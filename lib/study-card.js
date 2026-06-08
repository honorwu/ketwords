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

function normalizeMeaningKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[()\uFF08\uFF09]/g, "")
    .replace(/[\uFF1B;\u3001\uFF0C,./\s-]+/g, "")
    .replace(/[的地得着了过]/g, "")
    .trim();
}

const CLOSE_MEANING_GROUPS = [
  ["好看", "外貌好看", "长相好看", "长好看", "美丽", "漂亮", "美好", "迷人", "可爱", "英俊", "帅"],
  ["团体", "团队", "小组", "组", "队伍", "群体", "班级"],
  ["快", "快速", "迅速", "赶快", "马上"],
  ["慢", "缓慢"],
  ["大", "大型", "巨大", "庞大"],
  ["小", "小型", "一点", "少量"],
  ["开始", "开头", "起初"],
  ["结束", "完成", "完结"],
  ["害怕", "恐惧", "受惊", "担心", "紧张"],
  ["可怕", "吓人", "糟糕"],
  ["好", "优秀", "出色", "棒", "完美", "精彩"],
  ["坏", "差", "糟糕", "可怕"],
  ["聪明", "机灵", "聪慧"],
  ["困难", "难", "艰难"],
  ["容易", "简单"],
  ["危险", "不安全"],
  ["安全", "小心"],
  ["生气", "愤怒"],
  ["高兴", "开心", "愉快", "满意"],
  ["难过", "悲伤", "沮丧"],
  ["有趣", "令人兴奋", "刺激"],
  ["无聊", "乏味"],
  ["旅行", "旅程", "出行"],
  ["电影", "影片"],
  ["照片", "图片", "图画"],
  ["工作", "职业", "事业"],
  ["钱", "现金", "货币"],
  ["买", "购买"],
  ["卖", "出售"],
  ["花费", "费用", "价格"],
  ["走", "步行", "行走", "散步"],
  ["跑", "跑步", "奔跑", "跑步者"],
  ["跳舞", "舞蹈"],
  ["唱歌", "歌唱"],
  ["游泳", "泳"],
  ["骑车", "骑自行车", "骑"],
  ["滑雪", "滑雪运动"],
  ["滑冰", "溜冰"],
  ["冲浪", "冲浪运动"],
  ["爬", "攀登", "爬山"],
  ["航行", "航海"],
  ["飞", "飞行"],
  ["驾驶", "开车"],
  ["去", "来", "移动", "旅行"],
  ["说", "讲话", "说话"],
  ["听", "听到"],
  ["看", "看见", "观看"],
  ["找", "寻找", "查找"],
  ["修理", "修复"],
  ["建造", "建立"],
  ["选择", "决定"],
  ["知道", "了解"],
  ["记得", "记住"],
  ["忘记", "遗忘"],
  ["喜欢", "喜爱"],
  ["星星", "明星", "电影明星"],
  ["关闭", "关掉", "关上", "合上", "闭上", "停止营业", "不营业"],
  ["也许", "可能", "或许", "大概", "大约", "恐怕"],
  ["真实", "真实的", "真的", "真正", "真正的", "确实", "实际", "实际上"],
  ["空闲", "空闲的", "空", "空的", "空余", "空余的", "闲置", "闲置的", "备用", "备用的", "多余", "多余的"],
  ["金", "金的", "金色", "金色的", "金子", "黄金", "黄金的", "金质", "金质的", "金属", "金发的", "金发的人"],
];
const CLOSE_MEANING_LOOKUP = buildCloseMeaningLookup(CLOSE_MEANING_GROUPS);

function buildCloseMeaningLookup(groups) {
  const lookup = new Map();

  for (const group of groups) {
    const normalized = group.map(normalizeMeaningKey).filter(Boolean);

    for (const value of normalized) {
      lookup.set(value, normalized);
    }
  }

  return lookup;
}

function getMeaningParts(value) {
  return String(value || "")
    .split(/[;；,，、/()\uFF08\uFF09\s]+/)
    .map(normalizeMeaningKey)
    .filter(Boolean);
}

function areOptionLabelsTooClose(leftLabel, rightLabel) {
  const leftKey = normalizeMeaningKey(leftLabel);
  const rightKey = normalizeMeaningKey(rightLabel);

  if (!leftKey || !rightKey) {
    return false;
  }

  if (leftKey === rightKey) {
    return true;
  }

  const leftParts = getMeaningParts(leftLabel);
  const rightParts = new Set(getMeaningParts(rightLabel));

  for (const part of leftParts) {
    if (rightParts.has(part) && part.length >= 2) {
      return true;
    }
  }

  for (const leftPart of [leftKey, ...leftParts]) {
    const closeGroup = CLOSE_MEANING_LOOKUP.get(leftPart);

    if (!closeGroup) {
      continue;
    }

    for (const rightPart of [rightKey, ...rightParts]) {
      if (closeGroup.includes(rightPart)) {
        return true;
      }
    }
  }

  if (Math.min(leftKey.length, rightKey.length) >= 2) {
    return leftKey.includes(rightKey) || rightKey.includes(leftKey);
  }

  return false;
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
  return String(term || "").replace(/[^a-zA-Z0-9]/g, "").length;
}

function getSpellInputTexts(acceptedSpellings, fallbackTerm) {
  const spellings = (Array.isArray(acceptedSpellings) ? acceptedSpellings : [])
    .map((term) => String(term || "").trim())
    .filter(Boolean);

  if (spellings.length > 0) {
    return spellings;
  }

  return [fallbackTerm].filter(Boolean);
}

function getSpellingLengths(acceptedSpellings, fallbackTerm) {
  const lengths = getSpellInputTexts(acceptedSpellings, fallbackTerm)
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
    const pool = store.getDistractorPool(candidate.wordId, 80);
    const distractorCandidates = await Promise.all(
      pool.slice(0, 48).map((item) => ensureWordMeaning(item))
    );
    const candidateLabel = candidate.chineseMeaning || candidate.term;
    const usedMeanings = new Set([getOptionGroupKey(candidate, candidateLabel)]);
    const usedLabels = [candidateLabel];

    const distractors = [];

    for (const item of distractorCandidates) {
      const label = item.chineseMeaning || item.term;
      const optionKey = getOptionGroupKey(item, label);

      if (usedMeanings.has(optionKey)) {
        continue;
      }

      if (usedLabels.some((usedLabel) => areOptionLabelsTooClose(usedLabel, label))) {
        continue;
      }

      usedMeanings.add(optionKey);
      usedLabels.push(label);
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
