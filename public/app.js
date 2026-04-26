const state = {
  isAdmin: window.location.pathname === "/admin",
  overview: null,
  currentCard: null,
  selectedChoiceId: null,
  startedAt: 0,
  feedback: null,
  prefetchedNext: null,
  prefetchedNextPromise: null,
  parentWords: [],
  parentWordsNeedRefresh: true,
  parentWordsLoading: false,
  parentWordFilter: "",
  parentAddSubmitting: false,
  parentAddFeedback: null,
  answerSubmitting: false,
  cardLoading: false,
  studyTimerStartedAt: 0,
  studyTimerId: null,
  studyElapsedSeconds: 0,
  studyDisplayStats: null,
  auth: null,
  appLoaded: false,
  audioAutoPlayTimer: null,
  encouragement: "",
};

const ENCOURAGEMENTS = [
  "今天学一点点，考试时就会轻松很多。",
  "你不是在赶路，你是在一天天变厉害。",
  "先拿下一个词，再拿下下一个词。",
  "每次认真答一题，都是在给自己加分。",
  "慢一点没有关系，坚持就很了不起。",
  "今天的努力，会变成考场上的自信。",
  "记住一个词，就是向目标走近一步。",
  "不用一下子全会，稳稳往前就很好。",
];

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
const parentInputPanel = document.querySelector("#parentInputPanel");
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

function endStudySession() {
  stopStudyTimer({ reset: true });
  switchView("home");
}

endStudyButton.addEventListener("click", endStudySession);
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
            <div class="hero-metric-value">${today.minutes}/${plan.targetMinutes} 分钟</div>
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
          <div>
            <div class="metric-label">${checkin.monthLabel} 打卡</div>
            <div class="checkin-streak">${checkin.currentStreak} 天</div>
          </div>
          <div class="checkin-best">最佳 ${checkin.bestStreak} 天</div>
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
}

function renderProgress() {
  const { progress, plan, config } = state.overview;
  const spellLevels = (config?.spellPriorityLevels || ["S"]).join(" + ");

  progressPanel.innerHTML = `
    <h2>学习进度</h2>
    <div class="progress-list">
      <div class="progress-item">
        <div class="progress-top">
          <strong>全部词库</strong>
          <span>${progress.overallMastered} / ${progress.totalWords}</span>
        </div>
        <div class="bar"><div class="bar-fill orange" style="width:${formatPercent(progress.overallMastered, progress.totalWords)}"></div></div>
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
    <p class="muted">总词库一共有 ${progress.totalWords} 个词。认词和听词按全部词库统计；${spellLevels} 级会继续进入默写训练。</p>
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
  const { progress, today, parentMessage, cumulative } = state.overview;
  const todayMinutes = formatMinutesValue(today.minutes);
  const cumulativeMinutes = formatMinutesValue(
    cumulative.totalMinutes,
    cumulative.totalElapsedMs
  );

  parentStats.innerHTML = [
    buildMetricCard("学习时长", `${todayMinutes} / ${cumulativeMinutes} 分钟`, `今日 / 累计，今天完成 ${today.cards} 次答题`),
    buildMetricCard("累计答题次数", `${cumulative.totalAttempts} 次`, `累计学过 ${cumulative.studiedWords} 个词`),
    buildMetricCard("累计掌握词数", `${cumulative.masteredWords} 个`, `总词库 ${progress.totalWords} 个`),
    buildMetricCard("今日正确率", `${today.correctRate}%`, `包含近似拼写的容错`),
    buildMetricCard("全部词库进度", `${progress.coreMastered}/${progress.coreGoalCount}`, `还差 ${progress.coreGap} 个`),
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
    <p class="muted">${parentMessage}</p>
    <p class="muted">认词和听词按全部词库统计；拼写只统计当前需要进入默写训练的词。</p>
  `;

  mistakePanel.innerHTML = `
    <h2>需要多刷几次的词</h2>
    ${
      state.overview.hardWords.length === 0
        ? `<p class="muted">目前还没有明显的薄弱词。</p>`
        : `<div class="list">
            ${state.overview.hardWords
              .map(
                (item) => `
                  <div class="list-item">
                    <div>
                      <strong>${item.term}</strong>
                      <div class="word-meta">${item.meaning || "释义会在首次学习时自动补全"}</div>
                    </div>
                    <div>${item.mastery}</div>
                  </div>
                `
              )
              .join("")}
          </div>`
    }
  `;
}

