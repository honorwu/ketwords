const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ensureStudyConfig } = require("./study-config");
const {
  addColumnIfMissing,
  createLearningSchema,
  createWordSchema,
  dropColumnIfExists,
} = require("./store-schema");
const {
  compareWordMapByFrequency,
  getMasteryPercent,
  getStageSummary,
  getStageTargets,
  hydrateRow,
  isMastered,
  isRepeatedWrong,
} = require("./study-progress");
const {
  applyResultToStages,
  evaluateSpelling,
  isMasteredWithStages,
} = require("./answer-evaluator");
const {
  getDeferredMode,
  getEligibleModeCandidates,
  getModeForState,
  getModeOrderForToday,
  getWordMapStatus,
  isAvailableForModeToday,
} = require("./study-selection");

const WORD_BANK_DB_PATH = path.join(__dirname, "..", "data", "wordbank.sqlite");
const LEARNING_DB_PATH = path.join(__dirname, "..", "data", "learning.sqlite");
const {
  EXAM_DATE,
  PREP_START_DATE,
  WRONG_PARK_DAYS,
  DISPLAY_LABELS,
  todayKey,
  parseDateKey,
  diffDays,
  addMinutes,
  addDays,
  clamp,
  displayMinutes,
} = require("./study-logic");

function normalizeMeaning(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[；;、，,。./\s]+/g, "")
    .trim();
}

function selectRandomDistractors(candidate, states, limit = 16, random = Math.random) {
  const maxItems = Math.max(0, Math.floor(Number(limit) || 0));

  if (!candidate || maxItems === 0) {
    return [];
  }

  const candidates = states.filter((state) => {
    return (
      state.wordId !== candidate.wordId &&
      state.theme === candidate.theme &&
      normalizeMeaning(state.chineseMeaning)
    );
  });

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = candidates[index];
    candidates[index] = candidates[swapIndex];
    candidates[swapIndex] = temp;
  }

  const usedMeanings = new Set([normalizeMeaning(candidate.chineseMeaning)]);
  const selected = [];

  for (const state of candidates) {
    const meaning = normalizeMeaning(state.chineseMeaning);

    if (usedMeanings.has(meaning)) {
      continue;
    }

    usedMeanings.add(meaning);
    selected.push(state);

    if (selected.length >= maxItems) {
      break;
    }
  }

  return selected;
}

function normalizeLearningWordKeys(db, wordsTable = "words") {
  db.exec("SAVEPOINT normalize_learning_word_keys;");

  try {
    for (const tableName of ["progress", "study_logs", "parent_focus_words"]) {
      db.exec(`
        UPDATE ${tableName}
        SET word_key = (
          SELECT normalized_term
          FROM ${wordsTable} current_word
          WHERE current_word.id = ${tableName}.word_id
        )
        WHERE EXISTS (
          SELECT 1
          FROM ${wordsTable} current_word
          WHERE current_word.id = ${tableName}.word_id
        )
          AND (
            word_key IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM ${wordsTable} keyed_word
              WHERE keyed_word.normalized_term = ${tableName}.word_key
            )
          );
      `);
    }

    db.exec("RELEASE normalize_learning_word_keys;");
  } catch (error) {
    db.exec("ROLLBACK TO normalize_learning_word_keys;");
    db.exec("RELEASE normalize_learning_word_keys;");
    throw error;
  }
}

function ensureWordBankSchema() {
  const wordBankDb = new DatabaseSync(WORD_BANK_DB_PATH);

  try {
    createWordSchema(wordBankDb);
    addColumnIfMissing(wordBankDb, "words", "frequency_zipf REAL");
    addColumnIfMissing(wordBankDb, "words", "child_frequency_zipf REAL");
    addColumnIfMissing(wordBankDb, "words", "frequency_score REAL");
    addColumnIfMissing(wordBankDb, "words", "frequency_source TEXT");
    dropColumnIfExists(wordBankDb, "words", "priority");
    dropColumnIfExists(wordBankDb, "words", "frequency_band");
  } finally {
    wordBankDb.close();
  }
}

