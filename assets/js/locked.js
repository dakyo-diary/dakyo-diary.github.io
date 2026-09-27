/**
 * Unlocks password-protected diary posts in the browser.
 *
 * Each locked post carries `enc` (base64 of 12-byte IV + AES-GCM ciphertext),
 * `enc_salt` and `enc_iter`. The key is PBKDF2-SHA256(password, salt, iter)
 * — the same derivation as the server's `derive_lock_key`. Once a password
 * works, the derived key is kept in localStorage (per salt) so the reader
 * doesn't have to type it again on this device.
 */
(function (root) {
  "use strict";

  const subtle = (root.crypto || require("crypto").webcrypto).subtle;
  const KEY_PREFIX = "diary-lock:";

  /**
   * Decodes base64 to bytes.
   *
   * @param {string} b64 - Base64 text.
   * @returns {Uint8Array} Bytes.
   */
  function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * Encodes bytes as base64.
   *
   * @param {ArrayBuffer} buf - Bytes.
   * @returns {string} Base64 text.
   */
  function toB64(buf) {
    let s = "";
    new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }

  /**
   * Derives the raw AES key bytes from a password.
   *
   * @param {string} password - Shared password.
   * @param {string} saltB64 - Base64 salt.
   * @param {number} iterations - PBKDF2 iterations.
   * @returns {Promise<ArrayBuffer>} 32 key bytes.
   */
  async function deriveKeyBytes(password, saltB64, iterations) {
    const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations }, base, 256);
  }

  /**
   * Decrypts one post payload with raw key bytes.
   *
   * @param {ArrayBuffer} keyBytes - Raw AES key.
   * @param {string} encB64 - Base64 IV + ciphertext.
   * @returns {Promise<object>} The decrypted entry fields.
   * @throws {Error} If the key is wrong or the data was altered.
   */
  async function decryptWithKey(keyBytes, encB64) {
    const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const enc = fromB64(encB64);
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: enc.slice(0, 12) }, key, enc.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /**
   * Decrypts a post payload from the password (derive + decrypt).
   *
   * @param {string} password - Shared password.
   * @param {string} saltB64 - Base64 salt.
   * @param {number} iterations - PBKDF2 iterations.
   * @param {string} encB64 - Base64 IV + ciphertext.
   * @returns {Promise<object>} The decrypted entry fields.
   */
  async function decryptPayload(password, saltB64, iterations, encB64) {
    return decryptWithKey(await deriveKeyBytes(password, saltB64, iterations), encB64);
  }

  /**
   * Decrypts an encrypted photo file (12-byte IV + AES-GCM ciphertext).
   *
   * @param {ArrayBuffer|Uint8Array} keyBytes - Raw AES key.
   * @param {ArrayBuffer|Uint8Array} data - File contents.
   * @returns {Promise<ArrayBuffer>} The JPEG bytes.
   * @throws {Error} If the key is wrong or the data was altered.
   */
  async function decryptBytes(keyBytes, data) {
    const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const bytes = new Uint8Array(data);
    return subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { decryptPayload, decryptBytes };
    return;
  }

  // ── browser ──────────────────────────────────────────────────────────────

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /**
   * Renders plain diary text: blank lines split paragraphs, newlines are breaks.
   *
   * @param {string} text - Entry body.
   * @returns {string} HTML.
   */
  function bodyHtml(text) {
    return text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  /**
   * Renders the body with photo placeholders: `[사진N]` markers become
   * images (still encrypted — see `loadPhotos`), unplaced photos follow the
   * text in number order. Unknown markers stay as text, like on public posts.
   *
   * @param {string} text - Entry body.
   * @param {{num: number, src: string}[]} photos - Encrypted photo files.
   * @returns {string} HTML.
   */
  function bodyWithPhotos(text, photos) {
    const byNum = new Map((photos || []).map((p) => [p.num, p]));
    const placed = new Set();
    const img = (p) => `<img class="locked-photo" data-src="${esc(p.src)}" alt="사진 ${p.num}">`;
    const html = bodyHtml(text).replace(/\[사진(\d+)\]/g, (m, n) => {
      const p = byNum.get(Number(n));
      if (!p) return m;
      placed.add(p.num);
      return img(p);
    });
    const rest = [...byNum.values()].filter((p) => !placed.has(p.num)).sort((a, b) => a.num - b.num);
    return html + rest.map((p) => `<p>${img(p)}</p>`).join("");
  }

  /**
   * Fetches and decrypts the photos inside an unlocked entry.
   *
   * @param {HTMLElement} el - Unlocked entry element.
   * @param {Uint8Array} keyBytes - Raw AES key.
   * @param {string} base - Site base URL.
   */
  async function loadPhotos(el, keyBytes, base) {
    await Promise.all([...el.querySelectorAll("img.locked-photo[data-src]")].map(async (img) => {
      try {
        const res = await fetch(base + img.dataset.src);
        if (!res.ok) throw new Error(String(res.status));
        const jpeg = await decryptBytes(keyBytes, await res.arrayBuffer());
        img.src = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
        img.removeAttribute("data-src");
      } catch {
        img.alt = "사진을 불러오지 못했습니다";
      }
    }));
  }

  /**
   * Builds the unlocked entry markup (mirrors _includes/entry.html / post.html).
   *
   * @param {object} d - Decrypted fields.
   * @param {HTMLElement} el - The locked placeholder (carries data-url, data-single).
   * @returns {string} HTML.
   */
  function entryHtml(d, el) {
    const single = el.dataset.single === "1";
    const url = el.dataset.url;
    const base = el.dataset.base || "";
    // A memo thread: replies follow the root text, like on public posts.
    const replies = (d.replies || []).map((r) => {
      const [date, time] = String(r.at).split(" ");
      const when = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${esc(time || "")}`;
      return `<div class="reply"><p class="reply-time">${when}</p>${bodyWithPhotos(r.body, r.photos)}</div>`;
    }).join("");
    const body = `<div class="entry-body${single ? " single-body" : ""}">${bodyWithPhotos(d.body, d.photos)}${replies}</div>`;
    let head = "";
    if (d.kind === "review") {
      const cat = `<a href="${base}/reviews/${esc(d.category_slug)}/">${esc(d.category)}</a>`;
      const rating = d.rating ? `<span class="rating">★ ${esc(d.rating)}</span>` : "";
      head = single
        ? `<p class="single-meta">${cat}</p><h1 class="single-title">${esc(d.work)}</h1>`
          + (d.rating ? `<p class="single-rating">★ ${esc(d.rating)}<span> / 5</span></p>` : "")
          + (d.auto_title ? "" : `<p class="review-line review-line--single">${esc(d.title)}</p>`)
        : `<p class="review-label">${cat}${rating}</p><h3 class="work-title"><a href="${url}">${esc(d.work)}</a></h3>`
          + (d.auto_title ? "" : `<p class="review-line">${esc(d.title)}</p>`);
    } else {
      if (d.kind === "memo") {
        const memo = `<a href="${base}/memos/">메모</a>`;
        head = single ? `<p class="single-meta">${memo}</p>` : `<p class="review-label">${memo}</p>`;
      }
      if (!d.auto_title) {
        head += single ? `<h1 class="single-title">${esc(d.title)}</h1>`
          : `<h3 class="entry-title"><a href="${url}">${esc(d.title)}</a></h3>`;
      }
    }
    const content = d.spoiler
      ? `<details class="spoiler"><summary>스포일러 포함 · 펼쳐 보기</summary>${body}</details>` : body;
    return `<p class="unlocked-mark">🔓</p>${head}${content}`;
  }

  /**
   * Tries to unlock every locked post on the page.
   *
   * @param {string|null} password - Typed password, or null to use saved keys only.
   * @returns {Promise<boolean>} True if at least one post was unlocked.
   */
  async function unlockAll(password) {
    const nodes = [...document.querySelectorAll(".locked[data-enc]")];
    let any = false;
    const keys = {};
    for (const el of nodes) {
      const { salt, iter, enc } = el.dataset;
      try {
        let keyB64 = keys[salt] || localStorage.getItem(KEY_PREFIX + salt);
        if (!keyB64 && password) keyB64 = toB64(await deriveKeyBytes(password, salt, Number(iter)));
        if (!keyB64) continue;
        const data = await decryptWithKey(fromB64(keyB64), enc);
        keys[salt] = keyB64;
        try { localStorage.setItem(KEY_PREFIX + salt, keyB64); } catch { /* private mode */ }
        el.innerHTML = entryHtml(data, el);
        el.classList.remove("locked");
        el.classList.add("unlocked");
        loadPhotos(el, fromB64(keyB64), el.dataset.base || "");
        any = true;
      } catch {
        if (!password) { try { localStorage.removeItem(KEY_PREFIX + salt); } catch { /* ignore */ } }
      }
    }
    document.querySelectorAll(".lock-form").forEach((f) => { f.hidden = !document.querySelector(".locked[data-enc]"); });
    document.querySelectorAll(".lock-forget").forEach((b) => { b.hidden = !Object.keys(localStorage).some((k) => k.startsWith(KEY_PREFIX)); });
    return any;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.querySelector(".locked[data-enc]")) return;
    await unlockAll(null);
    document.querySelectorAll(".lock-form").forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const input = form.querySelector("input");
        const msg = form.querySelector(".lock-msg");
        const btn = form.querySelector("button");
        btn.disabled = true;
        msg.textContent = "여는 중…";
        const ok = await unlockAll(input.value);
        btn.disabled = false;
        msg.textContent = ok ? "" : "비밀번호가 맞지 않습니다.";
        if (ok) input.value = "";
      });
    });
    document.querySelectorAll(".lock-forget").forEach((b) => {
      b.addEventListener("click", () => {
        Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX)).forEach((k) => localStorage.removeItem(k));
        location.reload();
      });
    });
  });
})(typeof window !== "undefined" ? window : globalThis);
