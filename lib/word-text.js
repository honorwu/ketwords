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
const PART_OF_SPEECH_TOKEN_LABELS = new Set([
  ...PART_OF_SPEECH_LABELS,
  "exclam",
  "phr",
  "pl",
  "unc",
]);

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
  const tokens = parentheticalLabel(value)
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

module.exports = {
  cleanChineseMeaning,
  cleanPartOfSpeech,
  cleanWordTerm,
  isNonSpellingParenthetical,
  normalizeCompact,
  normalizeLookup,
};
