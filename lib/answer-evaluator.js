const { normalizeCompact, normalizeLookup } = require("./word-text");
const { getStageTargets } = require("./study-progress");

function isSimpleSpelling(value) {
  return /^[A-Za-z0-9]+$/.test(String(value || "").trim());
}

function evaluateSpelling(state, response) {
  const acceptedSpellings = (Array.isArray(state.acceptedSpellings)
    ? state.acceptedSpellings
    : []
  )
    .map((value) => String(value || "").trim())
    .filter(isSimpleSpelling);
  const acceptedText = acceptedSpellings[0] || state.baseTerm;
  const accepted = acceptedSpellings.map((value) => ({
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
      acceptedText,
      note: "拼写正确。",
    };
  }

  return {
    result: "wrong",
    acceptedText,
    note: `这次没关系，正确写法是 ${acceptedText}。`,
  };
}

function applyResultToStages(state, mode, result) {
  const next = {
    recognitionStage: state.recognitionStage,
    listeningStage: state.listeningStage,
    spellingStage: state.spellingStage,
  };

  if (mode === "recognize") {
    next.recognitionStage = result === "correct" ? 1 : 0;
  }

  if (mode === "listen") {
    next.listeningStage = result === "correct" ? 1 : 0;
  }

  if (mode === "spell") {
    next.spellingStage = result === "correct" ? 1 : 0;
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

module.exports = {
  applyResultToStages,
  evaluateSpelling,
  isMasteredWithStages,
};
