import {
  ENCOURAGEMENTS,
  MISTAKE_REVIEW_BASE_MS,
  MISTAKE_REVIEW_MAX_MS,
  MISTAKE_REVIEW_MIN_MS,
  state,
} from "./app-state.js";
import {
  getCleanSpellingText,
  getSpellingLetters,
  getSpellingPattern,
  playTermAudio,
} from "./app-audio.js";
import {
  buildMetricCard,
  escapeHtml,
  formatMinutesValue,
  formatPartOfSpeechLabel,
  formatPercent,
  frequencyLabel,
  numberValue,
} from "./app-format.js";
import { createStudySessionUi } from "./app-study-session.js";
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

const WORD_MAP_FILTERS = [
  { key: "all", label: "全部" },
  { key: "unseen", label: "未学习" },
  { key: "recognize", label: "认词中" },
  { key: "listen", label: "听词中" },
  { key: "spell", label: "拼写中" },
  { key: "mastered", label: "已掌握" },
  { key: "repeated", label: "反复错" },
];
const WORD_MAP_STATUS_LABELS = Object.fromEntries(
  WORD_MAP_FILTERS.map((item) => [item.key, item.label])
);
const {
  showEndStudyConfirmModal,
  showStudySummaryModal,
  startStudyTimer,
  stopStudyTimer,
} = createStudySessionUi({
  endStudySession,
  escapeHtml,
  numberValue,
  playTermAudio,
  renderStudyPlanMini,
  state,
});

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

