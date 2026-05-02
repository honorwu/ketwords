const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ensureWordlistJson } = require("./lib/wordlist");
const { createStore } = require("./lib/store");
const { ensureWordOfflineData } = require("./lib/offline-cache");

const PORT = Number(process.env.PORT || 3210);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const AUTH_CONFIG_PATH = path.join(DATA_DIR, "auth-config.json");
const BACKUP_DIR = process.env.KET_BACKUP_DIR || path.join(DATA_DIR, "backups");
const SESSION_COOKIE = "ket_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_RETENTION_DAYS = Number(process.env.KET_BACKUP_RETENTION_DAYS || 30);
const BUILD_INFO = {
  commit: readBuildCommit(),
  startedAt: new Date().toISOString(),
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let store;
const authConfig = loadAuthConfig();

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, {
    error: message,
  });
}

function readBuildCommit() {
  const envCommit =
    process.env.GIT_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA;

  if (envCommit) {
    return envCommit.slice(0, 12);
  }

  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return null;
  }
}

function normalizeOptionKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[()\uFF08\uFF09]/g, "")
    .replace(/[\uFF1B;\u3001\uFF0C,./\s-]+/g, "")
    .trim();
}

function getOptionGroupKey(item, label = "") {
  const termKey = normalizeOptionKey(item?.normalizedTerm || item?.term);
  const labelKey = normalizeOptionKey(label);

  if (["phone", "mobilephone", "cellphone", "telephone"].includes(termKey)) {
    return "phone";
  }

  if (/(电话|手机|移动电话)/.test(labelKey)) {
    return "phone";
  }

  if (termKey === "classroom" || /(教室|课堂)/.test(labelKey)) {
    return "school-room";
  }

  if (termKey === "class") {
    return "school-class";
  }

  return labelKey || termKey;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";

    request.on("data", (chunk) => {
      data += chunk;
    });

    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("请求体不是合法的 JSON。"));
      }
    });

    request.on("error", reject);
  });
}

function randomSecret(size = 18) {
  return crypto.randomBytes(size).toString("base64url");
}

function hashPassword(password) {
  const salt = randomSecret(16);
  const hash = crypto
    .scryptSync(String(password), salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    })
    .toString("base64url");

  return `scrypt$16384$8$1$${salt}$${hash}`;
}

function verifyPasswordHash(password, encodedHash) {
  const [algorithm, nValue, rValue, pValue, salt, storedHash] = String(encodedHash || "").split("$");

  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  let candidateHash;

  try {
    candidateHash = crypto
      .scryptSync(String(password), salt, 32, {
        N: Number(nValue),
        r: Number(rValue),
        p: Number(pValue),
      })
      .toString("base64url");
  } catch (error) {
    return false;
  }

  return safeEqual(candidateHash, storedHash);
}

function loadAuthConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let fileConfig = {};

  if (fs.existsSync(AUTH_CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, "utf8"));
    } catch (error) {
      console.warn("认证配置读取失败，将重新生成缺失项。", error);
    }
  }

  const studyPassword =
    process.env.KET_STUDY_PASSWORD || process.env.STUDY_PASSWORD || fileConfig.studyPassword;
  const adminPassword =
    process.env.KET_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || fileConfig.adminPassword;
  const nextConfig = {
    studyPasswordHash: process.env.KET_STUDY_PASSWORD_HASH || fileConfig.studyPasswordHash,
    adminPasswordHash: process.env.KET_ADMIN_PASSWORD_HASH || fileConfig.adminPasswordHash,
    sessionSecret:
      process.env.KET_SESSION_SECRET || process.env.SESSION_SECRET || fileConfig.sessionSecret,
  };

  let generated = false;

  if (studyPassword) {
    nextConfig.studyPasswordHash = hashPassword(studyPassword);
    generated = true;
  }

  if (adminPassword) {
    nextConfig.adminPasswordHash = hashPassword(adminPassword);
    generated = true;
  }

  if (!nextConfig.studyPasswordHash) {
    nextConfig.studyPasswordHash = hashPassword(randomSecret());
    generated = true;
  }

  if (!nextConfig.adminPasswordHash) {
    nextConfig.adminPasswordHash = hashPassword(randomSecret());
    generated = true;
  }

  if (!nextConfig.sessionSecret) {
    nextConfig.sessionSecret = randomSecret(32);
    generated = true;
  }

  if (generated || !fs.existsSync(AUTH_CONFIG_PATH) || fileConfig.studyPassword || fileConfig.adminPassword) {
    fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(nextConfig, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`已生成认证配置：${AUTH_CONFIG_PATH}`);
  }

  return nextConfig;
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        const key = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
        const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";
        return [key, decodeURIComponent(value)];
      })
  );
}

