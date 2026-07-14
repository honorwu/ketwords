const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "..", "data", "study-config.json");

const DEFAULT_CONFIG = {
  spellFrequencyBands: ["S"],
};

function ensureStudyConfig() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
    return DEFAULT_CONFIG;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      spellFrequencyBands: Array.isArray(parsed?.spellFrequencyBands)
        ? parsed.spellFrequencyBands
        : DEFAULT_CONFIG.spellFrequencyBands,
    };
  } catch (error) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
    return DEFAULT_CONFIG;
  }
}

module.exports = {
  CONFIG_PATH,
  ensureStudyConfig,
};