function renderHero() {
  const { exam, checkin, config, progress, today } = state.overview;
  const targets = config.dailyTargets;
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
              <span><strong>${today.recognizeCards}/${targets.recognize}</strong> 认</span>
              <span><strong>${today.listenCards}/${targets.listen}</strong> 听</span>
              <span><strong>${today.spellCards}/${targets.spell}</strong> 拼</span>
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
  const { progress, config } = state.overview;
  const spellMinScore = Number(config.spellFrequencyMinScore).toFixed(2);

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
    <p class="muted">总词库一共有 ${progress.totalWords} 个词。已完成 ${progress.completedStageUnits}/${progress.totalStageUnits} 个学习阶段；认词和听词按全部词库统计，日常词频不低于 ${spellMinScore} 的单词会继续进入默写训练。</p>
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
  const repeatedWrongThreshold = state.overview.config.repeatedWrongThreshold;
  const repeatedWrongWords = state.overview.hardWords.filter(
    (item) => item.wrongCount >= repeatedWrongThreshold
  );
  const attentionWords = (
    repeatedWrongWords.length > 0 ? repeatedWrongWords : state.overview.hardWords
  ).slice(0, 6);

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
    <h2>重点关注</h2>
    <p class="muted">反复错 ${repeatedWrongWords.length} 个（累计错 ${repeatedWrongThreshold} 次以上），有过错题 ${state.overview.hardWords.length} 个。</p>
    ${
      attentionWords.length === 0
        ? `<p class="muted">目前还没有错词，继续保持。</p>`
        : `<div class="list mistake-list">
            ${attentionWords
              .map(
                (item) => `
                  <div class="list-item">
                    <div>
                      <strong>${escapeHtml(item.term)}</strong>
                      <div class="word-meta">${escapeHtml(item.meaning || "释义会在首次学习时自动补全")}</div>
                    </div>
                    <div>
                      <strong>${item.wrongCount} 次</strong>
                      <div class="word-meta">${escapeHtml(item.mastery)}</div>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>`
    }
    ${repeatedWrongWords.length > 0 ? `
      <div class="action-row mistake-map-action">
        <button type="button" class="secondary-btn" id="showRepeatedWordsButton">在地图中查看全部反复错词</button>
      </div>
    ` : ""}
  `;

  mistakePanel.querySelector("#showRepeatedWordsButton")?.addEventListener("click", async () => {
    state.parentWordStatusFilter = "repeated";
    state.parentWordFilter = "";
    state.parentWordSelectedId = null;
    await ensureParentWords();
    renderParentWordPanel({ preserveMapScroll: false });
    wordProgressPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderParentWordPanel({
  focusSearch = false,
  focusWordId = null,
  preserveMapScroll = true,
} = {}) {
  const previousMap = wordProgressPanel.querySelector(".word-map-grid");
  const previousScrollTop = preserveMapScroll ? previousMap?.scrollTop || 0 : 0;
  const searchTerm = state.parentWordFilter.trim().toLowerCase();
  const statusFilter = state.parentWordStatusFilter;
  const repeatedWrongThreshold = numberValue(
    state.overview?.config?.repeatedWrongThreshold
  ) || 3;
  const statusCounts = Object.fromEntries(
    WORD_MAP_FILTERS.map((item) => [item.key, 0])
  );

  statusCounts.all = state.parentWords.length;
  state.parentWords.forEach((item) => {
    statusCounts[item.mapStatus] = (statusCounts[item.mapStatus] || 0) + 1;
    if (item.repeatedWrong) {
      statusCounts.repeated += 1;
    }
  });

  const filteredWords = state.parentWords.filter((item) => {
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "repeated" ? item.repeatedWrong : item.mapStatus === statusFilter);
    const matchesSearch = !searchTerm
      || `${item.term} ${item.meaning} ${item.theme} ${item.mastery} ${item.stageSummary}`
        .toLowerCase()
        .includes(searchTerm);

    return matchesStatus && matchesSearch;
  });
  const selectedWord = state.parentWords.find(
    (item) => Number(item.wordId) === Number(state.parentWordSelectedId)
  );

  wordProgressPanel.innerHTML = `
    <div class="word-map-toolbar">
      <div>
        <h2>词汇掌握地图</h2>
        <div class="muted">每格一个词，底色表示当前阶段；右上角红点表示累计错 ${repeatedWrongThreshold} 次以上。</div>
      </div>
      <label class="word-search">
        <span class="visually-hidden">搜索单词</span>
        <input
          class="word-filter"
          id="wordFilterInput"
          placeholder="搜索单词、中文或主题"
          value="${escapeHtml(state.parentWordFilter)}"
        />
      </label>
    </div>
    <div class="word-map-filters" role="group" aria-label="筛选单词状态">
      ${WORD_MAP_FILTERS.map(
        (filter) => `
          <button
            type="button"
            class="word-map-filter status-${filter.key}${statusFilter === filter.key ? " active" : ""}"
            data-word-map-filter="${filter.key}"
            aria-pressed="${statusFilter === filter.key}"
          >
            <span class="word-map-swatch" aria-hidden="true"></span>
            <span>${filter.label}</span>
            <strong>${statusCounts[filter.key] || 0}</strong>
          </button>
        `
      ).join("")}
    </div>
    ${selectedWord ? `
      <section class="word-map-selection" aria-label="已选单词详情">
        <div class="word-map-selection-heading">
          <div>
            <strong>${escapeHtml(selectedWord.term)}</strong>
            <span>${escapeHtml(selectedWord.meaning || "中文释义待补充")}</span>
          </div>
          <button type="button" class="word-map-selection-close" id="closeWordSelection" aria-label="关闭单词详情">×</button>
        </div>
        <div class="word-map-selection-facts">
          <span><b>当前阶段</b>${escapeHtml(WORD_MAP_STATUS_LABELS[selectedWord.mapStatus] || selectedWord.mastery)}</span>
          <span><b>掌握度</b>${selectedWord.masteryPercent}%</span>
          <span><b>答题记录</b>${selectedWord.timesSeen} 次，错 ${selectedWord.timesWrong} 次</span>
          <span><b>日常词频</b>${escapeHtml(frequencyLabel(selectedWord.frequencyScore).replace("日常词频 ", ""))}</span>
          <span><b>阶段进度</b>${escapeHtml(selectedWord.stageSummary)}</span>
          <span><b>下一步</b>${escapeHtml(selectedWord.nextAction)}</span>
        </div>
      </section>
    ` : ""}
    <div class="word-map-result-line" aria-live="polite">
      <strong>显示 ${filteredWords.length} / ${state.parentWords.length} 个词</strong>
      <span>按词表顺序固定排列，筛选不会改变单词状态。</span>
    </div>
    ${
      state.parentWordsLoading
        ? `<p class="muted">正在加载词汇掌握地图…</p>`
        : filteredWords.length === 0
          ? `<div class="word-map-empty">没有匹配到单词，可以换一个状态或清空搜索。</div>`
          : `<div class="word-map-grid" role="list" aria-label="词汇掌握地图">
              ${filteredWords.map((item) => {
                const statusLabel = WORD_MAP_STATUS_LABELS[item.mapStatus] || item.mastery;
                const repeatedLabel = item.repeatedWrong ? `，反复错词，累计错 ${item.timesWrong} 次` : "";
                const isSelected = Number(item.wordId) === Number(state.parentWordSelectedId);

                return `
                  <button
                    type="button"
                    role="listitem"
                    class="word-map-cell status-${item.mapStatus}${item.repeatedWrong ? " is-repeated-wrong" : ""}${isSelected ? " is-selected" : ""}"
                    data-word-id="${item.wordId}"
                    aria-pressed="${isSelected}"
                    aria-label="${escapeHtml(`${item.term}，${statusLabel}${repeatedLabel}，${item.meaning || "暂无中文释义"}`)}"
                    title="${escapeHtml(`${item.term} · ${statusLabel}${repeatedLabel}`)}"
                  ><span>${escapeHtml(item.term)}</span></button>
                `;
              }).join("")}
            </div>`
    }
  `;

  const map = wordProgressPanel.querySelector(".word-map-grid");
  if (map) {
    map.scrollTop = previousScrollTop;
  }

  const input = wordProgressPanel.querySelector("#wordFilterInput");
  if (input) {
    input.addEventListener("input", (event) => {
      state.parentWordFilter = event.target.value;
      state.parentWordSelectedId = null;
      renderParentWordPanel({ focusSearch: true });
    });
    if (focusSearch) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  wordProgressPanel.querySelectorAll("[data-word-map-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.parentWordStatusFilter = button.dataset.wordMapFilter;
      state.parentWordSelectedId = null;
      renderParentWordPanel({ preserveMapScroll: false });
    });
  });

  wordProgressPanel.querySelectorAll("[data-word-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const wordId = Number(button.dataset.wordId);
      state.parentWordSelectedId = wordId;
      renderParentWordPanel({ focusWordId: wordId });
    });
  });

  wordProgressPanel.querySelector("#closeWordSelection")?.addEventListener("click", () => {
    state.parentWordSelectedId = null;
    renderParentWordPanel();
  });

  if (focusWordId) {
    wordProgressPanel.querySelector(`[data-word-id="${focusWordId}"]`)?.focus({ preventScroll: true });
  }
}

