const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const { normalizeStudyConfig } = require("../lib/study-config");
const {
  compareWordMapByFrequency,
  getLearningTarget,
  getStageTargets,
  isRepeatedWrong,
} = require("../lib/study-progress");
const { applyResultToStages } = require("../lib/answer-evaluator");
const {
  getDeferredSpellRetryCandidates,
  getEligibleModeCandidates,
  getModeOrderForToday,
  getNextReviewAtAfterAnswer,
  getWordMapStatus,
  isAvailableForModeToday,
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
    recognize: 1,
    listen: 1,
    spell: 0,
  });
  assert.equal(config.repeatedWrongThreshold, 3);
  assert.equal(config.afterTargetSequence.length, 9);
});

test("家长掌握地图按当前学习阶段显示稳定状态", () => {
  const base = {
    firstSeenAt: "2026-07-15T00:00:00Z",
    learningTarget: "spell",
    recognitionStage: 0,
    listeningStage: 0,
    spellingStage: 0,
  };

  assert.equal(getWordMapStatus({ ...base, firstSeenAt: null }), "unseen");
  assert.equal(getWordMapStatus(base), "recognize");
  assert.equal(getWordMapStatus({ ...base, recognitionStage: 1 }), "listen");
  assert.equal(
    getWordMapStatus({ ...base, recognitionStage: 1, listeningStage: 1 }),
    "spell"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      recognitionStage: 1,
      listeningStage: 1,
      spellingStage: 1,
    }),
    "mastered"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      recognitionStage: 1,
      listeningStage: 1,
      lastMode: "spell",
      lastResult: "wrong",
    }),
    "spell-retry"
  );
});

test("累计错三次才标记为反复错词", () => {
  const config = normalizeStudyConfig({ repeatedWrongThreshold: 3 });

  assert.equal(isRepeatedWrong({ timesWrong: 2 }, config), false);
  assert.equal(isRepeatedWrong({ timesWrong: 3 }, config), true);
});

test("家长掌握地图按词频降序稳定排列", () => {
  const words = [
    { term: "low", frequencyScore: 3.2, sourceOrder: 1 },
    { term: "same-later", frequencyScore: 5.6, sourceOrder: 3 },
    { term: "high", frequencyScore: 7.1, sourceOrder: 2 },
    { term: "same-earlier", frequencyScore: 5.6, sourceOrder: 2 },
  ];

  words.sort(compareWordMapByFrequency);
  assert.deepEqual(
    words.map((word) => word.term),
    ["high", "same-earlier", "same-later", "low"]
  );
});

