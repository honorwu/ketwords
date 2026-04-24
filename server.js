const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { ensureWordlistJson } = require("./lib/wordlist");
const { createStore } = require("./lib/store");
const { ensureWordOfflineData } = require("./lib/offline-cache");

const PORT = Number(process.env.PORT || 3210);
const PUBLIC_DIR = path.join(__dirname, "public");

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, {
    error: message,
  });
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
  const usedMeanings = new Set([candidate.chineseMeaning || candidate.term]);

  const distractors = [];

  for (const item of distractorCandidates) {
    const label = item.chineseMeaning || item.term;

    if (usedMeanings.has(label)) {
      continue;
    }

    usedMeanings.add(label);
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
        label: candidate.chineseMeaning || candidate.term,
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

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/overview") {
    sendJson(response, 200, store.getOverview());
    return;
  }

  if (request.method === "GET" && pathname === "/api/study/next") {
    sendJson(response, 200, await buildCard());
    return;
  }

  if (request.method === "GET" && pathname === "/api/parent/words") {
    sendJson(response, 200, {
      words: store.getParentWords(),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/parent/words") {
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

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
    });
    return;
  }

  sendError(response, 404, "没有找到这个接口。");
}

async function bootstrap() {
  const words = await ensureWordlistJson();
  store = createStore();
  store.syncWords(words);

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
    console.log(`KET words server running at http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