function renderParentInputPanel() {
  const feedback = state.parentAddFeedback;
  const feedbackMarkup = feedback
    ? `
      <div class="parent-add-feedback ${feedback.type === "error" ? "error" : feedback.type === "success" ? "success" : ""}">
        ${escapeHtml(feedback.message)}
      </div>
    `
    : "";

  parentInputPanel.innerHTML = `
    <div class="parent-add-header">
      <div>
        <h2>家长补充词</h2>
        <div class="muted">把真题、阅读或听力里临时遇到的陌生词加进来，系统会优先安排到后面的学习里。</div>
      </div>
      <div class="parent-add-note">新补充的词默认按重点词处理，会进入认词、听词和默写流程。</div>
    </div>
    <form class="parent-add-form" id="parentAddForm">
      <div class="parent-add-grid">
        <input
          class="parent-add-input"
          id="parentWordTerm"
          placeholder="英文单词或词组，例如 yoghurt"
          autocomplete="off"
        />
        <input
          class="parent-add-input"
          id="parentWordMeaning"
          placeholder="中文释义（可选）"
          autocomplete="off"
        />
      </div>
      <div class="parent-add-actions">
        <button class="primary-btn" type="submit" ${state.parentAddSubmitting ? "disabled" : ""}>
          ${state.parentAddSubmitting ? "正在加入..." : "加入学习词库"}
        </button>
        <div class="muted">如果词库里已经有这个词，就会直接加入优先学习队列。</div>
      </div>
    </form>
    ${feedbackMarkup}
  `;

  parentInputPanel.querySelector("#parentAddForm").addEventListener("submit", submitParentWord);
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
                        ${item.parentAdded ? `<div class="word-flag">家长补充</div>` : ""}
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

  studyPlanMini.className = "study-plan-mini";
  studyPlanMini.innerHTML = `
    <div class="mini-line timer-line"><strong>${state.studyElapsedSeconds}</strong> 秒学习</div>
    <div class="mini-line"><strong>${numberValue(today.cards)}</strong> 次回答</div>
    <div class="mini-line"><strong>${numberValue(today.recognizeCards)}</strong> 次认词</div>
    <div class="mini-line"><strong>${numberValue(today.listenCards)}</strong> 次听词</div>
    <div class="mini-line"><strong>${numberValue(today.spellCards)}</strong> 次拼词</div>
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

  if (card.audioUrl) {
    const audio = new Audio(card.audioUrl);
    audio.play().catch(() => fallbackSpeak(card.baseTerm));
    return;
  }

  fallbackSpeak(card.baseTerm);
}

function fallbackSpeak(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function scheduleAutoPlay() {
  window.clearTimeout(state.audioAutoPlayTimer);
  state.audioAutoPlayTimer = window.setTimeout(() => {
    playCardAudio();
  }, 120);
}

function renderCard(card) {
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
      : `<div class="phonetic">${card.phonetic || "首次学习时会自动补发音信息"}</div>`;

  const exampleLine =
    card.example && card.mode === "recognize"
      ? `<div class="hint-box">例句：${card.example}</div>`
      : "";
  const flowNote =
    card.flowNote
      ? `<div class="hint-box soft">${card.flowNote}</div>`
      : "";
  const modeTip =
    card.mode === "spell"
      ? `${card.chineseMeaning}，输入完成后再提交。`
      : card.mode === "listen"
        ? "系统会自动播放，也可以手动再听一遍。"
        : "先看英文，再选出最合适的中文意思。";

  const optionMarkup =
    card.mode === "spell"
      ? `
        <div class="spell-box">
          <div class="hint-box">提示：${card.hint}</div>
          <input class="spell-input" id="spellInput" placeholder="输入英文后再提交" autocomplete="off" />
          <div class="action-row">
            <button class="secondary-btn" id="audioButton">听发音</button>
            <button class="submit-btn" id="submitButton">提交答案</button>
          </div>
        </div>
      `
      : `
        <div class="option-grid">
          ${card.options
            .map(
              (option) => `
                <button class="option-btn" data-choice="${option.wordId}">
                  ${option.label}
                </button>
              `
            )
            .join("")}
        </div>
        <div class="action-row">
          <button class="secondary-btn" id="audioButton">${card.mode === "listen" ? "再听一遍" : "听发音"}</button>
          <button class="secondary-btn dont-know-btn" id="dontKnowButton">不会</button>
          <button class="submit-btn" id="submitButton">提交答案</button>
        </div>
      `;

  studyPanel.innerHTML = `
    <div class="study-card">
      <div class="card-top">
        <div>
          <div class="badge-row">
            <span class="badge priority-${card.priority.toLowerCase()}">${priorityLabel(card.priority)}</span>
            <span class="badge priority-b">${card.theme}</span>
            <span class="badge priority-c">${formatPartOfSpeechLabel(card.partOfSpeech)}</span>
            <span class="badge priority-c">${card.prompt}</span>
          </div>
          <div class="prompt-title">${promptTitle}</div>
          ${phoneticLine}
        </div>
        <div class="mode-tip">
          ${modeTip}
        </div>
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
    studyPanel.querySelector("#spellInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submitAnswer();
      }
    });
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
    .querySelectorAll("#submitButton, #dontKnowButton, #audioButton, .option-btn, #spellInput")
    .forEach((element) => {
      element.disabled = disabled;
    });
}

