/**
 * Tap a photo in an entry to view it full screen.
 *
 * Works for public photos and for encrypted ones once `locked.js` has
 * decrypted them (images still without a `src` are ignored). Swipe or use
 * ←/→ to move between photos of the same entry; tap the backdrop, ✕, Esc or
 * the phone's back button to close.
 */
(function () {
  "use strict";

  const SELECTOR = ".entry-body img";
  let box = null;
  let group = [];
  let index = 0;
  let pushed = false;

  /** Builds the overlay once. */
  function build() {
    box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "사진 크게 보기");
    box.hidden = true;
    box.innerHTML = '<img alt=""><button type="button" class="lightbox-close" aria-label="닫기">✕</button><span class="lightbox-count"></span>';
    document.body.append(box);
    box.addEventListener("click", (ev) => { if (ev.target !== box.querySelector("img")) close(); });
    let startX = null;
    box.addEventListener("touchstart", (ev) => { startX = ev.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", (ev) => {
      if (startX === null) return;
      const dx = ev.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });
    document.addEventListener("keydown", (ev) => {
      if (box.hidden) return;
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowRight") step(1);
      else if (ev.key === "ArrowLeft") step(-1);
    });
    window.addEventListener("popstate", () => { if (!box.hidden) { pushed = false; close(); } });
  }

  /** Shows the current photo of the group. */
  function show() {
    const src = group[index];
    const img = box.querySelector("img");
    img.src = src.currentSrc || src.src;
    img.alt = src.alt || "";
    box.querySelector(".lightbox-count").textContent = group.length > 1 ? `${index + 1} / ${group.length}` : "";
  }

  /**
   * Moves to the next/previous photo of the entry.
   *
   * @param {number} dir - +1 or -1.
   */
  function step(dir) {
    if (group.length < 2) return;
    index = (index + dir + group.length) % group.length;
    show();
  }

  /**
   * Opens the viewer on an image.
   *
   * @param {HTMLImageElement} img - Tapped image.
   */
  function open(img) {
    if (!box) build();
    const entry = img.closest(".entry-main, .single, article") || document;
    group = [...entry.querySelectorAll(SELECTOR)].filter((i) => i.getAttribute("src"));
    index = Math.max(0, group.indexOf(img));
    show();
    box.hidden = false;
    document.documentElement.classList.add("lightbox-open");
    requestAnimationFrame(() => box.classList.add("is-open"));
    // Android back button closes the viewer instead of leaving the page.
    history.pushState({ lightbox: true }, "");
    pushed = true;
  }

  /** Closes the viewer. */
  function close() {
    if (!box || box.hidden) return;
    box.classList.remove("is-open");
    box.hidden = true;
    document.documentElement.classList.remove("lightbox-open");
    if (pushed) { pushed = false; history.back(); }
  }

  document.addEventListener("click", (ev) => {
    const img = ev.target.closest && ev.target.closest(SELECTOR);
    if (!img || !img.getAttribute("src") || (box && box.contains(img))) return;
    ev.preventDefault();
    open(img);
  });
})();
