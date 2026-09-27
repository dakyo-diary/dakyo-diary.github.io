/**
 * Writing heatmap ("잔디") for the blog home page.
 *
 * Reads the post list embedded by `_includes/heatmap.html` (KST date, time,
 * URL, label per published post), draws the last 53 weeks as rows
 * (Sunday → Saturday, newest week on top) shaded by posts per day, and shows
 * the current streak and this year's total. Only the latest few weeks are
 * shown until "이전 기록 펼치기". Tapping a day opens its post, or lists them
 * when there are several.
 *
 * The pure helpers are exported for Node so they can be unit tested.
 */
(function () {
  "use strict";

  const DAY_MS = 86400000;
  const WEEKS = 53;

  /** @param {string} s - "YYYY-MM-DD". @returns {number} UTC ms. */
  const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  /** @param {number} ms - UTC ms. @returns {string} "YYYY-MM-DD". */
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => fmt(parse(s) + n * DAY_MS);

  /**
   * Counts posts per day.
   *
   * @param {{d: string}[]} posts - Posts with a KST "YYYY-MM-DD" date.
   * @returns {Map<string, number>} Day → count.
   */
  function dayCounts(posts) {
    const m = new Map();
    posts.forEach((p) => m.set(p.d, (m.get(p.d) || 0) + 1));
    return m;
  }

  /**
   * Week columns (Sunday first) ending with the week of `today`.
   *
   * @param {string} today - "YYYY-MM-DD" (KST).
   * @param {number} [weeks=53] - Number of columns.
   * @returns {(string|null)[][]} Columns of 7 days; days after today are null.
   */
  function buildGrid(today, weeks = WEEKS) {
    const t = parse(today);
    const start = t - new Date(t).getUTCDay() * DAY_MS - (weeks - 1) * 7 * DAY_MS;
    return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (__, d) => {
      const ms = start + (w * 7 + d) * DAY_MS;
      return ms > t ? null : fmt(ms);
    }));
  }

  /**
   * Shade level for a day's count.
   *
   * @param {number} count - Posts that day.
   * @returns {number} 0–4.
   */
  function level(count) {
    return count <= 0 ? 0 : Math.min(4, count);
  }

  /**
   * Consecutive writing days ending today (or yesterday, if nothing yet today).
   *
   * @param {Map<string, number>} counts - From dayCounts.
   * @param {string} today - "YYYY-MM-DD" (KST).
   * @returns {number} Streak length in days.
   */
  function streak(counts, today) {
    let day = counts.get(today) ? today : addDays(today, -1);
    let n = 0;
    while (counts.get(day)) {
      n += 1;
      day = addDays(day, -1);
    }
    return n;
  }

  /**
   * Posts written in a calendar year.
   *
   * @param {Map<string, number>} counts - From dayCounts.
   * @param {number} year - e.g. 2026.
   * @returns {number} Total.
   */
  function yearTotal(counts, year) {
    let n = 0;
    counts.forEach((c, day) => { if (day.startsWith(`${year}-`)) n += c; });
    return n;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { dayCounts, buildGrid, level, streak, yearTotal };
    return;
  }

  // ── browser ──────────────────────────────────────────────────────────────

  // Rows shown before "이전 기록 펼치기" (newest weeks).
  const VISIBLE_WEEKS = 5;
  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

  /** Today's date in Korea, whatever the reader's time zone. */
  function todayKst() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  }

  /** @param {string} day - "YYYY-MM-DD". @returns {string} "9월 26일". */
  const korDate = (day) => `${+day.slice(5, 7)}월 ${+day.slice(8, 10)}일`;

  /**
   * Renders the heatmap into its section: one row per week (Sunday → Saturday),
   * newest week on top; only the latest VISIBLE_WEEKS rows until expanded.
   *
   * @param {HTMLElement} root - `.heatmap` section holding the JSON data.
   */
  function render(root) {
    let posts;
    try {
      posts = JSON.parse(root.querySelector(".heatmap-data").textContent);
    } catch {
      return;
    }
    const today = todayKst();
    const counts = dayCounts(posts);
    const byDay = new Map();
    posts.forEach((p) => { if (!byDay.has(p.d)) byDay.set(p.d, []); byDay.get(p.d).push(p); });
    const weeks = buildGrid(today).reverse();
    const days = streak(counts, today);

    const summary = document.createElement("p");
    summary.className = "heatmap-summary";
    summary.innerHTML = `<span class="heatmap-streak"></span><span class="heatmap-total"></span>`;
    summary.querySelector(".heatmap-streak").textContent = days ? `🔥 ${days}일 연속` : "오늘 첫 줄을 적어 볼까요";
    summary.querySelector(".heatmap-total").textContent = `올해 ${yearTotal(counts, +today.slice(0, 4))}개의 글`;

    const grid = document.createElement("div");
    grid.className = "heatmap-grid";
    grid.append(Object.assign(document.createElement("span"), { className: "heatmap-corner" }));
    WEEKDAY_LABELS.forEach((wd) => grid.append(Object.assign(document.createElement("span"), { className: "heatmap-wd", textContent: wd })));

    weeks.forEach((week, row) => {
      const old = row >= VISIBLE_WEEKS;
      // Month label on the row where a month begins (and on the top row).
      const label = document.createElement("span");
      label.className = "heatmap-month";
      const first = week.find((d) => d && d.endsWith("-01"));
      if (first || row === 0) label.textContent = `${+(first || week.find(Boolean)).slice(5, 7)}월`;
      if (old) label.dataset.old = "";
      grid.append(label);
      week.forEach((day) => {
        const n = day ? counts.get(day) || 0 : 0;
        const cell = document.createElement(n ? "button" : "span");
        cell.className = `heatmap-cell l${level(n)}${day ? "" : " future"}${day === today ? " today" : ""}`;
        if (day) {
          cell.title = `${korDate(day)} · ${n ? `글 ${n}개` : "글 없음"}`;
          cell.setAttribute("aria-label", cell.title);
        }
        if (n) {
          cell.type = "button";
          cell.dataset.day = day;
        }
        if (old) cell.dataset.old = "";
        grid.append(cell);
      });
    });

    const more = document.createElement("button");
    more.type = "button";
    more.className = "heatmap-more";
    const setExpanded = (on) => {
      root.classList.toggle("expanded", on);
      more.textContent = on ? "접기 ▴" : "이전 기록 펼치기 ▾";
      more.setAttribute("aria-expanded", String(on));
    };
    more.addEventListener("click", () => setExpanded(!root.classList.contains("expanded")));
    setExpanded(false);

    const legend = document.createElement("p");
    legend.className = "heatmap-legend";
    legend.innerHTML = "<span>적음</span>" + [0, 1, 2, 3, 4].map((l) => `<i class="heatmap-cell l${l}"></i>`).join("") + "<span>많음</span>";

    const foot = document.createElement("div");
    foot.className = "heatmap-foot";
    foot.append(more, legend);

    const list = document.createElement("div");
    list.className = "heatmap-day";
    list.hidden = true;

    grid.addEventListener("click", (ev) => {
      const cell = ev.target.closest("button.heatmap-cell");
      if (!cell) return;
      const items = byDay.get(cell.dataset.day) || [];
      if (items.length === 1) { location.href = items[0].u; return; }
      list.hidden = false;
      list.replaceChildren(
        Object.assign(document.createElement("p"), { className: "heatmap-day-title", textContent: `${korDate(cell.dataset.day)}의 기록` }),
        ...items.slice().sort((a, b) => a.t.localeCompare(b.t)).map((p) => {
          const a = document.createElement("a");
          a.href = p.u;
          a.textContent = `${p.t} · ${p.l}`;
          return a;
        }),
      );
    });

    root.append(summary, grid, foot, list);
    root.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".heatmap").forEach(render);
  });
})();
