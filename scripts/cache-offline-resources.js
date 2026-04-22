const { ensureWordlistJson } = require("../lib/wordlist");
const { createStore } = require("../lib/store");
const { cacheFonts, ensureWordOfflineData, hasLocalAudio } = require("../lib/offline-cache");

const CONCURRENCY = Math.max(1, Number(process.env.CACHE_CONCURRENCY || 4));

function summarizeState(state) {
  return {
    meaning: Boolean(state?.chineseMeaning),
    phonetic: Boolean(state?.phonetic),
    audio: hasLocalAudio(state),
  };
}

async function main() {
  const words = await ensureWordlistJson();
  const store = createStore();
  store.syncWords(words);

  const fontSummary = await cacheFonts();
  const states = store.getAllStates();
  let nextIndex = 0;
  let completed = 0;
  let meaningFilled = 0;
  let phoneticFilled = 0;
  let audioFilled = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= states.length) {
        return;
      }

      const before = summarizeState(states[currentIndex]);

      try {
        const after = await ensureWordOfflineData(store, states[currentIndex]);
        const summary = summarizeState(after);

        if (!before.meaning && summary.meaning) {
          meaningFilled += 1;
        }

        if (!before.phonetic && summary.phonetic) {
          phoneticFilled += 1;
        }

        if (!before.audio && summary.audio) {
          audioFilled += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`[cache] ${states[currentIndex].term}: ${error.message}`);
      }

      completed += 1;

      if (completed % 25 === 0 || completed === states.length) {
        console.log(
          `[cache] ${completed}/${states.length} meaning +${meaningFilled} phonetic +${phoneticFilled} audio +${audioFilled} failed ${failed}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const refreshed = store.getAllStates();
  const totals = refreshed.reduce(
    (accumulator, state) => {
      if (state.chineseMeaning) {
        accumulator.meaning += 1;
      }

      if (state.phonetic) {
        accumulator.phonetic += 1;
      }

      if (hasLocalAudio(state)) {
        accumulator.audio += 1;
      }

      return accumulator;
    },
    {
      meaning: 0,
      phonetic: 0,
      audio: 0,
    }
  );

  console.log(
    `[fonts] downloaded ${fontSummary.downloaded}/${fontSummary.total}, stylesheet ${fontSummary.stylesheetPath}`
  );
  console.log(
    `[done] words ${refreshed.length}, meaning ${totals.meaning}, phonetic ${totals.phonetic}, audio ${totals.audio}, failed ${failed}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
