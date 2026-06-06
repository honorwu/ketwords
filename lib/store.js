const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { normalizeCompact, normalizeLookup } = require("./wordlist");
const { ensureStudyConfig } = require("./study-config");
const {
  addColumnIfMissing,
  createLearningSchema,
  createWordSchema,
} = require("./store-schema");

const WORD_BANK_DB_PATH = path.join(__dirname, "..", "data", "wordbank.sqlite");
const LEARNING_DB_PATH = path.join(__dirname, "..", "data", "learning.sqlite");
const EXAM_DATE = "2026-08-22";
const PREP_START_DATE = "2026-04-22";
const TARGET_MINUTES = 15;
const DAILY_RECOGNIZE_TARGET = 50;
const DAILY_LISTEN_TARGET = 40;
const DAILY_SPELL_TARGET = 30;
const DAILY_MODE_SEQUENCE = ["recognize", "listen", "listen", "spell", "spell", "spell"];
const WRONG_PARK_DAYS = 3;
const SPELLING_WRONG_PARK_DAYS = 7;
const MASTERED_SPELL_REVIEW_INTERVALS = [7, 14, 30];
const DAILY_WRONG_RETRY_LIMITS = {
  recognize: 6,
  listen: 4,
  spell: 3,
};
const PRIORITY_SCORE = {
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};
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
  ["run", "running", "swim", "swimming", "cycle", "cycling", "ski", "skiing", "skate", "skating", "climb", "climbing", "dive", "surf", "surfing"],
  ["game", "board game", "chess", "puzzle", "toy", "doll", "kite", "hobby", "activity"],
  ["job", "work", "career", "business", "company", "office", "factory"],
  ["doctor", "dentist", "nurse", "mechanic", "farmer", "chef", "cook", "waiter", "waitress", "receptionist", "secretary", "assistant", "manager", "boss"],
  ["artist", "painter", "singer", "musician", "actor", "actress", "journalist", "photographer", "writer"],
  ["police", "police officer", "pilot", "driver", "tour guide", "guide", "shop assistant", "businessman", "businesswoman", "business person"],
  ["buy", "sell", "pay", "cost", "spend", "earn", "rent", "save"],
  ["money", "cash", "coin", "penny", "cent", "pound", "dollar", "euro", "price", "sale", "discount", "half price"],
  ["credit card", "cheque", "receipt", "ticket", "licence", "passport"],
  ["cheap", "expensive", "free", "half price", "low"],
  ["happy", "sad", "angry", "afraid", "scared", "frightened", "nervous", "worried", "upset", "bored", "pleased", "excited", "amazed", "surprised", "interested"],
  ["boring", "exciting", "amazing", "surprising", "interesting", "funny", "scary"],
  ["good", "great", "nice", "excellent", "perfect", "wonderful", "lovely", "pleasant", "brilliant"],
  ["bad", "worse", "terrible", "horrible", "poor", "awful"],
  ["beautiful", "pretty", "good-looking", "handsome", "lovely"],
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
  ["go", "come", "move", "walk", "run", "drive", "ride", "fly", "travel"],
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
  mastered: "\u5df2\u638c\u63e1",
  tomorrowListen: "\u660e\u5929\u542c\u8bcd",
  tomorrowSpell: "\u660e\u5929\u9ed8\u5199",
  tomorrowSpellRepeat: "\u660e\u5929\u518d\u9ed8\u5199",
  spelling: "\u62fc\u5199\u4e2d",
  canListen: "\u80fd\u542c\u61c2\u4e00\u4e9b",
  started: "\u5f00\u59cb\u8ba4\u8bc6\u4e86",
  notStarted: "\u672a\u5f00\u59cb",
  nextSpell: "\u4e0b\u4e00\u6b65\u9ed8\u5199",
  nextListen: "\u4e0b\u4e00\u6b65\u542c\u8fa8",
  nextRecognize: "\u4e0b\u4e00\u6b65\u8ba4\u8bcd",
  longReview: "\u5df2\u5b8c\u5168\u5b66\u4f1a",
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

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
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

