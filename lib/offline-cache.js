const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
const FONT_DIR = path.join(PUBLIC_DIR, "assets", "fonts");
const FONT_STYLESHEET_PATH = path.join(PUBLIC_DIR, "fonts.css");
const USER_AGENT = "ketwords-offline-cache/1.0";

const FONT_FILES = [
  {
    family: "Baloo 2",
    weight: 500,
    format: "truetype",
    fileName: "baloo-2-500.ttf",
    url: "https://fonts.gstatic.com/s/baloo2/v23/wXK0E3kTposypRydzVT08TS3JnAmtdgozapv.ttf",
  },
  {
    family: "Baloo 2",
    weight: 600,
    format: "truetype",
    fileName: "baloo-2-600.ttf",
    url: "https://fonts.gstatic.com/s/baloo2/v23/wXK0E3kTposypRydzVT08TS3JnAmtdjEyqpv.ttf",
  },
  {
    family: "Baloo 2",
    weight: 700,
    format: "truetype",
    fileName: "baloo-2-700.ttf",
    url: "https://fonts.gstatic.com/s/baloo2/v23/wXK0E3kTposypRydzVT08TS3JnAmtdj9yqpv.ttf",
  },
  {
    family: "Nunito",
    weight: 500,
    format: "truetype",
    fileName: "nunito-500.ttf",
    url: "https://fonts.gstatic.com/s/nunito/v32/XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhRTM.ttf",
  },
  {
    family: "Nunito",
    weight: 700,
    format: "truetype",
    fileName: "nunito-700.ttf",
    url: "https://fonts.gstatic.com/s/nunito/v32/XRXI3I6Li01BKofiOc5wtlZ2di8HDFwmRTM.ttf",
  },
  {
    family: "Nunito",
    weight: 800,
    format: "truetype",
    fileName: "nunito-800.ttf",
    url: "https://fonts.gstatic.com/s/nunito/v32/XRXI3I6Li01BKofiOc5wtlZ2di8HDDsmRTM.ttf",
  },
];

function buildFontStylesheet() {
  return `${FONT_FILES.map(
    (font) => `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${font.weight};
  font-display: swap;
  src: url('/assets/fonts/${font.fileName}') format('${font.format}');
}`
  ).join("\n\n")}\n`;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeAudioUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url;
}