function createStore() {
  fs.mkdirSync(path.dirname(LEARNING_DB_PATH), { recursive: true });

  if (!fs.existsSync(WORD_BANK_DB_PATH)) {
    throw new Error(
      `Missing word bank database. Expected ${WORD_BANK_DB_PATH}; commit and deploy the latest wordbank.sqlite.`
    );
  }

  ensureWordBankSchema();

  const activeDbPath = LEARNING_DB_PATH;
  const db = new DatabaseSync(activeDbPath);
  const wordsTable = "wordbank.words";
  const progressJoin = "p.word_key = w.normalized_term";

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`ATTACH DATABASE '${WORD_BANK_DB_PATH.replaceAll("'", "''")}' AS wordbank;`);
  createWordSchema(db, wordsTable);
  createLearningSchema(db, false);
  addColumnIfMissing(db, "progress", "word_key TEXT");
  addColumnIfMissing(db, "study_logs", "word_key TEXT");
  addColumnIfMissing(db, "parent_focus_words", "word_key TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_progress_word_key
      ON progress(word_key);

    CREATE INDEX IF NOT EXISTS idx_logs_word_key
      ON study_logs(word_key);
  `);

  normalizeLearningWordKeys(db, wordsTable);

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
    UPDATE progress
    SET listening_stage = 1
    WHERE spelling_stage > 0
      AND listening_stage < 1;

  `);

  const insertWord = db.prepare(`
    INSERT INTO ${wordsTable} (
      term,
      base_term,
      normalized_term,
      part_of_speech,
      theme,
      examples_json,
      accepted_spellings_json,
      chinese_meaning,
      phonetic,
      audio_url,
      source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_term) DO UPDATE SET
      term = excluded.term,
      base_term = excluded.base_term,
      part_of_speech = excluded.part_of_speech,
      theme = excluded.theme,
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
      w.examples_json,
      w.accepted_spellings_json,
      w.chinese_meaning,
      w.phonetic,
      w.audio_url,
      w.frequency_zipf,
      w.child_frequency_zipf,
      w.frequency_score,
      w.frequency_source,
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
          w.examples_json,
          w.accepted_spellings_json,
          w.chinese_meaning,
          w.phonetic,
          w.audio_url,
          w.frequency_zipf,
          w.child_frequency_zipf,
          w.frequency_score,
          w.frequency_source,
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
          COALESCE(w.frequency_score, w.frequency_zipf, 0) DESC,
          w.source_order ASC
      `)
      .all();

    return rows.map((row) => hydrateRow(row, config));
  }

  function getWordState(wordId, config = ensureStudyConfig()) {
    return hydrateRow(selectJoinedState.get(wordId), config);
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

  function getTodayWrongWords() {
    const today = todayKey();

    return db
      .prepare(
        `
          SELECT
            w.id AS word_id,
            w.term,
            w.base_term,
            w.chinese_meaning,
            w.phonetic,
            w.audio_url,
            w.frequency_score,
            w.source_order,
            COUNT(*) AS wrong_count,
            MAX(l.created_at) AS last_wrong_at
          FROM study_logs l
          INNER JOIN ${wordsTable} w
            ON w.normalized_term = l.word_key
          WHERE l.studied_on = ?
            AND l.result = 'wrong'
          GROUP BY w.normalized_term
          ORDER BY wrong_count DESC, last_wrong_at DESC, w.source_order ASC
        `
      )
      .all(today)
      .map((row) => ({
        wordId: row.word_id,
        term: row.term,
        baseTerm: row.base_term,
        meaning: row.chinese_meaning || "",
        phonetic: row.phonetic || "",
        audioUrl: row.audio_url || "",
        frequencyScore: row.frequency_score,
        wrongCount: row.wrong_count || 0,
      }));
  }

  function getTodayStudiedWordKeysByMode() {
    const today = todayKey();
    const rows = db
      .prepare(
        `
          SELECT
            l.mode,
            l.word_key
          FROM study_logs l
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
    const todayStats = getTodayStats();
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
        frequencyScore: state.frequencyScore,
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
      todayWrongWords: getTodayWrongWords(),
      childMessage:
        overallMastered === 0
          ? "今天先从未接触的高频词开始，不需要一下子拼很多。"
          : `今天已经掌握 ${overallMastered} 个词，继续把高频词稳住。`,
    };
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
        (state.listeningStage < targets.listening && state.spellingStage < 1)
      ) {
        throw submissionBlocked("这个词需要先认对并听对，之后才能进入默写。");
      }
    }

    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    if (!isAvailableForModeToday(state, mode, todayModeWordKeys)) {
      throw submissionBlocked("这个词今天已经在前一个环节练过了，请换一个词。");
    }
  }

  function getNextCandidate() {
    const states = getAllStates();
    const todayStats = getTodayStats();
    const now = new Date();
    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    for (const mode of getModeOrderForToday(todayStats)) {
      const candidates = getEligibleModeCandidates(states, mode, now, todayModeWordKeys);

      if (candidates.length > 0) {
        return {
          status: "ready",
          candidate: candidates[0],
          mode,
        };
      }
    }

    return {
      status: "done",
      candidate: null,
      mode: null,
      message:
        "\u4eca\u5929\u6682\u65f6\u6ca1\u6709\u7b26\u5408\u89c4\u5219\u7684\u5019\u9009\u8bcd\u4e86\uff0c\u53ef\u4ee5\u660e\u5929\u518d\u7ee7\u7eed\u3002",
    };
  }

  function getDistractorPool(wordId, limit = 16) {
    const candidate = getWordState(wordId);

    return selectRandomDistractors(candidate, getAllStates(), limit);
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
    const studyConfig = ensureStudyConfig();

    return getAllStates()
      .sort(compareWordMapByFrequency)
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        sourceOrder: state.sourceOrder,
        frequencyScore: state.frequencyScore,
        frequencyZipf: state.frequencyZipf,
        childFrequencyZipf: state.childFrequencyZipf,
        frequencySource: state.frequencySource,
        theme: state.theme,
        learningTarget: state.learningTarget,
        mapStatus: getWordMapStatus(state),
        repeatedWrong: isRepeatedWrong(state, studyConfig),
        mastery: masteryLabel(state),
        masteryPercent: getMasteryPercent(state),
        stageSummary: getStageSummary(state),
        recognitionStage: state.recognitionStage,
        listeningStage: state.listeningStage,
        spellingStage: state.spellingStage,
        started: Boolean(state.firstSeenAt),
        mastered: isMastered(state),
        timesSeen: state.timesSeen,
        timesCorrect: state.timesCorrect,
        timesWrong: state.timesWrong,
        correctStreak: state.correctStreak,
        lastMode: state.lastMode,
        lastResult: state.lastResult,
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
        const acceptedText = state.baseTerm || state.term;
        evaluation = {
          result: "wrong",
          acceptedText,
          note: `已标记为不会，正确写法是 ${acceptedText}。`,
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

    if (payload.mode === "spell" && evaluation.result !== "correct") {
      nextReviewAt = addDays(now, WRONG_PARK_DAYS.spell);
    } else if (evaluation.result === "wrong") {
      nextReviewAt = addDays(now, WRONG_PARK_DAYS[payload.mode] || 0);
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
      nextReviewAt = addDays(now, 3650);
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
  normalizeLearningWordKeys,
  selectRandomDistractors,
  todayKey,
};
