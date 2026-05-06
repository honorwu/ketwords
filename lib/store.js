const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { normalizeCompact, normalizeLookup } = require("./wordlist");
const { ensureStudyConfig } = require("./study-config");
const {
  addColumnIfMissing,
  createLearningSchema,
  createWordSchema,
} = require("./store-schema");

const WORD_BANK_DB_PATH = path.join(__dirname, "..", "data", "wordbank.sqlite");
const LEARNING_DB_PATH = path.join(__dirname, "..", "data", "learning.sqlite");
const EXAM_DATE = "2026-08-22";
const PREP_START_DATE = "2026-04-22";
const TARGET_MINUTES = 15;
const DAILY_RECOGNIZE_TARGET = 40;
const DAILY_LISTEN_TARGET = 20;
const DAILY_SPELL_TARGET = 15;
const DAILY_MODE_SEQUENCE = ["recognize", "listen", "spell"];
const HARD_SPELLING_WRONG_STREAK = 3;
const SPELLING_PARK_DAYS = 1;
const HARD_SPELLING_PARK_DAYS = 2;
const PRIORITY_SCORE = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

const DISPLAY_LABELS = Object.freeze({
  stageRecognize: "\u8ba4",
  stageListen: "\u542c",
  stageSpell: "\u62fc",
  mastered: "\u5df2\u638c\u63e1",
  tomorrowListen: "\u660e\u5929\u542c\u8bcd",
  tomorrowSpell: "\u660e\u5929\u9ed8\u5199",
  tomorrowSpellRepeat: "\u660e\u5929\u518d\u9ed8\u5199",
  spelling: "\u62fc\u5199\u4e2d",
  canListen: "\u80fd\u542c\u61c2\u4e00\u4e9b",
  started: "\u5f00\u59cb\u8ba4\u8bc6\u4e86",
  notStarted: "\u672a\u5f00\u59cb",
  nextSpell: "\u4e0b\u4e00\u6b65\u9ed8\u5199",
  nextListen: "\u4e0b\u4e00\u6b65\u542c\u8fa8",
  nextRecognize: "\u4e0b\u4e00\u6b65\u8ba4\u8bcd",
  longReview: "\u8fdb\u5165\u957f\u671f\u590d\u4e60",
});

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function diffDays(fromKey, toKey) {
  const diff = parseDateKey(fromKey) - parseDateKey(toKey);
  return Math.round(diff / 86400000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function displayMinutes(elapsedMs) {
  if (!elapsedMs) {
    return 0;
  }

  return Math.max(1, Math.round(elapsedMs / 60000));
}

function createStore() {
  fs.mkdirSync(path.dirname(LEARNING_DB_PATH), { recursive: true });

  if (!fs.existsSync(WORD_BANK_DB_PATH)) {
    throw new Error(
      `Missing word bank database. Expected ${WORD_BANK_DB_PATH}; commit and deploy the latest wordbank.sqlite.`
    );
  }

  const activeDbPath = LEARNING_DB_PATH;
  const db = new DatabaseSync(activeDbPath);
  const wordsTable = "wordbank.words";
  const progressJoin = "p.word_key = w.normalized_term OR (p.word_key IS NULL AND p.word_id = w.id)";

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`ATTACH DATABASE '${WORD_BANK_DB_PATH.replaceAll("'", "''")}' AS wordbank;`);
  createWordSchema(db, wordsTable);
  createLearningSchema(db, false);
  addColumnIfMissing(db, "progress", "word_key TEXT");
  addColumnIfMissing(db, "study_logs", "word_key TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_progress_word_key
      ON progress(word_key);

    CREATE INDEX IF NOT EXISTS idx_logs_word_key
      ON study_logs(word_key);
  `);

  db.exec(`
    UPDATE study_logs
    SET result = 'wrong'
    WHERE result = 'almost';

    UPDATE progress
    SET times_wrong = times_wrong + times_almost,
        times_almost = 0,
        last_result = CASE WHEN last_result = 'almost' THEN 'wrong' ELSE last_result END
    WHERE times_almost > 0 OR last_result = 'almost';

    UPDATE ${wordsTable}
    SET part_of_speech = CASE WHEN part_of_speech = 'custom' THEN 'unknown' ELSE part_of_speech END,
        theme = CASE WHEN theme = '家长补充' THEN 'general' ELSE theme END;
  `);

  const insertWord = db.prepare(`
    INSERT INTO ${wordsTable} (
      term,
      base_term,
      normalized_term,
      part_of_speech,
      theme,
      priority,
      examples_json,
      accepted_spellings_json,
      chinese_meaning,
      phonetic,
      audio_url,
      source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_term) DO UPDATE SET
      term = excluded.term,
      base_term = excluded.base_term,
      part_of_speech = excluded.part_of_speech,
      theme = excluded.theme,
      priority = excluded.priority,
      examples_json = excluded.examples_json,
      accepted_spellings_json = excluded.accepted_spellings_json,
      source_order = excluded.source_order
  `);

  const updateWordMetadata = db.prepare(`
    UPDATE ${wordsTable}
    SET chinese_meaning = ?,
        phonetic = ?,
        audio_url = ?
    WHERE id = ?
  `);

  const selectWordKeyById = db.prepare(`
    SELECT normalized_term
    FROM ${wordsTable}
    WHERE id = ?
  `);

  const selectJoinedState = db.prepare(`
    SELECT
      w.id,
      w.term,
      w.base_term,
      w.normalized_term,
      w.part_of_speech,
      w.theme,
      w.priority,
      w.examples_json,
      w.accepted_spellings_json,
      w.chinese_meaning,
      w.phonetic,
      w.audio_url,
      w.source_order,
      p.first_seen_at,
      p.introduced_date,
      p.last_seen_at,
      p.next_review_at,
      p.recognition_stage,
      p.listening_stage,
      p.spelling_stage,
      p.times_seen,
      p.times_correct,
      p.times_wrong,
      p.lapse_count,
      p.correct_streak,
      p.last_mode,
      p.last_result
    FROM ${wordsTable} w
    LEFT JOIN progress p
      ON ${progressJoin}
    WHERE w.id = ?
  `);

  function isSpellingPriority(priority, config = ensureStudyConfig()) {
    return new Set(config.spellPriorityLevels || ["S", "A"]).has(priority);
  }

  function getLearningTarget(row, config = ensureStudyConfig()) {
    return isSpellingPriority(row.priority, config) ? "spell" : "listen";
  }

  function hydrateRow(row, config = ensureStudyConfig()) {
    if (!row) {
      return null;
    }

    const learningTarget = getLearningTarget(row, config);

    return {
      wordId: row.id,
      term: row.term,
      baseTerm: row.base_term,
      normalizedTerm: row.normalized_term,
      partOfSpeech: row.part_of_speech,
      theme: row.theme,
      priority: row.priority,
      learningTarget,
      spellingRequired: learningTarget === "spell" ? 1 : 0,
      examples: JSON.parse(row.examples_json || "[]"),
      acceptedSpellings: JSON.parse(row.accepted_spellings_json || "[]"),
      chineseMeaning: row.chinese_meaning,
      phonetic: row.phonetic,
      audioUrl: row.audio_url,
      sourceOrder: row.source_order,
      firstSeenAt: row.first_seen_at,
      introducedDate: row.introduced_date,
      lastSeenAt: row.last_seen_at,
      nextReviewAt: row.next_review_at,
      recognitionStage: row.recognition_stage || 0,
      listeningStage: row.listening_stage || 0,
      spellingStage: row.spelling_stage || 0,
      timesSeen: row.times_seen || 0,
      timesCorrect: row.times_correct || 0,
      timesWrong: row.times_wrong || 0,
      lapseCount: row.lapse_count || 0,
      correctStreak: row.correct_streak || 0,
      lastMode: row.last_mode,
      lastResult: row.last_result,
    };
  }

  function getAllStates(config = ensureStudyConfig()) {
    const rows = db
      .prepare(`
        SELECT
          w.id,
          w.term,
          w.base_term,
          w.normalized_term,
          w.part_of_speech,
          w.theme,
          w.priority,
          w.examples_json,
          w.accepted_spellings_json,
          w.chinese_meaning,
          w.phonetic,
          w.audio_url,
          w.source_order,
          p.first_seen_at,
          p.introduced_date,
          p.last_seen_at,
          p.next_review_at,
          p.recognition_stage,
          p.listening_stage,
          p.spelling_stage,
          p.times_seen,
          p.times_correct,
          p.times_wrong,
          p.lapse_count,
          p.correct_streak,
          p.last_mode,
          p.last_result
        FROM ${wordsTable} w
        LEFT JOIN progress p
          ON ${progressJoin}
        ORDER BY
          CASE w.priority
            WHEN 'S' THEN 4
            WHEN 'A' THEN 3
            WHEN 'B' THEN 2
            ELSE 1
          END DESC,
          w.source_order ASC
      `)
      .all();

    return rows.map((row) => hydrateRow(row, config));
  }

  function getWordState(wordId, config = ensureStudyConfig()) {
    return hydrateRow(selectJoinedState.get(wordId), config);
  }

  function isMastered(state) {
    const targets = getStageTargets(state);
    return (
      state.recognitionStage >= targets.recognition &&
      state.listeningStage >= targets.listening &&
      state.spellingStage >= targets.spelling
    );
  }

  function isCoreGoal(state) {
    return state.priority === "S" || state.priority === "A";
  }

  function getStageTargets(state) {
    if (state.learningTarget === "spell") {
      return {
        recognition: 1,
        listening: 1,
        spelling: 2,
      };
    }

    if (state.learningTarget === "listen") {
      return {
        recognition: 1,
        listening: 1,
        spelling: 0,
      };
    }

    return {
      recognition: 1,
      listening: 1,
      spelling: 0,
    };
  }

  function getMasteryPercent(state) {
    const targets = getStageTargets(state);
    const total =
      targets.recognition + targets.listening + targets.spelling;

    if (!total) {
      return 0;
    }

    const current =
      Math.min(state.recognitionStage, targets.recognition) +
      Math.min(state.listeningStage, targets.listening) +
      Math.min(state.spellingStage, targets.spelling);

    return Math.round((current / total) * 100);
  }

  function getStageSummary(state) {
    const targets = getStageTargets(state);

    return [
      targets.recognition
        ? `${DISPLAY_LABELS.stageRecognize} ${Math.min(state.recognitionStage, targets.recognition)}/${targets.recognition}`
        : `${DISPLAY_LABELS.stageRecognize} -`,
      targets.listening
        ? `${DISPLAY_LABELS.stageListen} ${Math.min(state.listeningStage, targets.listening)}/${targets.listening}`
        : `${DISPLAY_LABELS.stageListen} -`,
      targets.spelling
        ? `${DISPLAY_LABELS.stageSpell} ${Math.min(state.spellingStage, targets.spelling)}/${targets.spelling}`
        : `${DISPLAY_LABELS.stageSpell} -`,
    ].join(" ");
  }

  function masteryLabel(state) {
    if (isMastered(state)) {
      return DISPLAY_LABELS.mastered;
    }

    const deferredMode = getDeferredMode(state);

    if (deferredMode === "listen") {
      return DISPLAY_LABELS.tomorrowListen;
    }

    if (deferredMode === "spell" && state.spellingStage === 0) {
      return DISPLAY_LABELS.tomorrowSpell;
    }

    if (deferredMode === "spell" && state.spellingStage >= 1) {
      return DISPLAY_LABELS.tomorrowSpellRepeat;
    }

    if (state.learningTarget === "spell" && state.spellingStage >= 1) {
      return DISPLAY_LABELS.spelling;
    }

    if (state.listeningStage >= 1) {
      return DISPLAY_LABELS.canListen;
    }

    if (state.recognitionStage >= 1) {
      return DISPLAY_LABELS.started;
    }

    return DISPLAY_LABELS.notStarted;
  }

  function syncWords(words) {
    db.exec("BEGIN");

    try {
      for (const word of words) {
        insertWord.run(
          word.term,
          word.baseTerm,
          word.normalizedTerm,
          word.partOfSpeech,
          word.theme,
          word.priority,
          JSON.stringify(word.examples || []),
          JSON.stringify(word.acceptedSpellings || [word.term]),
          null,
          null,
          null,
          word.sourceOrder
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getWordCount() {
    return Number(
      db.prepare(`SELECT COUNT(*) AS count FROM ${wordsTable}`).get().count || 0
    );
  }

  function ensureProgressRow(wordId) {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = todayKey(now);
    const wordKey = selectWordKeyById.get(wordId)?.normalized_term || null;

    db.prepare(`
      INSERT OR IGNORE INTO progress (
        word_id,
        word_key,
        first_seen_at,
        introduced_date,
        last_seen_at,
        next_review_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(wordId, wordKey, nowIso, today, nowIso, nowIso);

    return getWordState(wordId);
  }

  function getRecentLogs(days = 7) {
    const start = addDays(parseDateKey(todayKey()), -(days - 1));
    const startKey = todayKey(start);

    return db
      .prepare(
        `
          SELECT word_id, mode, result, elapsed_ms, studied_on, created_at
          FROM study_logs
          WHERE studied_on >= ?
          ORDER BY studied_on ASC, created_at ASC
        `
      )
      .all(startKey);
  }

  function getTodayStats() {
    const today = todayKey();
    const aggregate = db
      .prepare(
        `
          SELECT
            COUNT(*) AS cards,
            COUNT(DISTINCT word_id) AS words,
            COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms,
            COALESCE(SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END), 0) AS correct_cards,
            COALESCE(SUM(CASE WHEN mode = 'recognize' THEN 1 ELSE 0 END), 0) AS recognize_cards,
            COALESCE(SUM(CASE WHEN mode = 'listen' THEN 1 ELSE 0 END), 0) AS listen_cards,
            COALESCE(SUM(CASE WHEN mode = 'spell' THEN 1 ELSE 0 END), 0) AS spell_cards
          FROM study_logs
          WHERE studied_on = ?
        `
      )
      .get(today);

    const introduced = db
      .prepare(`SELECT COUNT(*) AS count FROM progress WHERE introduced_date = ?`)
      .get(today);

    return {
      cards: aggregate.cards || 0,
      words: aggregate.words || 0,
      elapsedMs: aggregate.elapsed_ms || 0,
      newWords: introduced.count || 0,
      recognizeCards: aggregate.recognize_cards || 0,
      listenCards: aggregate.listen_cards || 0,
      spellCards: aggregate.spell_cards || 0,
      correctRate:
        aggregate.cards > 0
          ? Math.round(((aggregate.correct_cards || 0) / aggregate.cards) * 100)
          : 0,
    };
  }

  function getTodayStudiedWordKeysByMode() {
    const today = todayKey();
    const rows = db
      .prepare(
        `
          SELECT
            l.mode,
            COALESCE(l.word_key, w.normalized_term) AS word_key
          FROM study_logs l
          LEFT JOIN ${wordsTable} w
            ON l.word_id = w.id
          WHERE l.studied_on = ?
        `
      )
      .all(today);
    const sets = {
      recognize: new Set(),
      listen: new Set(),
      spell: new Set(),
    };

    for (const row of rows) {
      if (sets[row.mode] && row.word_key) {
        sets[row.mode].add(row.word_key);
      }
    }

    return sets;
  }

  function getDailyActivity(days = 120, monthOffset = 0) {
    const today = new Date();
    const targetMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const currentMonthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const streakStart = addDays(today, -(days - 1));
    const queryStart = streakStart < currentMonthStart ? streakStart : currentMonthStart;
    const startKey = todayKey(queryStart);
    const rows = db
      .prepare(
        `
          SELECT
            studied_on,
            COUNT(*) AS cards,
            COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms
          FROM study_logs
          WHERE studied_on >= ?
          GROUP BY studied_on
          ORDER BY studied_on ASC
        `
      )
      .all(startKey);

    const map = new Map(rows.map((row) => [row.studied_on, row]));
    const daysList = [];

    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = addDays(today, -offset);
      const key = todayKey(date);
      const row = map.get(key);
      daysList.push({
        date: key,
        label: key.slice(5),
        cards: row?.cards || 0,
        minutes: displayMinutes(row?.elapsed_ms || 0),
        studied: Boolean(row?.cards),
        isToday: key === todayKey(),
      });
    }

    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
    const monthDays = [];
    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
      const key = todayKey(date);
      const row = map.get(key);
      monthDays.push({
        date: key,
        day,
        cards: row?.cards || 0,
        minutes: displayMinutes(row?.elapsed_ms || 0),
        studied: Boolean(row?.cards),
        isToday: key === todayKey(),
      });
    }

    let currentStreak = 0;
    let streakIndex = daysList.length - 1;

    if (daysList[streakIndex] && !daysList[streakIndex].studied) {
      streakIndex -= 1;
    }

    for (let index = streakIndex; index >= 0; index -= 1) {
      if (!daysList[index].studied) {
        break;
      }
      currentStreak += 1;
    }

    let bestStreak = 0;
    let running = 0;
    for (const item of daysList) {
      if (item.studied) {
        running += 1;
        bestStreak = Math.max(bestStreak, running);
      } else {
        running = 0;
      }
    }

    return {
      currentStreak,
      bestStreak,
      monthLabel: `${targetMonth.getFullYear()}年${targetMonth.getMonth() + 1}月`,
      monthOffset,
      firstWeekday: (currentMonthStart.getDay() + 6) % 7,
      monthDays,
    };
  }

  function computeStudyPlan(states) {
    const todayStats = getTodayStats();
    const dueReviewCount = states.filter((state) => {
      if (!state.firstSeenAt || isMastered(state)) {
        return false;
      }

      return !state.nextReviewAt || new Date(state.nextReviewAt) <= new Date();
    }).length;
    const remainingRecognize = Math.max(DAILY_RECOGNIZE_TARGET - todayStats.recognizeCards, 0);
    const remainingListen = Math.max(DAILY_LISTEN_TARGET - todayStats.listenCards, 0);
    const remainingSpell = Math.max(DAILY_SPELL_TARGET - todayStats.spellCards, 0);

    return {
      targetMinutes: TARGET_MINUTES,
      dailyTargets: {
        recognize: DAILY_RECOGNIZE_TARGET,
        listen: DAILY_LISTEN_TARGET,
        spell: DAILY_SPELL_TARGET,
      },
      dailyRemaining: {
        recognize: remainingRecognize,
        listen: remainingListen,
        spell: remainingSpell,
      },
      reachedTimeLimit:
        remainingRecognize === 0 && remainingListen === 0 && remainingSpell === 0,
      dueReviewCount,
      suggestedNewWords: DAILY_RECOGNIZE_TARGET,
      remainingNewWords: remainingRecognize,
      usedMinutes: displayMinutes(todayStats.elapsedMs),
      todayStats,
      statusText:
        remainingRecognize > 0
          ? `\u4eca\u5929\u5148\u5b8c\u6210 ${DAILY_RECOGNIZE_TARGET} \u4e2a\u8ba4\u8bcd\uff0c\u8fd8\u5dee ${remainingRecognize} \u4e2a\u3002`
          : remainingListen > 0
            ? `\u8ba4\u8bcd\u5df2\u5b8c\u6210\uff0c\u63a5\u7740\u5b8c\u6210 ${DAILY_LISTEN_TARGET} \u4e2a\u542c\u8bcd\uff0c\u8fd8\u5dee ${remainingListen} \u4e2a\u3002`
            : remainingSpell > 0
              ? `\u542c\u8bcd\u5df2\u5b8c\u6210\uff0c\u63a5\u7740\u5b8c\u6210 ${DAILY_SPELL_TARGET} \u4e2a\u62fc\u5199\uff0c\u8fd8\u5dee ${remainingSpell} \u4e2a\u3002`
              : "\u4eca\u5929\u7684\u4e09\u6bb5\u76ee\u6807\u5df2\u5b8c\u6210\uff0c\u63a5\u4e0b\u6765\u6309\u8ba4\u8bcd\u3001\u542c\u8bcd\u3001\u62fc\u5199\u5faa\u73af\u52a0\u7ec3\u3002",
      adaptiveNote:
        "\u5f53\u5929\u542c\u8bcd\u4e0d\u4f1a\u4f7f\u7528\u5f53\u5929\u521a\u8ba4\u8fc7\u7684\u8bcd\uff1b\u5f53\u5929\u62fc\u5199\u4e0d\u4f1a\u4f7f\u7528\u5f53\u5929\u521a\u8ba4\u8fc7\u6216\u521a\u542c\u8fc7\u7684\u8bcd\u3002",
    };
  }

  function getCumulativeStats(states) {
    const totalElapsedMs =
      db
        .prepare(`
          SELECT COALESCE(SUM(elapsed_ms), 0) AS value
          FROM study_logs
        `)
        .get().value || 0;

    const summary = states.reduce(
      (summary, state) => {
        if (state.firstSeenAt) {
          summary.studiedWords += 1;
        }

        if (isMastered(state)) {
          summary.masteredWords += 1;
        }

        summary.totalAttempts += state.timesSeen || 0;
        summary.totalWrong += state.timesWrong || 0;
        return summary;
      },
      {
        studiedWords: 0,
        masteredWords: 0,
        totalAttempts: 0,
        totalWrong: 0,
      }
    );

    return {
      ...summary,
      totalElapsedMs,
      totalMinutes: displayMinutes(totalElapsedMs),
    };
  }

  function getDeferredMode(state, now = new Date()) {
    if (!state.firstSeenAt || isMastered(state) || !state.nextReviewAt) {
      return null;
    }

    const reviewAt = new Date(state.nextReviewAt);

    if (Number.isNaN(reviewAt.getTime()) || reviewAt <= now) {
      return null;
    }

    return getModeForState(state);
  }

  function buildTrend(states) {
    const recentLogs = getRecentLogs(7);
    const map = new Map();

    for (let offset = 6; offset >= 0; offset -= 1) {
      const key = todayKey(addDays(new Date(), -offset));
      map.set(key, { date: key, elapsedMs: 0, cards: 0 });
    }

    for (const log of recentLogs) {
      const item = map.get(log.studied_on);

      if (!item) {
        continue;
      }

      item.cards += 1;
      item.elapsedMs += log.elapsed_ms || 0;
    }

    return Array.from(map.values()).map((item) => ({
      date: item.date,
      cards: item.cards,
      minutes: displayMinutes(item.elapsedMs),
    }));
  }

  function buildOverview() {
    const studyConfig = ensureStudyConfig();
    const states = getAllStates(studyConfig);
    const plan = computeStudyPlan(states);
    const todayStats = plan.todayStats;
    const cumulative = getCumulativeStats(states);
    const checkin = getDailyActivity(120);
    const daysRemaining = Math.max(diffDays(EXAM_DATE, todayKey()), 0);
    const prepTotalDays = Math.max(diffDays(EXAM_DATE, PREP_START_DATE), 1);
    const prepElapsedDays = clamp(diffDays(todayKey(), PREP_START_DATE), 0, prepTotalDays);
    const timeProgressPercent = Math.round((prepElapsedDays / prepTotalDays) * 100);
    const totalWords = states.length;
    const coreGoalCount = totalWords;
    const coreMastered = states.filter(isMastered).length;
    const stageProgress = states.reduce(
      (summary, state) => {
        const targets = getStageTargets(state);

        if (targets.recognition > 0) {
          summary.recognition.goal += 1;
          summary.recognition.mastered += state.recognitionStage >= targets.recognition ? 1 : 0;
          summary.overall.goal += targets.recognition;
          summary.overall.completed += Math.min(state.recognitionStage, targets.recognition);
        }

        if (targets.listening > 0) {
          summary.listening.goal += 1;
          summary.listening.mastered += state.listeningStage >= targets.listening ? 1 : 0;
          summary.overall.goal += targets.listening;
          summary.overall.completed += Math.min(state.listeningStage, targets.listening);
        }

        if (targets.spelling > 0) {
          summary.spelling.goal += 1;
          summary.spelling.mastered += state.spellingStage >= targets.spelling ? 1 : 0;
          summary.overall.goal += targets.spelling;
          summary.overall.completed += Math.min(state.spellingStage, targets.spelling);
        }

        return summary;
      },
      {
        recognition: { goal: 0, mastered: 0 },
        listening: { goal: 0, mastered: 0 },
        spelling: { goal: 0, mastered: 0 },
        overall: { goal: 0, completed: 0 },
      }
    );
    const spellGoalCount = stageProgress.spelling.goal;
    const spellMastered = stageProgress.spelling.mastered;
    const listenGoalCount = stageProgress.listening.goal;
    const listenMastered = stageProgress.listening.mastered;
    const recognizeGoalCount = stageProgress.recognition.goal;
    const recognizeMastered = stageProgress.recognition.mastered;
    const overallMastered = states.filter(isMastered).length;
    const totalStageUnits = stageProgress.overall.goal;
    const completedStageUnits = stageProgress.overall.completed;
    const learningProgressPercent =
      totalStageUnits > 0
        ? Math.round((completedStageUnits / totalStageUnits) * 100)
        : 0;
    const hardWords = states
      .filter((state) => state.timesWrong > 0)
      .sort((left, right) => {
        return right.timesWrong - left.timesWrong || right.sourceOrder - left.sourceOrder;
      })
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        wrongCount: state.timesWrong,
        mastery: masteryLabel(state),
        priority: state.priority,
      }));

    const firstTouch = states
      .map((state) => state.firstSeenAt)
      .filter(Boolean)
      .sort()[0];

    const elapsedDays = firstTouch
      ? diffDays(todayKey(), todayKey(new Date(firstTouch))) + 1
      : 0;
    const pacePerDay = elapsedDays > 0 ? completedStageUnits / elapsedDays : 0;
    const projectedStageUnitsByExam = Math.min(
      totalStageUnits,
      Math.round(completedStageUnits + pacePerDay * daysRemaining)
    );
    const projectedPercent =
      totalStageUnits > 0
        ? Math.round((projectedStageUnitsByExam / totalStageUnits) * 100)
        : 0;
    const projectedCompletionDate =
      pacePerDay > 0 && completedStageUnits < totalStageUnits
        ? todayKey(addDays(new Date(), Math.ceil((totalStageUnits - completedStageUnits) / pacePerDay)))
        : completedStageUnits >= totalStageUnits
          ? todayKey()
          : null;

    return {
      exam: {
        date: EXAM_DATE,
        daysRemaining,
      },
      plan,
      checkin,
      config: studyConfig,
      progress: {
        totalWords,
        overallMastered,
        coreGoalCount,
        coreMastered,
        coreGap: Math.max(coreGoalCount - coreMastered, 0),
        totalStageUnits,
        completedStageUnits,
        stageUnitGap: Math.max(totalStageUnits - completedStageUnits, 0),
        spellGoalCount,
        spellMastered,
        listenGoalCount,
        listenMastered,
        recognizeGoalCount,
        recognizeMastered,
        stageProgress,
        projectedPercent,
        projectedCompletionDate,
        onTrack: projectedStageUnitsByExam >= totalStageUnits,
        timeProgressPercent,
        learningProgressPercent,
      },
      cumulative,
      today: {
        minutes: displayMinutes(todayStats.elapsedMs),
        cards: todayStats.cards,
        words: todayStats.words,
        newWords: todayStats.newWords,
        recognizeCards: todayStats.recognizeCards,
        listenCards: todayStats.listenCards,
        spellCards: todayStats.spellCards,
        correctRate: todayStats.correctRate,
      },
      trend: buildTrend(states),
      hardWords,
      childMessage:
        overallMastered === 0
          ? "今天先从认识高优先级单词开始，不需要一下子拼很多。"
          : `今天已经掌握 ${overallMastered} 个词，继续把高优先级词稳住。`,
    };
  }

  function getModeForState(state) {
    if (state.learningTarget === "spell") {
      if (state.recognitionStage < 1) {
        return "recognize";
      }

      if (state.listeningStage < 1) {
        return "listen";
      }

      if (state.spellingStage < 2) {
        return "spell";
      }

      return state.spellingStage <= state.listeningStage ? "spell" : "listen";
    }

    if (state.learningTarget === "listen") {
      if (state.recognitionStage < 1) {
        return "recognize";
      }

      return "listen";
    }

    if (state.recognitionStage < 1) {
      return "recognize";
    }

    return "listen";
  }

  function getSpellWrongStreak(wordId) {
    const logs = db
      .prepare(`
        SELECT result
        FROM study_logs
        WHERE word_id = ?
          AND mode = 'spell'
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(wordId, HARD_SPELLING_WRONG_STREAK);

    let streak = 0;

    for (const log of logs) {
      if (log.result !== "wrong") {
        break;
      }

      streak += 1;
    }

    return streak;
  }

  function getDailyCandidateRank(state, mode) {
    return stableHash(`${todayKey()}|${mode}|${state.normalizedTerm || state.wordId}`);
  }

  function sortStudyCandidates(left, right, mode) {
    const leftScore = PRIORITY_SCORE[left.priority] || 1;
    const rightScore = PRIORITY_SCORE[right.priority] || 1;
    const leftRank = getDailyCandidateRank(left, mode);
    const rightRank = getDailyCandidateRank(right, mode);
    const leftDue = left.nextReviewAt ? new Date(left.nextReviewAt).getTime() : 0;
    const rightDue = right.nextReviewAt ? new Date(right.nextReviewAt).getTime() : 0;

    return (
      rightScore - leftScore ||
      leftRank - rightRank ||
      leftDue - rightDue ||
      left.sourceOrder - right.sourceOrder
    );
  }

  function isAvailableForModeToday(state, mode, todayModeWordKeys) {
    const key = state.normalizedTerm;

    if (mode === "listen" && todayModeWordKeys.recognize.has(key)) {
      return false;
    }

    if (
      mode === "spell" &&
      (todayModeWordKeys.recognize.has(key) || todayModeWordKeys.listen.has(key))
    ) {
      return false;
    }

    return true;
  }

  function isDueOrNewForMode(state, mode, now) {
    if (getModeForState(state) !== mode) {
      return false;
    }

    if (!state.firstSeenAt) {
      return mode === "recognize";
    }

    if (!state.nextReviewAt) {
      return true;
    }

    return new Date(state.nextReviewAt) <= now;
  }

  function submissionBlocked(message, statusCode = 409) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  function assertAnswerModeAllowed(state, mode) {
    const targets = getStageTargets(state);

    if (mode === "listen" && state.recognitionStage < targets.recognition) {
      throw submissionBlocked("这个词需要先认对，之后才能进入听词。");
    }

    if (mode === "spell") {
      if (targets.spelling <= 0) {
        throw submissionBlocked("这个词当前不在默写训练范围内。");
      }

      if (
        state.recognitionStage < targets.recognition ||
        state.listeningStage < targets.listening
      ) {
        throw submissionBlocked("这个词需要先认对并听对，之后才能进入默写。");
      }
    }

    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    if (!isAvailableForModeToday(state, mode, todayModeWordKeys)) {
      throw submissionBlocked("这个词今天已经在前一个环节练过了，请换一个词。");
    }
  }

  function getEligibleModeCandidates(states, mode, now, todayModeWordKeys) {
    return states
      .filter((state) =>
        isAvailableForModeToday(state, mode, todayModeWordKeys) &&
        isDueOrNewForMode(state, mode, now)
      )
      .sort((left, right) => sortStudyCandidates(left, right, mode));
  }

  function getModeOrderForToday(plan) {
    if (plan.todayStats.recognizeCards < DAILY_RECOGNIZE_TARGET) {
      return ["recognize", "listen", "spell"];
    }

    if (plan.todayStats.listenCards < DAILY_LISTEN_TARGET) {
      return ["listen", "recognize", "spell"];
    }

    if (plan.todayStats.spellCards < DAILY_SPELL_TARGET) {
      return ["spell", "recognize", "listen"];
    }

    const completedAfterTargets =
      plan.todayStats.cards -
      DAILY_RECOGNIZE_TARGET -
      DAILY_LISTEN_TARGET -
      DAILY_SPELL_TARGET;
    const offset =
      ((completedAfterTargets % DAILY_MODE_SEQUENCE.length) + DAILY_MODE_SEQUENCE.length) %
      DAILY_MODE_SEQUENCE.length;

    return [
      ...DAILY_MODE_SEQUENCE.slice(offset),
      ...DAILY_MODE_SEQUENCE.slice(0, offset),
    ];
  }

  function getNextCandidate() {
    const states = getAllStates();
    const plan = computeStudyPlan(states);
    const now = new Date();
    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    for (const mode of getModeOrderForToday(plan)) {
      const candidates = getEligibleModeCandidates(states, mode, now, todayModeWordKeys);

      if (candidates.length > 0) {
        return {
          status: "ready",
          plan,
          candidate: candidates[0],
          mode,
        };
      }
    }

    return {
      status: "done",
      plan,
      candidate: null,
      mode: null,
      message:
        "\u4eca\u5929\u6682\u65f6\u6ca1\u6709\u7b26\u5408\u89c4\u5219\u7684\u5019\u9009\u8bcd\u4e86\uff0c\u53ef\u4ee5\u660e\u5929\u518d\u7ee7\u7eed\u3002",
    };
  }

  function getDistractorPool(wordId, limit = 16) {
    const candidate = getWordState(wordId);

    return getAllStates()
      .filter((state) => state.wordId !== wordId)
      .sort((left, right) => {
        const leftThemeScore = left.theme === candidate.theme ? 1 : 0;
        const rightThemeScore = right.theme === candidate.theme ? 1 : 0;
        const leftPriority = PRIORITY_SCORE[left.priority] || 1;
        const rightPriority = PRIORITY_SCORE[right.priority] || 1;
        return (
          rightThemeScore - leftThemeScore ||
          rightPriority - leftPriority ||
          left.sourceOrder - right.sourceOrder
        );
      })
      .slice(0, limit);
  }

  function getModeLabel(mode) {
    if (mode === "tomorrow-listen") {
      return DISPLAY_LABELS.tomorrowListen;
    }

    if (mode === "tomorrow-spell") {
      return DISPLAY_LABELS.tomorrowSpell;
    }

    if (mode === "tomorrow-spell-repeat") {
      return DISPLAY_LABELS.tomorrowSpellRepeat;
    }

    if (mode === "spell") {
      return DISPLAY_LABELS.nextSpell;
    }

    if (mode === "listen") {
      return DISPLAY_LABELS.nextListen;
    }

    return DISPLAY_LABELS.nextRecognize;
  }

  function getWordProgress() {
    return getAllStates()
      .sort((left, right) => {
        const leftMastered = isMastered(left) ? 1 : 0;
        const rightMastered = isMastered(right) ? 1 : 0;
        const leftStarted = left.firstSeenAt ? 1 : 0;
        const rightStarted = right.firstSeenAt ? 1 : 0;
        const leftPriority = PRIORITY_SCORE[left.priority] || 1;
        const rightPriority = PRIORITY_SCORE[right.priority] || 1;

        return (
          rightStarted - leftStarted ||
          leftMastered - rightMastered ||
          rightPriority - leftPriority ||
          right.timesWrong - left.timesWrong ||
          left.sourceOrder - right.sourceOrder
        );
      })
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        priority: state.priority,
        theme: state.theme,
        learningTarget: state.learningTarget,
        mastery: masteryLabel(state),
        masteryPercent: getMasteryPercent(state),
        stageSummary: getStageSummary(state),
        started: Boolean(state.firstSeenAt),
        mastered: isMastered(state),
        timesSeen: state.timesSeen,
        timesWrong: state.timesWrong,
        nextAction: isMastered(state)
          ? DISPLAY_LABELS.longReview
          : getModeLabel(
              getDeferredMode(state)
                ? getDeferredMode(state) === "listen"
                  ? "tomorrow-listen"
                  : state.spellingStage >= 1
                    ? "tomorrow-spell-repeat"
                    : "tomorrow-spell"
                : getModeForState(state)
            ),
        nextReviewAt: state.nextReviewAt,
      }));
  }

  function evaluateSpelling(state, response) {
    const accepted = state.acceptedSpellings.map((value) => ({
      raw: value,
      normalized: normalizeLookup(value),
      compact: normalizeCompact(value),
    }));

    const normalizedResponse = normalizeLookup(response);
    const compactResponse = normalizeCompact(response);

    const exactMatch = accepted.find(
      (value) =>
        value.normalized === normalizedResponse || value.compact === compactResponse
    );

    if (exactMatch) {
      return {
        result: "correct",
        acceptedText: state.baseTerm,
        note: "拼写正确。",
      };
    }

    return {
      result: "wrong",
      acceptedText: state.baseTerm,
      note: `这次没关系，正确写法是 ${state.baseTerm}。`,
    };
  }

  function applyResultToStages(state, mode, result) {
    const next = {
      recognitionStage: state.recognitionStage,
      listeningStage: state.listeningStage,
      spellingStage: state.spellingStage,
    };

    if (mode === "recognize") {
      if (result === "correct") {
        next.recognitionStage = Math.min(next.recognitionStage + 1, 3);
      } else if (result === "wrong") {
        next.recognitionStage = Math.max(next.recognitionStage - 1, 0);
      }
    }

    if (mode === "listen") {
      if (result === "correct") {
        next.listeningStage = Math.min(next.listeningStage + 1, 3);
      } else if (result === "wrong") {
        next.listeningStage = Math.max(next.listeningStage - 1, 0);
      }
    }

    if (mode === "spell") {
      if (result === "correct") {
        next.spellingStage = Math.min(next.spellingStage + 1, 4);
      } else if (result === "wrong") {
        next.spellingStage = Math.max(next.spellingStage - 1, 0);
      }
    }

    return next;
  }

  function isMasteredWithStages(state, nextStages) {
    const targets = getStageTargets(state);
    return (
      nextStages.recognitionStage >= targets.recognition &&
      nextStages.listeningStage >= targets.listening &&
      nextStages.spellingStage >= targets.spelling
    );
  }

  function submitAnswer(payload) {
    const now = new Date();
    const nowIso = now.toISOString();
    const studiedOn = todayKey(now);
    const currentState = getWordState(payload.wordId);

    if (!currentState) {
      throw submissionBlocked("没有找到这个词。", 404);
    }

    assertAnswerModeAllowed(currentState, payload.mode);
    const state = ensureProgressRow(payload.wordId);

    let evaluation;

    if (payload.mode === "spell") {
      if (payload.gaveUp) {
        evaluation = {
          result: "wrong",
          acceptedText: state.term,
          note: `已标记为不会，正确写法是 ${state.term}。`,
        };
      } else {
        evaluation = evaluateSpelling(state, payload.response || "");
      }
    } else {
      const gaveUp = Boolean(payload.gaveUp);
      const isCorrect = !gaveUp && Number(payload.choiceWordId) === Number(payload.wordId);
      const correctAnswer = state.chineseMeaning || state.term;
      const note = isCorrect
        ? "回答正确。"
        : gaveUp
          ? `已标记为不会，正确答案是 ${correctAnswer}。`
          : `正确答案是 ${correctAnswer}。`;

      evaluation = {
        result: isCorrect ? "correct" : "wrong",
        acceptedText: state.term,
        note,
      };
    }

    const updatedStages = applyResultToStages(state, payload.mode, evaluation.result);
    const masteredAfter = isMasteredWithStages(state, updatedStages);

    let nextReviewAt = now;
    const targets = getStageTargets(state);
    const needsListening = updatedStages.listeningStage < targets.listening;
    const needsSpelling = updatedStages.spellingStage < targets.spelling;

    const spellWrongStreak =
      payload.mode === "spell" && evaluation.result === "wrong"
        ? getSpellWrongStreak(payload.wordId) + 1
        : 0;

    if (payload.mode === "spell" && evaluation.result !== "correct") {
      nextReviewAt = addDays(
        now,
        spellWrongStreak >= HARD_SPELLING_WRONG_STREAK
          ? HARD_SPELLING_PARK_DAYS
          : SPELLING_PARK_DAYS
      );
    } else if (evaluation.result === "wrong") {
      nextReviewAt = addMinutes(now, 12);
    } else if (
      payload.mode === "recognize" &&
      (needsListening || needsSpelling)
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (
      payload.mode === "listen" &&
      needsSpelling
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (
      payload.mode === "spell" &&
      evaluation.result === "correct" &&
      needsSpelling
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (!masteredAfter) {
      nextReviewAt = addMinutes(now, 3);
    } else {
      const intervals = [1, 3, 7, 14, 30];
      const streak = clamp(state.correctStreak + 1, 1, intervals.length);
      nextReviewAt = addDays(now, intervals[streak - 1]);
    }

    db.prepare(`
      UPDATE progress
      SET last_seen_at = ?,
          next_review_at = ?,
          recognition_stage = ?,
          listening_stage = ?,
          spelling_stage = ?,
          times_seen = times_seen + 1,
          times_correct = times_correct + ?,
          times_wrong = times_wrong + ?,
          lapse_count = lapse_count + ?,
          correct_streak = ?,
          last_mode = ?,
          last_result = ?
      WHERE word_id = ?
    `).run(
      nowIso,
      nextReviewAt.toISOString(),
      updatedStages.recognitionStage,
      updatedStages.listeningStage,
      updatedStages.spellingStage,
      evaluation.result === "correct" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "correct" ? state.correctStreak + 1 : 0,
      payload.mode,
      evaluation.result,
      payload.wordId
    );

    const logResponse = payload.mode === "spell"
      ? payload.gaveUp
        ? "gave_up"
        : payload.response || ""
      : payload.gaveUp
        ? "gave_up"
        : String(payload.choiceWordId || "");

    db.prepare(`
      INSERT INTO study_logs (
        word_id,
        word_key,
        mode,
        result,
        response,
        elapsed_ms,
        studied_on,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.wordId,
      selectWordKeyById.get(payload.wordId)?.normalized_term || null,
      payload.mode,
      evaluation.result,
      logResponse,
      Math.max(0, Number(payload.elapsedMs) || 0),
      studiedOn,
      nowIso
    );

    const refreshed = getWordState(payload.wordId);

    return {
      evaluation,
      mastered: isMastered(refreshed),
      masteryLabel: masteryLabel(refreshed),
      nextReviewAt: refreshed.nextReviewAt,
      state: refreshed,
    };
  }

  function getTextDiagnostics() {
    return {
      started: DISPLAY_LABELS.started,
      longReview: DISPLAY_LABELS.longReview,
      tomorrowListen: DISPLAY_LABELS.tomorrowListen,
      stageSample: `${DISPLAY_LABELS.stageRecognize} 1/1 ${DISPLAY_LABELS.stageListen} 0/1 ${DISPLAY_LABELS.stageSpell} -`,
    };
  }

  function updateWordMetadataEntry(wordId, updates) {
    const current = getWordState(wordId);

    updateWordMetadata.run(
      updates.chineseMeaning ?? current.chineseMeaning ?? null,
      updates.phonetic ?? current.phonetic ?? null,
      updates.audioUrl ?? current.audioUrl ?? null,
      wordId
    );

    return getWordState(wordId);
  }

  function backupDatabase(destinationPath) {
    if (!activeDbPath || activeDbPath === ":memory:") {
      throw new Error("内存数据库不能备份。");
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    db.exec("PRAGMA wal_checkpoint(FULL);");
    fs.copyFileSync(activeDbPath, destinationPath);

    const walPath = `${activeDbPath}-wal`;
    const shmPath = `${activeDbPath}-shm`;

    if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
      fs.copyFileSync(walPath, `${destinationPath}-wal`);
    }

    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${destinationPath}-shm`);
    }

    if (fs.existsSync(WORD_BANK_DB_PATH)) {
      fs.copyFileSync(
        WORD_BANK_DB_PATH,
        destinationPath.replace(/\.sqlite$/, "-wordbank.sqlite")
      );
    }

    return destinationPath;
  }

  return {
    db,
    dbPath: activeDbPath,
    storageMode: "split",
    examDate: EXAM_DATE,
    syncWords,
    getWordCount,
    getOverview: buildOverview,
    getDailyActivity,
    getNextCandidate,
    getDistractorPool,
    getWordProgress,
    getWordState,
    getAllStates,
    backupDatabase,
    updateWordMetadata(wordId, updates) {
      return updateWordMetadataEntry(wordId, updates);
    },
    getDiagnostics() {
      return {
        storageMode: "split",
        text: getTextDiagnostics(),
      };
    },
    submitAnswer,
    close() {
      db.close();
    },
  };
}

module.exports = {
  createStore,
  WORD_BANK_DB_PATH,
  LEARNING_DB_PATH,
  todayKey,
};
