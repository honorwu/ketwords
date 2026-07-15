const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const WORD_BANK_PATH = path.join(ROOT_DIR, "data", "wordbank.sqlite");

test("词库只保存数值词频并且资源引用完整", () => {
  const db = new DatabaseSync(WORD_BANK_PATH, { readOnly: true });
  const columns = db.prepare("PRAGMA table_info(words)").all().map((column) => column.name);
  const words = db.prepare(`
    SELECT term, audio_url, frequency_zipf, child_frequency_zipf, frequency_score
    FROM words
  `).all();

  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(words.length, 1716);
  assert.equal(columns.includes("priority"), false);
  assert.equal(columns.includes("frequency_band"), false);

  for (const word of words) {
    const expectedScore = Math.round(
      (word.frequency_zipf * 0.8 + (word.child_frequency_zipf ?? word.frequency_zipf) * 0.2) * 100
    ) / 100;
    assert.equal(word.frequency_score, expectedScore, `${word.term} 的综合词频不一致`);
    assert.ok(word.audio_url, `${word.term} 缺少音频索引`);
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "public", word.audio_url)), `${word.term} 的音频文件不存在`);
  }

  const exactDuplicates = db.prepare(`
    SELECT lower(term) term, part_of_speech, chinese_meaning, COUNT(*) count
    FROM words
    GROUP BY lower(term), part_of_speech, chinese_meaning
    HAVING COUNT(*) > 1
  `).all();
  assert.deepEqual(exactDuplicates, []);

  const themes = db.prepare(`
    SELECT theme, chinese_meaning
    FROM words
  `).all();
  assert.deepEqual(
    themes.filter((word) => !String(word.chinese_meaning || "").trim()),
    [],
    "每个单词都必须有固定中文释义"
  );
  const meaningsByTheme = new Map();

  for (const word of themes) {
    const meaning = String(word.chinese_meaning || "")
      .normalize("NFKC")
      .replace(/[；;、，,。./\s]+/g, "")
      .trim();

    if (!meaningsByTheme.has(word.theme)) {
      meaningsByTheme.set(word.theme, new Set());
    }

    if (meaning) {
      meaningsByTheme.get(word.theme).add(meaning);
    }
  }

  for (const [theme, meanings] of meaningsByTheme) {
    assert.ok(meanings.size >= 4, `${theme} 类别不足以提供 3 个不同释义的干扰项`);
  }

  db.close();
});

test("扩展名为 mp3 的离线音频不再混入 WAV 内容", () => {
  const audioDir = path.join(ROOT_DIR, "public", "audio");
  const disguisedWavFiles = fs.readdirSync(audioDir)
    .filter((fileName) => fileName.endsWith(".mp3"))
    .filter((fileName) => {
      const descriptor = fs.openSync(path.join(audioDir, fileName), "r");
      const header = Buffer.alloc(4);
      fs.readSync(descriptor, header, 0, 4, 0);
      fs.closeSync(descriptor);
      return header.toString("ascii") === "RIFF";
    });

  assert.deepEqual(disguisedWavFiles, []);
});
