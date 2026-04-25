const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { normalizeCompact, normalizeLookup, parseAcceptedSpellings } = require("./wordlist");
const { ensureStudyConfig } = require("./study-config");

const DB_PATH = path.join(__dirname, "..", "data", "ketwords.sqlite");
const WORD_BANK_DB_PATH = path.join(__dirname, "..", "data", "wordbank.sqlite");
const LEARNING_DB_PATH = path.join(__dirname, "..", "data", "learning.sqlite");
const SPLIT_MIGRATION_VERSION = 1;
const EXAM_DATE = "2026-08-22";
const PREP_START_DATE = "2026-04-22";
const TARGET_MINUTES = 15;
const DAILY_NEW_WORD_TARGET = 20;
const HARD_SPELLING_WRONG_STREAK = 3;
const SPELLING_PARK_DAYS = 1;
const HARD_SPELLING_PARK_DAYS = 2;
const PRIORITY_SCORE = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

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

function displayMinutes(elapsedMs) {
  if (!elapsedMs) {
    return 0;
  }

  return Math.max(1, Math.round(elapsedMs / 60000));
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(tableName)
  );
}

function columnExists(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function addColumnIfMissing(db, tableName, columnDefinition) {
  const columnName = columnDefinition.split(/\s+/)[0];

  if (!tableExists(db, tableName) || columnExists(db, tableName, columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
}

function getSplitMigrationRecord() {
  if (!fs.existsSync(WORD_BANK_DB_PATH) || !fs.existsSync(LEARNING_DB_PATH)) {
    return null;
  }

  const db = new DatabaseSync(LEARNING_DB_PATH);

  try {
    if (!tableExists(db, "migration_meta")) {
      return null;
    }

    return db
      .prepare(
        "SELECT version, completed_at, source_db FROM migration_meta WHERE name = 'split-databases'"
      )
      .get() || null;
  } finally {
    db.close();
  }
}

function isSplitMigrationComplete() {
  const record = getSplitMigrationRecord();
  return Number(record?.version || 0) >= SPLIT_MIGRATION_VERSION;
}

function copyDatabaseFiles(sourcePath, destinationPath) {
  if (!sourcePath || sourcePath === ":memory:" || !fs.existsSync(sourcePath)) {
    return null;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);

  for (const suffix of ["-wal", "-shm"]) {
    const extraPath = `${sourcePath}${suffix}`;

    if (fs.existsSync(extraPath)) {
      fs.copyFileSync(extraPath, `${destinationPath}${suffix}`);
    }
  }

  return destinationPath;
}

function createWordSchema(db, tableName = "words") {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      base_term TEXT NOT NULL,
      normalized_term TEXT NOT NULL UNIQUE,
      part_of_speech TEXT NOT NULL,
      theme TEXT NOT NULL,
      priority TEXT NOT NULL,
      learning_target TEXT NOT NULL,
      spelling_required INTEGER NOT NULL DEFAULT 0,
      examples_json TEXT NOT NULL,
      accepted_spellings_json TEXT NOT NULL,
      chinese_meaning TEXT,
      phonetic TEXT,
      audio_url TEXT,
      source_order INTEGER NOT NULL
    );
  `);
}

function createLearningSchema(db, includeForeignKeys = true) {
  const wordReference = includeForeignKeys
    ? ", FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE"
    : "";

  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      word_id INTEGER PRIMARY KEY,
      word_key TEXT,
      first_seen_at TEXT,
      introduced_date TEXT,
      last_seen_at TEXT,
      next_review_at TEXT,
      recognition_stage INTEGER NOT NULL DEFAULT 0,
      listening_stage INTEGER NOT NULL DEFAULT 0,
      spelling_stage INTEGER NOT NULL DEFAULT 0,
      times_seen INTEGER NOT NULL DEFAULT 0,
      times_correct INTEGER NOT NULL DEFAULT 0,
      times_almost INTEGER NOT NULL DEFAULT 0,
      times_wrong INTEGER NOT NULL DEFAULT 0,
      lapse_count INTEGER NOT NULL DEFAULT 0,
      correct_streak INTEGER NOT NULL DEFAULT 0,
      last_mode TEXT,
      last_result TEXT
      ${wordReference}
    );

    CREATE TABLE IF NOT EXISTS study_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL,
      word_key TEXT,
      mode TEXT NOT NULL,
      result TEXT NOT NULL,
      response TEXT,
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      studied_on TEXT NOT NULL,
      created_at TEXT NOT NULL
      ${wordReference}
    );

    CREATE INDEX IF NOT EXISTS idx_progress_next_review
      ON progress(next_review_at);

    CREATE INDEX IF NOT EXISTS idx_logs_studied_on
      ON study_logs(studied_on);

    CREATE TABLE IF NOT EXISTS parent_focus_words (
      word_id INTEGER PRIMARY KEY,
      word_key TEXT,
      added_at TEXT NOT NULL
      ${wordReference}
    );

    CREATE INDEX IF NOT EXISTS idx_parent_focus_added_at
      ON parent_focus_words(added_at DESC);

    CREATE TABLE IF NOT EXISTS migration_meta (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      source_db TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
  `);
}

function countRows(db, tableName) {
  if (!tableExists(db, tableName)) {
    return 0;
  }

  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count || 0);
}