async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 8000,
    retries = 1,
    parse = "json",
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (parse === "buffer") {
        return Buffer.from(await response.arrayBuffer());
      }

      if (parse === "text") {
        return response.text();
      }

      return response.json();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(300 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function cleanTranslationPayload(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return "";
  }

  return payload[0]
    .map((part) => part[0] || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

async function translateToChinese(term) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
    encodeURIComponent(term);

  try {
    const payload = await fetchWithRetry(url, {
      timeoutMs: 8000,
      retries: 1,
    });
    return cleanTranslationPayload(payload);
  } catch (error) {
    return "";
  }
}

async function fetchDictionaryMeta(term) {
  const normalizedTerm = String(term || "").trim();

  if (!normalizedTerm) {
    return {
      phonetic: "",
      audioCandidates: [],
    };
  }

  const url =
    "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(normalizedTerm);

  try {
    const payload = await fetchWithRetry(url, {
      timeoutMs: 8000,
      retries: 1,
    });

    if (!Array.isArray(payload) || payload.length === 0) {
      return {
        phonetic: "",
        audioCandidates: [],
      };
    }

    const entry = payload[0];
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    const phoneticRecord = phonetics.find((item) => item.text) || entry;
    const audioCandidates = phonetics
      .map((item) => normalizeAudioUrl(item.audio))
      .filter(Boolean);

    return {
      phonetic: phoneticRecord?.text || entry.phonetic || "",
      audioCandidates: Array.from(new Set(audioCandidates)),
    };
  } catch (error) {
    return {
      phonetic: "",
      audioCandidates: [],
    };
  }
}

function isSpeakableCandidate(value) {
  return /^[A-Za-z][A-Za-z' -]*$/.test(value);
}

function expandOptionalSpellings(value) {
  const source = String(value || "").trim();

  if (!source) {
    return [];
  }

  const match = source.match(/\(([^()]+)\)/);

  if (!match) {
    return [source];
  }

  const [segment, inner] = match;
  const withSegment = source.replace(segment, inner);
  const withoutSegment = source.replace(segment, "");

  return Array.from(
    new Set([
      ...expandOptionalSpellings(withSegment),
      ...expandOptionalSpellings(withoutSegment),
    ])
  );
}

function buildLookupTerms(state) {
  const rawCandidates = [
    state?.normalizedTerm,
    state?.baseTerm,
    state?.term,
    ...(Array.isArray(state?.acceptedSpellings) ? state.acceptedSpellings : []),
  ];
  const results = [];
  const seen = new Set();

  function addCandidate(value) {
    const candidate = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!candidate || !isSpeakableCandidate(candidate) || seen.has(candidate.toLowerCase())) {
      return;
    }

    seen.add(candidate.toLowerCase());
    results.push(candidate);
  }

  for (const rawCandidate of rawCandidates) {
    const candidate = String(rawCandidate || "").trim();

    if (!candidate) {
      continue;
    }

    const slashParts = candidate.split("/").map((item) => item.trim()).filter(Boolean);

    for (const part of slashParts) {
      const expandedParts = expandOptionalSpellings(part);

      for (const expandedPart of expandedParts) {
        addCandidate(expandedPart);
      }
    }
  }

  return results;
}

function pickLookupTerm(state) {
  const candidates = buildLookupTerms(state);
  return candidates[0] || String(state?.normalizedTerm || state?.baseTerm || state?.term || "").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getComputedAudioFileName(state) {
  const lookupTerm = pickLookupTerm(state).toLowerCase();
  const hash = crypto.createHash("sha1").update(lookupTerm).digest("hex").slice(0, 12);
  const slug = slugify(lookupTerm).slice(0, 48) || "word";
  return `${slug}-${hash}.mp3`;
}

function publicUrlToFilePath(publicUrl) {
  return path.join(PUBLIC_DIR, String(publicUrl || "").replace(/^\/+/, ""));
}

function fileExistsAndHasContent(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function getExistingLocalAudioUrl(state) {
  if (isLocalAudioUrl(state?.audioUrl)) {
    const existingPath = publicUrlToFilePath(state.audioUrl);

    if (fileExistsAndHasContent(existingPath)) {
      return state.audioUrl;
    }
  }

  const computedUrl = `/audio/${getComputedAudioFileName(state)}`;
  const computedPath = publicUrlToFilePath(computedUrl);

  if (fileExistsAndHasContent(computedPath)) {
    return computedUrl;
  }

  return "";
}

function getAudioCachePath(state) {
  const existingLocalAudioUrl = getExistingLocalAudioUrl(state);

  if (existingLocalAudioUrl) {
    return publicUrlToFilePath(existingLocalAudioUrl);
  }

  return path.join(AUDIO_DIR, getComputedAudioFileName(state));
}

function getAudioPublicUrl(state) {
  return getExistingLocalAudioUrl(state) || `/audio/${getComputedAudioFileName(state)}`;
}

function hasLocalAudio(state) {
  return Boolean(getExistingLocalAudioUrl(state));
}

function isLocalAudioUrl(audioUrl) {
  return typeof audioUrl === "string" && audioUrl.startsWith("/audio/");
}

function buildYoudaoAudioUrl(term) {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&type=1`;
}

function writeFileAtomic(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, contents);
  fs.renameSync(tempPath, filePath);
}

async function downloadBinaryIfMissing(url, targetPath) {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
    return {
      downloaded: false,
      filePath: targetPath,
    };
  }

  const buffer = await fetchWithRetry(url, {
    timeoutMs: 15000,
    retries: 1,
    parse: "buffer",
  });

  writeFileAtomic(targetPath, buffer);

  return {
    downloaded: true,
    filePath: targetPath,
  };
}

async function cacheFonts() {
  ensureDirectory(FONT_DIR);

  let downloaded = 0;

  for (const font of FONT_FILES) {
    const targetPath = path.join(FONT_DIR, font.fileName);
    const result = await downloadBinaryIfMissing(font.url, targetPath);

    if (result.downloaded) {
      downloaded += 1;
    }
  }

  const stylesheet = buildFontStylesheet();

  if (!fs.existsSync(FONT_STYLESHEET_PATH) || fs.readFileSync(FONT_STYLESHEET_PATH, "utf8") !== stylesheet) {
    writeFileAtomic(FONT_STYLESHEET_PATH, stylesheet);
  }

  return {
    downloaded,
    total: FONT_FILES.length,
    stylesheetPath: FONT_STYLESHEET_PATH,
  };
}

async function cacheAudioForWord(state, extraAudioCandidates = []) {
  ensureDirectory(AUDIO_DIR);

  if (hasLocalAudio(state)) {
    return {
      audioUrl: getAudioPublicUrl(state),
      downloaded: false,
      sourceUrl: "",
    };
  }

  const lookupTerms = buildLookupTerms(state);
  const candidates = Array.from(
    new Set(
      [
        ...lookupTerms.map((lookupTerm) => buildYoudaoAudioUrl(lookupTerm)),
        ...extraAudioCandidates.map(normalizeAudioUrl),
      ].filter(Boolean)
    )
  );

  for (const candidate of candidates) {
    try {
      const buffer = await fetchWithRetry(candidate, {
        timeoutMs: 15000,
        retries: 1,
        parse: "buffer",
      });

      if (buffer.length < 256) {
        continue;
      }

      writeFileAtomic(getAudioCachePath(state), buffer);

      return {
        audioUrl: getAudioPublicUrl(state),
        downloaded: true,
        sourceUrl: candidate,
      };
    } catch (error) {
      continue;
    }
  }

  return {
    audioUrl: "",
    downloaded: false,
    sourceUrl: "",
  };
}

async function ensureWordOfflineData(store, state, options = {}) {
  const settings = {
    allowNetwork: true,
    includeMeaning: true,
    includePhonetic: true,
    includeAudio: true,
    ...options,
  };

  if (!state) {
    return state;
  }

  const current =
    state.wordId && store?.getWordState ? store.getWordState(state.wordId) || state : state;
  const updates = {};
  let dictionaryMeta = null;

  if (settings.includeMeaning && !current.chineseMeaning && settings.allowNetwork) {
    const chineseMeaning = await translateToChinese(current.term);

    if (chineseMeaning) {
      updates.chineseMeaning = chineseMeaning;
    }
  }

  const localAudioUrl = settings.includeAudio && hasLocalAudio(current) ? getAudioPublicUrl(current) : "";
  const needsPhonetic = settings.includePhonetic && !current.phonetic;
  const needsAudio = settings.includeAudio && !localAudioUrl;

  if ((needsPhonetic || needsAudio) && settings.allowNetwork) {
    dictionaryMeta = await fetchDictionaryMeta(pickLookupTerm(current));

    if (needsPhonetic && dictionaryMeta.phonetic) {
      updates.phonetic = dictionaryMeta.phonetic;
    }
  }

  if (settings.includeAudio) {
    if (localAudioUrl) {
      if (current.audioUrl !== localAudioUrl) {
        updates.audioUrl = localAudioUrl;
      }
    } else if (settings.allowNetwork) {
      const audioResult = await cacheAudioForWord(current, dictionaryMeta?.audioCandidates || []);

      if (audioResult.audioUrl) {
        updates.audioUrl = audioResult.audioUrl;
      }
    }
  }

  if (Object.keys(updates).length > 0 && current.wordId && store?.updateWordMetadata) {
    return store.updateWordMetadata(current.wordId, updates);
  }

  return {
    ...current,
    ...updates,
    audioUrl: updates.audioUrl || localAudioUrl || current.audioUrl || "",
  };
}

module.exports = {
  AUDIO_DIR,
  FONT_DIR,
  FONT_STYLESHEET_PATH,
  cacheFonts,
  ensureWordOfflineData,
  getAudioCachePath,
  getAudioPublicUrl,
  hasLocalAudio,
  isLocalAudioUrl,
};
