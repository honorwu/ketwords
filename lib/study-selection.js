const {
  WRONG_PARK_DAYS,
  addDays,
  stableHash,
  todayKey,
} = require("./study-logic");
const { isMastered } = require("./study-progress");
const STUDY_MODE_PRIORITY = Object.freeze(["recognize", "listen", "spell"]);

function getModeForState(state) {
  if (state.learningTarget === "spell") {
    if (state.recognitionStage < 1) {
      return "recognize";
    }

    if (state.listeningStage < 1) {
      return "listen";
    }

    return "spell";
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

function getWordMapStatus(state) {
  if (!state.firstSeenAt) {
    return "unseen";
  }

  if (isMastered(state)) {
    return "mastered";
  }

  if (state.lastResult === "wrong") {
    if (state.lastMode === "listen") {
      return "listen-wrong";
    }

    if (state.lastMode === "spell") {
      return "spell-wrong";
    }
  }

  const mode = getModeForState(state);

  if (mode === "recognize") {
    return "recognize-wrong";
  }

  if (mode === "listen") {
    return state.lastMode === "listen" && state.lastResult === "wrong"
      ? "listen-wrong"
      : "listen-pending";
  }

  if (mode === "spell") {
    return state.lastMode === "spell" && state.lastResult === "wrong"
      ? "spell-wrong"
      : "spell-pending";
  }

  return "unseen";
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

function getDailyCandidateRank(state, mode) {
  return stableHash(`${todayKey()}|${mode}|${state.normalizedTerm || state.wordId}`);
}

function getDailyWordKey(state) {
  return String(
    state?.baseTerm ||
    state?.base_term ||
    state?.term ||
    state?.normalizedTerm ||
    state?.normalized_term ||
    state?.wordKey ||
    state?.word_key ||
    ""
  )
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sortStudyCandidates(left, right, mode) {
  const leftFrequency = Number(left.frequencyScore ?? left.frequencyZipf ?? 0);
  const rightFrequency = Number(right.frequencyScore ?? right.frequencyZipf ?? 0);
  const leftRank = getDailyCandidateRank(left, mode);
  const rightRank = getDailyCandidateRank(right, mode);
  const leftDue = left.nextReviewAt ? new Date(left.nextReviewAt).getTime() : 0;
  const rightDue = right.nextReviewAt ? new Date(right.nextReviewAt).getTime() : 0;
  const leftSeen = left.firstSeenAt ? 1 : 0;
  const rightSeen = right.firstSeenAt ? 1 : 0;

  return (
    leftSeen - rightSeen ||
    rightFrequency - leftFrequency ||
    leftDue - rightDue ||
    leftRank - rightRank ||
    left.sourceOrder - right.sourceOrder
  );
}

function isWordAvailableToday(state, todayModeWordKeys) {
  const key = getDailyWordKey(state);

  return !Object.values(todayModeWordKeys || {}).some((wordKeys) =>
    wordKeys?.has(key)
  );
}

function isParkedAfterWrong(state, mode, now) {
  if (state.lastResult !== "wrong" || state.lastMode !== mode || !state.lastSeenAt) {
    return false;
  }

  const lastSeenAt = new Date(state.lastSeenAt);

  if (Number.isNaN(lastSeenAt.getTime())) {
    return false;
  }

  const parkDays = WRONG_PARK_DAYS[mode] || 0;
  const availableAt = new Date(lastSeenAt);
  availableAt.setHours(0, 0, 0, 0);
  availableAt.setDate(availableAt.getDate() + parkDays);
  return availableAt > now;
}

function isWrongRetryCandidate(state, mode) {
  if (state.lastResult !== "wrong") {
    return false;
  }

  return state.lastMode === mode || (mode === "recognize" && state.lastMode === "listen");
}

function isDueOrNewForMode(state, mode, now) {
  if (isMastered(state)) {
    return false;
  }

  if (getModeForState(state) !== mode) {
    return false;
  }

  if (isParkedAfterWrong(state, mode, now)) {
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

function getEligibleModeCandidates(states, mode, now, todayModeWordKeys) {
  const candidates = states
    .filter((state) =>
      isWordAvailableToday(state, todayModeWordKeys) &&
      isDueOrNewForMode(state, mode, now)
    )
    .sort((left, right) => sortStudyCandidates(left, right, mode));

  const regularCandidates = candidates.filter(
    (state) => !isWrongRetryCandidate(state, mode)
  );
  const wrongRetryCandidates = candidates.filter((state) => isWrongRetryCandidate(state, mode));

  if (mode === "spell") {
    return regularCandidates;
  }

  return [...wrongRetryCandidates, ...regularCandidates];
}

function getDeferredSpellRetryCandidates(
  states,
  now,
  todayModeWordKeys = {}
) {
  return states
    .filter((state) => {
      if (
        isMastered(state) ||
        getModeForState(state) !== "spell" ||
        !isWrongRetryCandidate(state, "spell")
      ) {
        return false;
      }

      if (!isWordAvailableToday(state, todayModeWordKeys)) {
        return false;
      }

      if (state.nextReviewAt && new Date(state.nextReviewAt) > now) {
        return false;
      }

      return true;
    })
    .sort((left, right) => sortStudyCandidates(left, right, "spell"));
}

function getNextReviewAtAfterAnswer(masteredAfter, now = new Date()) {
  if (masteredAfter) {
    return addDays(now, 3650);
  }

  const nextDay = new Date(now);
  nextDay.setHours(0, 0, 0, 0);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay;
}

function getModePriorityOrder() {
  return [...STUDY_MODE_PRIORITY];
}

module.exports = {
  getDeferredMode,
  getDeferredSpellRetryCandidates,
  getDailyWordKey,
  getEligibleModeCandidates,
  getModeForState,
  getModePriorityOrder,
  getNextReviewAtAfterAnswer,
  getWordMapStatus,
  isWordAvailableToday,
  isDueOrNewForMode,
  isParkedAfterWrong,
  isWrongRetryCandidate,
  sortStudyCandidates,
};