function buildMigrationStatus() {
  const record = getSplitMigrationRecord();
  const completed = Number(record?.version || 0) >= SPLIT_MIGRATION_VERSION;
  const legacyExists = fs.existsSync(DB_PATH);
  const wordbankExists = fs.existsSync(WORD_BANK_DB_PATH);
  const learningExists = fs.existsSync(LEARNING_DB_PATH);
  const status = {
    mode: completed ? "split" : "legacy",
    completed,
    canMigrate: legacyExists && !completed && !wordbankExists && !learningExists,
    legacyPath: DB_PATH,
    wordbankPath: WORD_BANK_DB_PATH,
    learningPath: LEARNING_DB_PATH,
    legacyExists,
    wordbankExists,
    learningExists,
    record,
    counts: null,
  };

  if (legacyExists) {
    const legacyDb = new DatabaseSync(DB_PATH);

    try {
      status.counts = {
        legacy: {
          words: countRows(legacyDb, "words"),
          progress: countRows(legacyDb, "progress"),
          studyLogs: countRows(legacyDb, "study_logs"),
          parentFocusWords: countRows(legacyDb, "parent_focus_words"),
        },
      };
    } finally {
      legacyDb.close();
    }
  }

  if (wordbankExists && learningExists) {
    const wordDb = new DatabaseSync(WORD_BANK_DB_PATH);
    const learningDb = new DatabaseSync(LEARNING_DB_PATH);

    try {
      status.counts = {
        ...(status.counts || {}),
        split: {
          words: countRows(wordDb, "words"),
          progress: countRows(learningDb, "progress"),
          studyLogs: countRows(learningDb, "study_logs"),
          parentFocusWords: countRows(learningDb, "parent_focus_words"),
        },
      };
    } finally {
      wordDb.close();
      learningDb.close();
    }
  }

  return status;
}

