const API_BASE = "https://api.ikonoijoy-calendar.notequal.me/";

const GROUP_META = {
  all: { label: "すべて", color: null },
  "equal-love": { label: "＝LOVE", color: "var(--equal-love)" },
  "not-equal-me": { label: "≠ME", color: "var(--not-equal-me)" },
  "nearly-equal-joy": { label: "≒JOY", color: "var(--nearly-equal-joy)" }
};

const CATEGORY_OPTIONS = [
  "握手会",
  "ライブ/イベント",
  "メディア",
  "リリース",
  "誕生日",
  "その他"
];

const CATEGORY_ORDER = {
  "ライブ/イベント": 0,
  "握手会": 1,
  "誕生日": 2,
  "リリース": 3,
  "メディア": 4,
  "その他": 5
};

const GROUP_ORDER = {
  "equal-love": 0,
  "not-equal-me": 1,
  "nearly-equal-joy": 2
};

const WEEKDAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];

const state = {
  year: null,
  month: null,
  group: "all",
  selectedCategories: new Set(),
  selectedDay: null,
  scheduleData: {},
  isLoading: false,
  abortController: null
};

function getTokyoToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

function escapeHtml(text = "") {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeUrl(url = "") {
  try {
    const parsed = new URL(url, window.location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "#";
  } catch {
    return "#";
  }
}

function normalizeCategory(category) {
  const value = String(category || "").trim();
  return CATEGORY_OPTIONS.includes(value) ? value : "その他";
}

function getMonthDays(year, month) {
  return new Date(year, month, 0).getDate();
}

function isTodayCell(year, month, day) {
  const today = getTokyoToday();
  return year === today.year && month === today.month && day === today.day;
}

function isAllCategoriesMode() {
  return state.selectedCategories.size === 0;
}

function getAllEvents() {
  return Object.values(state.scheduleData).flat();
}

function getEventsForDay(day) {
  return state.scheduleData[String(day)] || [];
}

function applyFilters(events, options = {}) {
  const { ignoreGroup = false, ignoreCategories = false } = options;

  let result = [...events];

  if (!ignoreGroup && state.group !== "all") {
    result = result.filter(event => event.tag === state.group);
  }

  if (!ignoreCategories && state.selectedCategories.size > 0) {
    result = result.filter(event => state.selectedCategories.has(normalizeCategory(event.category)));
  }

  return result;
}

function sortEventsByCategory(events) {
  return [...events].sort((a, b) => {
    const categoryA = normalizeCategory(a.category);
    const categoryB = normalizeCategory(b.category);

    const categoryOrderA = CATEGORY_ORDER[categoryA] ?? 999;
    const categoryOrderB = CATEGORY_ORDER[categoryB] ?? 999;

    if (categoryOrderA !== categoryOrderB) {
      return categoryOrderA - categoryOrderB;
    }

    const groupOrderA = GROUP_ORDER[a.tag] ?? 999;
    const groupOrderB = GROUP_ORDER[b.tag] ?? 999;

    if (groupOrderA !== groupOrderB) {
      return groupOrderA - groupOrderB;
    }

    return (a.title || "").localeCompare(b.title || "", "ja");
  });
}

function countByGroup(events) {
  return events.reduce((acc, event) => {
    acc.all += 1;
    if (acc[event.tag] !== undefined) {
      acc[event.tag] += 1;
    }
    return acc;
  }, {
    all: 0,
    "equal-love": 0,
    "not-equal-me": 0,
    "nearly-equal-joy": 0
  });
}

function countByCategory(events) {
  const initial = { all: 0 };
  CATEGORY_OPTIONS.forEach(category => {
    initial[category] = 0;
  });

  return events.reduce((acc, event) => {
    const category = normalizeCategory(event.category);
    acc.all += 1;
    acc[category] += 1;
    return acc;
  }, initial);
}

function getDaysWithData() {
  return Object.keys(state.scheduleData)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function getDefaultSelectedDay() {
  const today = getTokyoToday();
  const totalDays = getMonthDays(state.year, state.month);

  if (
    state.year === today.year &&
    state.month === today.month &&
    today.day <= totalDays
  ) {
    return today.day;
  }

  const daysWithData = getDaysWithData();
  return daysWithData[0] || 1;
}

function formatDate(day) {
  const weekday = new Date(state.year, state.month - 1, day).getDay();
  return `${state.year}.${pad2(state.month)}.${pad2(day)}（${WEEKDAYS_JP[weekday]}）`;
}

function getCellAccent(events) {
  const tags = [...new Set(events.map(item => item.tag).filter(Boolean))];

  if (!tags.length) return "";

  const colors = tags
    .map(tag => GROUP_META[tag]?.color)
    .filter(Boolean);

  if (colors.length === 1) {
    return colors[0];
  }

  return `linear-gradient(135deg, ${colors.join(", ")})`;
}

function setActiveGroupButtons() {
  document.querySelectorAll(".filter-btn[data-group]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.group === state.group);
  });
}

function setMonthNavDisabled(disabled) {
  ["prev-month", "current-month", "next-month"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function renderCategoryFilters() {
  const container = document.getElementById("category-filter-container");
  if (!container) return;

  const allEvents = getAllEvents();

  const categoryBaseEvents = applyFilters(allEvents, { ignoreCategories: true });
  const categoryCounts = countByCategory(categoryBaseEvents);

  const html = [
    `
    <button
      class="filter-btn category-filter-btn ${isAllCategoriesMode() ? "active" : ""}"
      data-category="all"
      type="button"
    >
      全カテゴリ
      <span class="count">${categoryCounts.all}</span>
    </button>
    `,
    ...CATEGORY_OPTIONS.map(category => `
        <button
          class="filter-btn category-filter-btn ${state.selectedCategories.has(category) ? "active" : ""}"
          data-category="${escapeAttr(category)}"
          type="button"
          aria-pressed="${state.selectedCategories.has(category) ? "true" : "false"}"
        >
          ${escapeHtml(category)}
          <span class="count">${categoryCounts[category]}</span>
        </button>
        `)
  ];

  container.innerHTML = html.join("");
}

function setLoadingCounts(value = "…") {
  document.getElementById("count-all").textContent = value;
  document.getElementById("count-equal-love").textContent = value;
  document.getElementById("count-not-equal-me").textContent = value;
  document.getElementById("count-nearly-equal-joy").textContent = value;
  document.getElementById("month-total").textContent = value;
  document.getElementById("month-visible").textContent = value;
}

function updateCounts() {
  const allEvents = getAllEvents();

  const groupBaseEvents = applyFilters(allEvents, { ignoreGroup: true });
  const groupTotals = countByGroup(groupBaseEvents);

  document.getElementById("count-all").textContent = groupTotals.all;
  document.getElementById("count-equal-love").textContent = groupTotals["equal-love"];
  document.getElementById("count-not-equal-me").textContent = groupTotals["not-equal-me"];
  document.getElementById("count-nearly-equal-joy").textContent = groupTotals["nearly-equal-joy"];

  document.getElementById("month-title").textContent = `${state.year}年${state.month}月`;
  document.getElementById("month-total").textContent = allEvents.length;
  document.getElementById("month-visible").textContent = applyFilters(allEvents).length;

  renderCategoryFilters();
}

function renderLoading() {
  setActiveGroupButtons();
  setMonthNavDisabled(true);
  setLoadingCounts("…");

  document.getElementById("month-title").textContent = `${state.year}年${state.month}月`;

  const categoryContainer = document.getElementById("category-filter-container");
  if (categoryContainer) {
    categoryContainer.innerHTML = `
        <button class="filter-btn category-filter-btn active" disabled type="button">
          読み込み中...
          <span class="count">…</span>
        </button>
        `;
  }

  document.getElementById("calendar-grid").innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <h4>読み込み中...</h4>
      <p>${state.year}年${pad2(state.month)}月のデータを取得しています。</p>
    </div>
    `;

  document.getElementById("selected-date-title").textContent = `${pad2(state.month)}/--`;
  document.getElementById("selected-date-meta").textContent = "データを読み込み中...";

  document.getElementById("event-list").innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <h4>読み込み中...</h4>
    </div>
    `;
}

function renderError(message) {
  state.scheduleData = {};

  setActiveGroupButtons();
  updateCounts();
  setMonthNavDisabled(false);

  document.getElementById("calendar-grid").innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <h4>データ取得に失敗しました</h4>
      <p>${escapeHtml(message)}</p>
    </div>
    `;

  document.getElementById("selected-date-title").textContent = `${pad2(state.month)}/--`;
  document.getElementById("selected-date-meta").textContent = `${state.year}.${pad2(state.month)} の読み込みに失敗しました`;

  document.getElementById("event-list").innerHTML = `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <h4>予定を表示できません</h4>
      <p>API サーバーの起動状態、または CORS 設定を確認してください。</p>
    </div>
    `;
}

function renderCalendar() {
  const calendarGrid = document.getElementById("calendar-grid");
  const firstDayOfWeek = new Date(state.year, state.month - 1, 1).getDay();
  const totalDays = getMonthDays(state.year, state.month);

  let html = "";

  for (let i = 0; i < firstDayOfWeek; i++) {
    html += `<div class="calendar-day blank" aria-hidden="true"></div>`;
  }

  for (let day = 1; day <= totalDays; day++) {
    const allEvents = getEventsForDay(day);
    const filteredEvents = sortEventsByCategory(applyFilters(allEvents));
    const weekday = new Date(state.year, state.month - 1, day).getDay();
    const isToday = isTodayCell(state.year, state.month, day);

    const accent = getCellAccent(filteredEvents);

    const dayClasses = [
      "calendar-day",
      day === state.selectedDay ? "selected" : "",
      allEvents.length > 0 && filteredEvents.length === 0 ? "filtered-empty" : ""
    ].filter(Boolean).join(" ");

    let previewHtml = "";

    if (filteredEvents.length > 0) {
      previewHtml = `
            <div class="event-preview-list">
              ${filteredEvents.slice(0, 3).map(event => `
                <div class="mini-event ${event.tag}">
                  <span class="mini-dot"></span>
                  <span class="mini-event-text">${escapeHtml(event.title)}</span>
                </div>
              `).join("")}
              ${filteredEvents.length > 3 ? `<div class="more-note">+${filteredEvents.length - 3} more</div>` : ""}
            </div>
            `;
    } else {
      previewHtml = `
            <div class="day-empty">
              ${allEvents.length > 0 ? "現在のフィルターでは表示なし" : "予定なし"}
            </div>
            `;
    }

    html += `
            <article
              class="${dayClasses}"
              data-day="${day}"
              tabindex="0"
              role="button"
              aria-label="${formatDate(day)}"
              style="--cell-accent: ${accent};"
            >
              <div class="day-head">
                <div class="day-number-wrap">
                  <div class="day-number-line">
                    <div class="day-number">${day}</div>
                    ${isToday ? `<span class="today-badge">Today</span>` : ""}
                  </div>
                  <div class="day-weekday">${WEEKDAYS_JP[weekday]}</div>
                </div>
                <div class="day-count">${filteredEvents.length}</div>
              </div>
              ${previewHtml}
            </article>
        `;
  }

  calendarGrid.innerHTML = html;
}

function renderSelectedDay() {
  const selectedTitle = document.getElementById("selected-date-title");
  const selectedMeta = document.getElementById("selected-date-meta");
  const eventList = document.getElementById("event-list");

  const allEvents = getEventsForDay(state.selectedDay);
  const visibleEvents = sortEventsByCategory(applyFilters(allEvents));
  const isTodaySelected = isTodayCell(state.year, state.month, state.selectedDay);

  selectedTitle.innerHTML = `
        ${pad2(state.month)}/${pad2(state.selectedDay)}
        ${isTodaySelected ? `<span class="today-badge">Today</span>` : ""}
    `;

  selectedMeta.textContent =
    `${formatDate(state.selectedDay)}${isTodaySelected ? " ・ Today" : ""} ・ 全${allEvents.length}件 / 表示${visibleEvents.length}件`;

  if (!visibleEvents.length) {
    eventList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h4>表示できる予定がありません</h4>
          <p>${allEvents.length > 0 ? "この日は現在のフィルター条件に一致する予定がありません。" : "この日の予定はありません。"}</p>
        </div>
        `;
    return;
  }

  eventList.innerHTML = visibleEvents.map(event => `
    <article class="event-card ${event.tag}">
      <a href="${safeUrl(event.href)}" target="_blank" rel="noopener noreferrer">
        <div class="event-header">
          <span class="group-badge ${event.tag}">
            ${escapeHtml(GROUP_META[event.tag]?.label || "UNKNOWN")}
          </span>
          <span class="category-badge">
            ${escapeHtml(normalizeCategory(event.category))}
          </span>
          <span class="event-date">
            ${pad2(state.month)}/${pad2(state.selectedDay)}
          </span>
        </div>
        <div class="event-name">${escapeHtml(event.title)}</div>
        <div class="event-footer">
          <div class="detail-link">
            <span>詳細を見る</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
        </div>
      </a>
    </article>
    `).join("");
}

function renderAll() {
  setActiveGroupButtons();
  updateCounts();
  renderCalendar();
  renderSelectedDay();
  setMonthNavDisabled(false);
}

async function loadMonth(year, month, options = {}) {
  const { preferredDay = null } = options;

  if (state.abortController) {
    state.abortController.abort();
  }

  const controller = new AbortController();
  state.abortController = controller;
  state.isLoading = true;
  state.year = year;
  state.month = month;

  renderLoading();

  try {
    const url = `${API_BASE}?year=${year}&month=${pad2(month)}`;
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();

    if (controller.signal.aborted) return;

    state.scheduleData =
      json &&
        typeof json === "object" &&
        json.data &&
        typeof json.data === "object"
        ? json.data
        : {};

    const totalDays = getMonthDays(state.year, state.month);

    if (Number.isInteger(preferredDay)) {
      state.selectedDay = Math.max(1, Math.min(preferredDay, totalDays));
    } else {
      state.selectedDay = getDefaultSelectedDay();
    }

    renderAll();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.selectedDay = 1;
    renderError(error.message || "Unknown error");
  } finally {
    if (state.abortController === controller) {
      state.abortController = null;
    }
    state.isLoading = false;
  }
}

function changeMonth(offset) {
  const date = new Date(state.year, state.month - 1 + offset, 1);
  loadMonth(date.getFullYear(), date.getMonth() + 1, {
    preferredDay: state.selectedDay
  });
}

function bindGroupFilterEvents() {
  document.querySelectorAll(".filter-btn[data-group]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.isLoading) return;
      state.group = btn.dataset.group;
      renderAll();
    });
  });
}