test("所有单个单词都拼写，含分隔符的词组不拼写", () => {
  assert.equal(getLearningTarget({ baseTerm: "school", frequencyScore: 1 }), "spell");
  assert.equal(getLearningTarget({ baseTerm: "mum", frequencyScore: null }), "spell");
  assert.equal(getLearningTarget({ baseTerm: "A2" }), "spell");
  assert.equal(getLearningTarget({ baseTerm: "a few" }), "listen");
  assert.equal(getLearningTarget({ baseTerm: "part-time" }), "listen");
  assert.equal(getLearningTarget({ baseTerm: "p.m." }), "listen");
  assert.deepEqual(getStageTargets({ learningTarget: "spell" }), {
    recognition: 1,
    listening: 1,
    spelling: 1,
  });
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

test("认词听词错题等待到第二天，拼写错题不按天停放", () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const state = (mode, lastSeenAt) => ({
    lastResult: "wrong",
    lastMode: mode,
    lastSeenAt,
  });

  assert.equal(isParkedAfterWrong(state("recognize", "2026-07-14T00:00:00Z"), "recognize", now), true);
  assert.equal(isParkedAfterWrong(state("listen", "2026-07-13T11:59:59Z"), "listen", now), false);
  assert.equal(isParkedAfterWrong(state("spell", "2026-07-14T12:00:00Z"), "spell", now), false);
});

test("答题结果严格决定当前阶段是否通过", () => {
  const state = {
    recognitionStage: 0,
    listeningStage: 0,
    spellingStage: 0,
  };

  assert.equal(applyResultToStages(state, "recognize", "correct").recognitionStage, 1);
  assert.equal(
    applyResultToStages({ ...state, recognitionStage: 1 }, "recognize", "wrong")
      .recognitionStage,
    0
  );
  assert.equal(applyResultToStages(state, "listen", "correct").listeningStage, 1);
  assert.equal(applyResultToStages(state, "spell", "correct").spellingStage, 1);
});

test("答对后当天可以进入下一阶段，但同一阶段当天不重复", () => {
  const state = { normalizedTerm: "apple" };
  const studied = {
    recognize: new Set(["apple"]),
    listen: new Set(),
    spell: new Set(),
  };

  assert.equal(isAvailableForModeToday(state, "recognize", studied), false);
  assert.equal(isAvailableForModeToday(state, "listen", studied), true);
  assert.equal(isAvailableForModeToday(state, "spell", studied), true);
});

test("到期的认词听词错题排在普通候选项之前", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const studied = { recognize: new Set(), listen: new Set(), spell: new Set() };
  const dueWrong = {
    wordId: 1,
    normalizedTerm: "wrong",
    learningTarget: "spell",
    firstSeenAt: "2026-07-13T00:00:00Z",
    lastSeenAt: "2026-07-14T00:00:00Z",
    nextReviewAt: "2026-07-15T00:00:00Z",
    lastMode: "recognize",
    lastResult: "wrong",
    recognitionStage: 0,
    listeningStage: 0,
    spellingStage: 0,
    frequencyScore: 1,
    sourceOrder: 2,
  };
  const unseen = {
    ...dueWrong,
    wordId: 2,
    normalizedTerm: "new",
    firstSeenAt: null,
    lastSeenAt: null,
    nextReviewAt: null,
    lastMode: null,
    lastResult: null,
    frequencyScore: 9,
    sourceOrder: 1,
  };

  assert.deepEqual(
    getEligibleModeCandidates([unseen, dueWrong], "recognize", now, studied).map(
      (item) => item.normalizedTerm
    ),
    ["wrong", "new"]
  );
});

test("拼写错词只在普通候选项清空后进入队尾重试", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const studied = { recognize: new Set(), listen: new Set(), spell: new Set() };
  const wrong = {
    wordId: 1,
    normalizedTerm: "apple",
    learningTarget: "spell",
    firstSeenAt: "2026-07-14T00:00:00Z",
    lastSeenAt: "2026-07-15T10:00:00Z",
    nextReviewAt: "2026-07-15T10:00:00Z",
    lastMode: "spell",
    lastResult: "wrong",
    recognitionStage: 1,
    listeningStage: 1,
    spellingStage: 0,
    frequencyScore: 5,
    sourceOrder: 1,
  };

  assert.deepEqual(getEligibleModeCandidates([wrong], "spell", now, studied), []);
  assert.equal(
    getDeferredSpellRetryCandidates([wrong], now, new Map([["apple", 1]]), 2)[0],
    wrong
  );
  assert.deepEqual(
    getDeferredSpellRetryCandidates([wrong], now, new Map([["apple", 2]]), 2),
    []
  );
});

test("认词听词答错排到次日，答对立即进入下一阶段", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const nextDay = new Date(now);
  nextDay.setHours(0, 0, 0, 0);
  nextDay.setDate(nextDay.getDate() + 1);

  assert.equal(
    getNextReviewAtAfterAnswer("recognize", "wrong", false, now).toISOString(),
    nextDay.toISOString()
  );
  assert.equal(
    getNextReviewAtAfterAnswer("listen", "wrong", false, now).toISOString(),
    nextDay.toISOString()
  );
  assert.equal(
    getNextReviewAtAfterAnswer("recognize", "correct", false, now).toISOString(),
    now.toISOString()
  );
  assert.equal(
    getNextReviewAtAfterAnswer("spell", "wrong", false, now).toISOString(),
    now.toISOString()
  );
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
