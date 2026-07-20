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
  getModePriorityOrder,
  getNextReviewAtAfterAnswer,
  getWordMapStatus,
  isWordAvailableToday,
  isParkedAfterWrong,
  sortStudyCandidates,
} = require("../lib/study-selection");
const { normalizeLearningWordKeys } = require("../lib/store");

test("学习配置只保留日期和复习规则", () => {
  const config = normalizeStudyConfig({});

  assert.deepEqual(config.wrongParkDays, {
    recognize: 1,
    listen: 1,
    spell: 1,
  });
  assert.equal(config.repeatedWrongThreshold, 3);
  assert.equal("dailyTargets" in config, false);
  assert.equal("afterTargetSequence" in config, false);
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
  assert.equal(
    getWordMapStatus({
      ...base,
      lastMode: "recognize",
      lastResult: "wrong",
    }),
    "recognize-wrong"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      recognitionStage: 1,
      lastMode: "recognize",
      lastResult: "correct",
    }),
    "listen-pending"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      recognitionStage: 1,
      lastMode: "listen",
      lastResult: "wrong",
    }),
    "listen-wrong"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      recognitionStage: 1,
      listeningStage: 1,
      lastMode: "listen",
      lastResult: "correct",
    }),
    "spell-pending"
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
    "spell-wrong"
  );
  assert.equal(
    getWordMapStatus({
      ...base,
      learningTarget: "listen",
      recognitionStage: 1,
      listeningStage: 1,
      lastMode: "listen",
      lastResult: "correct",
    }),
    "mastered"
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

test("选题固定按认词、听词、拼写排序", () => {
  assert.deepEqual(getModePriorityOrder(), ["recognize", "listen", "spell"]);
});

test("认词听词和拼写错题都等待到第二天", () => {
  const now = new Date("2026-07-14T12:00:00Z");
  const state = (mode, lastSeenAt) => ({
    lastResult: "wrong",
    lastMode: mode,
    lastSeenAt,
  });

  assert.equal(isParkedAfterWrong(state("recognize", "2026-07-14T00:00:00Z"), "recognize", now), true);
  assert.equal(isParkedAfterWrong(state("listen", "2026-07-13T11:59:59Z"), "listen", now), false);
  assert.equal(isParkedAfterWrong(state("spell", "2026-07-14T12:00:00Z"), "spell", now), true);
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
  assert.deepEqual(
    applyResultToStages(
      {
        recognitionStage: 1,
        listeningStage: 1,
        spellingStage: 1,
      },
      "listen",
      "wrong"
    ),
    {
      recognitionStage: 0,
      listeningStage: 0,
      spellingStage: 0,
    }
  );
  assert.equal(applyResultToStages(state, "spell", "correct").spellingStage, 1);
});

test("同一个显示词形当天无论义项和阶段都只能出现一次", () => {
  const state = { baseTerm: "apple", normalizedTerm: "apple" };
  const studied = {
    recognize: new Set(["apple"]),
    listen: new Set(),
    spell: new Set(),
  };

  assert.equal(isWordAvailableToday(state, studied), false);
  assert.equal(
    isWordAvailableToday(
      { baseTerm: "design", normalizedTerm: "design 408" },
      { ...studied, recognize: new Set(["design"]) }
    ),
    false
  );
  assert.equal(
    isWordAvailableToday({ baseTerm: "banana", normalizedTerm: "banana" }, studied),
    true
  );
});

test("听词答错后从认词阶段作为错词优先重学", () => {
  const now = new Date("2026-07-16T12:00:00Z");
  const studied = { recognize: new Set(), listen: new Set(), spell: new Set() };
  const listenWrong = {
    wordId: 1,
    baseTerm: "design",
    normalizedTerm: "design 407",
    learningTarget: "spell",
    firstSeenAt: "2026-07-14T00:00:00Z",
    lastSeenAt: "2026-07-15T00:00:00Z",
    nextReviewAt: "2026-07-16T00:00:00Z",
    lastMode: "listen",
    lastResult: "wrong",
    recognitionStage: 0,
    listeningStage: 0,
    spellingStage: 0,
    frequencyScore: 1,
    sourceOrder: 2,
  };
  const unseen = {
    ...listenWrong,
    wordId: 2,
    baseTerm: "apple",
    normalizedTerm: "apple",
    firstSeenAt: null,
    lastSeenAt: null,
    nextReviewAt: null,
    lastMode: null,
    lastResult: null,
    frequencyScore: 9,
    sourceOrder: 1,
  };

  assert.equal(getWordMapStatus(listenWrong), "listen-wrong");
  assert.deepEqual(
    getEligibleModeCandidates([unseen, listenWrong], "recognize", now, studied).map(
      (item) => item.normalizedTerm
    ),
    ["design 407", "apple"]
  );
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
  assert.equal(getDeferredSpellRetryCandidates([wrong], now, studied)[0], wrong);
  assert.deepEqual(
    getDeferredSpellRetryCandidates(
      [wrong],
      now,
      { ...studied, spell: new Set(["apple"]) }
    ),
    []
  );
});

test("未掌握时无论答对答错都最早在第二天再次出现", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const nextDay = new Date(now);
  nextDay.setHours(0, 0, 0, 0);
  nextDay.setDate(nextDay.getDate() + 1);

  assert.equal(
    getNextReviewAtAfterAnswer(false, now).toISOString(),
    nextDay.toISOString()
  );
  assert.equal(
    getNextReviewAtAfterAnswer(true, now).getTime() > nextDay.getTime(),
    true
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
