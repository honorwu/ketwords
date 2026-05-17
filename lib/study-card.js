const { ensureWordOfflineData } = require("./offline-cache");

function normalizeOptionKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[()\uFF08\uFF09]/g, "")
    .replace(/[\uFF1B;\u3001\uFF0C,./\s-]+/g, "")
    .trim();
}

function getOptionGroupKey(item, label = "") {
  const termKey = normalizeOptionKey(item?.normalizedTerm || item?.term);
  const labelKey = normalizeOptionKey(label);

  if (["phone", "mobilephone", "cellphone", "telephone"].includes(termKey)) {
    return "phone";
  }

  if (/(电话|手机|移动电话)/.test(labelKey)) {
    return "phone";
  }

  if (termKey === "classroom" || /(教室|课堂)/.test(labelKey)) {
    return "school-room";
  }

  if (termKey === "class") {
    return "school-class";
  }

  return labelKey || termKey;
}

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
  return String(term || "").replace(/[^a-zA-Z-]/g, "").length;
}

function getSpellingLengths(acceptedSpellings, fallbackTerm) {
  const lengths = (Array.isArray(acceptedSpellings) ? acceptedSpellings : [])
    .map(spellingLetterCount)
    .filter((length) => length > 0);

  if (lengths.length === 0) {
    lengths.push(spellingLetterCount(fallbackTerm));
  }

  return {
    min: Math.min(...lengths),
    max: Math.max(...lengths),
  };
}

function buildSpellingHint(term, acceptedSpellings) {
  const lengths = getSpellingLengths(acceptedSpellings, term);
  const letters = String(term || "").replace(/[^a-zA-Z]/g, "");
  const firstLetter = letters.charAt(0).toUpperCase();
  const lengthLabel =
    lengths.min === lengths.max ? `${lengths.max}` : `${lengths.min}-${lengths.max}`;

  return `${firstLetter} 开头，约 ${lengthLabel} 个字母`;
}

function getPriorityLabel(priority) {
  return priority ? `${priority} 级` : "重点";
}

function buildFlowNote(candidate, mode) {
  if (!candidate.spellingRequired) {
    return "";
  }

  const label = getPriorityLabel(candidate.priority);

  if (mode === "spell") {
    return `这是 ${label}拼写词，今天做一次默写，下一次默写会放到后面的学习日。`;
  }

  if (mode === "listen") {
    return `这是 ${label}拼写词，今天先听词，默写会放到后面的学习日。`;
  }

  return `这是 ${label}拼写词，今天先认词，听词和默写会放到后面的学习日。`;
}

function createCardBuilder(store) {
  async function ensureWordMeaning(state) {
    if (!state || state.chineseMeaning) {
      return state;
    }

    return ensureWordOfflineData(store, state, {
      allowNetwork: false,
      includeMeaning: true,
      includePhonetic: false,
      includeAudio: false,
    });
  }

  async function ensureWordEnriched(state) {
    if (!state) {
      return state;
    }

    return ensureWordOfflineData(store, state, {
      allowNetwork: false,
    });
  }

  return async function buildCard() {
    const next = store.getNextCandidate();

    if (next.status === "done" || !next.candidate) {
      return {
        status: "done",
        plan: next.plan,
        card: null,
        message: next.message || "今天的计划完成了，可以先休息一下，明天再继续。",
      };
    }

    const candidate = await ensureWordEnriched(next.candidate);
    const spellingLengths = getSpellingLengths(candidate.acceptedSpellings, candidate.baseTerm);
    const pool = store.getDistractorPool(candidate.wordId, 14);
    const distractorCandidates = await Promise.all(
      pool.slice(0, 10).map((item) => ensureWordMeaning(item))
    );
    const candidateLabel = candidate.chineseMeaning || candidate.term;
    const usedMeanings = new Set([getOptionGroupKey(candidate, candidateLabel)]);

    const distractors = [];

    for (const item of distractorCandidates) {
      const label = item.chineseMeaning || item.term;
      const optionKey = getOptionGroupKey(item, label);

      if (usedMeanings.has(optionKey)) {
        continue;
      }

      usedMeanings.add(optionKey);
      distractors.push({
        wordId: item.wordId,
        label,
      });

      if (distractors.length >= 3) {
        break;
      }
    }

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
      plan: next.plan,
      card: {
        wordId: candidate.wordId,
        term: candidate.term,
        baseTerm: candidate.baseTerm,
        partOfSpeech: candidate.partOfSpeech,
        acceptedSpellings: candidate.acceptedSpellings,
        spellingMinLength: spellingLengths.min,
        spellingMaxLength: spellingLengths.max,
        mode: next.mode,
        priority: candidate.priority,
        theme: candidate.theme,
        chineseMeaning: candidate.chineseMeaning || "",
        phonetic: candidate.phonetic || "",
        audioUrl: candidate.audioUrl || "",
        example: next.mode === "recognize" ? candidate.examples?.[0] || "" : "",
        options,
        hint: buildSpellingHint(candidate.baseTerm, candidate.acceptedSpellings),
        flowNote: buildFlowNote(candidate, next.mode),
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
