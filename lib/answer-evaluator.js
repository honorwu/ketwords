const { normalizeCompact, normalizeLookup } = require("./wordlist");
const { getStageTargets } = require("./study-progress");

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
      const minimumListeningStage = state.spellingStage > 0 ? 1 : 0;
      next.listeningStage = Math.max(next.listeningStage - 1, minimumListeningStage);
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

module.exports = {
  applyResultToStages,
  evaluateSpelling,
  isMasteredWithStages,
};
