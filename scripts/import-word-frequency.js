const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  addColumnIfMissing,
  createWordSchema,
  dropColumnIfExists,
} = require("../lib/store-schema");

const ROOT_DIR = path.join(__dirname, "..");
const WORD_BANK_PATH = path.join(ROOT_DIR, "data", "wordbank.sqlite");
const DEFAULT_SOURCE_PATH = "/tmp/SUBTLEX-UK.txt.zip";
const PHRASE_PENALTY = 0.65;
const ADDITIONAL_WORD_PENALTY = 0.2;
const MANUAL_ESTIMATES = new Map([
  // SUBTLEX-UK predates the widespread use of this word.
  ["selfie", { zipf: 4.2, childZipf: 4.2, source: "manual-modern-estimate" }],
  // The KET entry is the noun “information technology”, not the pronoun “it”.
  ["IT", { zipf: 4.2, childZipf: 4.2, source: "manual-sense-estimate" }],
]);
const LOOKUP_ALIASES = new Map([
  ["guest-house", "guesthouse"],
  ["penfriend", "pen friend"],
  ["surfboarding", "surfboard"],
  ["v/versus", "versus"],
]);

function roundFrequency(value) {
  return Math.round(value * 100) / 100;
}

function normalizeLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[!?.,:;]+$/g, "")
    .replace(/\s+/g, " ");
}

function getFrequencyBand(zipf) {
  if (zipf >= 5.5) {
    return "S";
  }

  if (zipf >= 5) {
    return "A";
  }

  if (zipf >= 4) {
    return "B";
  }

  return "C";
}

function readSubtlexSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Missing SUBTLEX-UK source: ${sourcePath}\n` +
        "Download https://psychology.nottingham.ac.uk/subtlex-uk/SUBTLEX-UK.txt.zip " +
        `or pass its path: node scripts/import-word-frequency.js /path/to/SUBTLEX-UK.txt.zip`
    );
  }

  if (sourcePath.endsWith(".zip")) {
    return execFileSync("unzip", ["-p", sourcePath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  return fs.readFileSync(sourcePath, "utf8");
}

function parseSubtlex(raw) {
  const lines = raw.split(/\r?\n/);
  const headers = lines.shift().split("\t");
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = ["Spelling", "LogFreq(Zipf)", "CBBC_freq", "LogFreqCBBC(Zipf)"];

  for (const header of required) {
    if (column[header] === undefined) {
      throw new Error(`SUBTLEX-UK source is missing column: ${header}`);
    }
  }

  const entries = new Map();

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const values = line.split("\t");
    const spelling = normalizeLookup(values[column.Spelling]);
    const zipf = Number(values[column["LogFreq(Zipf)"]]);
    const childCount = Number(values[column.CBBC_freq]);
    const childZipf = childCount > 0 ? Number(values[column["LogFreqCBBC(Zipf)"]]) : null;

    if (!spelling || !Number.isFinite(zipf)) {
      continue;
    }

    const current = entries.get(spelling);

    if (!current || zipf > current.zipf) {
      entries.set(spelling, {
        zipf,
        childZipf: Number.isFinite(childZipf) ? childZipf : null,
      });
    }
  }

  return entries;
}

function findExactFrequency(term, entries) {
  const normalized = normalizeLookup(term);
  const candidates = [normalized];
  const alias = LOOKUP_ALIASES.get(normalized);

  if (alias) {
    candidates.push(alias);
  }

  for (const candidate of candidates) {
    const match = entries.get(candidate);

    if (match) {
      return {
        ...match,
        source: candidate === normalized ? "subtlex-uk" : "subtlex-uk-alias",
      };
    }
  }

  return null;
}

function estimatePhraseFrequency(term, entries) {
  const normalized = normalizeLookup(term);
  const alias = LOOKUP_ALIASES.get(normalized);
  const phrase = normalized === "cannot"
    ? "can not"
    : (alias || normalized).replace(/[-/]/g, " ");
  const tokens = phrase.split(" ").filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  const tokenEntries = tokens.map((token) => entries.get(token));

  if (tokenEntries.some((entry) => !entry)) {
    return null;
  }

  const penalty = PHRASE_PENALTY + Math.max(0, tokens.length - 2) * ADDITIONAL_WORD_PENALTY;
  const zipf = Math.max(1, Math.min(...tokenEntries.map((entry) => entry.zipf)) - penalty);
  const childValues = tokenEntries.map((entry) => entry.childZipf);
  const childZipf = childValues.every(Number.isFinite)
    ? Math.max(1, Math.min(...childValues) - penalty)
    : null;

  return {
    zipf: roundFrequency(zipf),
    childZipf: Number.isFinite(childZipf) ? roundFrequency(childZipf) : null,
    source: "subtlex-uk-component-estimate",
  };
}

function getTermFrequency(term, entries) {
  const manual = MANUAL_ESTIMATES.get(String(term || "").trim());
  const frequency = manual || findExactFrequency(term, entries) || estimatePhraseFrequency(term, entries);

  if (!frequency) {
    return {
      zipf: 3,
      childZipf: null,
      source: "fallback-low-estimate",
    };
  }

  return frequency;
}

function ensureFrequencyColumns(db) {
  createWordSchema(db);
  addColumnIfMissing(db, "words", "frequency_zipf REAL");
  addColumnIfMissing(db, "words", "child_frequency_zipf REAL");
  addColumnIfMissing(db, "words", "frequency_score REAL");
  addColumnIfMissing(db, "words", "frequency_band TEXT");
  addColumnIfMissing(db, "words", "frequency_source TEXT");
  dropColumnIfExists(db, "words", "priority");
}

function main() {
  const sourcePath = path.resolve(process.argv[2] || process.env.SUBTLEX_UK_PATH || DEFAULT_SOURCE_PATH);
  const entries = parseSubtlex(readSubtlexSource(sourcePath));
  const db = new DatabaseSync(WORD_BANK_PATH);
  ensureFrequencyColumns(db);

  const words = db.prepare("SELECT id, term FROM words ORDER BY source_order").all();
  const update = db.prepare(`
    UPDATE words
    SET frequency_zipf = ?,
        child_frequency_zipf = ?,
        frequency_score = ?,
        frequency_band = ?,
        frequency_source = ?
    WHERE id = ?
  `);
  const summary = {
    "subtlex-uk": 0,
    "subtlex-uk-alias": 0,
    "subtlex-uk-component-estimate": 0,
    "manual-modern-estimate": 0,
    "manual-sense-estimate": 0,
    "fallback-low-estimate": 0,
    S: 0,
    A: 0,
    B: 0,
    C: 0,
  };

  db.exec("BEGIN");

  try {
    for (const word of words) {
      const frequency = getTermFrequency(word.term, entries);
      const zipf = roundFrequency(frequency.zipf);
      const childZipf = Number.isFinite(frequency.childZipf)
        ? roundFrequency(frequency.childZipf)
        : null;
      const frequencyScore = roundFrequency(zipf * 0.8 + (childZipf ?? zipf) * 0.2);
      const band = getFrequencyBand(zipf);

      update.run(zipf, childZipf, frequencyScore, band, frequency.source, word.id);
      summary[frequency.source] += 1;
      summary[band] += 1;
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }

  console.log(`Imported SUBTLEX-UK frequencies for ${words.length} words from ${sourcePath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