function signSessionBody(body) {
  return crypto
    .createHmac("sha256", authConfig.sessionSecret)
    .update(body)
    .digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createSessionToken(role) {
  const body = Buffer.from(
    JSON.stringify({
      role,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    })
  ).toString("base64url");

  return `${body}.${signSessionBody(body)}`;
}

function readSession(request) {
  const token = parseCookies(request.headers.cookie || "")[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");

  if (!body || !signature || !safeEqual(signature, signSessionBody(body))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

    if (!session.exp || session.exp < Date.now()) {
      return null;
    }

    if (session.role !== "study" && session.role !== "admin") {
      return null;
    }

    return session;
  } catch (error) {
    return null;
  }
}

function buildSessionCookie(request, token) {
  const isSecure =
    process.env.KET_COOKIE_SECURE === "1" ||
    request.headers["x-forwarded-proto"] === "https";

  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function buildClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function canAccess(session, role) {
  if (!session) {
    return false;
  }

  return role === "study"
    ? session.role === "study" || session.role === "admin"
    : session.role === "admin";
}

function requireAuth(request, response, role) {
  const session = readSession(request);

  if (!session) {
    sendError(response, 401, "请先登录。");
    return null;
  }

  if (!canAccess(session, role)) {
    sendError(response, 403, "没有权限访问这里。");
    return null;
  }

  return session;
}

function verifyPassword(role, password) {
  if (role === "admin") {
    return verifyPasswordHash(password, authConfig.adminPasswordHash) ? "admin" : null;
  }

  if (verifyPasswordHash(password, authConfig.studyPasswordHash)) {
    return "study";
  }

  if (verifyPasswordHash(password, authConfig.adminPasswordHash)) {
    return "admin";
  }

  return null;
}

async function ensureWordMeaning(state) {
  if (!state) {
    return state;
  }

  if (state.chineseMeaning) {
    return state;
  }

  return ensureWordOfflineData(store, state, {
    allowNetwork: false,
    includeMeaning: true,
    includePhonetic: false,
    includeAudio: false,
  });
}

async function ensureWordEnriched(state) {
  if (!state) {
    return state;
  }

  return ensureWordOfflineData(store, state, {
    allowNetwork: false,
  });
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }

  return copy;
}

function buildSpellingHint(term) {
  const letters = term.replace(/[^a-zA-Z]/g, "");
  const firstLetter = letters.charAt(0).toUpperCase();
  return `${firstLetter} 开头，约 ${letters.length || term.length} 个字母`;
}

async function buildCard() {
  const next = store.getNextCandidate();

  if (next.status === "done" || !next.candidate) {
    return {
      status: "done",
      plan: next.plan,
      card: null,
      message: next.message || "今天的计划完成了，可以先休息一下，明天再继续。",
    };
  }

  const candidate = await ensureWordEnriched(next.candidate);
  const pool = store.getDistractorPool(candidate.wordId, 14);
  const distractorCandidates = await Promise.all(
    pool.slice(0, 10).map((item) => ensureWordMeaning(item))
  );
  const candidateLabel = candidate.chineseMeaning || candidate.term;
  const usedMeanings = new Set([getOptionGroupKey(candidate, candidateLabel)]);

  const distractors = [];

  for (const item of distractorCandidates) {
    const label = item.chineseMeaning || item.term;
    const optionKey = getOptionGroupKey(item, label);

    if (usedMeanings.has(optionKey)) {
      continue;
    }

    usedMeanings.add(optionKey);
    distractors.push({
      wordId: item.wordId,
      label,
    });

    if (distractors.length >= 3) {
      break;
    }
  }

  const options = shuffle(
    [
      {
        wordId: candidate.wordId,
        label: candidateLabel,
      },
      ...distractors,
    ].slice(0, 4)
  );

  return {
    status: "ready",
    plan: next.plan,
    card: {
      wordId: candidate.wordId,
      term: candidate.term,
      baseTerm: candidate.baseTerm,
      partOfSpeech: candidate.partOfSpeech,
      mode: next.mode,
      priority: candidate.priority,
      theme: candidate.theme,
      chineseMeaning: candidate.chineseMeaning || "",
      phonetic: candidate.phonetic || "",
      audioUrl: candidate.audioUrl || "",
      example: next.mode === "recognize" ? candidate.examples?.[0] || "" : "",
      options,
      hint: buildSpellingHint(candidate.baseTerm),
      flowNote:
        candidate.priority === "S"
          ? next.mode === "spell"
            ? candidate.spellingRequired
              ? "这是 S 级拼写词，今天做一次默写，下一次默写会放到后面的学习日。"
              : "这是重点词，今天进入默写环节。"
            : next.mode === "listen"
              ? "这是 S 级拼写词，今天先听词，默写会放到后面的学习日。"
              : "这是 S 级拼写词，今天先认词，听词和默写会放到后面的学习日。"
          : "",
      prompt:
        next.mode === "spell"
          ? "看中文写英文"
          : next.mode === "listen"
            ? "听发音选中文"
            : "看英文选中文",
    },
  };
}

function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.join(PUBLIC_DIR, relativePath);
  const normalized = path.normalize(resolvedPath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    sendError(response, 403, "不允许访问这个文件。");
    return;
  }

  const requestedHasExtension = Boolean(path.extname(relativePath));
  const fileExists = fs.existsSync(normalized);

  if (!fileExists && requestedHasExtension) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end("Not found");
    return;
  }

  const filePath = fileExists ? normalized : path.join(PUBLIC_DIR, "index.html");

  const extension = path.extname(filePath);
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  const noStoreExtensions = new Set([".html", ".js", ".css"]);

  response.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": noStoreExtensions.has(extension)
      ? "no-store"
      : "public, max-age=300",
  });

  fs.createReadStream(filePath).pipe(response);
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function runDatabaseBackup(reason = "daily") {
  if (process.env.KET_AUTO_BACKUP === "0") {
    return;
  }

  const backupPath = path.join(BACKUP_DIR, `ketwords-${dateKey()}.sqlite`);

  if (fs.existsSync(backupPath)) {
    return;
  }

  const savedPath = store.backupDatabase(backupPath);
  cleanupOldBackups();
  console.log(`学习数据已备份（${reason}）：${savedPath}`);
}

