const {
  DAILY_LISTEN_TARGET,
  DAILY_MODE_SEQUENCE,
  DAILY_RECOGNIZE_TARGET,
  DAILY_SPELL_TARGET,
  DAILY_WRONG_RETRY_LIMITS,
  WRONG_PARK_DAYS,
  addDays,
  stableHash,
  todayKey,
} = require("./study-logic");
const { isMastered } = require("./study-progress");

function getModeForState(state) {
  if (state.learningTarget === "spell") {
    if (state.recognitionStage < 1) {
      return "recognize";
    }

    if (state.listeningStage < 1 && state.spellingStage < 1) {
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

  return getModeForState(state);
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

function isAvailableForModeToday(state, mode, todayModeWordKeys) {
  const key = state.normalizedTerm;

  if (todayModeWordKeys[mode]?.has(key)) {
    return false;
  }

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

function isParkedAfterWrong(state, mode, now) {
  if (state.lastResult !== "wrong" || state.lastMode !== mode || !state.lastSeenAt) {
    return false;
  }

  const lastSeenAt = new Date(state.lastSeenAt);

  if (Number.isNaN(lastSeenAt.getTime())) {
    return false;
  }

  const parkDays = WRONG_PARK_DAYS[mode] || 0;
  return addDays(lastSeenAt, parkDays) > now;
}

function isWrongRetryCandidate(state, mode) {
  return state.lastResult === "wrong" && state.lastMode === mode;
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
      isAvailableForModeToday(state, mode, todayModeWordKeys) &&
      isDueOrNewForMode(state, mode, now)
    )
    .sort((left, right) => sortStudyCandidates(left, right, mode));

  const regularCandidates = candidates.filter((state) => !isWrongRetryCandidate(state, mode));
  const wrongRetryCandidates = candidates.filter((state) => isWrongRetryCandidate(state, mode));

  return [
    ...regularCandidates,
    ...wrongRetryCandidates.slice(0, DAILY_WRONG_RETRY_LIMITS[mode] || 0),
  ];
}

function getModeOrderForToday(todayStats) {
  if (todayStats.recognizeCards < DAILY_RECOGNIZE_TARGET) {
    return ["recognize", "listen", "spell"];
  }

  if (todayStats.listenCards < DAILY_LISTEN_TARGET) {
    return ["listen", "recognize", "spell"];
  }

  if (todayStats.spellCards < DAILY_SPELL_TARGET) {
    return ["spell", "recognize", "listen"];
  }

  const completedAfterTargets =
    todayStats.cards -
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

module.exports = {
  getDeferredMode,
  getEligibleModeCandidates,
  getModeForState,
  getModeOrderForToday,
  getWordMapStatus,
  isAvailableForModeToday,
  isDueOrNewForMode,
  isParkedAfterWrong,
  isWrongRetryCandidate,
  sortStudyCandidates,
};
