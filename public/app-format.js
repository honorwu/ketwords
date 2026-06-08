export function formatPercent(current, total) {
  if (!total) {
    return "0%";
  }

  return `${Math.round((current / total) * 100)}%`;
}

export function buildMetricCard(label, value, sub) {
  return `
    <article class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-sub">${sub}</div>
    </article>
  `;
}

export function formatMinutesValue(minutes, elapsedMs = 0) {
  const numericMinutes = Number(minutes);

  if (Number.isFinite(numericMinutes)) {
    return numericMinutes;
  }

  const numericElapsedMs = Number(elapsedMs);

  if (Number.isFinite(numericElapsedMs) && numericElapsedMs > 0) {
    return Math.max(1, Math.round(numericElapsedMs / 60000));
  }

  return 0;
}

export function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatPartOfSpeechLabel(partOfSpeech) {
  const labels = {
    abbrev: "abbrev 缩写",
    adj: "adj 形容词",
    adv: "adv 副词",
    av: "av 助动词",
    conj: "conj 连词",
    det: "det 限定词",
    exclam: "exclam 感叹词",
    mv: "mv 情态动词",
    n: "n 名词",
    phrv: "phr v 短语动词",
    "phr v": "phr v 短语动词",
    pl: "pl 复数",
    prep: "prep 介词",
    "prep phr": "prep phr 介词短语",
    pron: "pron 代词",
    sing: "sing 单数",
    v: "v 动词",
    custom: "自定义词",
  };

  return String(partOfSpeech || "")
    .split(/\s*[,&]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => labels[item] || item)
    .join(" + ");
}

export function priorityLabel(priority) {
  return priority === "S"
    ? "S 级拼写词"
    : priority === "A"
      ? "A 级重点词"
      : priority === "B"
        ? "B 级识别词"
        : "C 级低频词";
}
