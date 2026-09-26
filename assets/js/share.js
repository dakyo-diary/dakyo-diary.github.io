/**
 * Small "공유" buttons on the blog.
 *
 * Uses the Web Share API where available (phones: Slack, KakaoTalk, …) and
 * falls back to copying the link to the clipboard with a short notice.
 */
(function () {
  "use strict";

  /**
   * Copies text to the clipboard, with a textarea fallback for older browsers.
   *
   * @param {string} text - Text to copy.
   * @returns {Promise<void>} Resolves when copied.
   */
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  /**
   * Briefly swaps a button's label to confirm the action.
   *
   * @param {HTMLElement} btn - The share button.
   * @param {string} label - Temporary label.
   */
  function flash(btn, label) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = label;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = original; }, 1600);
  }

  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".share-btn");
    if (!btn) return;
    ev.preventDefault();
    const url = new URL(btn.dataset.url, location.href).href;
    const title = btn.dataset.title || document.title;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;  // user closed the sheet
      }
    }
    try {
      await copy(url);
      flash(btn, "복사됨");
    } catch {
      flash(btn, "복사 실패");
    }
  });
})();