function migrateToSplitDatabases() {
  const before = buildMigrationStatus();

  if (before.completed) {
    return {
      alreadyCompleted: true,
      status: before,
    };
  }

  if (!before.canMigrate) {
    throw new Error("当前状态不能自动迁移：请确认旧库存在，且新库文件尚未创建。");
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    path.dirname(DB_PATH),
    "backups",
    `ketwords-before-split-${stamp}.sqlite`
  );
  const legacyDb = new DatabaseSync(DB_PATH);

  legacyDb.exec("PRAGMA wal_checkpoint(FULL);");
  copyDatabaseFiles(DB_PATH, backupPath);

  const wordbankTempPath = `${WORD_BANK_DB_PATH}.migrating-${stamp}`;
  const learningTempPath = `${LEARNING_DB_PATH}.migrating-${stamp}`;
  const wordDb = new DatabaseSync(wordbankTempPath);
  const learningDb = new DatabaseSync(learningTempPath);
  let committed = false;

  try {
    createWordSchema(wordDb);
    createLearningSchema(learningDb, false);

    const words = legacyDb.prepare("SELECT * FROM words ORDER BY id").all();
    const progressRows = legacyDb
      .prepare(`
        SELECT p.*, w.normalized_term AS word_key
        FROM progress p
        LEFT JOIN words w
          ON w.id = p.word_id
        ORDER BY p.word_id
      `)
      .all();
    const logRows = legacyDb
      .prepare(`
        SELECT l.*, w.normalized_term AS word_key
        FROM study_logs l
        LEFT JOIN words w
          ON w.id = l.word_id
        ORDER BY l.id
      `)
      .all();
    const focusRows = legacyDb
      .prepare(`
        SELECT f.*, w.normalized_term AS word_key
        FROM parent_focus_words f
        LEFT JOIN words w
          ON w.id = f.word_id
        ORDER BY f.word_id
      `)
      .all();

    wordDb.exec("BEGIN");
    learningDb.exec("BEGIN");

    const insertWordRow = wordDb.prepare(`
      INSERT INTO words (
        id,
        term,
        base_term,
        normalized_term,
        part_of_speech,
        theme,
        priority,
        learning_target,
        spelling_required,
        examples_json,
        accepted_spellings_json,
        chinese_meaning,
        phonetic,
        audio_url,
        source_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of words) {
      insertWordRow.run(
        row.id,
        row.term,
        row.base_term,
        row.normalized_term,
        row.part_of_speech,
        row.theme,
        row.priority,
        row.learning_target,
        row.spelling_required,
        row.examples_json,
        row.accepted_spellings_json,
        row.chinese_meaning,
        row.phonetic,
        row.audio_url,
        row.source_order
      );
    }

    const insertProgressRow = learningDb.prepare(`
      INSERT INTO progress (
        word_id,
        word_key,
        first_seen_at,
        introduced_date,
        last_seen_at,
        next_review_at,
        recognition_stage,
        listening_stage,
        spelling_stage,
        times_seen,
        times_correct,
        times_almost,
        times_wrong,
        lapse_count,
        correct_streak,
        last_mode,
        last_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of progressRows) {
      insertProgressRow.run(
        row.word_id,
        row.word_key,
        row.first_seen_at,
        row.introduced_date,
        row.last_seen_at,
        row.next_review_at,
        row.recognition_stage,
        row.listening_stage,
        row.spelling_stage,
        row.times_seen,
        row.times_correct,
        row.times_almost,
        row.times_wrong,
        row.lapse_count,
        row.correct_streak,
        row.last_mode,
        row.last_result
      );
    }

    const insertLogRow = learningDb.prepare(`
      INSERT INTO study_logs (
        id,
        word_id,
        word_key,
        mode,
        result,
        response,
        elapsed_ms,
        studied_on,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of logRows) {
      insertLogRow.run(
        row.id,
        row.word_id,
        row.word_key,
        row.mode,
        row.result,
        row.response,
        row.elapsed_ms,
        row.studied_on,
        row.created_at
      );
    }

    const insertFocusRow = learningDb.prepare(`
      INSERT INTO parent_focus_words (
        word_id,
        word_key,
        added_at
      ) VALUES (?, ?, ?)
    `);

    for (const row of focusRows) {
      insertFocusRow.run(row.word_id, row.word_key, row.added_at);
    }

    const details = {
      backupPath,
      counts: {
        words: words.length,
        progress: progressRows.length,
        studyLogs: logRows.length,
        parentFocusWords: focusRows.length,
      },
    };

    learningDb
      .prepare(`
        INSERT INTO migration_meta (
          name,
          version,
          source_db,
          completed_at,
          details_json
        ) VALUES ('split-databases', ?, ?, ?, ?)
      `)
      .run(SPLIT_MIGRATION_VERSION, DB_PATH, now.toISOString(), JSON.stringify(details));

    wordDb.exec("COMMIT");
    learningDb.exec("COMMIT");
    wordDb.exec("PRAGMA wal_checkpoint(FULL);");
    learningDb.exec("PRAGMA wal_checkpoint(FULL);");
    committed = true;
  } catch (error) {
    try {
      wordDb.exec("ROLLBACK");
    } catch (_) {}

    try {
      learningDb.exec("ROLLBACK");
    } catch (_) {}

    throw error;
  } finally {
    legacyDb.close();
    wordDb.close();
    learningDb.close();

    if (!committed) {
      for (const tempPath of [wordbankTempPath, learningTempPath]) {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true });
        }
      }
    }
  }

  fs.renameSync(wordbankTempPath, WORD_BANK_DB_PATH);
  fs.renameSync(learningTempPath, LEARNING_DB_PATH);

  for (const tempPath of [`${wordbankTempPath}-wal`, `${wordbankTempPath}-shm`, `${learningTempPath}-wal`, `${learningTempPath}-shm`]) {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }

  const after = buildMigrationStatus();

  return {
    alreadyCompleted: false,
    backupPath,
    status: after,
  };
}

function createStore(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const usingDefaultDatabase = dbPath === DB_PATH;
  const usingSplitDatabases = usingDefaultDatabase && isSplitMigrationComplete();
  const activeDbPath = usingSplitDatabases ? LEARNING_DB_PATH : dbPath;
  const db = new DatabaseSync(activeDbPath);
  const wordsTable = usingSplitDatabases ? "wordbank.words" : "words";
  const progressJoin = usingSplitDatabases
    ? "p.word_key = w.normalized_term OR (p.word_key IS NULL AND p.word_id = w.id)"
    : "p.word_id = w.id";
  const parentFocusJoin = usingSplitDatabases
    ? "f.word_key = w.normalized_term OR (f.word_key IS NULL AND f.word_id = w.id)"
    : "f.word_id = w.id";

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  if (usingSplitDatabases) {
    db.exec(`ATTACH DATABASE '${WORD_BANK_DB_PATH.replaceAll("'", "''")}' AS wordbank;`);
    createWordSchema(db, wordsTable);
    createLearningSchema(db, false);
  } else {
    createWordSchema(db);
    createLearningSchema(db, true);
  }

  if (usingSplitDatabases) {
    addColumnIfMissing(db, "progress", "word_key TEXT");
    addColumnIfMissing(db, "study_logs", "word_key TEXT");
    addColumnIfMissing(db, "parent_focus_words", "word_key TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_progress_word_key
        ON progress(word_key);

      CREATE INDEX IF NOT EXISTS idx_logs_word_key
        ON study_logs(word_key);

      CREATE INDEX IF NOT EXISTS idx_parent_focus_word_key
        ON parent_focus_words(word_key);
    `);
  }

  const insertWord = db.prepare(`
    INSERT INTO ${wordsTable} (
      term,
      base_term,
      normalized_term,
      part_of_speech,
      theme,
      priority,
      learning_target,
      spelling_required,
      examples_json,
      accepted_spellings_json,
      chinese_meaning,
      phonetic,
      audio_url,
      source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_term) DO UPDATE SET
      term = excluded.term,
      base_term = excluded.base_term,
      part_of_speech = excluded.part_of_speech,
      theme = excluded.theme,
      priority = excluded.priority,
      learning_target = excluded.learning_target,
      spelling_required = excluded.spelling_required,
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

  const selectWordIdByNormalizedTerm = db.prepare(`
    SELECT id
    FROM ${wordsTable}
    WHERE normalized_term = ?
  `);

  const selectWordKeyById = db.prepare(`
    SELECT normalized_term
    FROM ${wordsTable}
    WHERE id = ?
  `);

  const selectMaxSourceOrder = db.prepare(`
    SELECT COALESCE(MAX(source_order), 0) AS value
    FROM ${wordsTable}
  `);

  const insertCustomWord = db.prepare(`
    INSERT INTO ${wordsTable} (
      term,
      base_term,
      normalized_term,
      part_of_speech,
      theme,
      priority,
      learning_target,
      spelling_required,
      examples_json,
      accepted_spellings_json,
      chinese_meaning,
      phonetic,
      audio_url,
      source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertParentFocusWord = db.prepare(
    usingSplitDatabases
      ? `
        INSERT INTO parent_focus_words (
          word_id,
          word_key,
          added_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          word_key = excluded.word_key,
          added_at = excluded.added_at
      `
      : `
        INSERT INTO parent_focus_words (
          word_id,
          added_at
        ) VALUES (?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          added_at = excluded.added_at
      `
  );

  const nudgeWordProgressForParentFocus = db.prepare(`
    UPDATE progress
    SET next_review_at = ?,
        recognition_stage = ?,
        listening_stage = ?,
        spelling_stage = ?,
        correct_streak = 0
    WHERE word_id = ?
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
      w.learning_target,
      w.spelling_required,
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
      p.times_almost,
      p.times_wrong,
      p.lapse_count,
      p.correct_streak,
      p.last_mode,
      p.last_result,
      f.added_at AS parent_added_at
    FROM ${wordsTable} w
    LEFT JOIN progress p
      ON ${progressJoin}
    LEFT JOIN parent_focus_words f
      ON ${parentFocusJoin}
    WHERE w.id = ?
  `);

  function hydrateRow(row) {
    if (!row) {
      return null;
    }

    return {
      wordId: row.id,
      term: row.term,
      baseTerm: row.base_term,
      normalizedTerm: row.normalized_term,
      partOfSpeech: row.part_of_speech,
      theme: row.theme,
      priority: row.priority,
      learningTarget: row.learning_target,
      spellingRequired: row.spelling_required,
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
      timesAlmost: row.times_almost || 0,
      timesWrong: row.times_wrong || 0,
      lapseCount: row.lapse_count || 0,
      correctStreak: row.correct_streak || 0,
      lastMode: row.last_mode,
      lastResult: row.last_result,
      parentAddedAt: row.parent_added_at,
    };
  }

  function getAllStates() {
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
          w.learning_target,
          w.spelling_required,
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
          p.times_almost,
          p.times_wrong,
          p.lapse_count,
          p.correct_streak,
          p.last_mode,
          p.last_result,
          f.added_at AS parent_added_at
        FROM ${wordsTable} w
        LEFT JOIN progress p
          ON ${progressJoin}
        LEFT JOIN parent_focus_words f
          ON ${parentFocusJoin}
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

    return rows.map(hydrateRow);
  }

  function getWordState(wordId) {
    return hydrateRow(selectJoinedState.get(wordId));
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
        ? `认 ${Math.min(state.recognitionStage, targets.recognition)}/${targets.recognition}`
        : "认 -",
      targets.listening
        ? `听 ${Math.min(state.listeningStage, targets.listening)}/${targets.listening}`
        : "听 -",
      targets.spelling
        ? `拼 ${Math.min(state.spellingStage, targets.spelling)}/${targets.spelling}`
        : "拼 -",
    ].join(" ");
  }

  function masteryLabel(state) {
    if (isMastered(state)) {
      return "已掌握";
    }

    const deferredMode = getDeferredMode(state);

    if (deferredMode === "listen") {
      return "明天听词";
    }

    if (deferredMode === "spell" && state.spellingStage === 0) {
      return "明天默写";
    }

    if (deferredMode === "spell" && state.spellingStage >= 1) {
      return "明天再默写";
    }

    if (state.learningTarget === "spell" && state.spellingStage >= 1) {
      return "拼写中";
    }

    if (state.listeningStage >= 1) {
      return "能听懂一些";
    }

    if (state.recognitionStage >= 1) {
      return "开始认识了";
    }

    return "未开始";
  }

  function syncWords(words) {
    const config = ensureStudyConfig();
    const spellPriorityLevels = new Set(config.spellPriorityLevels || ["S"]);

    db.exec("BEGIN");

    try {
      for (const word of words) {
        const effectiveLearningTarget = spellPriorityLevels.has(word.priority)
          ? "spell"
          : word.learningTarget;
        const effectiveSpellingRequired = effectiveLearningTarget === "spell" ? 1 : 0;

        insertWord.run(
          word.term,
          word.baseTerm,
          word.normalizedTerm,
          word.partOfSpeech,
          word.theme,
          word.priority,
          effectiveLearningTarget,
          effectiveSpellingRequired,
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

  function ensureProgressRow(wordId) {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = todayKey(now);

    if (usingSplitDatabases) {
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
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO progress (
          word_id,
          first_seen_at,
          introduced_date,
          last_seen_at,
          next_review_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(wordId, nowIso, today, nowIso, nowIso);
    }

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
            COALESCE(SUM(CASE WHEN result = 'almost' THEN 1 ELSE 0 END), 0) AS almost_cards
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
      correctRate:
        aggregate.cards > 0
          ? Math.round(
              (((aggregate.correct_cards || 0) + (aggregate.almost_cards || 0) * 0.5) /
                aggregate.cards) *
                100
            )
          : 0,
    };
  }

  function getDailyActivity(days = 120) {
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = addDays(
      currentMonthStart,
      -Math.max(days - 30, 0)
    );
    const startKey = todayKey(start);
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

    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const monthDays = [];
    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), day);
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
    for (let index = daysList.length - 1; index >= 0; index -= 1) {
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
      monthLabel: `${today.getFullYear()}年${today.getMonth() + 1}月`,
      firstWeekday: (currentMonthStart.getDay() + 6) % 7,
      monthDays,
    };
  }

  function computeStudyPlan(states) {
    const today = todayKey();
    const recentLogs = getRecentLogs(3);
    const todayStats = getTodayStats();
    const todayAccuracy = todayStats.cards > 0 ? todayStats.correctRate / 100 : 0;
    const todayAvgElapsedMs =
      todayStats.cards > 0 ? todayStats.elapsedMs / todayStats.cards : 0;
    const remainingMinutes = Math.max(
      0,
      TARGET_MINUTES - todayStats.elapsedMs / 60000
    );
    const remainingDays = Math.max(diffDays(EXAM_DATE, today), 0);
    const coreRemaining = states.filter(
      (state) => isCoreGoal(state) && !isMastered(state)
    ).length;

    const dueReviewCount = states.filter((state) => {
      if (!state.firstSeenAt || isMastered(state)) {
        return false;
      }

      return !state.nextReviewAt || new Date(state.nextReviewAt) <= new Date();
    }).length;

    let accuracy = 0;
    let avgElapsedMs = 0;

    if (recentLogs.length > 0) {
      accuracy =
        recentLogs.reduce((total, log) => {
          if (log.result === "correct") {
            return total + 1;
          }

          if (log.result === "almost") {
            return total + 0.5;
          }

          return total;
        }, 0) / recentLogs.length;

      avgElapsedMs =
        recentLogs.reduce((total, log) => total + (log.elapsed_ms || 0), 0) /
        recentLogs.length;
    }

    const baseNewTarget = clamp(
      Math.round((coreRemaining / Math.max(remainingDays, 1)) * 1.1),
      6,
      24
    );

    let adjustedTarget = baseNewTarget;

    if (accuracy >= 0.9 && avgElapsedMs > 0 && avgElapsedMs <= 18000) {
      adjustedTarget += 4;
    } else if (accuracy >= 0.8 && avgElapsedMs > 0 && avgElapsedMs <= 25000) {
      adjustedTarget += 2;
    } else if (accuracy > 0 && (accuracy < 0.65 || avgElapsedMs > 40000)) {
      adjustedTarget -= 3;
    } else if (accuracy > 0 && (accuracy < 0.75 || avgElapsedMs > 30000)) {
      adjustedTarget -= 1;
    }

    if (dueReviewCount > 18) {
      adjustedTarget -= 2;
    }

    let stretchNewWords = 0;

    if (
      todayStats.cards >= 8 &&
      todayAccuracy >= 0.95 &&
      todayAvgElapsedMs > 0 &&
      todayAvgElapsedMs <= 12000
    ) {
      stretchNewWords = Math.min(14, Math.floor(remainingMinutes / 3.5));
    } else if (
      todayStats.cards >= 6 &&
      todayAccuracy >= 0.9 &&
      todayAvgElapsedMs > 0 &&
      todayAvgElapsedMs <= 18000
    ) {
      stretchNewWords = Math.min(10, Math.floor(remainingMinutes / 4));
    } else if (
      todayStats.cards >= 4 &&
      todayAccuracy >= 0.85 &&
      todayAvgElapsedMs > 0 &&
      todayAvgElapsedMs <= 24000
    ) {
      stretchNewWords = Math.min(6, Math.floor(remainingMinutes / 5));
    }

    if (stretchNewWords > 0) {
      adjustedTarget = Math.max(adjustedTarget, todayStats.newWords + stretchNewWords);
    }

    adjustedTarget = clamp(Math.max(adjustedTarget, DAILY_NEW_WORD_TARGET), DAILY_NEW_WORD_TARGET, 32);

    return {
      targetMinutes: TARGET_MINUTES,
      reachedTimeLimit: todayStats.elapsedMs >= TARGET_MINUTES * 60000,
      dueReviewCount,
      suggestedNewWords: adjustedTarget,
      remainingNewWords: Math.max(adjustedTarget - todayStats.newWords, 0),
      usedMinutes: displayMinutes(todayStats.elapsedMs),
      todayStats,
      statusText:
        todayStats.elapsedMs >= TARGET_MINUTES * 60000
          ? `今天已经学习到 ${TARGET_MINUTES} 分钟左右，可以先休息一下。`
          : dueReviewCount === 0 && Math.max(adjustedTarget - todayStats.newWords, 0) === 0
          ? `今天状态很好，还可以继续学到约 ${TARGET_MINUTES} 分钟。`
          : `今天建议先复习 ${dueReviewCount} 个到期词，再推进 ${Math.max(
              adjustedTarget - todayStats.newWords,
              0
            )} 个新词。`,
      adaptiveNote:
        stretchNewWords > 0
          ? `今天识词很快，系统已自动把新词目标加到 ${adjustedTarget} 个。`
          : accuracy >= 0.85
          ? "今天状态不错，系统会适度增加新词量。"
          : accuracy > 0 && accuracy < 0.7
            ? "今天陌生词偏多，系统会先减一点新词，保护学习体验。"
            : "系统会根据正确率和耗时，动态调整每天的新词量。",
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
        summary.totalAlmost += state.timesAlmost || 0;
        return summary;
      },
      {
        studiedWords: 0,
        masteredWords: 0,
        totalAttempts: 0,
        totalWrong: 0,
        totalAlmost: 0,
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
    const states = getAllStates();
    const plan = computeStudyPlan(states);
    const todayStats = plan.todayStats;
    const cumulative = getCumulativeStats(states);
    const checkin = getDailyActivity(120);
    const studyConfig = ensureStudyConfig();
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
        }

        if (targets.listening > 0) {
          summary.listening.goal += 1;
          summary.listening.mastered += state.listeningStage >= targets.listening ? 1 : 0;
        }

        if (targets.spelling > 0) {
          summary.spelling.goal += 1;
          summary.spelling.mastered += state.spellingStage >= targets.spelling ? 1 : 0;
        }

        return summary;
      },
      {
        recognition: { goal: 0, mastered: 0 },
        listening: { goal: 0, mastered: 0 },
        spelling: { goal: 0, mastered: 0 },
      }
    );
    const spellGoalCount = stageProgress.spelling.goal;
    const spellMastered = stageProgress.spelling.mastered;
    const listenGoalCount = stageProgress.listening.goal;
    const listenMastered = stageProgress.listening.mastered;
    const recognizeGoalCount = stageProgress.recognition.goal;
    const recognizeMastered = stageProgress.recognition.mastered;
    const overallMastered = states.filter(isMastered).length;
    const hardWords = states
      .filter((state) => state.timesWrong > 0 || state.timesAlmost > 0)
      .sort((left, right) => {
        const rightScore = right.timesWrong * 2 + right.timesAlmost;
        const leftScore = left.timesWrong * 2 + left.timesAlmost;
        return rightScore - leftScore || right.sourceOrder - left.sourceOrder;
      })
      .slice(0, 8)
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        wrongCount: state.timesWrong,
        almostCount: state.timesAlmost,
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
    const pacePerDay = elapsedDays > 0 ? coreMastered / elapsedDays : 0;
    const projectedCoreByExam = Math.min(
      coreGoalCount,
      Math.round(coreMastered + pacePerDay * daysRemaining)
    );
    const projectedPercent =
      coreGoalCount > 0
        ? Math.round((projectedCoreByExam / coreGoalCount) * 100)
        : 0;
    const projectedCompletionDate =
      pacePerDay > 0 && coreMastered < coreGoalCount
        ? todayKey(addDays(new Date(), Math.ceil((coreGoalCount - coreMastered) / pacePerDay)))
        : coreMastered >= coreGoalCount
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
        spellGoalCount,
        spellMastered,
        listenGoalCount,
        listenMastered,
        recognizeGoalCount,
        recognizeMastered,
        stageProgress,
        projectedPercent,
        projectedCompletionDate,
        onTrack: projectedCoreByExam >= coreGoalCount,
        timeProgressPercent,
        learningProgressPercent:
          coreGoalCount > 0
            ? Math.round((coreMastered / coreGoalCount) * 100)
            : 0,
      },
      cumulative,
      today: {
        minutes: displayMinutes(todayStats.elapsedMs),
        cards: todayStats.cards,
        words: todayStats.words,
        newWords: todayStats.newWords,
        correctRate: todayStats.correctRate,
      },
      trend: buildTrend(states),
      hardWords,
      childMessage:
        overallMastered === 0
          ? "今天先从认识高优先级单词开始，不需要一下子拼很多。"
          : `今天已经掌握 ${overallMastered} 个词，继续把高优先级词稳住。`,
      parentMessage:
        projectedCoreByExam >= coreGoalCount
          ? "按当前速度，预计能在考试前尽量覆盖并掌握整套词库。"
          : `按当前速度，预计考试前可完成约 ${projectedPercent}% 的全部词库目标。`,
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

  function sortByParentFocus(left, right) {
    const leftFocused = left.parentAddedAt ? 1 : 0;
    const rightFocused = right.parentAddedAt ? 1 : 0;
    const leftFocusedAt = left.parentAddedAt ? new Date(left.parentAddedAt).getTime() : 0;
    const rightFocusedAt = right.parentAddedAt ? new Date(right.parentAddedAt).getTime() : 0;

    return (
      rightFocused - leftFocused ||
      rightFocusedAt - leftFocusedAt
    );
  }

  function getNextCandidate() {
    const states = getAllStates();
    const plan = computeStudyPlan(states);
    const now = new Date();

    if (plan.reachedTimeLimit) {
      return {
        status: "done",
        plan,
        candidate: null,
        mode: null,
        message: `今天已经学到 ${TARGET_MINUTES} 分钟左右了，先休息一下，明天继续。`,
      };
    }

    const newStates = states
      .filter((state) => !state.firstSeenAt)
      .sort((left, right) => {
        const leftScore = PRIORITY_SCORE[left.priority] || 1;
        const rightScore = PRIORITY_SCORE[right.priority] || 1;
        return (
          sortByParentFocus(left, right) ||
          rightScore - leftScore ||
          left.sourceOrder - right.sourceOrder
        );
      });

    if (plan.todayStats.newWords < DAILY_NEW_WORD_TARGET && newStates.length > 0) {
      return {
        status: "ready",
        plan,
        candidate: newStates[0],
        mode: getModeForState(newStates[0]),
      };
    }

    const dueStates = states
      .filter((state) => {
        if (!state.firstSeenAt || isMastered(state)) {
          return false;
        }

        return !state.nextReviewAt || new Date(state.nextReviewAt) <= now;
      })
      .sort((left, right) => {
        const leftScore = PRIORITY_SCORE[left.priority] || 1;
        const rightScore = PRIORITY_SCORE[right.priority] || 1;
        const leftDue = left.nextReviewAt ? new Date(left.nextReviewAt).getTime() : 0;
        const rightDue = right.nextReviewAt ? new Date(right.nextReviewAt).getTime() : 0;
        return (
          sortByParentFocus(left, right) ||
          rightScore - leftScore ||
          leftDue - rightDue ||
          left.sourceOrder - right.sourceOrder
        );
      });

    if (dueStates.length > 0) {
      const chosen = dueStates[0];
      return {
        status: "ready",
        plan,
        candidate: chosen,
        mode: getModeForState(chosen),
      };
    }

    if (newStates.length > 0) {
      return {
        status: "ready",
        plan,
        candidate: newStates[0],
        mode: getModeForState(newStates[0]),
      };
    }

    return {
      status: "done",
      plan,
      candidate: null,
      mode: null,
      message: "今天已经把可学的新词推进完了，可以先休息一下，明天继续。",
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
      return "明天听词";
    }

    if (mode === "tomorrow-spell") {
      return "明天默写";
    }

    if (mode === "tomorrow-spell-repeat") {
      return "明天再默写";
    }

    if (mode === "spell") {
      return "下一步默写";
    }

    if (mode === "listen") {
      return "下一步听辨";
    }

    return "下一步认词";
  }

  function getParentWords() {
    return getAllStates()
      .sort((left, right) => {
        const focusSort = sortByParentFocus(left, right);
        const leftMastered = isMastered(left) ? 1 : 0;
        const rightMastered = isMastered(right) ? 1 : 0;
        const leftStarted = left.firstSeenAt ? 1 : 0;
        const rightStarted = right.firstSeenAt ? 1 : 0;
        const leftPriority = PRIORITY_SCORE[left.priority] || 1;
        const rightPriority = PRIORITY_SCORE[right.priority] || 1;
        const leftMistakes = left.timesWrong * 2 + left.timesAlmost;
        const rightMistakes = right.timesWrong * 2 + right.timesAlmost;

        return (
          focusSort ||
          rightStarted - leftStarted ||
          leftMastered - rightMastered ||
          rightPriority - leftPriority ||
          rightMistakes - leftMistakes ||
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
        parentAdded: Boolean(state.parentAddedAt),
        parentAddedAt: state.parentAddedAt,
        timesSeen: state.timesSeen,
        timesWrong: state.timesWrong,
        timesAlmost: state.timesAlmost,
        nextAction: isMastered(state)
          ? "进入长期复习"
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

  function cleanParentWordTerm(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function addParentWord(payload = {}) {
    const term = cleanParentWordTerm(payload.term);
    const meaning = cleanParentWordTerm(payload.meaning);
    const normalizedTerm = normalizeLookup(term);

    if (!term || !normalizedTerm) {
      throw new Error("请输入要补充的英文单词或词组。");
    }

    const nowIso = new Date().toISOString();
    const existingRow = selectWordIdByNormalizedTerm.get(normalizedTerm);
    let wordId;
    let action = "created";

    db.exec("BEGIN");

    try {
      if (existingRow?.id) {
        wordId = existingRow.id;
        action = "queued";
      } else {
        const acceptedSpellings = parseAcceptedSpellings(term);
        const baseTerm = acceptedSpellings[0] || term;
        const nextSourceOrder = Number(selectMaxSourceOrder.get().value || 0) + 1;

        const result = insertCustomWord.run(
          term,
          baseTerm,
          normalizedTerm,
          "custom",
          "家长补充",
          "A",
          "spell",
          1,
          JSON.stringify([]),
          JSON.stringify(acceptedSpellings),
          meaning || null,
          null,
          null,
          nextSourceOrder
        );

        wordId = Number(result.lastInsertRowid);
      }

      if (usingSplitDatabases) {
        upsertParentFocusWord.run(
          wordId,
          selectWordKeyById.get(wordId)?.normalized_term || null,
          nowIso
        );
      } else {
        upsertParentFocusWord.run(wordId, nowIso);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    let current = getWordState(wordId);

    if (current.firstSeenAt) {
      const nextStages = isMastered(current)
        ? {
            recognition: 0,
            listening: 0,
            spelling: 0,
          }
        : {
            recognition: current.recognitionStage,
            listening: current.listeningStage,
            spelling: current.spellingStage,
          };

      nudgeWordProgressForParentFocus.run(
        nowIso,
        nextStages.recognition,
        nextStages.listening,
        nextStages.spelling,
        wordId
      );
      current = getWordState(wordId);
    }

    if (meaning && current.chineseMeaning !== meaning) {
      current = updateWordMetadataEntry(wordId, {
        chineseMeaning: meaning,
      });
    }

    return {
      action,
      state: current,
    };
  }

  function levenshtein(left, right) {
    const leftChars = left.split("");
    const rightChars = right.split("");
    const matrix = Array.from({ length: leftChars.length + 1 }, () =>
      Array(rightChars.length + 1).fill(0)
    );

    for (let row = 0; row <= leftChars.length; row += 1) {
      matrix[row][0] = row;
    }

    for (let col = 0; col <= rightChars.length; col += 1) {
      matrix[0][col] = col;
    }

    for (let row = 1; row <= leftChars.length; row += 1) {
      for (let col = 1; col <= rightChars.length; col += 1) {
        const cost = leftChars[row - 1] === rightChars[col - 1] ? 0 : 1;
        matrix[row][col] = Math.min(
          matrix[row - 1][col] + 1,
          matrix[row][col - 1] + 1,
          matrix[row - 1][col - 1] + cost
        );
      }
    }

    return matrix[leftChars.length][rightChars.length];
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
        acceptedText: state.term,
        note:
          normalizeLookup(exactMatch.raw) === normalizeLookup(state.baseTerm)
            ? "拼写正确。"
            : "接受这种英式 / 美式变体写法。",
      };
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestMatch = state.baseTerm;

    for (const value of accepted) {
      const distance = levenshtein(compactResponse, value.compact);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = value.raw;
      }
    }

    const threshold =
      compactResponse.length <= 5 ? 1 : compactResponse.length <= 10 ? 2 : 3;

    if (
      compactResponse &&
      bestDistance <= threshold &&
      bestDistance / Math.max(bestMatch.length, 1) <= 0.34
    ) {
      return {
        result: "almost",
        acceptedText: state.term,
        note: `很接近了，正确写法是 ${state.term}。`,
      };
    }

    return {
      result: "wrong",
      acceptedText: state.term,
      note: `这次没关系，正确写法是 ${state.term}。`,
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
    const state = ensureProgressRow(payload.wordId);

    let evaluation;

    if (payload.mode === "spell") {
      evaluation = evaluateSpelling(state, payload.response || "");
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
    } else if (evaluation.result === "almost") {
      nextReviewAt = addMinutes(now, 4);
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
          times_almost = times_almost + ?,
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
      evaluation.result === "almost" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "correct" ? state.correctStreak + 1 : 0,
      payload.mode,
      evaluation.result,
      payload.wordId
    );

    const logResponse = payload.mode === "spell"
      ? payload.response || ""
      : payload.gaveUp
        ? "gave_up"
        : String(payload.choiceWordId || "");

    if (usingSplitDatabases) {
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
    } else {
      db.prepare(`
        INSERT INTO study_logs (
          word_id,
          mode,
          result,
          response,
          elapsed_ms,
          studied_on,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.wordId,
        payload.mode,
        evaluation.result,
        logResponse,
        Math.max(0, Number(payload.elapsedMs) || 0),
        studiedOn,
        nowIso
      );
    }

    const refreshed = getWordState(payload.wordId);

    return {
      evaluation,
      mastered: isMastered(refreshed),
      masteryLabel: masteryLabel(refreshed),
      nextReviewAt: refreshed.nextReviewAt,
      state: refreshed,
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

    if (usingSplitDatabases && fs.existsSync(WORD_BANK_DB_PATH)) {
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
    storageMode: usingSplitDatabases ? "split" : "legacy",
    examDate: EXAM_DATE,
    getMigrationStatus: buildMigrationStatus,
    migrateToSplitDatabases,
    syncWords,
    addParentWord,
    getOverview: buildOverview,
    getNextCandidate,
    getDistractorPool,
    getParentWords,
    getWordState,
    getAllStates,
    backupDatabase,
    updateWordMetadata(wordId, updates) {
      return updateWordMetadataEntry(wordId, updates);
    },
    submitAnswer,
    close() {
      db.close();
    },
  };
}

module.exports = {
  createStore,
  buildMigrationStatus,
  migrateToSplitDatabases,
  DB_PATH,
  WORD_BANK_DB_PATH,
  LEARNING_DB_PATH,
  todayKey,
};
