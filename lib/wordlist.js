const fs = require("node:fs");
const path = require("node:path");

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

const SPELLING_VARIANT_MAP = buildVariantMap(SPELLING_VARIANT_GROUPS);
const NON_SPELLING_PARENTHETICALS = new Set([
  "adj",
  "adv",
  "am eng",
  "br eng",
  "cm",
  "computer",
  "drawing",
  "entertain",
  "entertainment",
  "km",
  "music",
  "n",
  "not artificial",
  "planning",
  "process",
  "social media",
  "stylish",
  "clever",
  "technology",
  "tv",
  "v",
  "transitive and intransitive",
]);
const PART_OF_SPEECH_LABELS = new Set([
  "adj",
  "adv",
  "av",
  "conj",
  "det",
  "mv",
  "n",
  "prep",
  "pron",
  "v",
]);
const REGION_LABELS = new Set(["am", "br", "am eng", "br eng"]);
const SHORT_OPTIONAL_LETTER_MAX_LENGTH = 2;
const PART_OF_SPEECH_TOKEN_LABELS = new Set([
  ...PART_OF_SPEECH_LABELS,
  "exclam",
  "phr",
  "pl",
  "unc",
]);

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

function cleanSpaces(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parentheticalLabel(value) {
  return normalizeLookup(value).replace(/\s+/g, " ");
}

function isDictionaryLabel(value) {
  const label = parentheticalLabel(value);

  if (!label) {
    return false;
  }

  if (
    NON_SPELLING_PARENTHETICALS.has(label) ||
    PART_OF_SPEECH_LABELS.has(label) ||
    REGION_LABELS.has(label)
  ) {
    return true;
  }

  const compact = label.replace(/\s+/g, "");
  if (compact === "ameng" || compact === "breng") {
    return true;
  }

  const parts = label.split(/\s*&\s*|\s+and\s+|\s+/).map((part) => part.trim());
  return parts.length > 0 && parts.every((part) =>
    PART_OF_SPEECH_LABELS.has(part) || REGION_LABELS.has(part) || part === "eng"
  );
}

function isPartOfSpeechLabel(value) {
  const label = parentheticalLabel(value);
  const tokens = label
    .split(/\s*&\s*|\s+and\s+|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return tokens.length > 0 && tokens.every((token) =>
    PART_OF_SPEECH_TOKEN_LABELS.has(token)
  );
}

function extractPartOfSpeechFromTerm(term) {
  const matches = String(term || "").matchAll(/[\uFF08(]([^()\uFF08\uFF09]+)[\uFF09)]/g);

  for (const match of matches) {
    if (isPartOfSpeechLabel(match[1])) {
      return cleanSpaces(match[1].toLowerCase());
    }
  }

  return "";
}

function cleanPartOfSpeech(partOfSpeech, term = "") {
  const termPartOfSpeech = extractPartOfSpeechFromTerm(term);

  if (termPartOfSpeech) {
    return termPartOfSpeech;
  }

  const cleaned = String(partOfSpeech || "")
    .replace(/\b(?:am|br)\s+eng:?.*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || REGION_LABELS.has(parentheticalLabel(cleaned))) {
    return "unknown";
  }

  return cleaned;
}

function isNonSpellingParenthetical(value) {
  const label = parentheticalLabel(value);

  if (isDictionaryLabel(value)) {
    return true;
  }

  const parts = label.split(/\s*&\s*|\s+and\s+/).map((part) => part.trim());
  if (parts.length > 0 && parts.every((part) => PART_OF_SPEECH_LABELS.has(part))) {
    return true;
  }

  const tokens = label.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => PART_OF_SPEECH_LABELS.has(token));
}

function stripBareTrailingLabels(text) {
  let next = cleanSpaces(text);

  while (true) {
    const stripped = next
      .replace(/\b(?:am|br)\s+eng$/i, "")
      .replace(/\b(?:adj|adv|av|conj|det|mv|n|prep|pron|v)$/i, "")
      .trim();

    if (stripped === next) {
      return next;
    }

    next = stripped;
  }
}

function stripParentheticalSegments(text, { labelsOnly = false } = {}) {
  return String(text || "").replace(/\s*[\uFF08(]([^()\uFF08\uFF09]+)[\uFF09)]\s*/g, (match, inner) => {
    if (labelsOnly && !isDictionaryLabel(inner)) {
      return match;
    }

    return "";
  });
}

function cleanWordTerm(term) {
  return stripBareTrailingLabels(stripParentheticalSegments(term))
    .replace(/\s+([/?])/g, "$1")
    .replace(/([/?])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChineseMeaning(meaning) {
  return stripParentheticalSegments(meaning, { labelsOnly: true })
    .replace(/\s+([;；,，、])/g, "$1")
    .replace(/([;；,，、])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function expandInlineOptionalLetters(term) {
  const match = String(term || "").match(/^([a-z]+)\(([a-z]+)\)([a-z]*)$/i);

  if (!match) {
    return [cleanWordTerm(term)];
  }

  const [, prefix, optional, suffix] = match;
  if (optional.length > SHORT_OPTIONAL_LETTER_MAX_LENGTH) {
    return [cleanWordTerm(`${prefix}${suffix}`)];
  }

  return [`${prefix}${suffix}`, `${prefix}${optional}${suffix}`];
}

function stripTrailingNonSpellingNotes(term) {
  let next = String(term || "").trim();

  while (true) {
    const match = next.match(/\s+\(([^()]+)\)\s*$/);

    if (!match || !isNonSpellingParenthetical(match[1])) {
      return next.trim();
    }

    next = next.slice(0, match.index).trim();
  }
}

function buildSpellingCandidates(rawTerm) {
  const stripped = stripTrailingNonSpellingNotes(rawTerm);
  const slashParts =
    stripped !== "as well (as)"
      ? stripped
          .split("/")
          .map((part) => part.trim())
          .filter(Boolean)
      : [stripped];
  const candidates = slashParts.length > 1 ? slashParts : [stripped];
  const expanded = [];

  for (const candidate of candidates) {
    const optionalWordMatch = candidate.match(/^(.*)\s+\(([^()]+)\)$/);

    if (optionalWordMatch) {
      const prefix = optionalWordMatch[1].trim();
      expanded.push(cleanWordTerm(prefix));
      continue;
    }

    expanded.push(...expandInlineOptionalLetters(candidate));
  }

  return expanded
    .map((term) => cleanWordTerm(stripTrailingNonSpellingNotes(term)))
    .filter(Boolean);
}

function parseAcceptedSpellings(rawTerm) {
  const accepted = new Set(buildSpellingCandidates(rawTerm));

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
  const baseTerm = cleanWordTerm(acceptedSpellings[0] || entry.term);
  const normalizedTerm = normalizeLookup(baseTerm);
  const partOfSpeech = cleanPartOfSpeech(entry.pos, entry.term);

  return {
    sourceOrder: index + 1,
    term: baseTerm || cleanWordTerm(entry.term) || entry.term,
    baseTerm,
    normalizedTerm,
    partOfSpeech,
    examples: entry.examples,
    acceptedSpellings,
    theme: guessTheme(baseTerm),
  };
}

function ensureUniqueNormalizedTerms(records) {
  const counts = new Map();

  for (const record of records) {
    const normalized = record.normalizedTerm || normalizeLookup(record.baseTerm) || `word ${record.sourceOrder}`;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return records.map((record) => {
    const normalized = record.normalizedTerm || normalizeLookup(record.baseTerm) || `word ${record.sourceOrder}`;

    if (counts.get(normalized) <= 1) {
      return {
        ...record,
        normalizedTerm: normalized,
      };
    }

    return {
      ...record,
      normalizedTerm: `${normalized} ${record.sourceOrder}`,
    };
  });
}

async function parseCambridgePdf(pdfPath = PDF_PATH) {
  const { PDFParse } = require("pdf-parse");
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

  return ensureUniqueNormalizedTerms(entries.map(buildWordRecord));
}

function buildFallbackWordlist() {
  return ensureUniqueNormalizedTerms(FALLBACK_TERMS.map((entry, index) =>
    buildWordRecord(
      {
        term: entry.term,
        pos: entry.pos,
        examples: [],
      },
      index
    )
  ));
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
  cleanChineseMeaning,
  cleanPartOfSpeech,
  cleanWordTerm,
  ensureWordlistJson,
  buildSpellingCandidates,
  parseAcceptedSpellings,
  normalizeCompact,
  normalizeLookup,
};
