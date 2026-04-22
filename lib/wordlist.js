const fs = require("node:fs");
const path = require("node:path");
const { PDFParse } = require("pdf-parse");

const DATA_DIR = path.join(__dirname, "..", "data");
const PDF_PATH = path.join(DATA_DIR, "a2-key-vocabulary-list.pdf");
const WORDLIST_PATH = path.join(DATA_DIR, "a2-key-wordlist.json");

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const MONTHS = [
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
];

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "first",
  "second",
  "third",
];

const SPELL_PRIORITY_TERMS = new Set(
  [
    "answer",
    "apple",
    "arm",
    "ask",
    "bag",
    "banana",
    "bathroom",
    "beach",
    "bed",
    "bedroom",
    "bike",
    "bird",
    "book",
    "bread",
    "brother",
    "bus",
    "cake",
    "camera",
    "car",
    "cat",
    "chair",
    "chicken",
    "child",
    "children",
    "city",
    "class",
    "classroom",
    "clean",
    "close",
    "coat",
    "cold",
    "colour",
    "color",
    "come",
    "cook",
    "country",
    "cousin",
    "dad",
    "dance",
    "desk",
    "dictionary",
    "dinner",
    "dog",
    "door",
    "drink",
    "ear",
    "eat",
    "egg",
    "eye",
    "face",
    "family",
    "father",
    "fish",
    "food",
    "foot",
    "friend",
    "fruit",
    "garden",
    "girl",
    "good",
    "grandfather",
    "grandmother",
    "great",
    "green",
    "hand",
    "happy",
    "hat",
    "head",
    "help",
    "home",
    "homework",
    "horse",
    "hot",
    "house",
    "hungry",
    "jacket",
    "juice",
    "kitchen",
    "learn",
    "leg",
    "lesson",
    "library",
    "like",
    "listen",
    "live",
    "long",
    "look",
    "lunch",
    "map",
    "milk",
    "mother",
    "mouth",
    "music",
    "name",
    "nose",
    "notebook",
    "open",
    "orange",
    "park",
    "pen",
    "pencil",
    "phone",
    "photo",
    "picture",
    "pizza",
    "play",
    "question",
    "rain",
    "read",
    "red",
    "rice",
    "room",
    "run",
    "sad",
    "salad",
    "sandwich",
    "school",
    "see",
    "shirt",
    "shoe",
    "shop",
    "short",
    "sister",
    "sit",
    "sleep",
    "small",
    "snow",
    "speak",
    "sport",
    "stand",
    "student",
    "study",
    "sun",
    "swim",
    "table",
    "talk",
    "teacher",
    "tennis",
    "test",
    "ticket",
    "tired",
    "tomato",
    "tooth",
    "town",
    "train",
    "tree",
    "trip",
    "trousers",
    "t-shirt",
    "uncle",
    "walk",
    "wall",
    "warm",
    "water",
    "wear",
    "weather",
    "window",
    "write",
    "yellow",
  ].concat(DAYS, MONTHS)
);

const LISTEN_PRIORITY_TERMS = new Set(
  [
    "a.m.",
    "afternoon",
    "airport",
    "alarm clock",
    "animal",
    "apartment",
    "apartment building",
    "arrive",
    "autumn",
    "backpack",
    "badminton",
    "bath",
    "boat",
    "breakfast",
    "bridge",
    "building",
    "bus station",
    "cafe",
    "cinema",
    "clock",
    "cloud",
    "cloudy",
    "computer",
    "cooker",
    "date",
    "daughter",
    "day",
    "doctor",
    "dolphin",
    "driver",
    "duck",
    "evening",
    "exam",
    "farm",
    "field",
    "film",
    "floor",
    "flower",
    "forest",
    "fruit juice",
    "grandparent",
    "guitar",
    "holiday",
    "hospital",
    "hotel",
    "hour",
    "journey",
    "library card",
    "lift",
    "market",
    "minute",
    "mirror",
    "mobile",
    "mobile phone",
    "morning",
    "mountain",
    "museum",
    "night",
    "online",
    "parent",
    "p.m.",
    "playground",
    "pool",
    "rainy",
    "restaurant",
    "river",
    "road",
    "sea",
    "season",
    "sheep",
    "shopping",
    "shoulder",
    "shower",
    "singer",
    "skiing",
    "skirt",
    "sky",
    "snowy",
    "son",
    "station",
    "storm",
    "street",
    "summer",
    "supermarket",
    "sweater",
    "swimming pool",
    "taxi",
    "theatre",
    "tomorrow",
    "travel",
    "traveller",
    "trousers",
    "underground",
    "village",
    "waiter",
    "weather forecast",
    "week",
    "weekend",
    "winter",
    "wind",
    "windy",
    "yesterday",
    "zoo",
  ]
    .concat(DAYS, MONTHS, NUMBER_WORDS)
    .filter(Boolean)
);