function markChoiceResult({ selectedChoiceId, correctWordId, gaveUp }) {
  if (state.currentCard?.mode === "spell") {
    return;
  }

  studyPanel.querySelectorAll(".option-btn").forEach((button) => {
    const choiceId = Number(button.dataset.choice);
    const isCorrect = choiceId === Number(correctWordId);
    const isSelected = choiceId === Number(selectedChoiceId);

    button.classList.remove("selected");
    button.classList.toggle("correct-answer", isCorrect);
    button.classList.toggle("wrong-answer", isSelected && !isCorrect && !gaveUp);

    if (isCorrect || (isSelected && !isCorrect && !gaveUp)) {
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

  state.answerSubmitting = true;
  setAnswerControlsDisabled(true);
  const previousToday = getStudyDisplayToday();

  const payload = {
    wordId: state.currentCard.wordId,
    mode: state.currentCard.mode,
    elapsedMs: Date.now() - state.startedAt,
  };

  if (state.currentCard.mode === "spell") {
    payload.response = studyPanel.querySelector("#spellInput").value.trim();
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

  state.overview = result.overview;
  applyLocalStudyAttempt(payload.mode, previousToday);
  state.parentWordsNeedRefresh = true;
  renderOverview();
  prefetchNextCard();
  markChoiceResult({
    selectedChoiceId: payload.choiceWordId,
    correctWordId: payload.wordId,
    gaveUp: payload.gaveUp,
  });

  const feedbackArea = studyPanel.querySelector("#feedbackArea");
  const cssClass =
    result.evaluation.result === "wrong"
      ? "feedback wrong"
      : result.evaluation.result === "almost"
        ? "feedback almost"
        : "feedback";

  feedbackArea.innerHTML = `
    <div class="${cssClass}">
      <strong>${
        result.evaluation.result === "correct"
          ? "答对了"
          : result.evaluation.result === "almost"
            ? "很接近"
            : "答错了，正确答案看这里"
      }</strong>
      <p>${result.evaluation.note}</p>
      <p>当前状态：${result.masteryLabel}</p>
    </div>
  `;

  const submitButton = studyPanel.querySelector("#submitButton");

  submitButton.disabled = false;
  submitButton.textContent = "下一个";
  submitButton.classList.add("next-ready");
  submitButton.focus({ preventScroll: true });
  submitButton.addEventListener("click", async () => {
    submitButton.disabled = true;
    submitButton.textContent = "正在准备...";
    await loadNextCard();
  }, { once: true });
}

async function loadNextCard({ showLoading = false } = {}) {
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

async function submitParentWord(event) {
  event.preventDefault();

  const termInput = parentInputPanel.querySelector("#parentWordTerm");
  const meaningInput = parentInputPanel.querySelector("#parentWordMeaning");
  const term = termInput.value.trim();
  const meaning = meaningInput.value.trim();

  if (!term) {
    state.parentAddFeedback = {
      type: "error",
      message: "先输入要补充的英文单词或词组。",
    };
    renderParentInputPanel();
    return;
  }

  state.parentAddSubmitting = true;
  state.parentAddFeedback = {
    type: "info",
    message: "正在加入词库，并补齐本地释义和发音缓存…",
  };
  renderParentInputPanel();

  try {
    const payload = await requestJson("/api/parent/words", {
      method: "POST",
      body: JSON.stringify({
        term,
        meaning,
      }),
    });

    state.overview = payload.overview;
    state.parentWordsNeedRefresh = true;
    state.parentAddFeedback = {
      type: "success",
      message:
        payload.action === "created"
          ? `已加入 ${payload.word.term}，后面会优先安排学习。`
          : `词库里已有 ${payload.word.term}，已经加入优先学习队列。`,
    };

    renderOverview();
    await ensureParentWords(true);
  } catch (error) {
    state.parentAddFeedback = {
      type: "error",
      message: "加入失败了，请稍后再试。",
    };
    renderParentInputPanel();
  } finally {
    state.parentAddSubmitting = false;
    renderParentInputPanel();
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
  renderParentInputPanel();
  renderStudyPlanMini();

  if (views.parent.classList.contains("active")) {
    renderParentWordPanel();
  }
}

async function loadAuthenticatedApp() {
  if (state.appLoaded) {
    state.overview = await requestJson("/api/overview");
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

  state.overview = await requestJson("/api/overview");
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