function cleanupOldBackups() {
  if (!Number.isFinite(BACKUP_RETENTION_DAYS) || BACKUP_RETENTION_DAYS <= 0) {
    return;
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    return;
  }

  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86400000;

  for (const file of fs.readdirSync(BACKUP_DIR)) {
    if (!/^ketwords-\d{4}-\d{2}-\d{2}\.sqlite/.test(file)) {
      continue;
    }

    const fullPath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(fullPath);

    if (stats.mtimeMs < cutoff) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

function startBackupScheduler() {
  runDatabaseBackup("startup");
  setInterval(() => runDatabaseBackup("daily"), BACKUP_CHECK_INTERVAL_MS).unref();
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/auth/me") {
    const session = readSession(request);
    sendJson(response, 200, {
      authenticated: Boolean(session),
      role: session?.role || null,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readRequestBody(request);
    const role = body.role === "admin" ? "admin" : "study";
    const verifiedRole = verifyPassword(role, body.password || "");

    if (!verifiedRole || !canAccess({ role: verifiedRole }, role)) {
      sendError(response, 401, "密码不正确。");
      return;
    }

    const token = createSessionToken(verifiedRole);
    sendJson(
      response,
      200,
      {
        authenticated: true,
        role: verifiedRole,
      },
      {
        "Set-Cookie": buildSessionCookie(request, token),
      }
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    sendJson(
      response,
      200,
      {
        ok: true,
      },
      {
        "Set-Cookie": buildClearCookie(),
      }
    );
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      build: BUILD_INFO,
      runtime: store?.getDiagnostics ? store.getDiagnostics() : null,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/overview") {
    if (!requireAuth(request, response, "study")) {
      return;
    }

    sendJson(response, 200, store.getOverview());
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/api/checkin")) {
    if (!requireAuth(request, response, "study")) {
      return;
    }

    const offset = Number(url.searchParams.get("offset") || "0");
    sendJson(response, 200, store.getDailyActivity(120, offset));
    return;
  }

  if (request.method === "GET" && pathname === "/api/study/next") {
    if (!requireAuth(request, response, "study")) {
      return;
    }

    sendJson(response, 200, await buildCard());
    return;
  }

  if (request.method === "GET" && pathname === "/api/parent/words") {
    if (!requireAuth(request, response, "admin")) {
      return;
    }

    sendJson(response, 200, {
      words: store.getParentWords(),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/parent/words") {
    if (!requireAuth(request, response, "admin")) {
      return;
    }

    const body = await readRequestBody(request);

    if (!body.term) {
      sendError(response, 400, "请先输入要补充的英文单词或词组。");
      return;
    }

    const result = store.addParentWord({
      term: body.term,
      meaning: body.meaning,
    });

    const enriched = await ensureWordOfflineData(store, result.state, {
      allowNetwork: true,
    });

    sendJson(response, 200, {
      action: result.action,
      word: {
        wordId: enriched.wordId,
        term: enriched.term,
        meaning: enriched.chineseMeaning || "",
        audioUrl: enriched.audioUrl || "",
      },
      overview: store.getOverview(),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/study/answer") {
    if (!requireAuth(request, response, "study")) {
      return;
    }

    const body = await readRequestBody(request);

    if (!body.wordId || !body.mode) {
      sendError(response, 400, "缺少答题参数。");
      return;
    }

    const result = store.submitAnswer(body);
    sendJson(response, 200, {
      ...result,
      overview: store.getOverview(),
    });
    return;
  }

  sendError(response, 404, "没有找到这个接口。");
}

async function bootstrap() {
  store = createStore();

  if (store.getWordCount() === 0) {
    const words = await ensureWordlistJson();
    store.syncWords(words);
  }

  startBackupScheduler();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url.pathname);
        return;
      }

      serveStatic(request, response, url.pathname);
    } catch (error) {
      console.error(error);
      sendError(response, 500, "服务器出错了，请稍后再试。");
    }
  });

  server.listen(PORT, () => {
    console.log(`Vocabulary trainer running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
