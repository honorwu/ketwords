function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
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
      examples_json TEXT NOT NULL,
      accepted_spellings_json TEXT NOT NULL,
      chinese_meaning TEXT,
      phonetic TEXT,
      audio_url TEXT,
      frequency_zipf REAL,
      child_frequency_zipf REAL,
      frequency_score REAL,
      frequency_band TEXT,
      frequency_source TEXT,
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
  `);
}

module.exports = {
  addColumnIfMissing,
  createLearningSchema,
  createWordSchema,
};
