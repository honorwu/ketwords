import {
  ENCOURAGEMENTS,
  MISTAKE_REVIEW_BASE_MS,
  MISTAKE_REVIEW_MAX_MS,
  MISTAKE_REVIEW_MIN_MS,
  state,
} from "./app-state.js";
import {
  getCleanSpellingText,
  getLetterAudioUrl,
  getLetterSpeechText,
  getSpellingLetters,
  getSpellingPattern,
  getSpellingSpeech,
  playAudioUrl,
  playTermAudio,
  speakEnglish,
  waitMs,
} from "./app-audio.js";
import { ensureResultAudioContext, playResultSound } from "./result-sound.js";

const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
const appShell = document.querySelector(".app-shell");
const views = {
  home: document.querySelector("#homeView"),
  study: document.querySelector("#studyView"),
  parent: document.querySelector("#parentView"),
};

const heroCard = document.querySelector("#heroCard");
const progressPanel = document.querySelector("#progressPanel");
const focusWordsPanel = document.querySelector("#focusWordsPanel");
const parentStats = document.querySelector("#parentStats");
const goalPanel = document.querySelector("#goalPanel");
const mistakePanel = document.querySelector("#mistakePanel");
const wordProgressPanel = document.querySelector("#wordProgressPanel");
const studyPlanMini = document.querySelector("#studyPlanMini");
const studyPanel = document.querySelector("#studyPanel");
const startStudyButton = document.querySelector("#startStudyButton");
const endStudyButton = document.querySelector("#endStudyButton");

function switchView(name) {
  if (!state.isAdmin && name === "parent") {
    return;
  }

  navTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("active", key === name);
  });

  if (name === "parent") {
    ensureParentWords().catch((error) => {
      console.error(error);
    });
  }
}

navTabs.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "study") {
      beginStudySession();
      return;
    }

    stopStudyTimer({ reset: true });
    switchView(button.dataset.view);
  });
});

async function endStudySession() {
  stopStudyTimer({ reset: true });
  clearMistakeReviewPause();

  try {
    setOverview(await requestJson("/api/overview"));
    state.studyDisplayStats = null;
    renderOverview();
  } catch (error) {
    console.error(error);
  }

  switchView("home");
  showStudySummaryModal();
}

endStudyButton.addEventListener("click", () => {
  showEndStudyConfirmModal();
});
startStudyButton.addEventListener("click", () => {
  beginStudySession();
});

function beginStudySession() {
  switchView("study");
  startStudyTimer();

  if (!state.currentCard && !state.cardLoading) {
    loadNextCard({ showLoading: true });
  }
}

async function requestJson(url, options = {}) {
  const { skipAuthPrompt = false, ...fetchOptions } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    },
    ...fetchOptions,
  });

  if (!response.ok) {
    if (response.status === 401 && !skipAuthPrompt) {
      state.auth = null;
      state.appLoaded = false;
      renderAuthScreen("登录已过期，请重新输入密码。");
    }

    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function renderAuthScreen(message = "") {
  appShell.style.display = "none";
  document.querySelector("#authScreen")?.remove();

  const role = state.isAdmin ? "admin" : "study";
  const screen = document.createElement("div");
  screen.className = "auth-screen";
  screen.id = "authScreen";
  screen.innerHTML = `
    <form class="auth-card" id="authForm">
      <div class="brand-chip">A2</div>
      <h1>${state.isAdmin ? "家长端登录" : "学习端登录"}</h1>
      <p class="muted">${state.isAdmin ? "请输入家长管理密码。" : "请输入学习端密码。"}</p>
      <input
        class="auth-input"
        id="authPassword"
        type="password"
        placeholder="密码"
        autocomplete="current-password"
        autofocus
      />
      <button class="primary-btn full-width" type="submit" id="authSubmit">登录</button>
      <div class="auth-error" id="authError">${escapeHtml(message)}</div>
    </form>
  `;

  document.body.appendChild(screen);
  screen.querySelector("#authPassword").focus();
  screen.querySelector("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const passwordInput = screen.querySelector("#authPassword");
    const submitButton = screen.querySelector("#authSubmit");
    const errorBox = screen.querySelector("#authError");

    submitButton.disabled = true;
    errorBox.textContent = "";

    try {
      const auth = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          role,
          password: passwordInput.value,
        }),
        skipAuthPrompt: true,
      });

      state.auth = auth;
      screen.remove();
      appShell.style.display = "";
      await loadAuthenticatedApp();
    } catch (error) {
      errorBox.textContent = "密码不正确，请再试一次。";
      passwordInput.select();
    } finally {
      submitButton.disabled = false;
    }
  });
}

function formatPercent(current, total) {
  if (!total) {
    return "0%";
  }

  return `${Math.round((current / total) * 100)}%`;
}

function buildMetricCard(label, value, sub) {
  return `
    <article class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-sub">${sub}</div>
    </article>
  `;
}

function formatMinutesValue(minutes, elapsedMs = 0) {
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

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getStudyDisplayToday() {
  const today = state.overview?.today || {};
  const displayStats = state.studyDisplayStats || {};
  const keys = ["cards", "recognizeCards", "listenCards", "spellCards"];
  const merged = { ...today };

  keys.forEach((key) => {
    merged[key] = Math.max(numberValue(today[key]), numberValue(displayStats[key]));
  });

  return merged;
}

function applyLocalStudyAttempt(mode, previousToday) {
  if (!state.overview?.today) {
    return;
  }

  const modeKey = {
    recognize: "recognizeCards",
    listen: "listenCards",
    spell: "spellCards",
  }[mode];

  const keys = ["cards", "recognizeCards", "listenCards", "spellCards"];
  const nextStats = {};

  keys.forEach((key) => {
    nextStats[key] = Math.max(
      numberValue(state.overview.today[key]),
      numberValue(previousToday[key])
    );
  });

  nextStats.cards = Math.max(
    numberValue(state.overview.today.cards),
    numberValue(previousToday.cards) + 1
  );

  if (modeKey) {
    nextStats[modeKey] = Math.max(
      numberValue(state.overview.today[modeKey]),
      numberValue(previousToday[modeKey]) + 1
    );
  }

  state.studyDisplayStats = nextStats;
}

function updateStudyTimer() {
  if (!state.studyTimerStartedAt) {
    return;
  }

  state.studyElapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - state.studyTimerStartedAt) / 1000)
  );
  renderStudyPlanMini();
}