function getPriorityClosenessScore(left, right) {
  const leftPriority = PRIORITY_SCORE[left?.priority] || 1;
  const rightPriority = PRIORITY_SCORE[right?.priority] || 1;

  return Math.max(0, 48 - Math.abs(leftPriority - rightPriority) * 16);
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
  const priorityScore = getPriorityClosenessScore(candidate, state);
  let score =
    (inManualGroup ? 1200 : 0) +
    (sameSpecificTheme ? 340 : sameGeneralTheme ? 18 : 0) +
    sharedBuckets * 130 +
    sharedPos * 120 +
    meaningScore +
    termScore +
    priorityScore;

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

function createStore() {
  fs.mkdirSync(path.dirname(LEARNING_DB_PATH), { recursive: true });

  if (!fs.existsSync(WORD_BANK_DB_PATH)) {
    throw new Error(
      `Missing word bank database. Expected ${WORD_BANK_DB_PATH}; commit and deploy the latest wordbank.sqlite.`
    );
  }

  const activeDbPath = LEARNING_DB_PATH;
  const db = new DatabaseSync(activeDbPath);
  const wordsTable = "wordbank.words";
  const progressJoin = "p.word_key = w.normalized_term OR (p.word_key IS NULL AND p.word_id = w.id)";

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`ATTACH DATABASE '${WORD_BANK_DB_PATH.replaceAll("'", "''")}' AS wordbank;`);
  createWordSchema(db, wordsTable);
  createLearningSchema(db, false);
  addColumnIfMissing(db, "progress", "word_key TEXT");
  addColumnIfMissing(db, "study_logs", "word_key TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_progress_word_key
      ON progress(word_key);

    CREATE INDEX IF NOT EXISTS idx_logs_word_key
      ON study_logs(word_key);
  `);

  db.exec(`
    UPDATE study_logs
    SET result = 'wrong'
    WHERE result = 'almost';

    UPDATE progress
    SET times_wrong = times_wrong + times_almost,
        times_almost = 0,
        last_result = CASE WHEN last_result = 'almost' THEN 'wrong' ELSE last_result END
    WHERE times_almost > 0 OR last_result = 'almost';

    UPDATE ${wordsTable}
    SET part_of_speech = CASE WHEN part_of_speech = 'custom' THEN 'unknown' ELSE part_of_speech END,
        theme = CASE WHEN theme = '家长补充' THEN 'general' ELSE theme END;
    UPDATE progress
    SET listening_stage = 1
    WHERE spelling_stage > 0
      AND listening_stage < 1;

    UPDATE progress
    SET next_review_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at, '+7 days')
    WHERE word_key IN (
      SELECT normalized_term
      FROM ${wordsTable}
      WHERE priority IN ('S', 'A')
        AND instr(base_term, ' ') = 0
    )
      AND recognition_stage >= 1
      AND listening_stage >= 1
      AND spelling_stage >= 2
      AND last_seen_at IS NOT NULL
      AND (
        next_review_at IS NULL
        OR julianday(next_review_at) < julianday(last_seen_at) + 7
      );
  `);

  const insertWord = db.prepare(`
    INSERT INTO ${wordsTable} (
      term,
      base_term,
      normalized_term,
      part_of_speech,
      theme,
      priority,
      examples_json,
      accepted_spellings_json,
      chinese_meaning,
      phonetic,
      audio_url,
      source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_term) DO UPDATE SET
      term = excluded.term,
      base_term = excluded.base_term,
      part_of_speech = excluded.part_of_speech,
      theme = excluded.theme,
      priority = excluded.priority,
      examples_json = excluded.examples_json,
      accepted_spellings_json = excluded.accepted_spellings_json,
      source_order = excluded.source_order
  `);

  const updateWordMetadata = db.prepare(`
    UPDATE ${wordsTable}
    SET chinese_meaning = ?,
        phonetic = ?,
        audio_url = ?
    WHERE id = ?
  `);

  const selectWordKeyById = db.prepare(`
    SELECT normalized_term
    FROM ${wordsTable}
    WHERE id = ?
  `);

  const selectJoinedState = db.prepare(`
    SELECT
      w.id,
      w.term,
      w.base_term,
      w.normalized_term,
      w.part_of_speech,
      w.theme,
      w.priority,
      w.examples_json,
      w.accepted_spellings_json,
      w.chinese_meaning,
      w.phonetic,
      w.audio_url,
      w.source_order,
      p.first_seen_at,
      p.introduced_date,
      p.last_seen_at,
      p.next_review_at,
      p.recognition_stage,
      p.listening_stage,
      p.spelling_stage,
      p.times_seen,
      p.times_correct,
      p.times_wrong,
      p.lapse_count,
      p.correct_streak,
      p.last_mode,
      p.last_result
    FROM ${wordsTable} w
    LEFT JOIN progress p
      ON ${progressJoin}
    WHERE w.id = ?
  `);

  function isSpellingPriority(priority, config = ensureStudyConfig()) {
    return (config.spellPriorityLevels || ["S", "A"]).includes(priority);
  }

  function isSingleWordSpellingTarget(row) {
    const baseTerm = String(row.base_term || row.baseTerm || row.term || "").trim();
    return Boolean(baseTerm) && !/\s/.test(baseTerm);
  }

  function getLearningTarget(row, config = ensureStudyConfig()) {
    return isSpellingPriority(row.priority, config) && isSingleWordSpellingTarget(row)
      ? "spell"
      : "listen";
  }

  function hydrateRow(row, config = ensureStudyConfig()) {
    if (!row) {
      return null;
    }

    const learningTarget = getLearningTarget(row, config);

    return {
      wordId: row.id,
      term: row.term,
      baseTerm: row.base_term,
      normalizedTerm: row.normalized_term,
      partOfSpeech: row.part_of_speech,
      theme: row.theme,
      priority: row.priority,
      learningTarget,
      spellingRequired: learningTarget === "spell" ? 1 : 0,
      examples: JSON.parse(row.examples_json || "[]"),
      acceptedSpellings: JSON.parse(row.accepted_spellings_json || "[]"),
      chineseMeaning: row.chinese_meaning,
      phonetic: row.phonetic,
      audioUrl: row.audio_url,
      sourceOrder: row.source_order,
      firstSeenAt: row.first_seen_at,
      introducedDate: row.introduced_date,
      lastSeenAt: row.last_seen_at,
      nextReviewAt: row.next_review_at,
      recognitionStage: row.recognition_stage || 0,
      listeningStage: row.listening_stage || 0,
      spellingStage: row.spelling_stage || 0,
      timesSeen: row.times_seen || 0,
      timesCorrect: row.times_correct || 0,
      timesWrong: row.times_wrong || 0,
      lapseCount: row.lapse_count || 0,
      correctStreak: row.correct_streak || 0,
      lastMode: row.last_mode,
      lastResult: row.last_result,
    };
  }

  function getAllStates(config = ensureStudyConfig()) {
    const rows = db
      .prepare(`
        SELECT
          w.id,
          w.term,
          w.base_term,
          w.normalized_term,
          w.part_of_speech,
          w.theme,
          w.priority,
          w.examples_json,
          w.accepted_spellings_json,
          w.chinese_meaning,
          w.phonetic,
          w.audio_url,
          w.source_order,
          p.first_seen_at,
          p.introduced_date,
          p.last_seen_at,
          p.next_review_at,
          p.recognition_stage,
          p.listening_stage,
          p.spelling_stage,
          p.times_seen,
          p.times_correct,
          p.times_wrong,
          p.lapse_count,
          p.correct_streak,
          p.last_mode,
          p.last_result
        FROM ${wordsTable} w
        LEFT JOIN progress p
          ON ${progressJoin}
        ORDER BY
          CASE w.priority
            WHEN 'S' THEN 4
            WHEN 'A' THEN 3
            WHEN 'B' THEN 2
            ELSE 1
          END DESC,
          w.source_order ASC
      `)
      .all();

    return rows.map((row) => hydrateRow(row, config));
  }

  function getWordState(wordId, config = ensureStudyConfig()) {
    return hydrateRow(selectJoinedState.get(wordId), config);
  }

  function isMastered(state) {
    const targets = getStageTargets(state);
    return (
      state.recognitionStage >= targets.recognition &&
      state.listeningStage >= targets.listening &&
      state.spellingStage >= targets.spelling
    );
  }

  function getStageTargets(state) {
    if (state.learningTarget === "spell") {
      return {
        recognition: 1,
        listening: 1,
        spelling: 2,
      };
    }

    if (state.learningTarget === "listen") {
      return {
        recognition: 1,
        listening: 1,
        spelling: 0,
      };
    }

    return {
      recognition: 1,
      listening: 1,
      spelling: 0,
    };
  }

  function getMasteryPercent(state) {
    const targets = getStageTargets(state);
    const total =
      targets.recognition + targets.listening + targets.spelling;

    if (!total) {
      return 0;
    }

    const current =
      Math.min(state.recognitionStage, targets.recognition) +
      Math.min(state.listeningStage, targets.listening) +
      Math.min(state.spellingStage, targets.spelling);

    return Math.round((current / total) * 100);
  }

  function getStageSummary(state) {
    const targets = getStageTargets(state);

    return [
      targets.recognition
        ? `${DISPLAY_LABELS.stageRecognize} ${Math.min(state.recognitionStage, targets.recognition)}/${targets.recognition}`
        : `${DISPLAY_LABELS.stageRecognize} -`,
      targets.listening
        ? `${DISPLAY_LABELS.stageListen} ${Math.min(state.listeningStage, targets.listening)}/${targets.listening}`
        : `${DISPLAY_LABELS.stageListen} -`,
      targets.spelling
        ? `${DISPLAY_LABELS.stageSpell} ${Math.min(state.spellingStage, targets.spelling)}/${targets.spelling}`
        : `${DISPLAY_LABELS.stageSpell} -`,
    ].join(" ");
  }

  function masteryLabel(state) {
    if (isMastered(state)) {
      return DISPLAY_LABELS.mastered;
    }

    const deferredMode = getDeferredMode(state);

    if (deferredMode === "listen") {
      return DISPLAY_LABELS.tomorrowListen;
    }

    if (deferredMode === "spell" && state.spellingStage === 0) {
      return DISPLAY_LABELS.tomorrowSpell;
    }

    if (deferredMode === "spell" && state.spellingStage >= 1) {
      return DISPLAY_LABELS.tomorrowSpellRepeat;
    }

    if (state.learningTarget === "spell" && state.spellingStage >= 1) {
      return DISPLAY_LABELS.spelling;
    }

    if (state.listeningStage >= 1) {
      return DISPLAY_LABELS.canListen;
    }

    if (state.recognitionStage >= 1) {
      return DISPLAY_LABELS.started;
    }

    return DISPLAY_LABELS.notStarted;
  }

  function syncWords(words) {
    db.exec("BEGIN");

    try {
      for (const word of words) {
        insertWord.run(
          word.term,
          word.baseTerm,
          word.normalizedTerm,
          word.partOfSpeech,
          word.theme,
          word.priority,
          JSON.stringify(word.examples || []),
          JSON.stringify(word.acceptedSpellings || [word.term]),
          null,
          null,
          null,
          word.sourceOrder
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getWordCount() {
    return Number(
      db.prepare(`SELECT COUNT(*) AS count FROM ${wordsTable}`).get().count || 0
    );
  }

  function ensureProgressRow(wordId) {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = todayKey(now);
    const wordKey = selectWordKeyById.get(wordId)?.normalized_term || null;

    db.prepare(`
      INSERT OR IGNORE INTO progress (
        word_id,
        word_key,
        first_seen_at,
        introduced_date,
        last_seen_at,
        next_review_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(wordId, wordKey, nowIso, today, nowIso, nowIso);

    return getWordState(wordId);
  }

  function getRecentLogs(days = 7) {
    const start = addDays(parseDateKey(todayKey()), -(days - 1));
    const startKey = todayKey(start);

    return db
      .prepare(
        `
          SELECT word_id, mode, result, elapsed_ms, studied_on, created_at
          FROM study_logs
          WHERE studied_on >= ?
          ORDER BY studied_on ASC, created_at ASC
        `
      )
      .all(startKey);
  }

  function getTodayStats() {
    const today = todayKey();
    const aggregate = db
      .prepare(
        `
          SELECT
            COUNT(*) AS cards,
            COUNT(DISTINCT word_id) AS words,
            COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms,
            COALESCE(SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END), 0) AS correct_cards,
            COALESCE(SUM(CASE WHEN mode = 'recognize' THEN 1 ELSE 0 END), 0) AS recognize_cards,
            COALESCE(SUM(CASE WHEN mode = 'listen' THEN 1 ELSE 0 END), 0) AS listen_cards,
            COALESCE(SUM(CASE WHEN mode = 'spell' THEN 1 ELSE 0 END), 0) AS spell_cards
          FROM study_logs
          WHERE studied_on = ?
        `
      )
      .get(today);

    const introduced = db
      .prepare(`SELECT COUNT(*) AS count FROM progress WHERE introduced_date = ?`)
      .get(today);

    return {
      cards: aggregate.cards || 0,
      words: aggregate.words || 0,
      elapsedMs: aggregate.elapsed_ms || 0,
      newWords: introduced.count || 0,
      recognizeCards: aggregate.recognize_cards || 0,
      listenCards: aggregate.listen_cards || 0,
      spellCards: aggregate.spell_cards || 0,
      correctRate:
        aggregate.cards > 0
          ? Math.round(((aggregate.correct_cards || 0) / aggregate.cards) * 100)
          : 0,
    };
  }

  function getTodayWrongWords() {
    const today = todayKey();

    return db
      .prepare(
        `
          SELECT
            w.id AS word_id,
            w.term,
            w.base_term,
            w.chinese_meaning,
            w.phonetic,
            w.audio_url,
            w.priority,
            w.source_order,
            COUNT(*) AS wrong_count,
            MAX(l.created_at) AS last_wrong_at
          FROM study_logs l
          LEFT JOIN ${wordsTable} logged_word
            ON l.word_id = logged_word.id
          INNER JOIN ${wordsTable} w
            ON w.normalized_term = COALESCE(l.word_key, logged_word.normalized_term)
          WHERE l.studied_on = ?
            AND l.result = 'wrong'
          GROUP BY w.normalized_term
          ORDER BY wrong_count DESC, last_wrong_at DESC, w.source_order ASC
        `
      )
      .all(today)
      .map((row) => ({
        wordId: row.word_id,
        term: row.term,
        baseTerm: row.base_term,
        meaning: row.chinese_meaning || "",
        phonetic: row.phonetic || "",
        audioUrl: row.audio_url || "",
        priority: row.priority,
        wrongCount: row.wrong_count || 0,
      }));
  }

  function getTodayStudiedWordKeysByMode() {
    const today = todayKey();
    const rows = db
      .prepare(
        `
          SELECT
            l.mode,
            COALESCE(l.word_key, w.normalized_term) AS word_key
          FROM study_logs l
          LEFT JOIN ${wordsTable} w
            ON l.word_id = w.id
          WHERE l.studied_on = ?
        `
      )
      .all(today);
    const sets = {
      recognize: new Set(),
      listen: new Set(),
      spell: new Set(),
    };

    for (const row of rows) {
      if (sets[row.mode] && row.word_key) {
        sets[row.mode].add(row.word_key);
      }
    }

    return sets;
  }

  function getDailyActivity(days = 120, monthOffset = 0) {
    const today = new Date();
    const targetMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const currentMonthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const streakStart = addDays(today, -(days - 1));
    const queryStart = streakStart < currentMonthStart ? streakStart : currentMonthStart;
    const startKey = todayKey(queryStart);
    const rows = db
      .prepare(
        `
          SELECT
            studied_on,
            COUNT(*) AS cards,
            COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms
          FROM study_logs
          WHERE studied_on >= ?
          GROUP BY studied_on
          ORDER BY studied_on ASC
        `
      )
      .all(startKey);

    const map = new Map(rows.map((row) => [row.studied_on, row]));
    const daysList = [];

    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = addDays(today, -offset);
      const key = todayKey(date);
      const row = map.get(key);
      daysList.push({
        date: key,
        label: key.slice(5),
        cards: row?.cards || 0,
        minutes: displayMinutes(row?.elapsed_ms || 0),
        studied: Boolean(row?.cards),
        isToday: key === todayKey(),
      });
    }

    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
    const monthDays = [];
    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
      const key = todayKey(date);
      const row = map.get(key);
      monthDays.push({
        date: key,
        day,
        cards: row?.cards || 0,
        minutes: displayMinutes(row?.elapsed_ms || 0),
        studied: Boolean(row?.cards),
        isToday: key === todayKey(),
      });
    }

    let currentStreak = 0;
    let streakIndex = daysList.length - 1;

    if (daysList[streakIndex] && !daysList[streakIndex].studied) {
      streakIndex -= 1;
    }

    for (let index = streakIndex; index >= 0; index -= 1) {
      if (!daysList[index].studied) {
        break;
      }
      currentStreak += 1;
    }

    let bestStreak = 0;
    let running = 0;
    for (const item of daysList) {
      if (item.studied) {
        running += 1;
        bestStreak = Math.max(bestStreak, running);
      } else {
        running = 0;
      }
    }

    return {
      currentStreak,
      bestStreak,
      monthLabel: `${targetMonth.getFullYear()}年${targetMonth.getMonth() + 1}月`,
      monthOffset,
      firstWeekday: (currentMonthStart.getDay() + 6) % 7,
      monthDays,
    };
  }

  function computeStudyPlan(states) {
    const todayStats = getTodayStats();
    const dueReviewCount = states.filter((state) => {
      if (!state.firstSeenAt || isMastered(state)) {
        return false;
      }

      return !state.nextReviewAt || new Date(state.nextReviewAt) <= new Date();
    }).length;
    const remainingRecognize = Math.max(DAILY_RECOGNIZE_TARGET - todayStats.recognizeCards, 0);
    const remainingListen = Math.max(DAILY_LISTEN_TARGET - todayStats.listenCards, 0);
    const remainingSpell = Math.max(DAILY_SPELL_TARGET - todayStats.spellCards, 0);

    return {
      targetMinutes: TARGET_MINUTES,
      dailyTargets: {
        recognize: DAILY_RECOGNIZE_TARGET,
        listen: DAILY_LISTEN_TARGET,
        spell: DAILY_SPELL_TARGET,
      },
      dailyRemaining: {
        recognize: remainingRecognize,
        listen: remainingListen,
        spell: remainingSpell,
      },
      reachedTimeLimit:
        remainingRecognize === 0 && remainingListen === 0 && remainingSpell === 0,
      dueReviewCount,
      suggestedNewWords: DAILY_RECOGNIZE_TARGET,
      remainingNewWords: remainingRecognize,
      usedMinutes: displayMinutes(todayStats.elapsedMs),
      todayStats,
      statusText:
        remainingRecognize > 0
          ? `\u4eca\u5929\u5148\u5b8c\u6210 ${DAILY_RECOGNIZE_TARGET} \u4e2a\u8ba4\u8bcd\uff0c\u8fd8\u5dee ${remainingRecognize} \u4e2a\u3002`
          : remainingListen > 0
            ? `\u8ba4\u8bcd\u5df2\u5b8c\u6210\uff0c\u63a5\u7740\u5b8c\u6210 ${DAILY_LISTEN_TARGET} \u4e2a\u542c\u8bcd\uff0c\u8fd8\u5dee ${remainingListen} \u4e2a\u3002`
            : remainingSpell > 0
              ? `\u542c\u8bcd\u5df2\u5b8c\u6210\uff0c\u63a5\u7740\u5b8c\u6210 ${DAILY_SPELL_TARGET} \u4e2a\u62fc\u5199\uff0c\u8fd8\u5dee ${remainingSpell} \u4e2a\u3002`
              : "\u4eca\u5929\u7684\u4e09\u6bb5\u76ee\u6807\u5df2\u5b8c\u6210\uff0c\u63a5\u4e0b\u6765\u6309 1 \u4e2a\u8ba4\u8bcd\u30012 \u4e2a\u542c\u8bcd\u30013 \u4e2a\u62fc\u5199\u7684\u8282\u594f\u52a0\u7ec3\u3002",
      adaptiveNote:
        "\u5f53\u5929\u542c\u8bcd\u4e0d\u4f1a\u4f7f\u7528\u5f53\u5929\u521a\u8ba4\u8fc7\u7684\u8bcd\uff1b\u5f53\u5929\u62fc\u5199\u4e0d\u4f1a\u4f7f\u7528\u5f53\u5929\u521a\u8ba4\u8fc7\u6216\u521a\u542c\u8fc7\u7684\u8bcd\u3002",
    };
  }

  function getCumulativeStats(states) {
    const totalElapsedMs =
      db
        .prepare(`
          SELECT COALESCE(SUM(elapsed_ms), 0) AS value
          FROM study_logs
        `)
        .get().value || 0;

    const summary = states.reduce(
      (summary, state) => {
        if (state.firstSeenAt) {
          summary.studiedWords += 1;
        }

        if (isMastered(state)) {
          summary.masteredWords += 1;
        }

        summary.totalAttempts += state.timesSeen || 0;
        summary.totalWrong += state.timesWrong || 0;
        return summary;
      },
      {
        studiedWords: 0,
        masteredWords: 0,
        totalAttempts: 0,
        totalWrong: 0,
      }
    );

    return {
      ...summary,
      totalElapsedMs,
      totalMinutes: displayMinutes(totalElapsedMs),
    };
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

  function buildTrend(states) {
    const recentLogs = getRecentLogs(7);
    const map = new Map();

    for (let offset = 6; offset >= 0; offset -= 1) {
      const key = todayKey(addDays(new Date(), -offset));
      map.set(key, { date: key, elapsedMs: 0, cards: 0 });
    }

    for (const log of recentLogs) {
      const item = map.get(log.studied_on);

      if (!item) {
        continue;
      }

      item.cards += 1;
      item.elapsedMs += log.elapsed_ms || 0;
    }

    return Array.from(map.values()).map((item) => ({
      date: item.date,
      cards: item.cards,
      minutes: displayMinutes(item.elapsedMs),
    }));
  }

  function buildOverview() {
    const studyConfig = ensureStudyConfig();
    const states = getAllStates(studyConfig);
    const plan = computeStudyPlan(states);
    const todayStats = plan.todayStats;
    const cumulative = getCumulativeStats(states);
    const checkin = getDailyActivity(120);
    const daysRemaining = Math.max(diffDays(EXAM_DATE, todayKey()), 0);
    const prepTotalDays = Math.max(diffDays(EXAM_DATE, PREP_START_DATE), 1);
    const prepElapsedDays = clamp(diffDays(todayKey(), PREP_START_DATE), 0, prepTotalDays);
    const timeProgressPercent = Math.round((prepElapsedDays / prepTotalDays) * 100);
    const totalWords = states.length;
    const coreGoalCount = totalWords;
    const coreMastered = states.filter(isMastered).length;
    const stageProgress = states.reduce(
      (summary, state) => {
        const targets = getStageTargets(state);

        if (targets.recognition > 0) {
          summary.recognition.goal += 1;
          summary.recognition.mastered += state.recognitionStage >= targets.recognition ? 1 : 0;
          summary.overall.goal += targets.recognition;
          summary.overall.completed += Math.min(state.recognitionStage, targets.recognition);
        }

        if (targets.listening > 0) {
          summary.listening.goal += 1;
          summary.listening.mastered += state.listeningStage >= targets.listening ? 1 : 0;
          summary.overall.goal += targets.listening;
          summary.overall.completed += Math.min(state.listeningStage, targets.listening);
        }

        if (targets.spelling > 0) {
          summary.spelling.goal += 1;
          summary.spelling.mastered += state.spellingStage >= targets.spelling ? 1 : 0;
          summary.overall.goal += targets.spelling;
          summary.overall.completed += Math.min(state.spellingStage, targets.spelling);
        }

        return summary;
      },
      {
        recognition: { goal: 0, mastered: 0 },
        listening: { goal: 0, mastered: 0 },
        spelling: { goal: 0, mastered: 0 },
        overall: { goal: 0, completed: 0 },
      }
    );
    const spellGoalCount = stageProgress.spelling.goal;
    const spellMastered = stageProgress.spelling.mastered;
    const listenGoalCount = stageProgress.listening.goal;
    const listenMastered = stageProgress.listening.mastered;
    const recognizeGoalCount = stageProgress.recognition.goal;
    const recognizeMastered = stageProgress.recognition.mastered;
    const overallMastered = states.filter(isMastered).length;
    const totalStageUnits = stageProgress.overall.goal;
    const completedStageUnits = stageProgress.overall.completed;
    const learningProgressPercent =
      totalStageUnits > 0
        ? Math.round((completedStageUnits / totalStageUnits) * 100)
        : 0;
    const hardWords = states
      .filter((state) => state.timesWrong > 0)
      .sort((left, right) => {
        return right.timesWrong - left.timesWrong || right.sourceOrder - left.sourceOrder;
      })
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        wrongCount: state.timesWrong,
        mastery: masteryLabel(state),
        priority: state.priority,
      }));

    const firstTouch = states
      .map((state) => state.firstSeenAt)
      .filter(Boolean)
      .sort()[0];

    const elapsedDays = firstTouch
      ? diffDays(todayKey(), todayKey(new Date(firstTouch))) + 1
      : 0;
    const pacePerDay = elapsedDays > 0 ? completedStageUnits / elapsedDays : 0;
    const projectedStageUnitsByExam = Math.min(
      totalStageUnits,
      Math.round(completedStageUnits + pacePerDay * daysRemaining)
    );
    const projectedPercent =
      totalStageUnits > 0
        ? Math.round((projectedStageUnitsByExam / totalStageUnits) * 100)
        : 0;
    const projectedCompletionDate =
      pacePerDay > 0 && completedStageUnits < totalStageUnits
        ? todayKey(addDays(new Date(), Math.ceil((totalStageUnits - completedStageUnits) / pacePerDay)))
        : completedStageUnits >= totalStageUnits
          ? todayKey()
          : null;

    return {
      exam: {
        date: EXAM_DATE,
        daysRemaining,
      },
      plan,
      checkin,
      config: studyConfig,
      progress: {
        totalWords,
        overallMastered,
        coreGoalCount,
        coreMastered,
        coreGap: Math.max(coreGoalCount - coreMastered, 0),
        totalStageUnits,
        completedStageUnits,
        stageUnitGap: Math.max(totalStageUnits - completedStageUnits, 0),
        spellGoalCount,
        spellMastered,
        listenGoalCount,
        listenMastered,
        recognizeGoalCount,
        recognizeMastered,
        stageProgress,
        projectedPercent,
        projectedCompletionDate,
        onTrack: projectedStageUnitsByExam >= totalStageUnits,
        timeProgressPercent,
        learningProgressPercent,
      },
      cumulative,
      today: {
        minutes: displayMinutes(todayStats.elapsedMs),
        cards: todayStats.cards,
        words: todayStats.words,
        newWords: todayStats.newWords,
        recognizeCards: todayStats.recognizeCards,
        listenCards: todayStats.listenCards,
        spellCards: todayStats.spellCards,
        correctRate: todayStats.correctRate,
      },
      trend: buildTrend(states),
      hardWords,
      todayWrongWords: getTodayWrongWords(),
      childMessage:
        overallMastered === 0
          ? "今天先从认识高优先级单词开始，不需要一下子拼很多。"
          : `今天已经掌握 ${overallMastered} 个词，继续把高优先级词稳住。`,
    };
  }

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

  function isMasteredSpellReviewDue(state, mode, now) {
    if (mode !== "spell" || state.learningTarget !== "spell" || !isMastered(state)) {
      return false;
    }

    if (!state.nextReviewAt) {
      return false;
    }

    const reviewAt = new Date(state.nextReviewAt);
    return !Number.isNaN(reviewAt.getTime()) && reviewAt <= now;
  }

  function getDailyCandidateRank(state, mode) {
    return stableHash(`${todayKey()}|${mode}|${state.normalizedTerm || state.wordId}`);
  }

  function sortStudyCandidates(left, right, mode) {
    const leftScore = PRIORITY_SCORE[left.priority] || 1;
    const rightScore = PRIORITY_SCORE[right.priority] || 1;
    const leftRank = getDailyCandidateRank(left, mode);
    const rightRank = getDailyCandidateRank(right, mode);
    const leftDue = left.nextReviewAt ? new Date(left.nextReviewAt).getTime() : 0;
    const rightDue = right.nextReviewAt ? new Date(right.nextReviewAt).getTime() : 0;
    const leftSeen = left.firstSeenAt ? 1 : 0;
    const rightSeen = right.firstSeenAt ? 1 : 0;

    return (
      leftSeen - rightSeen ||
      rightScore - leftScore ||
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

    const parkDays = mode === "spell" ? SPELLING_WRONG_PARK_DAYS : WRONG_PARK_DAYS;
    return addDays(lastSeenAt, parkDays) > now;
  }

  function isWrongRetryCandidate(state, mode) {
    return state.lastResult === "wrong" && state.lastMode === mode;
  }

  function isDueOrNewForMode(state, mode, now) {
    if (isMastered(state)) {
      return isMasteredSpellReviewDue(state, mode, now);
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

  function submissionBlocked(message, statusCode = 409) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  function assertAnswerModeAllowed(state, mode) {
    const targets = getStageTargets(state);

    if (mode === "listen" && state.recognitionStage < targets.recognition) {
      throw submissionBlocked("这个词需要先认对，之后才能进入听词。");
    }

    if (mode === "spell") {
      if (targets.spelling <= 0) {
        throw submissionBlocked("这个词当前不在默写训练范围内。");
      }

      if (
        state.recognitionStage < targets.recognition ||
        (state.listeningStage < targets.listening && state.spellingStage < 1)
      ) {
        throw submissionBlocked("这个词需要先认对并听对，之后才能进入默写。");
      }
    }

    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    if (!isAvailableForModeToday(state, mode, todayModeWordKeys)) {
      throw submissionBlocked("这个词今天已经在前一个环节练过了，请换一个词。");
    }
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

  function getModeOrderForToday(plan) {
    if (plan.todayStats.recognizeCards < DAILY_RECOGNIZE_TARGET) {
      return ["recognize", "listen", "spell"];
    }

    if (plan.todayStats.listenCards < DAILY_LISTEN_TARGET) {
      return ["listen", "recognize", "spell"];
    }

    if (plan.todayStats.spellCards < DAILY_SPELL_TARGET) {
      return ["spell", "recognize", "listen"];
    }

    const completedAfterTargets =
      plan.todayStats.cards -
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

  function getNextCandidate() {
    const states = getAllStates();
    const plan = computeStudyPlan(states);
    const now = new Date();
    const todayModeWordKeys = getTodayStudiedWordKeysByMode();

    for (const mode of getModeOrderForToday(plan)) {
      const candidates = getEligibleModeCandidates(states, mode, now, todayModeWordKeys);

      if (candidates.length > 0) {
        return {
          status: "ready",
          plan,
          candidate: candidates[0],
          mode,
        };
      }
    }

    return {
      status: "done",
      plan,
      candidate: null,
      mode: null,
      message:
        "\u4eca\u5929\u6682\u65f6\u6ca1\u6709\u7b26\u5408\u89c4\u5219\u7684\u5019\u9009\u8bcd\u4e86\uff0c\u53ef\u4ee5\u660e\u5929\u518d\u7ee7\u7eed\u3002",
    };
  }

  function getDistractorPool(wordId, limit = 16) {
    const candidate = getWordState(wordId);

    if (!candidate) {
      return [];
    }

    const candidateGroupTerms = getDistractorGroupTerms(candidate);

    return getAllStates()
      .filter((state) => state.wordId !== wordId)
      .map((state) => ({
        state,
        score: getDistractorScore(candidate, state, candidateGroupTerms),
        rank: stableHash(`${candidate.normalizedTerm || candidate.wordId}|${state.normalizedTerm || state.wordId}`),
      }))
      .sort((left, right) => {
        return (
          right.score - left.score ||
          left.rank - right.rank ||
          left.state.sourceOrder - right.state.sourceOrder
        );
      })
      .map((item) => item.state)
      .slice(0, limit);
  }

  function getModeLabel(mode) {
    if (mode === "tomorrow-listen") {
      return DISPLAY_LABELS.tomorrowListen;
    }

    if (mode === "tomorrow-spell") {
      return DISPLAY_LABELS.tomorrowSpell;
    }

    if (mode === "tomorrow-spell-repeat") {
      return DISPLAY_LABELS.tomorrowSpellRepeat;
    }

    if (mode === "spell") {
      return DISPLAY_LABELS.nextSpell;
    }

    if (mode === "listen") {
      return DISPLAY_LABELS.nextListen;
    }

    return DISPLAY_LABELS.nextRecognize;
  }

  function getWordProgress() {
    return getAllStates()
      .sort((left, right) => {
        const leftMastered = isMastered(left) ? 1 : 0;
        const rightMastered = isMastered(right) ? 1 : 0;
        const leftStarted = left.firstSeenAt ? 1 : 0;
        const rightStarted = right.firstSeenAt ? 1 : 0;
        const leftPriority = PRIORITY_SCORE[left.priority] || 1;
        const rightPriority = PRIORITY_SCORE[right.priority] || 1;

        return (
          rightStarted - leftStarted ||
          leftMastered - rightMastered ||
          rightPriority - leftPriority ||
          right.timesWrong - left.timesWrong ||
          left.sourceOrder - right.sourceOrder
        );
      })
      .map((state) => ({
        wordId: state.wordId,
        term: state.term,
        meaning: state.chineseMeaning || "",
        priority: state.priority,
        theme: state.theme,
        learningTarget: state.learningTarget,
        mastery: masteryLabel(state),
        masteryPercent: getMasteryPercent(state),
        stageSummary: getStageSummary(state),
        started: Boolean(state.firstSeenAt),
        mastered: isMastered(state),
        timesSeen: state.timesSeen,
        timesWrong: state.timesWrong,
        nextAction: isMastered(state)
          ? DISPLAY_LABELS.longReview
          : getModeLabel(
              getDeferredMode(state)
                ? getDeferredMode(state) === "listen"
                  ? "tomorrow-listen"
                  : state.spellingStage >= 1
                    ? "tomorrow-spell-repeat"
                    : "tomorrow-spell"
                : getModeForState(state)
            ),
        nextReviewAt: state.nextReviewAt,
      }));
  }

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

  function submitAnswer(payload) {
    const now = new Date();
    const nowIso = now.toISOString();
    const studiedOn = todayKey(now);
    const currentState = getWordState(payload.wordId);

    if (!currentState) {
      throw submissionBlocked("没有找到这个词。", 404);
    }

    assertAnswerModeAllowed(currentState, payload.mode);
    const state = ensureProgressRow(payload.wordId);

    let evaluation;

    if (payload.mode === "spell") {
      if (payload.gaveUp) {
        evaluation = {
          result: "wrong",
          acceptedText: state.term,
          note: `已标记为不会，正确写法是 ${state.term}。`,
        };
      } else {
        evaluation = evaluateSpelling(state, payload.response || "");
      }
    } else {
      const gaveUp = Boolean(payload.gaveUp);
      const isCorrect = !gaveUp && Number(payload.choiceWordId) === Number(payload.wordId);
      const correctAnswer = state.chineseMeaning || state.term;
      const note = isCorrect
        ? "回答正确。"
        : gaveUp
          ? `已标记为不会，正确答案是 ${correctAnswer}。`
          : `正确答案是 ${correctAnswer}。`;

      evaluation = {
        result: isCorrect ? "correct" : "wrong",
        acceptedText: state.term,
        note,
      };
    }

    const updatedStages = applyResultToStages(state, payload.mode, evaluation.result);
    const masteredAfter = isMasteredWithStages(state, updatedStages);

    let nextReviewAt = now;
    const targets = getStageTargets(state);
    const needsListening = updatedStages.listeningStage < targets.listening;
    const needsSpelling = updatedStages.spellingStage < targets.spelling;

    if (payload.mode === "spell" && evaluation.result !== "correct") {
      nextReviewAt = addDays(now, SPELLING_WRONG_PARK_DAYS);
    } else if (evaluation.result === "wrong") {
      nextReviewAt = addDays(now, WRONG_PARK_DAYS);
    } else if (
      payload.mode === "recognize" &&
      (needsListening || needsSpelling)
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (
      payload.mode === "listen" &&
      needsSpelling
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (
      payload.mode === "spell" &&
      evaluation.result === "correct" &&
      needsSpelling
    ) {
      nextReviewAt = addDays(now, 1);
    } else if (!masteredAfter) {
      nextReviewAt = addMinutes(now, 3);
    } else if (state.learningTarget === "spell") {
      const reviewIndex = clamp(
        updatedStages.spellingStage - targets.spelling,
        0,
        MASTERED_SPELL_REVIEW_INTERVALS.length - 1
      );
      nextReviewAt = addDays(now, MASTERED_SPELL_REVIEW_INTERVALS[reviewIndex]);
    } else {
      nextReviewAt = addDays(now, 3650);
    }

    db.prepare(`
      UPDATE progress
      SET last_seen_at = ?,
          next_review_at = ?,
          recognition_stage = ?,
          listening_stage = ?,
          spelling_stage = ?,
          times_seen = times_seen + 1,
          times_correct = times_correct + ?,
          times_wrong = times_wrong + ?,
          lapse_count = lapse_count + ?,
          correct_streak = ?,
          last_mode = ?,
          last_result = ?
      WHERE word_id = ?
    `).run(
      nowIso,
      nextReviewAt.toISOString(),
      updatedStages.recognitionStage,
      updatedStages.listeningStage,
      updatedStages.spellingStage,
      evaluation.result === "correct" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "wrong" ? 1 : 0,
      evaluation.result === "correct" ? state.correctStreak + 1 : 0,
      payload.mode,
      evaluation.result,
      payload.wordId
    );

    const logResponse = payload.mode === "spell"
      ? payload.gaveUp
        ? "gave_up"
        : payload.response || ""
      : payload.gaveUp
        ? "gave_up"
        : String(payload.choiceWordId || "");

    db.prepare(`
      INSERT INTO study_logs (
        word_id,
        word_key,
        mode,
        result,
        response,
        elapsed_ms,
        studied_on,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.wordId,
      selectWordKeyById.get(payload.wordId)?.normalized_term || null,
      payload.mode,
      evaluation.result,
      logResponse,
      Math.max(0, Number(payload.elapsedMs) || 0),
      studiedOn,
      nowIso
    );

    const refreshed = getWordState(payload.wordId);

    return {
      evaluation,
      mastered: isMastered(refreshed),
      masteryLabel: masteryLabel(refreshed),
      nextReviewAt: refreshed.nextReviewAt,
      state: refreshed,
    };
  }

  function getTextDiagnostics() {
    return {
      started: DISPLAY_LABELS.started,
      longReview: DISPLAY_LABELS.longReview,
      tomorrowListen: DISPLAY_LABELS.tomorrowListen,
      stageSample: `${DISPLAY_LABELS.stageRecognize} 1/1 ${DISPLAY_LABELS.stageListen} 0/1 ${DISPLAY_LABELS.stageSpell} -`,
    };
  }

  function updateWordMetadataEntry(wordId, updates) {
    const current = getWordState(wordId);

    updateWordMetadata.run(
      updates.chineseMeaning ?? current.chineseMeaning ?? null,
      updates.phonetic ?? current.phonetic ?? null,
      updates.audioUrl ?? current.audioUrl ?? null,
      wordId
    );

    return getWordState(wordId);
  }

  function backupDatabase(destinationPath) {
    if (!activeDbPath || activeDbPath === ":memory:") {
      throw new Error("内存数据库不能备份。");
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    db.exec("PRAGMA wal_checkpoint(FULL);");
    fs.copyFileSync(activeDbPath, destinationPath);

    const walPath = `${activeDbPath}-wal`;
    const shmPath = `${activeDbPath}-shm`;

    if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
      fs.copyFileSync(walPath, `${destinationPath}-wal`);
    }

    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${destinationPath}-shm`);
    }

    if (fs.existsSync(WORD_BANK_DB_PATH)) {
      fs.copyFileSync(
        WORD_BANK_DB_PATH,
        destinationPath.replace(/\.sqlite$/, "-wordbank.sqlite")
      );
    }

    return destinationPath;
  }

  return {
    db,
    dbPath: activeDbPath,
    storageMode: "split",
    examDate: EXAM_DATE,
    syncWords,
    getWordCount,
    getOverview: buildOverview,
    getDailyActivity,
    getNextCandidate,
    getDistractorPool,
    getWordProgress,
    getWordState,
    getAllStates,
    backupDatabase,
    updateWordMetadata(wordId, updates) {
      return updateWordMetadataEntry(wordId, updates);
    },
    getDiagnostics() {
      return {
        storageMode: "split",
        text: getTextDiagnostics(),
      };
    },
    submitAnswer,
    close() {
      db.close();
    },
  };
}

module.exports = {
  createStore,
  WORD_BANK_DB_PATH,
  LEARNING_DB_PATH,
  todayKey,
};
