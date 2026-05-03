const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { ensureWordlistJson } = require("./lib/wordlist");
const { createStore } = require("./lib/store");
const { createAuth } = require("./lib/auth");
const { createBackupScheduler } = require("./lib/backup-scheduler");
const { createCardBuilder } = require("./lib/study-card");

const PORT = Number(process.env.PORT || 3210);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const AUTH_CONFIG_PATH = path.join(DATA_DIR, "auth-config.json");
const BACKUP_DIR = process.env.KET_BACKUP_DIR || path.join(DATA_DIR, "backups");
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
let buildCard;
const auth = createAuth({
  dataDir: DATA_DIR,
  authConfigPath: AUTH_CONFIG_PATH,
});

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

function requireAuth(request, response, role) {
  const session = auth.readSession(request);

  if (!session) {
    sendError(response, 401, "请先登录。");
    return null;
  }

  if (!auth.canAccess(session, role)) {
    sendError(response, 403, "没有权限访问这里。");
    return null;
  }

  return session;
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

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/auth/me") {
    const session = auth.readSession(request);
    sendJson(response, 200, {
      authenticated: Boolean(session),
      role: session?.role || null,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readRequestBody(request);
    const role = body.role === "admin" ? "admin" : "study";
    const verifiedRole = auth.verifyPassword(role, body.password || "");

    if (!verifiedRole || !auth.canAccess({ role: verifiedRole }, role)) {
      sendError(response, 401, "密码不正确。");
      return;
    }

    const token = auth.createSessionToken(verifiedRole);
    sendJson(
      response,
      200,
      {
        authenticated: true,
        role: verifiedRole,
      },
      {
        "Set-Cookie": auth.buildSessionCookie(request, token),
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
        "Set-Cookie": auth.buildClearCookie(),
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
      words: store.getWordProgress(),
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
  buildCard = createCardBuilder(store);

  if (store.getWordCount() === 0) {
    const words = await ensureWordlistJson();
    store.syncWords(words);
  }

  createBackupScheduler(store, {
    backupDir: BACKUP_DIR,
    retentionDays: BACKUP_RETENTION_DAYS,
  })();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
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
