const { ensureStudyConfig } = require("./study-config");

const STUDY_CONFIG = ensureStudyConfig();
const EXAM_DATE = STUDY_CONFIG.examDate;
const PREP_START_DATE = STUDY_CONFIG.prepStartDate;
const WRONG_PARK_DAYS = STUDY_CONFIG.wrongParkDays;
const DISTRACTOR_GROUPS = [
  ["east", "south", "west", "north"],
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],
  ["spring", "summer", "autumn", "winter"],
  [
    "black",
    "blue",
    "brown",
    "green",
    "grey",
    "gray",
    "orange",
    "pink",
    "purple",
    "red",
    "white",
    "yellow",
  ],
  ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
  ["eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"],
  ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million"],
  ["first", "second", "third", "last", "next"],
  ["morning", "afternoon", "evening", "night"],
  ["breakfast", "lunch", "dinner", "supper"],
  ["mother", "father", "brother", "sister", "son", "daughter", "aunt", "uncle", "cousin"],
  ["grandfather", "grandmother", "grandparent", "grandad", "granddad", "grandpa", "grandma"],
  ["husband", "wife", "boyfriend", "girlfriend", "parent", "child", "baby"],
  ["head", "face", "eye", "ear", "nose", "mouth", "tooth", "hand", "arm", "leg", "foot"],
  ["body", "finger", "hair", "neck", "shoulder", "stomach", "back", "heart"],
  ["headache", "stomach ache", "toothache", "pain", "medicine", "health", "sick", "ill"],
  ["shirt", "t-shirt", "coat", "jacket", "dress", "skirt", "shoe", "sock", "hat", "trousers", "shorts", "jeans", "sweater", "jumper", "uniform"],
  ["bag", "backpack", "pocket", "purse", "suitcase", "wallet"],
  ["bus", "car", "train", "taxi", "boat", "ship", "bike", "bicycle", "aeroplane", "airplane", "helicopter", "lorry", "motorbike", "scooter"],
  ["airport", "bus station", "station", "platform", "garage", "car park", "parking lot"],
  ["road", "street", "motorway", "crossing", "traffic", "traffic light", "roundabout"],
  ["school", "library", "bank", "hospital", "hotel", "museum", "park", "cinema", "restaurant", "cafe", "market", "supermarket", "shop", "bookshop", "bookstore"],
  ["sunny", "rainy", "cloudy", "snowy", "windy", "wet", "cold", "hot", "warm", "cool"],
  ["rain", "snow", "wind", "cloud", "storm", "fog", "foggy", "weather", "weather forecast"],
  ["apple", "banana", "orange", "pear", "grape", "melon", "lemon", "strawberry", "fruit"],
  ["carrot", "potato", "tomato", "bean", "mushroom", "garlic", "vegetable"],
  ["bread", "cake", "cookie", "sandwich", "pizza", "pasta", "rice", "cereal"],
  ["beef", "chicken", "fish", "meat", "sausage"],
  ["coffee", "tea", "milk", "water", "juice", "lemonade", "cola", "mineral water"],
  ["breakfast", "lunch", "dinner", "supper", "meal", "snack", "main course"],
  ["cook", "bake", "boil", "fry", "grill", "roast", "wash up"],
  ["table", "chair", "desk", "sofa", "armchair", "bed", "bookcase", "bookshelf", "cupboard", "wardrobe", "shelf"],
  ["bathroom", "bedroom", "dining room", "kitchen", "living room", "sitting room", "hall"],
  ["door", "floor", "wall", "window", "roof", "ceiling", "gate", "stairs"],
  ["computer", "laptop", "tablet", "screen", "keyboard", "mouse", "printer", "camera", "digital camera"],
  ["phone", "mobile phone", "cell phone", "telephone", "text", "email", "message", "app", "website", "internet", "web", "online", "wifi"],
  ["cd", "dvd", "cd player", "radio", "television", "tv", "video"],
  ["answer", "ask", "question", "reply", "tell"],
  ["listen", "hear", "speak", "talk", "say", "read", "write", "spell"],
  ["learn", "study", "teach", "practice", "lesson", "homework", "exam", "examination", "test", "exercise"],
  ["book", "notebook", "textbook", "dictionary", "paper", "page", "paragraph", "sentence", "word"],
  ["pen", "pencil", "pencil case", "ruler", "eraser", "rubber", "scissors"],
  ["history", "geography", "chemistry", "science", "maths", "music", "art", "language"],
  ["dance", "dancing", "music", "song", "sing", "singing", "piano", "guitar", "violin", "jazz", "opera", "disco"],
  ["football", "soccer", "basketball", "baseball", "volleyball", "rugby", "tennis", "badminton", "table tennis", "golf"],
  ["walk", "walking", "run", "running", "swim", "swimming", "cycle", "cycling", "ski", "skiing", "skate", "skating", "climb", "climbing", "dive", "surf", "surfing", "sail", "sailing"],
  ["game", "board game", "chess", "puzzle", "toy", "doll", "kite", "hobby", "activity"],
  ["job", "work", "career", "business", "company", "office", "factory"],
  ["doctor", "dentist", "nurse", "mechanic", "farmer", "chef", "cook", "waiter", "waitress", "receptionist", "secretary", "assistant", "manager", "boss"],
  ["artist", "painter", "singer", "musician", "actor", "actress", "journalist", "photographer", "writer"],
  ["police", "police officer", "pilot", "driver", "tour guide", "guide", "shop assistant", "businessman", "businesswoman", "business person"],
  ["group", "team", "club", "member", "staff", "company", "family", "people", "crowd", "class"],
  ["buy", "sell", "pay", "cost", "spend", "earn", "rent", "save"],
  ["money", "cash", "coin", "penny", "cent", "pound", "dollar", "euro", "price", "sale", "discount", "half price"],
  ["credit card", "cheque", "receipt", "ticket", "licence", "passport"],
  ["cheap", "expensive", "free", "half price", "low"],
  ["happy", "sad", "angry", "afraid", "scared", "frightened", "nervous", "worried", "upset", "bored", "pleased", "excited", "amazed", "surprised", "interested"],
  ["boring", "exciting", "amazing", "surprising", "interesting", "funny", "scary"],
  ["good", "great", "nice", "excellent", "perfect", "wonderful", "lovely", "pleasant", "brilliant"],
  ["bad", "worse", "terrible", "horrible", "poor", "awful"],
  ["beautiful", "pretty", "good-looking", "handsome", "lovely", "friendly", "young", "old", "tall", "short", "strong", "thin", "clever"],
  ["big", "large", "huge", "small", "little"],
  ["long", "short", "tall", "high", "low", "wide"],
  ["thin", "fat", "heavy", "light", "strong", "weak"],
  ["young", "old", "adult", "aged", "new", "modern", "latest", "advanced"],
  ["quick", "quickly", "fast", "slow", "slowly", "early", "late"],
  ["easy", "difficult", "hard", "impossible", "possible", "able"],
  ["careful", "carefully", "danger", "dangerous", "safe", "safely"],
  ["clean", "dirty", "tidy", "untidy", "dry", "wet"],
  ["open", "close", "closed", "shut", "turn on", "turn off"],
  ["same", "similar", "different", "opposite"],
  ["usual", "usually", "unusual", "often", "sometimes", "never", "always", "ever"],
  ["actually", "really", "perhaps", "maybe", "possibly", "probably", "certainly"],
  ["again", "still", "already", "yet", "just", "then", "afterwards", "finally", "suddenly"],
  ["before", "after", "during", "while", "until", "since"],
  ["begin", "start", "end", "finish", "complete", "stop"],
  ["go", "come", "move", "drive", "ride", "fly", "travel"],
  ["bring", "carry", "take", "put", "give", "send", "throw", "pull", "push", "hold"],
  ["look", "see", "watch", "find", "look for", "find out", "discover", "notice", "show"],
  ["make", "build", "invent", "create", "repair", "fix", "break", "break down"],
  ["want", "would like", "need", "have to", "must", "should", "can", "could", "may", "might", "will"],
  ["like", "love", "enjoy", "prefer", "hate"],
  ["agree", "decide", "choose", "mean", "suppose", "think", "know", "remember", "forget", "guess"],
  ["in", "on", "under", "over", "above", "below", "between", "among", "behind", "in front of", "next to", "near", "across", "through"],
  ["inside", "outside", "upstairs", "downstairs", "back", "front", "middle", "left", "right"],
  ["here", "there", "where", "somewhere", "everywhere", "anywhere", "nowhere"],
  ["all", "both", "some", "any", "many", "much", "few", "a few", "little", "a little", "several", "enough"],
  ["more", "most", "less", "least", "another", "other", "each", "every"],
  ["I", "me", "my", "mine", "myself"],
  ["you", "your", "yours", "yourself"],
  ["he", "him", "his", "himself"],
  ["she", "her", "hers", "herself"],
  ["we", "us", "our", "ours", "ourselves"],
  ["they", "them", "their", "theirs", "themselves"],
  ["someone", "somebody", "everyone", "everybody", "anyone", "anybody", "no one", "nobody"],
  ["thing", "something", "anything", "nothing", "everything", "stuff"],
  ["and", "or", "but", "because", "so", "if", "when", "than", "that", "which", "who"],
  ["a", "an", "the", "this", "that", "these", "those"],
  ["circle", "square", "line", "point", "dot", "round"],
  ["box", "bottle", "cup", "glass", "plate", "bowl", "dish"],
  ["north", "south", "east", "west", "capital", "country", "city", "town", "village", "countryside"],
  ["sea", "ocean", "river", "lake", "island", "beach", "forest", "rainforest", "field", "hill", "mountain"],
  ["plant", "flower", "tree", "grass", "wood", "rock", "ground", "sky", "moon", "sun"],
];
const DISTRACTOR_GROUP_LOOKUP = buildDistractorGroupLookup(DISTRACTOR_GROUPS);
const GENERAL_THEME = "general";
const ENGLISH_DISTRACTOR_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);
const CHINESE_DISTRACTOR_STOP_CHARS = new Set([
  "一",
  "个",
  "人",
  "事",
  "物",
  "的",
  "地",
  "得",
  "和",
  "与",
  "及",
  "或",
  "把",
  "被",
  "是",
  "有",
  "在",
  "了",
]);
const MEANING_BUCKET_RULES = [
  ["person", /人|员|者|师|生|男|女|父|母|兄|弟|姐|妹|婴|孩|朋友|丈夫|妻|警察|医生|厨师|记者|歌手|画家|司机|导游|经理|老板|秘书|接待|助理/],
  ["place", /处|地|店|馆|场|站|院|校|室|园|中心|机场|银行|医院|博物馆|公园|电影院|餐厅|城市|乡村|海滩|农场|市场|超市/],
  ["time", /时|间|天|日|周|月|年|早|午|晚|夜|季|春|夏|秋|冬|点|分钟|小时|昨天|今天|明天/],
  ["food", /食|饭|餐|肉|鸡|鱼|蛋|面包|蛋糕|三明治|披萨|米|奶|茶|咖啡|水|汁|水果|苹果|香蕉|橙|土豆|番茄|蔬菜|巧克力|糖/],
  ["transport", /车|船|机|自行车|飞机|火车|公共汽车|出租|道路|街|交通|票|旅行|旅程|机场|站台/],
  ["home", /家|房|屋|室|厨房|卧室|浴室|客厅|桌|椅|床|门|窗|墙|地板|沙发|柜|架/],
  ["school", /学|课|书|笔|考试|问题|答案|作业|字典|语言|练习|老师|学生|教室|学校/],
  ["technology", /电脑|计算机|电话|手机|网络|网站|邮件|信息|屏幕|应用|相机|视频|收音机|电视|光盘|dvd|cd/],
  ["money", /钱|现金|硬币|便士|美分|英镑|美元|欧元|价格|花费|支付|卖|买|租|折扣|免费|票|收据|信用卡/],
  ["feeling", /高兴|开心|悲|难过|生气|害怕|担心|紧张|无聊|兴奋|惊讶|满意|感兴趣|可怕|有趣|令人/],
  ["quality", /好|坏|棒|优秀|完美|漂亮|美丽|可爱|愉快|糟糕|可怕|严重|困难|容易|可能|安全|危险|现代|先进/],
  ["size", /大|小|高|低|长|短|宽|窄|胖|瘦|重|轻|强|弱|巨大/],
  ["colour", /色|黑|白|红|蓝|绿|黄|粉|紫|棕|灰|橙/],
  ["weather", /雨|雪|风|云|暴风|雾|晴|天气|冷|热|暖|凉|湿|干/],
  ["nature", /海|河|湖|山|岛|森林|雨林|田|天空|月亮|太阳|树|花|草|植物|岩石|地面/],
  ["body", /身体|头|脸|眼|耳|鼻|嘴|牙|手|脚|腿|胳膊|肩|脖|胃|心|头痛|腹痛|牙痛/],
  ["clothes", /衣|裤|裙|鞋|袜|帽|外套|夹克|衬衫|毛衣|牛仔|制服|t恤/],
  ["sport", /运动|球|足球|篮球|网球|羽毛球|高尔夫|跑|游泳|滑|滑雪|骑车|爬|潜水|冲浪/],
  ["music", /音乐|唱|歌|钢琴|吉他|小提琴|爵士|歌剧|跳舞|舞蹈/],
  ["grammar", /我|你|他|她|它|我们|他们|这个|那个|这些|那些|全部|一些|任何|每|另|因为|所以|如果|但是|或者|关于|穿过|上|下|里|外|前|后|左|右/],
];

