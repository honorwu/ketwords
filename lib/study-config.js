const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "..", "data", "study-config.json");
const STUDY_MODES = ["recognize", "listen", "spell"];

const DEFAULT_CONFIG = {
  examDate: "2026-08-22",
  prepStartDate: "2026-04-22",
  dailyTargets: {
    recognize: 60,
    listen: 20,
    spell: 10,
  },
  afterTargetSequence: [
    "recognize",
    "recognize",
    "recognize",
    "recognize",
    "recognize",
    "recognize",
    "listen",
    "listen",
    "spell",
  ],
  wrongParkDays: {
    recognize: 3,
    listen: 3,
    spell: 7,
  },
  dailyWrongRetryLimits: {
    recognize: 6,
    listen: 4,
    spell: 3,
  },
  repeatedWrongThreshold: 3,
  spellFrequencyMinScore: 5.5,
};

function normalizeDate(value, fallback) {
  const candidate = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))
    ? candidate
    : fallback;
}

function normalizeNumber(value, fallback, minimum = 0) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= minimum ? candidate : fallback;
}

function normalizeModeNumbers(value, fallback, minimum = 0) {
  return Object.fromEntries(
    STUDY_MODES.map((mode) => [
      mode,
      normalizeNumber(value?.[mode], fallback[mode], minimum),
    ])
  );
}

function normalizeStudyConfig(value = {}) {
  const sequence = Array.isArray(value.afterTargetSequence)
    ? value.afterTargetSequence.filter((mode) => STUDY_MODES.includes(mode))
    : [];

  return {
    examDate: normalizeDate(value.examDate, DEFAULT_CONFIG.examDate),
    prepStartDate: normalizeDate(value.prepStartDate, DEFAULT_CONFIG.prepStartDate),
    dailyTargets: normalizeModeNumbers(value.dailyTargets, DEFAULT_CONFIG.dailyTargets, 1),
    afterTargetSequence: sequence.length > 0
      ? sequence
      : [...DEFAULT_CONFIG.afterTargetSequence],
    wrongParkDays: normalizeModeNumbers(value.wrongParkDays, DEFAULT_CONFIG.wrongParkDays),
    dailyWrongRetryLimits: normalizeModeNumbers(
      value.dailyWrongRetryLimits,
      DEFAULT_CONFIG.dailyWrongRetryLimits
    ),
    repeatedWrongThreshold: normalizeNumber(
      value.repeatedWrongThreshold,
      DEFAULT_CONFIG.repeatedWrongThreshold,
      1
    ),
    spellFrequencyMinScore: normalizeNumber(
      value.spellFrequencyMinScore,
      DEFAULT_CONFIG.spellFrequencyMinScore,
      1
    ),
  };
}

function ensureStudyConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
    return normalizeStudyConfig(DEFAULT_CONFIG);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return normalizeStudyConfig(parsed);
  } catch (error) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
    return normalizeStudyConfig(DEFAULT_CONFIG);
  }
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  ensureStudyConfig,
  normalizeStudyConfig,
};