function bindCategoryFilterEvents() {
  const container = document.getElementById("category-filter-container");
  if (!container) return;

  container.addEventListener("click", (event) => {
    if (state.isLoading) return;

    const btn = event.target.closest(".category-filter-btn[data-category]");
    if (!btn) return;

    const category = btn.dataset.category;

    if (category === "all") {
      state.selectedCategories.clear();
    } else {
      if (state.selectedCategories.has(category)) {
        state.selectedCategories.delete(category);
      } else {
        state.selectedCategories.add(category);
      }
    }

    renderAll();
  });
}

function bindCalendarEvents() {
  const calendarGrid = document.getElementById("calendar-grid");

  calendarGrid.addEventListener("click", (event) => {
    if (state.isLoading) return;

    const cell = event.target.closest(".calendar-day[data-day]");
    if (!cell) return;

    state.selectedDay = Number(cell.dataset.day);
    renderCalendar();
    renderSelectedDay();
  });

  calendarGrid.addEventListener("keydown", (event) => {
    if (state.isLoading) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    const cell = event.target.closest(".calendar-day[data-day]");
    if (!cell) return;

    event.preventDefault();
    state.selectedDay = Number(cell.dataset.day);
    renderCalendar();
    renderSelectedDay();
  });
}

function bindMonthEvents() {
  const prevBtn = document.getElementById("prev-month");
  const currentBtn = document.getElementById("current-month");
  const nextBtn = document.getElementById("next-month");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.isLoading) return;
      changeMonth(-1);
    });
  }

  if (currentBtn) {
    currentBtn.addEventListener("click", () => {
      if (state.isLoading) return;
      const today = getTokyoToday();
      loadMonth(today.year, today.month, {
        preferredDay: today.day
      });
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (state.isLoading) return;
      changeMonth(1);
    });
  }
}

function bindScrollTop() {
  const scrollTopBtn = document.getElementById("scroll-top");
  if (!scrollTopBtn) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      scrollTopBtn.classList.add("visible");
    } else {
      scrollTopBtn.classList.remove("visible");
    }
  });

  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function init() {
  const today = getTokyoToday();

  state.year = today.year;
  state.month = today.month;
  state.selectedDay = today.day;

  bindGroupFilterEvents();
  bindCategoryFilterEvents();
  bindCalendarEvents();
  bindMonthEvents();
  bindScrollTop();

  loadMonth(today.year, today.month, {
    preferredDay: today.day
  });
}

document.addEventListener("DOMContentLoaded", init);