function startStudyTimer() {
  if (state.studyTimerId) {
    return;
  }

  state.studyTimerStartedAt = Date.now() - state.studyElapsedSeconds * 1000;
  updateStudyTimer();
  state.studyTimerId = window.setInterval(updateStudyTimer, 1000);
}

function stopStudyTimer({ reset = false } = {}) {
  if (state.studyTimerId) {
    window.clearInterval(state.studyTimerId);
  }

  state.studyTimerId = null;
  state.studyTimerStartedAt = 0;

  if (reset) {
    state.studyElapsedSeconds = 0;
  }

  renderStudyPlanMini();
}

function getStudySummaryMessage(wrongWords) {
  const today = state.overview?.today || {};
  const cards = numberValue(today.cards);
  const correctRate = numberValue(today.correctRate);

  if (cards === 0) {
    return "今天先停一下也可以。下一次从一题开始，慢慢来。";
  }

  if (wrongWords.length === 0) {
    return "今天没有错词，说明你答得很专注。收尾很漂亮。";
  }

  if (correctRate >= 80) {
    return "今天答得很稳。把下面的词读两遍，就可以放心休息了。";
  }

  return "今天已经认真练过了。错词不是坏事，它们是在提醒下一次会更容易。";
}

function playReviewWord(term, audioUrl) {
  playTermAudio(term, audioUrl);
}

function handleEndStudyConfirmKeydown(event) {
  if (event.key === "Escape") {
    closeEndStudyConfirmModal();
  }
}

function closeEndStudyConfirmModal() {
  document.querySelector("#endStudyConfirmModal")?.remove();
  document.body.classList.remove("modal-open");
  window.removeEventListener("keydown", handleEndStudyConfirmKeydown);
}

