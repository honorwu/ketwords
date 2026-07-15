const assert = require("node:assert/strict");
const test = require("node:test");
const { createCardBuilder } = require("../lib/study-card");
const { selectRandomDistractors } = require("../lib/store");

test("干扰项只从同主题随机抽取已有中文释义", () => {
  const candidate = {
    wordId: 1,
    theme: "food",
    chineseMeaning: "苹果",
  };
  const states = [
    candidate,
    { wordId: 2, theme: "food", chineseMeaning: "香蕉" },
    { wordId: 3, theme: "food", chineseMeaning: "梨" },
    { wordId: 4, theme: "food", chineseMeaning: "苹果" },
    { wordId: 5, theme: "food", chineseMeaning: "" },
    { wordId: 6, theme: "animals", chineseMeaning: "狗" },
    { wordId: 7, theme: "food", chineseMeaning: "葡萄" },
    { wordId: 8, theme: "food", chineseMeaning: "桃子" },
  ];

  const first = selectRandomDistractors(candidate, states, 3, () => 0);
  const second = selectRandomDistractors(candidate, states, 3, () => 0.999999);

  assert.equal(first.length, 3);
  assert.ok(first.every((item) => item.theme === candidate.theme));
  assert.ok(first.every((item) => item.chineseMeaning && item.chineseMeaning !== "苹果"));
  assert.equal(new Set(first.map((item) => item.chineseMeaning)).size, 3);
  assert.notDeepEqual(
    first.map((item) => item.wordId),
    second.map((item) => item.wordId)
  );
});

test("认词卡严格使用四个词在词库中的原始中文释义", async () => {
  const candidate = {
    wordId: 1,
    term: "apple",
    baseTerm: "apple",
    normalizedTerm: "apple",
    partOfSpeech: "n",
    theme: "food",
    chineseMeaning: "苹果",
    acceptedSpellings: ["apple"],
    examples: [],
    spellingRequired: 1,
    frequencyScore: 5.5,
    phonetic: "/ˈæp.əl/",
    audioUrl: "",
  };
  let requestedLimit = null;
  const store = {
    getNextCandidate() {
      return { status: "ready", mode: "recognize", candidate };
    },
    getDistractorPool(wordId, limit) {
      assert.equal(wordId, candidate.wordId);
      requestedLimit = limit;
      return [
        { wordId: 2, chineseMeaning: "香蕉" },
        { wordId: 3, chineseMeaning: "梨" },
        { wordId: 4, chineseMeaning: "葡萄" },
      ];
    },
  };

  const result = await createCardBuilder(store)();
  const options = result.card.options
    .map((option) => [option.wordId, option.label])
    .sort((left, right) => left[0] - right[0]);

  assert.equal(requestedLimit, 3);
  assert.deepEqual(options, [
    [1, "苹果"],
    [2, "香蕉"],
    [3, "梨"],
    [4, "葡萄"],
  ]);
});
