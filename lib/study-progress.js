const { ensureStudyConfig } = require("./study-config");
const { DISPLAY_LABELS } = require("./study-logic");

function isSpellingPriority(priority, config = ensureStudyConfig()) {
  return (config.spellPriorityLevels || ["S", "A", "B"]).includes(priority);
}

function hasSpellingText(row) {
  const baseTerm = String(row.base_term || row.baseTerm || row.term || "").trim();
  return /^[A-Za-z0-9]+$/.test(baseTerm);
}

function getLearningTarget(row, config = ensureStudyConfig()) {
  return isSpellingPriority(row.priority, config) && hasSpellingText(row)
    ? "spell"
    : "listen";
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

function isMastered(state) {
  const targets = getStageTargets(state);
  return (
    state.recognitionStage >= targets.recognition &&
    state.listeningStage >= targets.listening &&
    state.spellingStage >= targets.spelling
  );
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

module.exports = {
  getLearningTarget,
  getMasteryPercent,
  getStageSummary,
  getStageTargets,
  hasSpellingText,
  hydrateRow,
  isMastered,
  isSpellingPriority,
};
