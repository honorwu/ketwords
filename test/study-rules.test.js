const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const { normalizeStudyConfig } = require("../lib/study-config");
const { getLearningTarget } = require("../lib/study-progress");
const {
  getModeOrderForToday,
  isParkedAfterWrong,
  sortStudyCandidates,
} = require("../lib/study-selection");
const { normalizeLearningWordKeys } = require("../lib/store");

test("学习配置统一提供每日目标和复习规则", () => {
  const config = normalizeStudyConfig({});

  assert.deepEqual(config.dailyTargets, {
    recognize: 60,
    listen: 20,
    spell: 10,
  });
  assert.deepEqual(config.wrongParkDays, {
    recognize: 3,
    listen: 3,
    spell: 7,
  });
  assert.equal(config.spellFrequencyMinScore, 5.5);
  assert.equal(config.afterTargetSequence.length, 9);
});

test("只有达到词频线的单个单词进入拼写", () => {
  const config = normalizeStudyConfig({ spellFrequencyMinScore: 5.5 });

  assert.equal(getLearningTarget({ baseTerm: "school", frequencyScore: 5.5 }, config), "spell");
  assert.equal(getLearningTarget({ baseTerm: "mum", frequencyScore: 5.49 }, config), "listen");
  assert.equal(getLearningTarget({ baseTerm: "a few", frequencyScore: 7 }, config), "listen");
});

test("学习队列先排未接触词，再按数值词频排序", () => {
  const candidates = [
    { term: "seen", firstSeenAt: "2026-07-01T00:00:00Z", frequencyScore: 8, sourceOrder: 1 },
    { term: "lower", firstSeenAt: null, frequencyScore: 5, sourceOrder: 2 },
    { term: "higher", firstSeenAt: null, frequencyScore: 6, sourceOrder: 3 },
  ];

  candidates.sort((left, right) => sortStudyCandidates(left, right, "recognize"));
  assert.deepEqual(candidates.map((candidate) => candidate.term), ["higher", "lower", "seen"]);
});

test("每日目标完成后按 6:2:1 继续加练", () => {
  assert.equal(getModeOrderForToday({ cards: 0, recognizeCards: 0, listenCards: 0, spellCards: 0 })[0], "recognize");
  assert.equal(getModeOrderForToday({ cards: 60, recognizeCards: 60, listenCards: 0, spellCards: 0 })[0], "listen");
  assert.equal(getModeOrderForToday({ cards: 80, recognizeCards: 60, listenCards: 20, spellCards: 0 })[0], "spell");
  assert.deepEqual(
    getModeOrderForToday({ cards: 90, recognizeCards: 60, listenCards: 20, spellCards: 10 }).slice(0, 9),
    ["recognize", "recognize", "recognize", "recognize", "recognize", "recognize", "listen", "listen", "spell"]
  );
});

test("认词听词错题等待 3 天，拼写错题等待 7 天", () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const state = (mode, lastSeenAt) => ({
    lastResult: "wrong",
    lastMode: mode,
    lastSeenAt,
  });

  assert.equal(isParkedAfterWrong(state("recognize", "2026-07-12T12:00:00Z"), "recognize", now), true);
  assert.equal(isParkedAfterWrong(state("listen", "2026-07-10T12:00:00Z"), "listen", now), false);
  assert.equal(isParkedAfterWrong(state("spell", "2026-07-08T12:00:00Z"), "spell", now), true);
  assert.equal(isParkedAfterWrong(state("spell", "2026-07-06T12:00:00Z"), "spell", now), false);
});

test("旧学习 key 只在失效时按当前词库规范化", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY, normalized_term TEXT NOT NULL UNIQUE);
    CREATE TABLE progress (word_id INTEGER PRIMARY KEY, word_key TEXT);
    CREATE TABLE study_logs (id INTEGER PRIMARY KEY, word_id INTEGER, word_key TEXT);
    CREATE TABLE parent_focus_words (word_id INTEGER PRIMARY KEY, word_key TEXT);
    INSERT INTO words VALUES (1, 'current-key'), (2, 'stable-key');
    INSERT INTO progress VALUES (1, 'old-key');
    INSERT INTO study_logs VALUES (1, 1, NULL);
    INSERT INTO parent_focus_words VALUES (1, 'stable-key');
  `);

  normalizeLearningWordKeys(db);

  assert.equal(db.prepare("SELECT word_key FROM progress").get().word_key, "current-key");
  assert.equal(db.prepare("SELECT word_key FROM study_logs").get().word_key, "current-key");
  assert.equal(db.prepare("SELECT word_key FROM parent_focus_words").get().word_key, "stable-key");
  db.close();
});
