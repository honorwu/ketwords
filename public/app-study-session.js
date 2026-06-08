export function createStudySessionUi({
  endStudySession,
  escapeHtml,
  numberValue,
  playTermAudio,
  renderStudyPlanMini,
  state,
}) {
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

  return {
    showEndStudyConfirmModal,
    showStudySummaryModal,
    startStudyTimer,
    stopStudyTimer,
  };
}