function showEndStudyConfirmModal() {
  closeEndStudyConfirmModal();

  const modal = document.createElement("div");
  modal.className = "study-summary-modal";
  modal.id = "endStudyConfirmModal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "endStudyConfirmTitle");
  modal.innerHTML = `
    <div class="study-summary-dialog end-study-confirm-dialog">
      <div class="summary-header">
        <div>
          <p class="summary-kicker">确认一下</p>
          <h2 id="endStudyConfirmTitle">结束今天的学习？</h2>
        </div>
        <button class="summary-close-btn" type="button" id="endStudyCloseButton" aria-label="关闭">x</button>
      </div>
      <p class="summary-message">结束后会回到今日任务，并显示今天的错词复习总结。</p>
      <div class="confirm-actions">
        <button class="secondary-btn" type="button" id="continueStudyButton">继续学习</button>
        <button class="danger-btn" type="button" id="confirmEndStudyButton">确认结束</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  window.addEventListener("keydown", handleEndStudyConfirmKeydown);

  modal.querySelector("#endStudyCloseButton").addEventListener("click", closeEndStudyConfirmModal);
  modal.querySelector("#continueStudyButton").addEventListener("click", closeEndStudyConfirmModal);
  modal.querySelector("#confirmEndStudyButton").addEventListener("click", async () => {
    const confirmButton = modal.querySelector("#confirmEndStudyButton");
    confirmButton.disabled = true;
    confirmButton.textContent = "正在结束...";
    closeEndStudyConfirmModal();

    try {
      await endStudySession();
    } catch (error) {
      console.error(error);
    }
  });
  modal.querySelector("#continueStudyButton").focus({ preventScroll: true });
}

function handleStudySummaryKeydown(event) {
  if (event.key === "Escape") {
    closeStudySummaryModal();
  }
}

function closeStudySummaryModal() {
  document.querySelector("#studySummaryModal")?.remove();
  document.body.classList.remove("modal-open");
  window.removeEventListener("keydown", handleStudySummaryKeydown);
}

function renderStudySummaryWrongWords(wrongWords) {
  if (wrongWords.length === 0) {
    return `
      <div class="summary-empty">
        今天没有错词。可以给自己一个小小的鼓励，然后去休息。
      </div>
    `;
  }

  return `
    <div class="summary-review-list">
      ${wrongWords
        .map((item) => {
          const speakTerm = item.baseTerm || item.term;

          return `
            <div class="summary-review-word">
              <div class="summary-review-main">
                <div class="summary-word-line">
                  <strong>${escapeHtml(item.term)}</strong>
                  ${item.phonetic ? `<span>${escapeHtml(item.phonetic)}</span>` : ""}
                </div>
                <div class="word-meta">${escapeHtml(item.meaning || "这个词今天答错过，先看英文再读一遍。")}</div>
              </div>
              <div class="summary-review-actions">
                <span>${numberValue(item.wrongCount) || 1} 次</span>
                <button
                  class="secondary-btn review-audio-btn"
                  type="button"
                  data-term="${escapeHtml(speakTerm)}"
                  data-audio-url="${escapeHtml(item.audioUrl || "")}"
                >
                  读一读
                </button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function showStudySummaryModal() {
  const today = state.overview?.today || {};
  const wrongWords = Array.isArray(state.overview?.todayWrongWords)
    ? state.overview.todayWrongWords
    : [];

  closeStudySummaryModal();

  const modal = document.createElement("div");
  modal.className = "study-summary-modal";
  modal.id = "studySummaryModal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "studySummaryTitle");
  modal.innerHTML = `
    <div class="study-summary-dialog">
      <div class="summary-header">
        <div>
          <p class="summary-kicker">今天辛苦啦</p>
          <h2 id="studySummaryTitle">收工前再看一眼</h2>
        </div>
        <button class="summary-close-btn" type="button" id="summaryCloseButton" aria-label="关闭">x</button>
      </div>
      <p class="summary-message">${escapeHtml(getStudySummaryMessage(wrongWords))}</p>
      <div class="summary-stats">
        <span><strong>${numberValue(today.cards)}</strong> 次回答</span>
        <span><strong>${numberValue(today.correctRate)}%</strong> 正确率</span>
        <span><strong>${wrongWords.length}</strong> 个错词</span>
      </div>
      <h3>今日错词</h3>
      ${renderStudySummaryWrongWords(wrongWords)}
      <div class="summary-actions">
        <button class="primary-btn" type="button" id="summaryDoneButton">我复习好了</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  window.addEventListener("keydown", handleStudySummaryKeydown);

  modal.querySelector("#summaryCloseButton").addEventListener("click", closeStudySummaryModal);
  modal.querySelector("#summaryDoneButton").addEventListener("click", closeStudySummaryModal);
  modal.querySelectorAll(".review-audio-btn").forEach((button) => {
    button.addEventListener("click", () => {
      playReviewWord(button.dataset.term || "", button.dataset.audioUrl || "");
    });
  });

  const focusTarget =
    modal.querySelector(".review-audio-btn") || modal.querySelector("#summaryDoneButton");
  focusTarget.focus({ preventScroll: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatPartOfSpeechLabel(partOfSpeech) {
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

function renderHero() {
  const { exam, plan, checkin, progress, today } = state.overview;
  const leadingBlanks = Array.from({ length: checkin.firstWeekday }, () => null);
  const monthCells = [...leadingBlanks, ...checkin.monthDays];

  heroCard.innerHTML = `
    <div class="hero-grid">
      <div>
        <div class="chip-row">
          <span class="chip">考试日 ${exam.date}</span>
        </div>
        <div class="hero-title">每天学一点，也能稳稳往前走。</div>
        <div class="hint-box soft">${state.encouragement}</div>
        <div class="hero-metrics">
          <div class="hero-metric">
            <div class="metric-label">距离考试</div>
            <div class="hero-metric-value">${exam.daysRemaining} 天</div>
          </div>
          <div class="hero-metric">
            <div class="metric-label">今天进度</div>
            <div class="today-targets">
              <span><strong>${today.recognizeCards}/${plan.dailyTargets.recognize}</strong> 认</span>
              <span><strong>${today.listenCards}/${plan.dailyTargets.listen}</strong> 听</span>
              <span><strong>${today.spellCards}/${plan.dailyTargets.spell}</strong> 拼</span>
            </div>
          </div>
          <div class="hero-metric">
            <div class="metric-label">已掌握词数</div>
            <div class="hero-metric-value">${progress.overallMastered}/${progress.totalWords}</div>
          </div>
        </div>
        <div class="hero-actions">
          <button class="primary-btn" id="heroStartButton">开始今天的学习</button>
        </div>
      </div>
      <div class="checkin-card">
        <div class="checkin-card-top">
          <div class="checkin-card-title">
            <div class="metric-label">${checkin.monthLabel} 打卡</div>
            <div class="checkin-streak">${checkin.currentStreak} 天</div>
          </div>
          <div class="checkin-card-nav">
            <button class="checkin-nav-btn" id="checkinPrevBtn">&#8249;</button>
            <div class="checkin-best">最佳 ${checkin.bestStreak} 天</div>
            <button class="checkin-nav-btn" id="checkinNextBtn">&#8250;</button>
          </div>
        </div>
        <div class="week-labels">
          <span>一</span>
          <span>二</span>
          <span>三</span>
          <span>四</span>
          <span>五</span>
          <span>六</span>
          <span>日</span>
        </div>
        <div class="hero-calendar-grid">
          ${monthCells
            .map(
              (item) => `
                ${
                  item
                    ? `<div class="hero-calendar-day ${item.studied ? "done" : ""} ${item.isToday ? "today" : ""}">
                        <div class="calendar-date">${item.day}</div>
                        <div class="calendar-mark">${item.studied ? "✓" : "·"}</div>
                      </div>`
                    : `<div class="hero-calendar-blank"></div>`
                }
              `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  heroCard.querySelector("#heroStartButton").addEventListener("click", () => {
    beginStudySession();
  });

  heroCard.querySelector("#checkinPrevBtn").addEventListener("click", () => {
    const currentOffset = state.overview?.checkin?.monthOffset || 0;
    loadCheckinMonth(currentOffset - 1);
  });

  heroCard.querySelector("#checkinNextBtn").addEventListener("click", () => {
    const currentOffset = state.overview?.checkin?.monthOffset || 0;
    loadCheckinMonth(currentOffset + 1);
  });
}

function setOverview(overview) {
  state.overview = overview;
  state.checkinCache = {
    0: overview.checkin,
  };
}

async function loadCheckinMonth(offset) {
  if (offset === 0) {
    if (!state.checkinCache[0] && state.overview.checkin?.monthOffset === 0) {
      state.checkinCache[0] = state.overview.checkin;
    }

    if (!state.checkinCache[0]) {
      state.checkinCache[0] = await requestJson("/api/checkin?offset=0");
    }

    state.overview.checkin = state.checkinCache[0];
    renderHero();
    return;
  }

  if (state.checkinCache[offset]) {
    state.overview.checkin = state.checkinCache[offset];
    renderHero();
    return;
  }

  try {
    const data = await requestJson(`/api/checkin?offset=${offset}`);
    state.checkinCache[offset] = data;
    state.overview.checkin = data;
    renderHero();
  } catch (error) {
    console.error(error);
  }
}

function renderProgress() {
  const { progress, plan, config } = state.overview;
  const spellLevels = (config?.spellPriorityLevels || ["S", "A"]).join(" + ");

  progressPanel.innerHTML = `
    <h2>学习进度</h2>
    <div class="progress-list">
      <div class="progress-item">
        <div class="progress-top">
          <strong>整体学习进度</strong>
          <span>${progress.learningProgressPercent}%</span>
        </div>
        <div class="bar"><div class="bar-fill orange" style="width:${progress.learningProgressPercent}%"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>认词进度</strong>
          <span>${progress.recognizeMastered} / ${progress.recognizeGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill blue" style="width:${formatPercent(progress.recognizeMastered, progress.recognizeGoalCount)}"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>听词进度</strong>
          <span>${progress.listenMastered} / ${progress.listenGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill green" style="width:${formatPercent(progress.listenMastered, progress.listenGoalCount)}"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>拼写进度</strong>
          <span>${progress.spellMastered} / ${progress.spellGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${formatPercent(progress.spellMastered, progress.spellGoalCount)}"></div></div>
      </div>
    </div>
    <p class="muted">总词库一共有 ${progress.totalWords} 个词。已完成 ${progress.completedStageUnits}/${progress.totalStageUnits} 个学习阶段；认词和听词按全部词库统计，${spellLevels} 级会继续进入默写训练。</p>
  `;
}

function renderFocusWords() {
  const hardWords = state.overview.hardWords.slice(0, 5);

  focusWordsPanel.innerHTML = `
    <h2>最近容易错的词</h2>
    ${
      hardWords.length === 0
        ? `<p class="muted">目前还没有反复出错的词，继续保持。</p>`
        : `<div class="list">
            ${hardWords
              .map(
                (item) => `
                  <div class="list-item">
                    <div>
                      <strong>${item.term}</strong>
                      <div class="word-meta">${item.meaning || "释义会在学习时自动补全"}</div>
                    </div>
                    <div>${item.wrongCount} 次错题</div>
                  </div>
                `
              )
              .join("")}
          </div>`
    }
  `;
}

function renderParentDashboard() {
  const { progress, today, cumulative } = state.overview;
  const todayMinutes = formatMinutesValue(today.minutes);
  const cumulativeMinutes = formatMinutesValue(
    cumulative.totalMinutes,
    cumulative.totalElapsedMs
  );

  parentStats.innerHTML = [
    buildMetricCard("学习时长", `${todayMinutes} / ${cumulativeMinutes} 分钟`, `今日 / 累计，今天完成 ${today.cards} 次答题`),
    buildMetricCard("累计答题次数", `${cumulative.totalAttempts} 次`, `累计学过 ${cumulative.studiedWords} 个词`),
    buildMetricCard("已开始学习词数", `${cumulative.studiedWords} 个`, `总词库 ${progress.totalWords} 个`),
    buildMetricCard("已完全学会", `${progress.overallMastered} 个`, `按当前训练目标，总词库 ${progress.totalWords} 个`),
    buildMetricCard("今日正确率", `${today.correctRate}%`, `答错就按错误计算`),
    buildMetricCard("全部词库进度", `${progress.learningProgressPercent}%`, `已完成 ${progress.completedStageUnits}/${progress.totalStageUnits} 个阶段`),
    buildMetricCard(
      "考试前预计完成",
      `${progress.projectedPercent}%`,
      progress.projectedCompletionDate
        ? `按当前速度，预计完成日 ${progress.projectedCompletionDate}`
        : "需要再积累几天学习数据"
    ),
  ].join("");

  goalPanel.innerHTML = `
    <h2>进度判断</h2>
    <div class="progress-list">
      <div class="progress-item">
        <div class="progress-top">
          <strong>时间进度</strong>
          <span>${progress.timeProgressPercent}%</span>
        </div>
        <div class="bar"><div class="bar-fill blue" style="width:${progress.timeProgressPercent}%"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>学习进度</strong>
          <span>${progress.learningProgressPercent}%</span>
        </div>
        <div class="bar"><div class="bar-fill orange" style="width:${progress.learningProgressPercent}%"></div></div>
      </div>
    </div>
    <div class="progress-list">
      <div class="progress-item">
        <div class="progress-top">
          <strong>认词进度</strong>
          <span>${progress.recognizeMastered} / ${progress.recognizeGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill blue" style="width:${formatPercent(progress.recognizeMastered, progress.recognizeGoalCount)}"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>听词进度</strong>
          <span>${progress.listenMastered} / ${progress.listenGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill green" style="width:${formatPercent(progress.listenMastered, progress.listenGoalCount)}"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-top">
          <strong>拼写进度</strong>
          <span>${progress.spellMastered} / ${progress.spellGoalCount}</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${formatPercent(progress.spellMastered, progress.spellGoalCount)}"></div></div>
      </div>
    </div>
    <p class="muted">学习进度按阶段累计：认词、听词都会计入进度；拼写只统计当前需要进入默写训练的词。</p>
  `;

  mistakePanel.innerHTML = `
    <h2>全部错词${state.overview.hardWords.length ? `（${state.overview.hardWords.length} 个）` : ""}</h2>
    ${
      state.overview.hardWords.length === 0
        ? `<p class="muted">目前还没有错词。</p>`
        : `<div class="list mistake-list">
            ${state.overview.hardWords
              .map(
                (item) => `
                  <div class="list-item">
                    <div>
                      <strong>${item.term}</strong>
                      <div class="word-meta">${item.meaning || "释义会在首次学习时自动补全"}</div>
                    </div>
                    <div>
                      <strong>${item.wrongCount} 次</strong>
                      <div class="word-meta">${item.mastery}</div>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>`
    }
  `;
}

function renderParentWordPanel() {
  const filter = state.parentWordFilter.trim().toLowerCase();
  const filteredWords = state.parentWords.filter((item) => {
    if (!filter) {
      return true;
    }

    return `${item.term} ${item.meaning} ${item.theme} ${item.mastery}`
      .toLowerCase()
      .includes(filter);
  });

  wordProgressPanel.innerHTML = `
    <div class="word-progress-toolbar">
      <div>
        <h2>单词掌握明细</h2>
        <div class="muted">可以查看每个词当前的学习阶段、掌握程度和累计答题次数。</div>
      </div>
      <input
        class="word-filter"
        id="wordFilterInput"
        placeholder="搜索单词、中文或主题"
        value="${escapeHtml(state.parentWordFilter)}"
      />
    </div>
    ${
      state.parentWordsLoading
        ? `<p class="muted">正在加载单词明细…</p>`
        : filteredWords.length === 0
          ? `<p class="muted">没有匹配到单词。</p>`
          : `<div class="word-table">
              <div class="word-row header">
                <div>单词</div>
                <div>等级</div>
                <div>掌握度</div>
                <div>阶段</div>
                <div>答题次数</div>
                <div>下一步</div>
              </div>
              ${filteredWords
                .map(
                  (item) => `
                    <div class="word-row">
                      <div class="word-cell-main">
                        <strong>${escapeHtml(item.term)}</strong>
                        <div class="word-meta">${escapeHtml(item.meaning || "中文会在学习时逐步补全")}</div>
                      </div>
                      <div>${escapeHtml(item.priority)}</div>
                      <div>
                        <div>${item.masteryPercent}% · ${escapeHtml(item.mastery)}</div>
                        <div class="tiny-bar"><div class="tiny-bar-fill" style="width:${item.masteryPercent}%"></div></div>
                      </div>
                      <div>${escapeHtml(item.stageSummary)}</div>
                      <div>${item.timesSeen}</div>
                      <div>${escapeHtml(item.nextAction)}</div>
                    </div>
                  `
                )
                .join("")}
            </div>`
    }
  `;

  const input = wordProgressPanel.querySelector("#wordFilterInput");

  if (input) {
    input.addEventListener("input", (event) => {
      state.parentWordFilter = event.target.value;
      renderParentWordPanel();
    });
  }
}

function renderStudyPlanMini() {
  if (!state.overview) {
    return;
  }

  const today = getStudyDisplayToday();
  const targets = state.overview.plan?.dailyTargets || {
    recognize: 50,
    listen: 40,
    spell: 30,
  };

  studyPlanMini.className = "study-plan-mini";
  studyPlanMini.innerHTML = `
    <div class="mini-line timer-line"><strong>${state.studyElapsedSeconds}</strong> 秒学习</div>
    <div class="mini-line"><strong>${numberValue(today.cards)}</strong> 次回答</div>
    <div class="mini-line"><strong>${numberValue(today.recognizeCards)}/${targets.recognize}</strong> 认词</div>
    <div class="mini-line"><strong>${numberValue(today.listenCards)}/${targets.listen}</strong> 听词</div>
    <div class="mini-line"><strong>${numberValue(today.spellCards)}/${targets.spell}</strong> 拼写</div>
  `;
}

function priorityLabel(priority) {
  return priority === "S"
    ? "S 级拼写词"
    : priority === "A"
      ? "A 级重点词"
      : priority === "B"
        ? "B 级识别词"
        : "C 级低频词";
}

function playCardAudio() {
  const card = state.currentCard;

  if (!card) {
    return;
  }

  playTermAudio(card.baseTerm, card.audioUrl);
}

function renderFixedSpellingChar(char) {
  return /\s/.test(char) ? "&nbsp;" : escapeHtml(char);
}

async function speakSpellingLetters(text, token) {
  const letters = getSpellingLetters(text);

  for (let index = 0; index < letters.length; index += 1) {
    if (token !== state.mistakeReviewSpeechToken) {
      return;
    }

    const letter = letters[index];
    const speechText = getLetterSpeechText(letter);
    const audioUrl = getLetterAudioUrl(letter);

    if (index === 0 && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    try {
      await playAudioUrl(audioUrl);
    } catch (error) {
      await speakEnglish(speechText, {
        rate: 0.74,
        cancel: index === 0,
      });
    }

    if (index < letters.length - 1) {
      await waitMs(70);
    }
  }
}

function getMistakeReviewMs(correctText) {
  const letterCount =
    getSpellingLetters(correctText).length || String(correctText || "").length;

  return Math.min(
    MISTAKE_REVIEW_MAX_MS,
    Math.max(MISTAKE_REVIEW_MIN_MS, MISTAKE_REVIEW_BASE_MS + letterCount * 330)
  );
}

function clearMistakeReviewPause({ cancelSpeech = true } = {}) {
  window.clearTimeout(state.mistakeReviewTimer);
  window.clearInterval(state.mistakeReviewInterval);
  state.mistakeReviewTimer = null;
  state.mistakeReviewInterval = null;
  state.mistakeReviewSpeechToken += 1;

  if (!("speechSynthesis" in window)) {
    return;
  }

  if (cancelSpeech) {
    window.speechSynthesis.cancel();
  }
}

async function playMistakeReviewAudio(card, correctText, token) {
  const term = String(correctText || card?.baseTerm || card?.term || "").trim();

  if (!term) {
    return;
  }

  await playTermAudio(term, card?.audioUrl || "");

  if (token !== state.mistakeReviewSpeechToken) {
    return;
  }

  await waitMs(260);

  if (token !== state.mistakeReviewSpeechToken) {
    return;
  }

  const spellingSpeech = getSpellingSpeech(term);

  if (spellingSpeech) {
    await speakSpellingLetters(term, token);
  }
}

function startMistakeReviewPause(button, card, correctText) {
  clearMistakeReviewPause();

  const token = state.mistakeReviewSpeechToken;
  const unlockAt = Date.now() + getMistakeReviewMs(correctText);
  const updateButton = () => {
    const secondsLeft = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
    button.textContent = `先读再拼 ${secondsLeft}s`;
  };

  button.disabled = true;
  button.classList.add("review-locked");
  updateButton();

  state.mistakeReviewInterval = window.setInterval(updateButton, 1000);
  state.mistakeReviewTimer = window.setTimeout(() => {
    window.clearInterval(state.mistakeReviewInterval);
    state.mistakeReviewTimer = null;
    state.mistakeReviewInterval = null;
    button.disabled = false;
    button.textContent = "下一个";
    button.classList.remove("review-locked");
  }, Math.max(0, unlockAt - Date.now()));

  playMistakeReviewAudio(card, correctText, token).catch(() => {});
}

function scheduleAutoPlay() {
  window.clearTimeout(state.audioAutoPlayTimer);
  state.audioAutoPlayTimer = window.setTimeout(() => {
    playCardAudio();
  }, 120);
}

function renderSpellUnderlines() {
  const container = studyPanel.querySelector("#spellUnderlines");

  if (!container) {
    return;
  }

  const card = state.currentCard;
  const maxLen = getSpellInputLength(card);
  const pattern = getSpellingPattern(card.baseTerm || card.term, maxLen);
  let inputIndex = 0;

  container.innerHTML = pattern
    .map((item) => {
      if (item.type === "fixed") {
        const spaceClass = /\s/.test(item.char) ? " fixed-space" : "";
        return `<span class="spell-char fixed-char${spaceClass}">${renderFixedSpellingChar(item.char)}</span>`;
      }

      const currentIndex = inputIndex;
      const char = state.spellInputValue[currentIndex] || "";
      inputIndex += 1;
      return `<span class="spell-char spell-input-char" data-input-index="${currentIndex}">${escapeHtml(char)}</span>`;
    })
    .join("");
}

function renderSpellingReviewMarkup(correctText) {
  const letters = getSpellingLetters(correctText);

  if (letters.length === 0) {
    return "";
  }

  return `
    <div class="spelling-review">
      <div class="spelling-review-label">先读一遍，再按字母拼一遍</div>
      <div class="spelling-review-letters">
        ${letters
          .map(
            (letter) => `
              <span class="spelling-review-letter">${escapeHtml(letter)}</span>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function getAttemptLabel(card, payload) {
  if (payload.gaveUp) {
    return "这次点了：不会";
  }

  if (card.mode === "spell") {
    return `这次写的是：${payload.response || "未填写"}`;
  }

  const selectedOption = (card.options || []).find(
    (option) => Number(option.wordId) === Number(payload.choiceWordId)
  );

  return selectedOption?.label ? `这次选的是：${selectedOption.label}` : "";
}

function setupSpellKeyboard() {
  document.removeEventListener("keydown", handleSpellKeydown);
  document.addEventListener("keydown", handleSpellKeydown);
}

function handleSpellKeydown(event) {
  if (state.currentCard?.mode !== "spell" || state.answerSubmitting) {
    return;
  }

  const card = state.currentCard;
  const maxLen = getSpellInputLength(card);

  if (event.key === "Enter") {
    event.preventDefault();
    submitAnswer();
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    if (state.spellInputValue.length > 0) {
      state.spellInputValue = state.spellInputValue.slice(0, -1);
      renderSpellUnderlines();
    }
    return;
  }

  if (event.key === "Delete" || event.key === "Escape") {
    event.preventDefault();
    state.spellInputValue = "";
    renderSpellUnderlines();
    return;
  }

  const char = event.key.toLowerCase();
  if (/^[a-z0-9]$/.test(char) && state.spellInputValue.length < maxLen) {
    event.preventDefault();
    state.spellInputValue += char;
    renderSpellUnderlines();
  }
}

function getSpellInputLength(card) {
  return Number(card.spellingMaxLength) || getCleanSpellingText(card.baseTerm).length;
}

function getSpellSubmitMinLength(card) {
  return Number(card.spellingMinLength) || getSpellInputLength(card);
}

function renderCard(card) {
  clearMistakeReviewPause();
  state.selectedChoiceId = null;
  state.feedback = null;
  state.currentCard = card;
  state.startedAt = Date.now();
  state.answerSubmitting = false;

  const promptTitle =
    card.mode === "listen"
      ? "听一听这个单词"
      : card.mode === "spell"
        ? card.chineseMeaning
        : card.term;
  const priorityClass = String(card.priority || "B")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  const phoneticLine =
    card.mode === "spell"
      ? ""
      : `<div class="phonetic">${escapeHtml(card.phonetic || "首次学习时会自动补发音信息")}</div>`;

  const exampleLine =
    card.example && card.mode === "recognize"
      ? `<div class="hint-box">例句：${escapeHtml(card.example)}</div>`
      : "";
  const flowNote =
    card.flowNote
      ? `<div class="hint-box soft">${escapeHtml(card.flowNote)}</div>`
      : "";
  const modeTip =
    card.mode === "spell"
      ? ""
      : card.mode === "listen"
        ? "系统会自动播放，也可以手动再听一遍。"
        : "先看英文，再选出最合适的中文意思。";
  const modeTipMarkup = modeTip
    ? `
        <div class="mode-tip">
          ${escapeHtml(modeTip)}
        </div>
      `
    : "";

  const optionMarkup =
    card.mode === "spell"
      ? `
        <div class="spell-box">
          <div class="spell-underlines" id="spellUnderlines"></div>
          <div class="action-row">
            <button class="secondary-btn" id="audioButton">听发音</button>
            <button class="submit-btn" id="submitButton">提交答案</button>
            <button class="secondary-btn dont-know-btn" id="dontKnowButton">不会</button>
          </div>
        </div>
      `
      : `
        <div class="option-grid">
          ${card.options
            .map(
              (option) => `
                <button class="option-btn" data-choice="${Number(option.wordId)}">
                  ${escapeHtml(option.label)}
                </button>
              `
            )
            .join("")}
        </div>
        <div class="action-row">
          <button class="secondary-btn" id="audioButton">${card.mode === "listen" ? "再听一遍" : "听发音"}</button>
          <button class="submit-btn" id="submitButton">提交答案</button>
          <button class="secondary-btn dont-know-btn" id="dontKnowButton">不会</button>
        </div>
      `;

  studyPanel.innerHTML = `
    <div class="study-card">
      <div class="card-top">
        <div>
          <div class="badge-row">
            <span class="badge priority-${priorityClass}">${escapeHtml(priorityLabel(card.priority))}</span>
            <span class="badge priority-b">${escapeHtml(card.theme)}</span>
            <span class="badge priority-c">${formatPartOfSpeechLabel(card.partOfSpeech)}</span>
            <span class="badge priority-c">${escapeHtml(card.prompt)}</span>
          </div>
          <div class="prompt-title">${escapeHtml(promptTitle)}</div>
          ${phoneticLine}
        </div>
        ${modeTipMarkup}
      </div>
      ${flowNote}
      ${exampleLine}
      ${optionMarkup}
      <div id="feedbackArea"></div>
    </div>
  `;

  const audioButton = studyPanel.querySelector("#audioButton");
  audioButton.addEventListener("click", playCardAudio);

  scheduleAutoPlay();

  if (card.mode === "spell") {
    state.spellInputValue = "";
    renderSpellUnderlines();
    setupSpellKeyboard();
  } else {
    studyPanel.querySelectorAll(".option-btn").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedChoiceId = Number(button.dataset.choice);
        studyPanel.querySelectorAll(".option-btn").forEach((item) => {
          item.classList.toggle("selected", item === button);
        });
      });
    });
  }

  const dontKnowButton = studyPanel.querySelector("#dontKnowButton");

  if (dontKnowButton) {
    dontKnowButton.addEventListener("click", () => submitAnswer({ gaveUp: true }));
  }

  studyPanel.querySelector("#submitButton").addEventListener("click", () => submitAnswer());
}

function renderStudyDone(message) {
  studyPanel.innerHTML = `
    <div class="empty-state">
      <h2>今天完成啦</h2>
      <p>${message}</p>
      <div class="action-row">
        <button class="primary-btn" id="doneHomeButton">回到今日任务</button>
      </div>
    </div>
  `;

  studyPanel.querySelector("#doneHomeButton").addEventListener("click", () => {
    stopStudyTimer({ reset: true });
    switchView("home");
  });
}

function showStudyLoading() {
  studyPanel.innerHTML = `
    <div class="empty-state">
      <h2>正在安排下一题</h2>
      <p>系统会优先推送高优先级词和到期复习词。</p>
    </div>
  `;
}

async function getNextCardPayload() {
  if (state.prefetchedNext) {
    const payload = state.prefetchedNext;
    state.prefetchedNext = null;
    return payload;
  }

  if (state.prefetchedNextPromise) {
    const payload = await state.prefetchedNextPromise;
    state.prefetchedNext = null;
    return payload;
  }

  return requestJson("/api/study/next");
}

function prefetchNextCard() {
  if (state.prefetchedNext || state.prefetchedNextPromise) {
    return;
  }

  state.prefetchedNextPromise = requestJson("/api/study/next")
    .then((payload) => {
      state.prefetchedNext = payload;
      return payload;
    })
    .finally(() => {
      state.prefetchedNextPromise = null;
    });
}

function setAnswerControlsDisabled(disabled) {
  studyPanel
    .querySelectorAll("#submitButton, #dontKnowButton, #audioButton, .option-btn")
    .forEach((element) => {
      element.disabled = disabled;
    });
}

function markChoiceResult({ selectedChoiceId, correctWordId, gaveUp }) {
  if (state.currentCard?.mode === "spell") {
    return;
  }

  const answeredCorrectly = !gaveUp && Number(selectedChoiceId) === Number(correctWordId);

  studyPanel.querySelectorAll(".option-btn").forEach((button) => {
    const choiceId = Number(button.dataset.choice);
    const isCorrect = choiceId === Number(correctWordId);
    const isSelected = choiceId === Number(selectedChoiceId);

    button.classList.remove("selected");
    button.classList.toggle("correct-answer", isCorrect);
    button.classList.toggle("wrong-answer", isSelected && !isCorrect && !gaveUp);

    if (!answeredCorrectly && (isCorrect || (isSelected && !isCorrect && !gaveUp))) {
      const marker = document.createElement("span");
      marker.className = "answer-marker";
      marker.textContent = isCorrect ? "正确答案" : "你的答案";
      button.appendChild(marker);
    }
  });
}

async function submitAnswer({ gaveUp = false } = {}) {
  if (!state.currentCard || state.answerSubmitting) {
    return;
  }

  if (state.currentCard.mode !== "spell" && !state.selectedChoiceId && !gaveUp) {
    return;
  }

  if (state.currentCard.mode === "spell" && !gaveUp) {
    const card = state.currentCard;
    const minLen = getSpellSubmitMinLength(card);
    if (state.spellInputValue.length < minLen) {
      return;
    }
  }

  state.answerSubmitting = true;
  setAnswerControlsDisabled(true);
  ensureResultAudioContext(state);
  const previousToday = getStudyDisplayToday();

  const payload = {
    wordId: state.currentCard.wordId,
    mode: state.currentCard.mode,
    elapsedMs: Date.now() - state.startedAt,
  };

  if (state.currentCard.mode === "spell") {
    if (gaveUp) {
      payload.gaveUp = true;
    }
    payload.response = state.spellInputValue;
  } else if (gaveUp) {
    payload.gaveUp = true;
  } else {
    payload.choiceWordId = state.selectedChoiceId;
  }

  let result;

  try {
    result = await requestJson("/api/study/answer", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    state.answerSubmitting = false;
    setAnswerControlsDisabled(false);
    studyPanel.querySelector("#feedbackArea").innerHTML = `
      <div class="feedback wrong">
        <strong>提交失败</strong>
        <p>网络或服务暂时没有响应，请再试一次。</p>
      </div>
    `;
    return;
  }

  setOverview(result.overview);
  applyLocalStudyAttempt(payload.mode, previousToday);
  state.parentWordsNeedRefresh = true;
  renderOverview();
  prefetchNextCard();
  playResultSound(state, result.evaluation.result);
  markChoiceResult({
    selectedChoiceId: payload.choiceWordId,
    correctWordId: payload.wordId,
    gaveUp: payload.gaveUp,
  });

  const feedbackArea = studyPanel.querySelector("#feedbackArea");
  if (result.evaluation.result === "correct") {
    feedbackArea.innerHTML = "";
  } else {
    const phoneticMarkup = state.currentCard.phonetic
      ? `<span class="answer-phonetic">${escapeHtml(state.currentCard.phonetic)}</span>`
      : "";

    const correctText =
      result.evaluation.acceptedText ||
      state.currentCard.baseTerm ||
      state.currentCard.term;
    const attemptLabel = getAttemptLabel(state.currentCard, payload);
    const attemptMarkup = attemptLabel
      ? `<div class="answer-attempt">${escapeHtml(attemptLabel)}</div>`
      : "";

    feedbackArea.innerHTML = `
      <div class="feedback wrong">
        <div class="answer-reveal">
          <div class="answer-word">${escapeHtml(state.currentCard.term)}</div>
          <div class="answer-meta">
            <span>${escapeHtml(formatPartOfSpeechLabel(state.currentCard.partOfSpeech))}</span>
            ${phoneticMarkup}
          </div>
          <div class="answer-meaning">${escapeHtml(state.currentCard.chineseMeaning || result.evaluation.acceptedText || "")}</div>
          ${attemptMarkup}
          ${renderSpellingReviewMarkup(correctText)}
          <div class="answer-guidance">停一下，跟读并拼一遍，再进入下一题。</div>
        </div>
      </div>
    `;
  }

  if (state.currentCard.mode === "spell" && result.evaluation.result === "wrong") {
    const acceptedText = getCleanSpellingText(
      result.evaluation.acceptedText || state.currentCard.baseTerm
    );
    const container = studyPanel.querySelector("#spellUnderlines");
    if (container) {
      container.querySelectorAll(".spell-input-char").forEach((span) => {
        const i = Number(span.dataset.inputIndex);
        const inputChar = state.spellInputValue[i] || "";
        const correctChar = acceptedText[i] || "";
        if (!inputChar && correctChar) {
          span.textContent = correctChar;
          span.classList.add("missing-char");
        } else if (inputChar && inputChar.toLowerCase() !== correctChar.toLowerCase()) {
          span.classList.add("wrong-char");
          if (correctChar) {
            span.dataset.correct = correctChar;
          }
        }
      });
    }
  }

  const submitButton = studyPanel.querySelector("#submitButton");

  submitButton.disabled = false;
  submitButton.textContent = "下一个";
  submitButton.classList.add("next-ready");
  if (result.evaluation.result === "wrong") {
    startMistakeReviewPause(
      submitButton,
      state.currentCard,
      result.evaluation.acceptedText || state.currentCard.baseTerm || state.currentCard.term
    );
  } else {
    submitButton.focus({ preventScroll: true });
  }
  submitButton.addEventListener("click", async () => {
    clearMistakeReviewPause();
    submitButton.disabled = true;
    submitButton.textContent = "正在准备...";
    await loadNextCard();
  }, { once: true });
}

async function loadNextCard({ showLoading = false } = {}) {
  clearMistakeReviewPause();
  state.cardLoading = true;

  if (showLoading) {
    showStudyLoading();
  }

  let payload;

  try {
    payload = await getNextCardPayload();
  } catch (error) {
    studyPanel.innerHTML = `
      <div class="empty-state">
        <h2>下一题加载失败</h2>
        <p>请刷新页面，或稍后再试一次。</p>
        <button class="primary-btn" id="retryStudyButton">重新加载</button>
      </div>
    `;
    studyPanel.querySelector("#retryStudyButton").addEventListener("click", () => {
      loadNextCard({ showLoading: true });
    });
    state.cardLoading = false;
    return;
  }

  if (payload.status === "done") {
    state.currentCard = null;
    renderStudyDone(payload.message);
  } else {
    renderCard(payload.card);
  }

  state.cardLoading = false;
}

async function ensureParentWords(force = false) {
  if (!force && !state.parentWordsNeedRefresh && state.parentWords.length > 0) {
    renderParentWordPanel();
    return;
  }

  state.parentWordsLoading = true;
  renderParentWordPanel();

  try {
    const payload = await requestJson("/api/parent/words");
    state.parentWords = payload.words;
    state.parentWordsNeedRefresh = false;
  } finally {
    state.parentWordsLoading = false;
    renderParentWordPanel();
  }
}

function renderOverview() {
  if (!state.overview) {
    return;
  }

  renderHero();
  renderProgress();
  renderFocusWords();
  renderParentDashboard();
  renderStudyPlanMini();

  if (views.parent.classList.contains("active")) {
    renderParentWordPanel();
  }
}

async function loadAuthenticatedApp() {
  if (state.appLoaded) {
    setOverview(await requestJson("/api/overview"));
    state.studyDisplayStats = null;
    renderOverview();
    return;
  }

  if (state.isAdmin) {
    document.title = "词汇成长计划 · 家长看板";
    document.querySelector(".nav-tabs").style.display = "none";
    switchView("parent");
    await ensureParentWords(true);
  }

  showStudyLoading();

  setOverview(await requestJson("/api/overview"));
  state.studyDisplayStats = null;
  renderOverview();

  if (state.isAdmin) {
    switchView("parent");
  }

  state.appLoaded = true;
}

async function init() {
  state.encouragement =
    ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];

  const auth = await requestJson("/api/auth/me", {
    skipAuthPrompt: true,
  });

  if (!auth.authenticated || (state.isAdmin && auth.role !== "admin")) {
    renderAuthScreen();
    return;
  }

  state.auth = auth;
  await loadAuthenticatedApp();
}

init().catch((error) => {
  console.error(error);
  studyPanel.innerHTML = `
    <div class="empty-state">
      <h2>加载失败</h2>
      <p>请确认本地服务已经启动，然后刷新页面重试。</p>
    </div>
  `;
});