const THEME_TERMS = {
  family: [
    "aunt",
    "baby",
    "boy",
    "boyfriend",
    "brother",
    "child",
    "children",
    "cousin",
    "dad",
    "daughter",
    "family",
    "father",
    "friend",
    "girlfriend",
    "grandfather",
    "grandmother",
    "grandparent",
    "husband",
    "mother",
    "mum",
    "parent",
    "sister",
    "son",
    "uncle",
    "wife",
  ],
  school: [
    "answer",
    "book",
    "class",
    "classroom",
    "computer",
    "desk",
    "dictionary",
    "exam",
    "exercise",
    "homework",
    "language",
    "learn",
    "lesson",
    "library",
    "notebook",
    "pen",
    "pencil",
    "question",
    "read",
    "ruler",
    "school",
    "spell",
    "student",
    "study",
    "teacher",
    "test",
    "write",
  ],
  food: [
    "apple",
    "banana",
    "bread",
    "breakfast",
    "butter",
    "cake",
    "cheese",
    "chicken",
    "chips",
    "chocolate",
    "coffee",
    "cook",
    "dinner",
    "drink",
    "egg",
    "eat",
    "fish",
    "food",
    "fruit",
    "juice",
    "lunch",
    "meat",
    "milk",
    "orange",
    "pasta",
    "pizza",
    "potato",
    "rice",
    "salad",
    "sandwich",
    "soup",
    "sugar",
    "tea",
    "tomato",
    "vegetable",
    "water",
  ],
  home: [
    "apartment",
    "apartment building",
    "armchair",
    "bath",
    "bathroom",
    "bed",
    "bedroom",
    "chair",
    "cupboard",
    "desk",
    "door",
    "flat",
    "floor",
    "garden",
    "home",
    "house",
    "kitchen",
    "lamp",
    "living room",
    "mirror",
    "room",
    "shower",
    "sofa",
    "table",
    "wall",
    "window",
  ],
  body: [
    "arm",
    "back",
    "body",
    "ear",
    "eye",
    "face",
    "finger",
    "foot",
    "feet",
    "hair",
    "hand",
    "head",
    "leg",
    "mouth",
    "neck",
    "nose",
    "shoulder",
    "stomach",
    "tooth",
    "teeth",
  ],
  animals: [
    "animal",
    "bear",
    "bird",
    "cat",
    "cow",
    "dog",
    "duck",
    "elephant",
    "fish",
    "goat",
    "hen",
    "horse",
    "insect",
    "monkey",
    "mouse",
    "pet",
    "rabbit",
    "sheep",
    "tiger",
    "whale",
    "zoo",
  ],
  time: DAYS.concat(MONTHS, [
    "afternoon",
    "autumn",
    "clock",
    "date",
    "day",
    "evening",
    "hour",
    "minute",
    "month",
    "morning",
    "night",
    "season",
    "spring",
    "summer",
    "today",
    "tomorrow",
    "week",
    "weekend",
    "winter",
    "year",
    "yesterday",
    "a.m.",
    "p.m.",
  ]),
  travel: [
    "aeroplane",
    "airplane",
    "airport",
    "backpack",
    "bag",
    "bike",
    "boat",
    "bridge",
    "bus",
    "bus station",
    "car",
    "driver",
    "holiday",
    "hotel",
    "journey",
    "map",
    "plane",
    "road",
    "ship",
    "station",
    "street",
    "suitcase",
    "taxi",
    "ticket",
    "train",
    "travel",
    "trip",
    "underground",
  ],
  places: [
    "bank",
    "beach",
    "cafe",
    "cinema",
    "city",
    "country",
    "farm",
    "hospital",
    "hotel",
    "library",
    "market",
    "museum",
    "park",
    "playground",
    "restaurant",
    "school",
    "shop",
    "supermarket",
    "swimming pool",
    "theatre",
    "town",
    "village",
    "zoo",
  ],
  clothes: [
    "clothes",
    "coat",
    "dress",
    "hat",
    "jacket",
    "jeans",
    "shirt",
    "shoe",
    "shoes",
    "shorts",
    "skirt",
    "sock",
    "socks",
    "sweater",
    "t-shirt",
    "trousers",
    "trainers",
  ],
  weather: [
    "cloud",
    "cloudy",
    "cold",
    "cool",
    "hot",
    "rain",
    "rainy",
    "snow",
    "snowy",
    "storm",
    "sun",
    "sunny",
    "warm",
    "weather",
    "wet",
    "wind",
    "windy",
  ],
  hobbies: [
    "art",
    "badminton",
    "basketball",
    "dance",
    "draw",
    "football",
    "game",
    "guitar",
    "hobby",
    "music",
    "piano",
    "photo",
    "play",
    "run",
    "sing",
    "skiing",
    "song",
    "sport",
    "swim",
    "tennis",
    "video",
  ],
  nature: [
    "field",
    "flower",
    "forest",
    "mountain",
    "plant",
    "river",
    "sea",
    "sky",
    "tree",
  ],
  technology: [
    "app",
    "camera",
    "computer",
    "email",
    "internet",
    "message",
    "mobile",
    "mobile phone",
    "online",
    "phone",
    "screen",
    "text",
    "video",
    "website",
  ],
  colours: [
    "black",
    "blue",
    "brown",
    "colour",
    "color",
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
};

const SPELLING_VARIANT_GROUPS = [
  ["aeroplane", "airplane"],
  ["colour", "color"],
  ["favourite", "favorite"],
  ["grey", "gray"],
  ["centre", "center"],
  ["theatre", "theater"],
  ["traveller", "traveler"],
  ["programme", "program"],
  ["mum", "mom"],
  ["maths", "math"],
];

const FALLBACK_TERMS = [
  { term: "apple", pos: "n" },
  { term: "book", pos: "n" },
  { term: "brother", pos: "n" },
  { term: "cat", pos: "n" },
  { term: "classroom", pos: "n" },
  { term: "dog", pos: "n" },
  { term: "eat", pos: "v" },
  { term: "friend", pos: "n" },
  { term: "happy", pos: "adj" },
  { term: "home", pos: "n" },
  { term: "juice", pos: "n" },
  { term: "kitchen", pos: "n" },
  { term: "listen", pos: "v" },
  { term: "mother", pos: "n" },
  { term: "pencil", pos: "n" },
  { term: "play", pos: "v" },
  { term: "rain", pos: "n & v" },
  { term: "school", pos: "n" },
  { term: "teacher", pos: "n" },
  { term: "write", pos: "v" },
];

const NORMALIZED_THEME_TERMS = Object.fromEntries(
  Object.entries(THEME_TERMS).map(([theme, values]) => [
    theme,
    new Set(values.map((value) => normalizeLookup(value))),
  ])
);

const NORMALIZED_SPELL_PRIORITY = new Set(
  Array.from(SPELL_PRIORITY_TERMS, normalizeLookup)
);
const NORMALIZED_LISTEN_PRIORITY = new Set(
  Array.from(LISTEN_PRIORITY_TERMS, normalizeLookup)
);

const SPELLING_VARIANT_MAP = buildVariantMap(SPELLING_VARIANT_GROUPS);

function buildVariantMap(groups) {
  const map = new Map();

  for (const group of groups) {
    const normalized = group.map((term) => normalizeLookup(term));

    for (const term of normalized) {
      const others = normalized.filter((candidate) => candidate !== term);
      map.set(term, others);
    }
  }

  return map;
}

function normalizeLookup(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9@/\s-]/g, "")
    .replace(/[-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(text) {
  return normalizeLookup(text).replace(/\s+/g, "");
}

function parseAcceptedSpellings(rawTerm) {
  const slashParts = rawTerm
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const accepted = new Set([rawTerm]);

  if (slashParts.length > 1 && rawTerm !== "as well (as)") {
    for (const part of slashParts) {
      accepted.add(part);
    }
  }

  for (const term of Array.from(accepted)) {
    const normalized = normalizeLookup(term);
    const variants = SPELLING_VARIANT_MAP.get(normalized) || [];

    for (const variant of variants) {
      accepted.add(variant);
    }
  }

  return Array.from(accepted)
    .map((term) => term.trim())
    .filter(Boolean);
}

function guessTheme(term) {
  const normalized = normalizeLookup(term);
  const tokens = normalized.split(" ");

  for (const [theme, values] of Object.entries(NORMALIZED_THEME_TERMS)) {
    if (values.has(normalized) || tokens.some((token) => values.has(token))) {
      return theme;
    }
  }

  return "general";
}

function isGrammarHeavy(pos) {
  return /(det|pron|conj|prep|mv|av)/.test(pos);
}

function classifyWord(term, pos) {
  const normalized = normalizeLookup(term);
  const theme = guessTheme(term);
  const grammarHeavy = isGrammarHeavy(pos);
  const isSpell = !grammarHeavy && NORMALIZED_SPELL_PRIORITY.has(normalized);
  const isListen =
    !isSpell &&
    !grammarHeavy &&
    (NORMALIZED_LISTEN_PRIORITY.has(normalized) ||
      ["time", "travel", "places", "weather", "technology"].includes(theme));

  let learningTarget = "recognize";

  if (isSpell) {
    learningTarget = "spell";
  } else if (isListen) {
    learningTarget = "listen";
  }

  let priority = "B";

  if (grammarHeavy) {
    priority = "C";
  } else if (learningTarget === "spell") {
    priority = "S";
  } else if (learningTarget === "listen" || theme !== "general") {
    priority = "A";
  } else if (
    term.includes(" ") ||
    normalized.length > 12 ||
    /(tion|sion|ment|ness|ship|ence|ance)$/.test(normalized)
  ) {
    priority = "C";
  }

  return {
    theme,
    priority,
    learningTarget,
    spellingRequired: learningTarget === "spell" ? 1 : 0,
  };
}

function shouldIgnoreLine(line) {
  return (
    !line ||
    line === "Vocabulary List" ||
    line === "Schools" ||
    line.startsWith("-- ") ||
    line.startsWith("© UCLES") ||
    line.startsWith("Page ") ||
    line.startsWith("A2 Key and Key for") ||
    line.startsWith("A2 Key") ||
    line.startsWith("Key and Key for Schools Vocabulary List")
  );
}

function buildWordRecord(entry, index) {
  const acceptedSpellings = parseAcceptedSpellings(entry.term);
  const baseTerm = acceptedSpellings[0] || entry.term;
  const normalizedTerm = normalizeLookup(entry.term);
  const classification = classifyWord(baseTerm, entry.pos);

  return {
    sourceOrder: index + 1,
    term: entry.term,
    baseTerm,
    normalizedTerm,
    partOfSpeech: entry.pos,
    examples: entry.examples,
    acceptedSpellings,
    ...classification,
  };
}

async function parseCambridgePdf(pdfPath = PDF_PATH) {
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const result = await parser.getText();
  await parser.destroy();

  const lines = result.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let inAlphabeticalSection = false;
  let currentEntry = null;

  for (const line of lines) {
    if (!inAlphabeticalSection) {
      if (line === "A") {
        inAlphabeticalSection = true;
      }

      continue;
    }

    if (line.startsWith("Appendix 1")) {
      break;
    }

    if (shouldIgnoreLine(line) || /^[A-Z]$/.test(line)) {
      continue;
    }

    const entryMatch = line.match(/^(.*)\s\(([^()]+)\)$/);

    if (entryMatch && !line.startsWith("•")) {
      currentEntry = {
        term: entryMatch[1].trim(),
        pos: entryMatch[2].trim(),
        examples: [],
      };
      entries.push(currentEntry);
      continue;
    }

    if (line.startsWith("•") && currentEntry) {
      currentEntry.examples.push(line.replace(/^•\s*/, "").trim());
      continue;
    }

    if (currentEntry && currentEntry.examples.length > 0 && !shouldIgnoreLine(line)) {
      const lastIndex = currentEntry.examples.length - 1;
      currentEntry.examples[lastIndex] = `${currentEntry.examples[lastIndex]} ${line}`
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return entries.map(buildWordRecord);
}

function buildFallbackWordlist() {
  return FALLBACK_TERMS.map((entry, index) =>
    buildWordRecord(
      {
        term: entry.term,
        pos: entry.pos,
        examples: [],
      },
      index
    )
  );
}

async function ensureWordlistJson() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(WORDLIST_PATH)) {
    const cached = JSON.parse(fs.readFileSync(WORDLIST_PATH, "utf8"));

    if (Array.isArray(cached) && cached.length > 100) {
      return cached;
    }
  }

  try {
    if (!fs.existsSync(PDF_PATH)) {
      throw new Error(`Local vocabulary PDF not found: ${PDF_PATH}`);
    }

    const wordlist = await parseCambridgePdf(PDF_PATH);
    fs.writeFileSync(WORDLIST_PATH, JSON.stringify(wordlist, null, 2), "utf8");
    return wordlist;
  } catch (error) {
    const fallback = buildFallbackWordlist();
    fs.writeFileSync(WORDLIST_PATH, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

module.exports = {
  PDF_PATH,
  WORDLIST_PATH,
  ensureWordlistJson,
  parseAcceptedSpellings,
  normalizeCompact,
  normalizeLookup,
};
