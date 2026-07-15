const { ensureWordOfflineData } = require("./offline-cache");

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }

  return copy;
}

function spellingLetterCount(term) {
  return String(term || "").replace(/[^a-zA-Z0-9]/g, "").length;
}

function getSpellInputTexts(acceptedSpellings, fallbackTerm) {
  const spellings = (Array.isArray(acceptedSpellings) ? acceptedSpellings : [])
    .map((term) => String(term || "").trim())
    .filter((term) => /^[A-Za-z0-9]+$/.test(term));

  if (spellings.length > 0) {
    return spellings;
  }

  const fallback = String(fallbackTerm || "").trim();
  return /^[A-Za-z0-9]+$/.test(fallback) ? [fallback] : [];
}

function getSpellingLengths(acceptedSpellings, fallbackTerm) {
  const lengths = getSpellInputTexts(acceptedSpellings, fallbackTerm)
    .map(spellingLetterCount)
    .filter((length) => length > 0);

  if (lengths.length === 0) {
    lengths.push(0);
  }

  return {
    min: Math.min(...lengths),
    max: Math.max(...lengths),
  };
}

function buildSpellingHint(term, acceptedSpellings) {
  const lengths = getSpellingLengths(acceptedSpellings, term);
  const spellings = getSpellInputTexts(acceptedSpellings, term);
  const letters = String(spellings[0] || term || "").replace(/[^a-zA-Z]/g, "");
  const firstLetter = letters.charAt(0).toUpperCase();
  const lengthLabel =
    lengths.min === lengths.max ? `${lengths.max}` : `${lengths.min}-${lengths.max}`;

  return `${firstLetter} 开头，约 ${lengthLabel} 个字母`;
}

function buildFlowNote(candidate, mode, isDeferredRetry = false) {
  if (!candidate.spellingRequired) {
    return mode === "recognize"
      ? "这是词组，认对后进入听词；认错则明天继续认词。"
      : "这是词组，听对后标记为已掌握；听错则明天继续听词。";
  }

  if (mode === "spell") {
    return isDeferredRetry
      ? "这是排到队尾的拼写错词，拼对后会标记为已掌握。"
      : "拼写正确后，这个词会标记为已掌握；拼错会排到普通任务之后。";
  }

  if (mode === "listen") {
    return "听对后进入拼写；听错则明天继续听词。";
  }

  return "认对后进入听词；认错则明天继续认词。";
}

function createCardBuilder(store) {
  async function ensureWordEnriched(state) {
    if (!state) {
      return state;
    }

    return ensureWordOfflineData(store, state, {
      allowNetwork: false,
      includeMeaning: false,
    });
  }

  return async function buildCard() {
    const next = store.getNextCandidate();

    if (next.status === "done" || !next.candidate) {
      return {
        status: "done",
        card: null,
        message: next.message || "今天的计划完成了，可以先休息一下，明天再继续。",
      };
    }

    const candidate = await ensureWordEnriched(next.candidate);
    const spellingLengths = getSpellingLengths(candidate.acceptedSpellings, candidate.baseTerm);
    const candidateLabel = String(candidate.chineseMeaning || "").trim();
    const distractors = store.getDistractorPool(candidate.wordId, 3).map((item) => ({
      wordId: item.wordId,
      label: String(item.chineseMeaning || "").trim(),
    }));

    const options = shuffle(
      [
        {
          wordId: candidate.wordId,
          label: candidateLabel,
        },
        ...distractors,
      ].slice(0, 4)
    );

    return {
      status: "ready",
      card: {
        wordId: candidate.wordId,
        term: candidate.term,
        baseTerm: candidate.baseTerm,
        partOfSpeech: candidate.partOfSpeech,
        acceptedSpellings: candidate.acceptedSpellings,
        spellingMinLength: spellingLengths.min,
        spellingMaxLength: spellingLengths.max,
        mode: next.mode,
        frequencyScore: candidate.frequencyScore,
        theme: candidate.theme,
        chineseMeaning: candidate.chineseMeaning || "",
        phonetic: candidate.phonetic || "",
        audioUrl: candidate.audioUrl || "",
        example: next.mode === "recognize" ? candidate.examples?.[0] || "" : "",
        options,
        hint: buildSpellingHint(candidate.baseTerm, candidate.acceptedSpellings),
        flowNote: buildFlowNote(candidate, next.mode, next.isDeferredRetry),
        prompt:
          next.mode === "spell"
            ? "看中文写英文"
            : next.mode === "listen"
              ? "听发音选中文"
              : "看英文选中文",
      },
    };
  };
}

module.exports = {
  createCardBuilder,
};