function renderStudyPlanMini() {
  if (!state.overview) {
    return;
  }

  const today = getStudyDisplayToday();
  const targets = state.overview.config.dailyTargets;

  studyPlanMini.className = "study-plan-mini";
  studyPlanMini.innerHTML = `
    <div class="mini-line timer-line"><strong>${state.studyElapsedSeconds}</strong> 秒学习</div>
    <div class="mini-line"><strong>${numberValue(today.cards)}</strong> 次回答</div>
    <div class="mini-line"><strong>${numberValue(today.recognizeCards)}/${targets.recognize}</strong> 认词</div>
    <div class="mini-line"><strong>${numberValue(today.listenCards)}/${targets.listen}</strong> 听词</div>
    <div class="mini-line"><strong>${numberValue(today.spellCards)}/${targets.spell}</strong> 拼写</div>
  `;
}

function playCardAudio() {
  const card = state.currentCard;

  if (!card) {
    return;
  }

  playTermAudio(card.baseTerm, card.audioUrl);
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
}

function startMistakeReviewPause(button, card, correctText) {
  clearMistakeReviewPause();

  const token = state.mistakeReviewSpeechToken;
  const unlockAt = Date.now() + getMistakeReviewMs(correctText);
  const updateButton = () => {
    const secondsLeft = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
    button.textContent = `先看一遍 ${secondsLeft}s`;
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
        return `<span class="spell-char fixed-char">${escapeHtml(item.char)}</span>`;
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
      <div class="spelling-review-label">看清拼写，再写一遍</div>
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
            <span class="badge frequency-score">${escapeHtml(frequencyLabel(card.frequencyScore))}</span>
            <span class="badge badge-neutral">${escapeHtml(card.theme)}</span>
            <span class="badge badge-neutral">${formatPartOfSpeechLabel(card.partOfSpeech)}</span>
            <span class="badge badge-neutral">${escapeHtml(card.prompt)}</span>
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
      <p>系统会优先推送未接触的高频词和到期复习词。</p>
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
    const spellingReviewMarkup =
      state.currentCard.mode === "spell" ? renderSpellingReviewMarkup(correctText) : "";
    const guidanceText =
      state.currentCard.mode === "spell"
        ? "停一下，跟读并看清拼写，再进入下一题。"
        : "停一下，跟读一遍，再进入下一题。";

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
          ${spellingReviewMarkup}
          <div class="answer-guidance">${escapeHtml(guidanceText)}</div>
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