const DISPLAY_LABELS = Object.freeze({
  stageRecognize: "\u8ba4",
  stageListen: "\u542c",
  stageSpell: "\u62fc",
  statusUnseen: "未学习",
  statusRecognizeWrong: "认词错误",
  statusListenPending: "待听词",
  statusListenWrong: "听词错误",
  statusSpellPending: "待拼写",
  statusSpellWrong: "拼写错误",
  mastered: "已掌握",
  tomorrowRecognize: "明天继续认词",
  tomorrowListen: "明天听词",
  tomorrowListenRetry: "明天继续听词",
  tomorrowSpell: "明天拼写",
  spellRetry: "从明天起，普通任务完成后重试拼写",
  nextSpell: "下一步拼写",
  nextListen: "下一步听词",
  nextRecognize: "下一步认词",
  longReview: "已掌握",
});

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function diffDays(fromKey, toKey) {
  const diff = parseDateKey(fromKey) - parseDateKey(toKey);
  return Math.round(diff / 86400000);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeDistractorTerm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDistractorGroupLookup(groups) {
  const lookup = new Map();

  for (const group of groups) {
    const normalized = group.map(normalizeDistractorTerm).filter(Boolean);

    for (const term of normalized) {
      lookup.set(term, normalized);
    }
  }

  return lookup;
}

function getDistractorGroupTerms(state) {
  const keys = [
    state?.baseTerm,
    state?.normalizedTerm,
    state?.term,
    ...(Array.isArray(state?.acceptedSpellings) ? state.acceptedSpellings : []),
  ].map(normalizeDistractorTerm);

  for (const key of keys) {
    if (DISTRACTOR_GROUP_LOOKUP.has(key)) {
      return DISTRACTOR_GROUP_LOOKUP.get(key);
    }
  }

  return [];
}

function isInDistractorGroup(state, groupTerms) {
  if (!groupTerms.length) {
    return false;
  }

  const keys = [
    state?.baseTerm,
    state?.normalizedTerm,
    state?.term,
    ...(Array.isArray(state?.acceptedSpellings) ? state.acceptedSpellings : []),
  ].map(normalizeDistractorTerm);

  return keys.some((key) => groupTerms.includes(key));
}

function getPartOfSpeechTags(state) {
  const text = `${state?.partOfSpeech || ""} ${state?.term || ""}`.toLowerCase();
  const tags = new Set();

  if (/(^|[^a-z])n(?:\s+pl)?([^a-z]|$)/.test(text)) tags.add("n");
  if (/(^|[^a-z])v([^a-z]|$)|\bmv\b|\bav\b/.test(text)) tags.add("v");
  if (/\badj\b/.test(text)) tags.add("adj");
  if (/\badv\b/.test(text)) tags.add("adv");
  if (/\bprep\b/.test(text)) tags.add("prep");
  if (/\bpron\b/.test(text)) tags.add("pron");
  if (/\bdet\b/.test(text)) tags.add("det");
  if (/\bconj\b/.test(text)) tags.add("conj");

  return tags;
}

function countSharedSetItems(left, right) {
  let shared = 0;

  for (const item of left) {
    if (right.has(item)) {
      shared += 1;
    }
  }

  return shared;
}

function getTermValues(state) {
  return [
    state?.baseTerm,
    state?.normalizedTerm,
    state?.term,
    ...(Array.isArray(state?.acceptedSpellings) ? state.acceptedSpellings : []),
  ]
    .map(normalizeDistractorTerm)
    .filter(Boolean);
}

function getTermTokens(state) {
  const tokens = new Set();

  for (const value of getTermValues(state)) {
    for (const token of value.split(/[\s-]+/)) {
      const normalized = token.trim();

      if (normalized.length > 1 && !ENGLISH_DISTRACTOR_STOPWORDS.has(normalized)) {
        tokens.add(normalized);
      }
    }
  }

  return tokens;
}

function getCompactTerms(state) {
  return new Set(
    getTermValues(state)
      .map((value) => value.replace(/[^a-z0-9]/g, ""))
      .filter((value) => value.length > 2)
  );
}

function getMeaningTokens(state) {
  const tokens = new Set();
  const text = String(state?.chineseMeaning || "");

  for (const chunk of text.split(/[;；,，、/()\s]+/)) {
    const normalized = chunk.trim();

    if (normalized.length > 1) {
      tokens.add(normalized);
    }
  }

  for (const char of text.match(/[\u3400-\u9fff]/g) || []) {
    if (!CHINESE_DISTRACTOR_STOP_CHARS.has(char)) {
      tokens.add(char);
    }
  }

  for (const word of text.match(/[a-zA-Z0-9]+/g) || []) {
    if (word.length > 1) {
      tokens.add(word.toLowerCase());
    }
  }

  return tokens;
}

function getSemanticBuckets(state) {
  const buckets = new Set();
  const theme = state?.theme || GENERAL_THEME;
  const text = `${state?.chineseMeaning || ""} ${state?.term || ""} ${state?.baseTerm || ""}`.toLowerCase();

  if (theme && theme !== GENERAL_THEME) {
    buckets.add(`theme:${theme}`);
  }

  for (const tag of getPartOfSpeechTags(state)) {
    if (["det", "pron", "prep", "conj"].includes(tag)) {
      buckets.add(`grammar:${tag}`);
    }
  }

  for (const [bucket, pattern] of MEANING_BUCKET_RULES) {
    if (pattern.test(text)) {
      buckets.add(bucket);
    }
  }

  return buckets;
}

function getMeaningOverlapScore(left, right) {
  const leftTokens = getMeaningTokens(left);
  const rightTokens = getMeaningTokens(right);

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const shared = countSharedSetItems(leftTokens, rightTokens);

  if (!shared) {
    return 0;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return shared * 28 + (shared / unionSize) * 140;
}

function longestCommonPrefixLength(left, right) {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function getTermSimilarityScore(left, right) {
  const leftTokens = getTermTokens(left);
  const rightTokens = getTermTokens(right);
  const sharedTokens = countSharedSetItems(leftTokens, rightTokens);
  const leftCompacts = getCompactTerms(left);
  const rightCompacts = getCompactTerms(right);
  let score = sharedTokens * 90;

  for (const leftValue of leftCompacts) {
    for (const rightValue of rightCompacts) {
      if (leftValue === rightValue) {
        score += 220;
        continue;
      }

      if (leftValue.includes(rightValue) || rightValue.includes(leftValue)) {
        score += 150;
      }

      const prefixLength = longestCommonPrefixLength(leftValue, rightValue);

      if (prefixLength >= 5) {
        score += 70;
      } else if (prefixLength >= 4) {
        score += 40;
      }
    }
  }

  return Math.min(score, 320);
}

function getFrequencyClosenessScore(left, right) {
  const leftFrequency = Number(left?.frequencyScore ?? left?.frequencyZipf ?? 0);
  const rightFrequency = Number(right?.frequencyScore ?? right?.frequencyZipf ?? 0);

  return Math.max(0, 48 - Math.abs(leftFrequency - rightFrequency) * 16);
}

function getDistractorScore(candidate, state, candidateGroupTerms) {
  const inManualGroup = isInDistractorGroup(state, candidateGroupTerms);
  const sameSpecificTheme =
    candidate?.theme && candidate.theme !== GENERAL_THEME && candidate.theme === state.theme;
  const sameGeneralTheme = candidate?.theme === GENERAL_THEME && state.theme === GENERAL_THEME;
  const candidatePosTags = getPartOfSpeechTags(candidate);
  const statePosTags = getPartOfSpeechTags(state);
  const sharedPos = countSharedSetItems(candidatePosTags, statePosTags);
  const sharedBuckets = countSharedSetItems(getSemanticBuckets(candidate), getSemanticBuckets(state));
  const meaningScore = getMeaningOverlapScore(candidate, state);
  const termScore = getTermSimilarityScore(candidate, state);
  const frequencyScore = getFrequencyClosenessScore(candidate, state);
  let score =
    (inManualGroup ? 1200 : 0) +
    (sameSpecificTheme ? 340 : sameGeneralTheme ? 18 : 0) +
    sharedBuckets * 130 +
    sharedPos * 120 +
    meaningScore +
    termScore +
    frequencyScore;

  if (!sharedPos && !inManualGroup && !sameSpecificTheme && !sharedBuckets) {
    score -= 180;
  }

  if (candidate?.theme !== GENERAL_THEME && state.theme === GENERAL_THEME && !inManualGroup && !sharedBuckets) {
    score -= 80;
  }

  return score;
}

function displayMinutes(elapsedMs) {
  if (!elapsedMs) {
    return 0;
  }

  return Math.max(1, Math.round(elapsedMs / 60000));
}

module.exports = {
  EXAM_DATE,
  PREP_START_DATE,
  WRONG_PARK_DAYS,
  DISPLAY_LABELS,
  todayKey,
  parseDateKey,
  diffDays,
  addDays,
  clamp,
  stableHash,
  getDistractorGroupTerms,
  getDistractorScore,
  displayMinutes,
};
