export const state = {
  isAdmin: window.location.pathname === "/admin",
  overview: null,
  currentCard: null,
  selectedChoiceId: null,
  startedAt: 0,
  feedback: null,
  prefetchedNext: null,
  prefetchedNextPromise: null,
  parentWords: [],
  parentWordsNeedRefresh: true,
  parentWordsLoading: false,
  parentWordFilter: "",
  answerSubmitting: false,
  cardLoading: false,
  studyTimerStartedAt: 0,
  studyTimerId: null,
  studyElapsedSeconds: 0,
  studyDisplayStats: null,
  auth: null,
  appLoaded: false,
  audioAutoPlayTimer: null,
  resultAudioContext: null,
  encouragement: "",
  checkinCache: {},
  spellInputValue: "",
  mistakeReviewTimer: null,
  mistakeReviewInterval: null,
  mistakeReviewSpeechToken: 0,
};

export const ENCOURAGEMENTS = [
  "今天学一点点，考试时就会轻松很多。",
  "你不是在赶路，你是在一天天变厉害。",
  "先拿下一个词，再拿下下一个词。",
  "每次认真答一题，都是在给自己加分。",
  "慢一点没有关系，坚持就很了不起。",
  "今天的努力，会变成考场上的自信。",
  "记住一个词，就是向目标走近一步。",
  "不用一下子全会，稳稳往前就很好。",
];

export const MISTAKE_REVIEW_MIN_MS = 6500;
export const MISTAKE_REVIEW_MAX_MS = 9500;
export const MISTAKE_REVIEW_BASE_MS = 3400;
