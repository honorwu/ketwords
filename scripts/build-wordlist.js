const { ensureWordlistJson, WORDLIST_PATH } = require("../lib/wordlist");

async function main() {
  const words = await ensureWordlistJson();
  console.log(`Wordlist ready: ${words.length} entries -> ${WORDLIST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
