/* ---------------- Data layer ---------------- */
const STORAGE_KEY = "fleetlog_v1";
const SETTINGS_KEY = "fleetlog_settings_v1";
const CATEGORIES = [
  { key: "maintenance", get label() { return t("cat_maintenance"); } },
  { key: "insurance", get label() { return t("cat_insurance"); } },
  { key: "inspection", get label() { return t("cat_inspection"); } }
];

const CATEGORY_ICONS = {
  maintenance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z"/></svg>',
  insurance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>',
  inspection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 3.5h6v2H9z" fill="currentColor" stroke="none"/><path d="M9 12l2 2 4-4"/></svg>'
};

// Every event repeats yearly: Next due is one year after Last done, and Renew moves on one year.
const REPEAT_YEARLY = 12;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Accepts saved data or a backup file and returns a clean { vehicles } object, or null if it
// isn't My Fleet data at all. Fills in anything missing (ids, event lists) so a partial or
// hand-edited file can't crash the app, and drops broken entries.
function normalizeData(raw) {
  if (!raw || !Array.isArray(raw.vehicles)) return null;
  const str = v => (v === undefined || v === null) ? "" : String(v);
  const date = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
  const seen = new Set();
  const freshId = id => { let x = (typeof id === "string" && id) ? id : uid(); while (seen.has(x)) x = uid(); seen.add(x); return x; };
  const vehicles = raw.vehicles.filter(v => v && typeof v === "object").map(v => {
    const items = {};
    CATEGORIES.forEach(c => {
      const list = v.items && Array.isArray(v.items[c.key]) ? v.items[c.key] : [];
      // attachment belonged to the removed photo/document feature: drop it
      // repeatMonths belonged to the per-event repeat setting (now: every event is yearly)
      items[c.key] = list.filter(i => i && typeof i === "object").map(({ attachment, repeatMonths, ...i }) => ({
        ...i, id: freshId(i.id), label: str(i.label) || t("untitled"), dueDate: date(i.dueDate), lastDate: date(i.lastDate),
        notes: str(i.notes), done: i.done === true
      }));
    });
    const { photo, ...rest } = v;   // vehicle photos were removed too
    return { ...rest, id: freshId(v.id), name: str(v.name) || t("unnamed_vehicle"), regDate: date(v.regDate),
      registration: str(v.registration), vin: str(v.vin), note: str(v.note), items };
  });
  return { vehicles };
}

let dataLoadProblem = false;
let hadLegacyFields = false;   // saved data still mentions removed photos/documents
function loadData() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (raw) {
    try {
      const data = normalizeData(JSON.parse(raw));
      if (data) { hadLegacyFields = /"(photo|attachment)"\s*:/.test(raw); return data; }
    } catch (e) {}
    // Saved data exists but can't be read: keep one copy so the next save doesn't destroy it.
    try { if (!localStorage.getItem(STORAGE_KEY + "_unreadable")) localStorage.setItem(STORAGE_KEY + "_unreadable", raw); } catch (e) {}
    dataLoadProblem = true;
  }
  return { vehicles: [] };
}
// Saves on the phone first (works offline), then sends the change to the cloud account.
// Pass false for internal tidy-ups that aren't a user change.
function saveData(sync = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (e) {
    showToast(t("save_failed"));
    return false;
  }
  if (sync) markDirty();
  return true;
}

const DEFAULT_SETTINGS = { notifications: false, leadDays: 30, theme: "auto", lang: "bg" };
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) { const st = JSON.parse(raw); if (st && typeof st === "object") return { ...DEFAULT_SETTINGS, ...st }; }
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {} }

const state = {
  tab: "home",          // bottom menu: home | upcoming | settings
  data: loadData(),
  settings: loadSettings(),
  activeVehicleId: null,
  editing: null // { vehicleId, category, itemId | null }
};

/* ---------------- Date helpers ----------------
   All dates are the phone's LOCAL date. (toISOString() is UTC, which in Bulgaria
   is a day behind between midnight and 2-3am.) */
function localISO(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
// Adds whole months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
function addMonthsISO(dateStr, months) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(y, m - 1 + months, 1);
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return localISO(t);
}
// Dates as numbers: 05.12.2026 in Bulgarian, 05/12/2026 in English.
function numericDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return LANG === "bg" ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
}
function refreshDateFields() {
  document.querySelectorAll(".date-field").forEach(f => {
    const input = f.querySelector("input"), text = f.querySelector(".date-text");
    text.textContent = input.value ? numericDate(input.value) : t("date_ph");
    text.classList.toggle("empty", !input.value);
  });
}
document.addEventListener("input", (e) => { if (e.target.closest && e.target.closest(".date-field")) refreshDateFields(); });
document.addEventListener("change", (e) => { if (e.target.closest && e.target.closest(".date-field")) refreshDateFields(); });
function formatDate(dateStr) {
  if (LANG === "bg") return numericDate(dateStr);
  return new Date(dateStr + "T00:00:00").toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}
// A completed event (Done + Save): grayed out, never overdue, no reminders.
function isDone(item) { return item.done === true; }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.round((due - today) / 86400000);
}
// "Due soon" (amber) uses the same window as the reminders: Settings > Remind me.
function soonDays() { return [7, 14, 30].includes(state.settings.leadDays) ? state.settings.leadDays : 30; }
/* ---------------- Rendering ---------------- */
const mainEl = document.getElementById("main");
const toastEl = document.getElementById("toast");

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

/* ---------------- Vehicle type icons ----------------
   Predesigned side-profile silhouettes (viewBox 0 0 64 40, drawn in currentColor).
   Vehicles without a saved type fall back to the sedan. */
// Inner SVG markup for each vehicle type (viewBox 0 0 64 40, drawn in currentColor).
// Simple filled side views; every vehicle uses the same wheel style.
const sedan = `<path fill-rule="evenodd" d="M4 29V23q0-3.6 3.6-4.2L17 17.4 23.2 10.4Q24.4 9 26.2 9H39q1.8 0 3 1.3l6.6 7 7.8 1.6Q60 19.6 60 23v6h-3.5a8.5 8.5 0 0 0-17 0H24.5a8.5 8.5 0 0 0-17 0Z
M20.6 17l4.2-5q.5-.6 1.3-.6h4.4V17ZM33 11.4h5.6q.8 0 1.3.5l5 5.1H33Z"/><path fill-rule="evenodd" d="M10 29a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM13.72 29a2.28 2.28 0 1 0 4.56 0a2.28 2.28 0 1 0 -4.56 0Z"/><path fill-rule="evenodd" d="M42 29a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM45.72 29a2.28 2.28 0 1 0 4.56 0a2.28 2.28 0 1 0 -4.56 0Z"/>`;

const suv = `<path fill-rule="evenodd" d="M3.5 29V13q0-5.5 5.5-5.5h26.6q2 0 3.3 1.5L45 16.2l11.6 1.6Q61 18.4 61 22.4V29h-3.5a9 9 0 0 0-18 0H24.5a9 9 0 0 0-18 0Z
M8.5 15.6v-3.3q0-2 2-2H20v5.3ZM23 10.3h7v5.3h-7ZM33 10.3h2.2q.9 0 1.5.7l4.1 4.6H33Z"/><path fill-rule="evenodd" d="M9 29a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0ZM13.03 29a2.47 2.47 0 1 0 4.94 0a2.47 2.47 0 1 0 -4.94 0Z"/><path fill-rule="evenodd" d="M42 29a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0ZM46.03 29a2.47 2.47 0 1 0 4.94 0a2.47 2.47 0 1 0 -4.94 0Z"/>`;

const motorbike = `<path fill-rule="evenodd" d="M5 28a7 7 0 1 0 14 0a7 7 0 1 0 -14 0ZM9.34 28a2.66 2.66 0 1 0 5.32 0a2.66 2.66 0 1 0 -5.32 0Z"/><path fill-rule="evenodd" d="M45 28a7 7 0 1 0 14 0a7 7 0 1 0 -14 0ZM49.34 28a2.66 2.66 0 1 0 5.32 0a2.66 2.66 0 1 0 -5.32 0Z"/>
<path d="M14 17.5q0-2.5 2.5-2.5H28l2-3.2q.9-1.3 2.4-1.3h7.4q1.7 0 2.1 1.6L43 17H38.5l-2.5 9h-10.5L22 20.5H16.5Q14 20.5 14 17.5Z"/>
<path d="M18.6 26.2l5.6-1.7M42 13l6.6 9.9M40 9.5h5.5M42.6 9.5l-.6 3.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;

const scooter = `<path fill-rule="evenodd" d="M8.5 29.5a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0ZM11.91 29.5a2.09 2.09 0 1 0 4.18 0a2.09 2.09 0 1 0 -4.18 0Z"/><path fill-rule="evenodd" d="M45.5 29.5a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0ZM48.91 29.5a2.09 2.09 0 1 0 4.18 0a2.09 2.09 0 1 0 -4.18 0Z"/>
<path d="M5 24.5q0-6.5 6.5-7.8L26 16q3.5 0 4.6 3.2L32 23.5h9.5L44.6 10.2q.5-1.7 2.2-1.7h1.4q1.3 0 1.1 1.3L46.6 24q-.4 2.3-2.7 2.3H22a8 8 0 0 0-16 0Z"/>
<path d="M10 15.2q0-3.2 3.2-3.2h10.6q2.6 0 2.6 2.4v1.2H10Z"/>
<path d="M44 7h7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
<path d="M47.6 19l1.6 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;

const atv = `<path fill-rule="evenodd" d="M6.5 29a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0ZM11.15 29a2.85 2.85 0 1 0 5.7 0a2.85 2.85 0 1 0 -5.7 0Z"/><path fill-rule="evenodd" d="M42.5 29a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0ZM47.15 29a2.85 2.85 0 1 0 5.7 0a2.85 2.85 0 1 0 -5.7 0Z"/>
<path d="M3 19.5q0-3.5 3.5-3.5H26l3-4h9l3 4h16.5q3.5 0 3.5 3.5V21H3Z"/>
<path d="M22 21h20l-2 6H24Z"/>
<path d="M41 12l1.6-5M39.6 6.4h6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;

const VEHICLE_TYPES = [
  { key: "scooter", get label() { return t("type_scooter"); }, art: scooter },
  { key: "motorbike", get label() { return t("type_motorbike"); }, art: motorbike },
  { key: "atv", get label() { return t("type_atv"); }, art: atv },
  { key: "sedan", get label() { return t("type_sedan"); }, art: sedan },
  { key: "suv", get label() { return t("type_suv"); }, art: suv }
];
const DEFAULT_VEHICLE_TYPE = "sedan";
function vehicleTypeOf(vehicle) {
  return VEHICLE_TYPES.some(t => t.key === vehicle.type) ? vehicle.type : DEFAULT_VEHICLE_TYPE;
}
function vehicleIconSvg(typeKey) {
  const t = VEHICLE_TYPES.find(x => x.key === typeKey) || VEHICLE_TYPES.find(x => x.key === DEFAULT_VEHICLE_TYPE);
  return `<svg viewBox="0 0 64 40" fill="currentColor" aria-hidden="true" focusable="false">${t.art}</svg>`;
}

document.getElementById("loginIcon").innerHTML = vehicleIconSvg("sedan");

/* ---------------- Back-gesture / history navigation ----------------
   The app is a single page with no real URLs, so by default there's nothing
   for the phone's back gesture to step through — it falls straight through
   to closing the installed app. We fix that by pushing a history entry each
   time a screen/modal opens, and only ever closing things via history
   navigation (closeNav), so a real back-gesture and an in-app Cancel/Save
   button both funnel through the same single close handler below. */
let navDepth = 0;
let exitArmed = false;
let exitArmTimer = null;
function pushNav() {
  if (exitArmed) restoreRootSentinel();   // did something else instead of exiting: re-arm the guard first
  navDepth++;
  history.pushState({ fleetNav: navDepth }, "", location.href);
}
// The bottom-most app history entry. While it exists, a back press on the home page is caught
// (to show "Press back again to exit"); once it's been popped, the next back press exits.
function restoreRootSentinel() {
  exitArmed = false;
  clearTimeout(exitArmTimer);
  navDepth++;
  history.pushState({ fleetNav: navDepth }, "", location.href);
}
function replaceNav() { history.replaceState({ fleetNav: navDepth }, "", location.href); }
// While a close is on its way (history.back() is asynchronous) further taps on Save /
// Cancel / Delete are ignored, so a quick double-tap can't save twice or close two screens.
let navClosing = false, navClosingTimer = null, suppressPops = 0;
function closeNav() {
  if (navClosing) return;
  navClosing = true;
  clearTimeout(navClosingTimer);
  navClosingTimer = setTimeout(() => { navClosing = false; }, 800);   // safety net
  history.back();
}
window.addEventListener("popstate", () => {
  navClosing = false;
  clearTimeout(navClosingTimer);
  if (suppressPops > 0) { suppressPops--; return; }
  if (navDepth > 0) navDepth--;
  if (confirmResolve) { finishConfirm(false); pushNav(); return; }   // back closes only the question
  performTopLevelClose();
});
// Close everything and return to the home page in one step, keeping the back-gesture
// history in sync (used after deleting the open vehicle and after importing a backup).
function goToRoot() {
  document.querySelectorAll(".overlay.open").forEach(o => o.classList.remove("open"));   // every panel, incl. any added later
  state.editing = null;
  state.activeVehicleId = null;
  state.tab = "home";
  render();
  const steps = navDepth - 1;            // entries above the root sentinel
  if (steps > 0) {
    navDepth = 1;
    suppressPops++;
    navClosing = true;
    clearTimeout(navClosingTimer);
    navClosingTimer = setTimeout(() => { navClosing = false; }, 800);
    history.go(-steps);
  }
}
function performTopLevelClose() {
  if (itemOverlay.classList.contains("open")) { itemOverlay.classList.remove("open"); state.editing = null; return; }
  if (vehicleOverlay.classList.contains("open")) { vehicleOverlay.classList.remove("open"); return; }
  if (categoryPickerOverlay.classList.contains("open")) { categoryPickerOverlay.classList.remove("open"); return; }
  if (restoreOverlay.classList.contains("open")) { restoreOverlay.classList.remove("open"); return; }
  if (state.activeVehicleId) { state.activeVehicleId = null; render(); return; }
  if (state.tab !== "home") { state.tab = "home"; render(); window.scrollTo(0, 0); return; }   // back from a tab goes Home
  // On the home page with nothing open: this press just used up the root sentinel, so the
  // phone is now on the app's first history entry and the NEXT back press closes the app.
  // If that second press doesn't come within 2 seconds, put the sentinel back.
  if (!exitArmed) {
    exitArmed = true;
    showToast(t("press_back_exit"));
    clearTimeout(exitArmTimer);
    exitArmTimer = setTimeout(() => { if (exitArmed) restoreRootSentinel(); }, 2000);
  }
}

const GRIP_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>';

// Press-and-hold on a vehicle card/row to drag-reorder it. A short hold (350ms)
// distinguishes "reorder" from a normal tap/scroll; small movement before that
// cancels the hold so scrolling the list still works normally.
function enableDragReorder(el, container, vehicleId, onTap) {
  el.dataset.vehicleId = vehicleId;
  let longPressTimer = null;
  let dragging = false;
  let hasDragged = false;
  let startX = 0, startY = 0;
  let pointerId = null;

  // Once a drag has started, stop the page from scrolling. (Changing touch-action mid-gesture
  // has no effect on Android, so without this the browser grabs the finger as a scroll and
  // cancels the drag.) Also suppress the long-press context menu.
  el.addEventListener("touchmove", (e) => { if (dragging) e.preventDefault(); }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    pointerId = e.pointerId;
    hasDragged = false;
    longPressTimer = setTimeout(() => {
      dragging = true;
      hasDragged = true;
      try { el.setPointerCapture(pointerId); } catch (err) {}
      el.classList.add("dragging");
      el.style.touchAction = "none";
      if (navigator.vibrate) navigator.vibrate(25);
    }, 350);
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
        clearTimeout(longPressTimer);
      }
      return;
    }
    e.preventDefault();
    const currentY = e.clientY;
    const others = Array.from(container.children).filter(c => c !== el);
    let insertBefore = null;
    for (const other of others) {
      const rect = other.getBoundingClientRect();
      if (currentY < rect.top + rect.height / 2) { insertBefore = other; break; }
    }
    if (insertBefore) {
      if (insertBefore !== el.nextSibling) container.insertBefore(el, insertBefore);
    } else if (container.lastElementChild !== el) {
      container.appendChild(el);
    }
  });

  function endDrag() {
    clearTimeout(longPressTimer);
    if (dragging) {
      dragging = false;
      el.classList.remove("dragging");
      el.style.touchAction = "";
      try { el.releasePointerCapture(pointerId); } catch (err) {}
      const newOrderIds = Array.from(container.children).map(c => c.dataset.vehicleId).filter(Boolean);
      const oldOrder = state.data.vehicles.map(v => v.id).join();
      state.data.vehicles.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
      render();
      // A press-and-hold that ends where it started isn't a change: no save, no backup file.
      if (state.data.vehicles.map(v => v.id).join() !== oldOrder) {
        saveData();
        showToast(t("order_updated"));
      }
    }
  }
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.addEventListener("click", (e) => {
    if (hasDragged) { hasDragged = false; e.stopPropagation(); return; }
    onTap();
  });
}

function vehicleStatusCounts(vehicle) {
  let overdue = 0, soon = 0;
  CATEGORIES.forEach(cat => {
    (vehicle.items[cat.key] || []).forEach(item => {
      if (isDone(item)) return;
      const days = daysUntil(item.dueDate);
      if (days === null) return;
      if (days < 0) overdue++;
      else if (days <= soonDays()) soon++;
    });
  });
  return { overdue, soon };
}
function statusCountBadgeHTML(vehicle) {
  const { overdue, soon } = vehicleStatusCounts(vehicle);
  if (overdue > 0) return `<span class="status-count sc-red">${overdue}</span>`;
  if (soon > 0) return `<span class="status-count sc-amber">${soon}</span>`;
  return "";
}

const UI_ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>'
};
const CATEGORY_AVATAR = { maintenance: "a-green", insurance: "a-blue", inspection: "a-amber" };

// Every not-done event that is overdue or due within the "Remind me" window, soonest first.
function attentionItems() {
  const lead = soonDays(), out = [];
  state.data.vehicles.forEach(v => CATEGORIES.forEach(c => (v.items[c.key] || []).forEach(it => {
    if (isDone(it)) return;
    const days = daysUntil(it.dueDate);
    if (days !== null && days <= lead) out.push({ v, c, it, days });
  })));
  return out.sort((a, b) => a.days - b.days);
}
// Right-hand value of an event row: short, coloured by urgency.
function dueValue(item) {
  if (isDone(item)) return { text: t("v_done"), cls: "v-none" };
  const days = daysUntil(item.dueDate);
  if (days === null) return { text: t("v_no_date"), cls: "v-none" };
  if (days < 0) return { text: t("v_days", { n: -days }), meta: t("v_overdue_word"), cls: "v-red" };
  if (days === 0) return { text: t("v_today"), cls: "v-amber" };
  return { text: t("v_days", { n: days }), cls: days <= soonDays() ? "v-amber" : "v-green" };
}
function eventSub(item) {
  if (isDone(item)) { const on = item.lastDate || item.dueDate; return on ? t("sub_done_on", { date: formatDate(on) }) : t("v_done"); }
  return item.dueDate ? t("sub_due", { date: formatDate(item.dueDate) }) : t("sub_no_due");
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function renderHero(view) {
  const due = attentionItems();
  const overdue = due.filter(d => d.days < 0).length, soon = due.length - overdue, lead = soonDays();
  const hero = el("button", "hero" + (due.length ? "" : " is-calm"));
  let big, sub;
  if (overdue) { big = t("hero_overdue_big", { n: overdue }); sub = soon ? t("hero_more_soon", { n: soon, d: lead }) : t("hero_tap"); }
  else if (soon) {
    const n = due[0];
    big = t("hero_soon_big", { n: soon });
    sub = t("hero_next", { what: `${escapeHtml(n.v.name)} · ${escapeHtml(n.it.label)}`, when: n.days === 0 ? t("when_today") : t("when_in", { n: n.days }) });
  }
  else { big = t("hero_ok_big"); sub = t("hero_ok_sub", { d: lead }); }
  const n = state.data.vehicles.length;
  hero.innerHTML = `
    <div class="hero-label">${t("hero_label")}</div>
    <div class="hero-big">${big}</div>
    <div class="hero-sub">${sub}</div>
    <div class="hero-pills">
      ${overdue ? `<span class="hero-pill"><i class="p-red"></i>${t("pill_overdue", { n: overdue })}</span>` : ""}
      ${soon ? `<span class="hero-pill"><i class="p-amber"></i>${t("pill_soon", { n: soon })}</span>` : ""}
      <span class="hero-pill">${t("pill_vehicles", { n })}</span>
    </div>`;
  if (due.length) hero.onclick = () => switchTab("upcoming");
  else hero.tabIndex = -1;
  view.appendChild(hero);
}

function renderHome(view) {
  view.appendChild(el("h1", "page-title", "My Fleet"));
  if (state.data.vehicles.length === 0) {
    const empty = el("div", "empty-state", `
      <div class="empty-icon">${vehicleIconSvg("sedan")}</div>
      <div class="empty-title">${t("empty_title")}</div>
      <div class="empty-copy">${t("empty_copy")}</div>
      <button class="btn btn-primary" id="emptyAddVehicle">${t("empty_btn")}</button>`);
    view.appendChild(empty);
    empty.querySelector("#emptyAddVehicle").onclick = () => openVehicleModal();
    return;
  }
  renderHero(view);
  const head = el("div", "section-title", `<span>${t("vehicles")}</span>`);
  const add = el("button", "pill-btn", t("add_short"));
  add.setAttribute("aria-label", t("add_vehicle"));
  add.onclick = () => openVehicleModal();
  head.appendChild(add);
  view.appendChild(head);
  const list = el("div", "group picker-list");
  state.data.vehicles.forEach(v => {
    const row = el("div", "row tappable picker-card", `
      <div class="avatar">${vehicleIconSvg(vehicleTypeOf(v))}</div>
      <div class="row-text">
        <div class="row-title">${escapeHtml(v.name)}</div>
        <div class="row-sub">${v.registration ? escapeHtml(v.registration) : t("no_reg")}</div>
      </div>
      ${statusCountBadgeHTML(v)}
      <span class="chev"></span>`);
    const openVehicle = () => { pushNav(); state.activeVehicleId = v.id; render(); window.scrollTo(0, 0); };
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.onkeydown = (e) => { if (e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openVehicle(); } };
    enableDragReorder(row, list, v.id, openVehicle);
    list.appendChild(row);
  });
  view.appendChild(list);
}

function renderVehiclePage(view, vehicle) {
  view.appendChild(el("div", "vehicle-hero", `
    <div class="big-avatar">${vehicleIconSvg(vehicleTypeOf(vehicle))}</div>
    <div class="vh-name">${escapeHtml(vehicle.name)}</div>
    <div class="vh-sub">${vehicle.registration ? escapeHtml(vehicle.registration) : t("no_reg")}</div>`));

  const actions = el("div", "actions");
  const addAct = el("button", "action primary", `<span class="action-circle">${UI_ICONS.plus}</span>${t("add_event")}`);
  addAct.onclick = () => openCategoryPicker();
  const editAct = el("button", "action", `<span class="action-circle">${UI_ICONS.edit}</span>${t("edit")}`);
  editAct.setAttribute("aria-label", t("edit_vehicle"));
  editAct.onclick = () => openVehicleEditModal(vehicle.id);
  actions.append(addAct, editAct);
  view.appendChild(actions);

  if (vehicle.vin || vehicle.regDate || vehicle.note) {
    const details = el("div", "group details");
    if (vehicle.vin) details.appendChild(el("div", "row", `<div class="row-text"><div class="row-title">${t("vin")}</div><div class="row-sub mono">${escapeHtml(vehicle.vin)}</div></div>`));
    if (vehicle.regDate) details.appendChild(el("div", "row", `<div class="row-text"><div class="row-title">${t("reg_date")}</div><div class="row-sub mono">${numericDate(vehicle.regDate)}</div></div>`));
    if (vehicle.note) details.appendChild(el("div", "row", `<div class="row-text"><div class="row-title">${t("note")}</div><div class="row-sub">${escapeHtml(vehicle.note)}</div></div>`));
    view.appendChild(details);
  }

  CATEGORIES.forEach(cat => {
    const head = el("div", "section-title", `<span class="title-with-icon"><span class="cat-dot avatar ${CATEGORY_AVATAR[cat.key]}">${CATEGORY_ICONS[cat.key]}</span>${cat.label}</span>`);
    const add = el("button", "pill-btn", t("add_short"));
    add.setAttribute("aria-label", t("add_to", { cat: cat.label }));
    add.title = t("add_to", { cat: cat.label });
    add.onclick = () => openItemModal(vehicle.id, cat.key, null);
    head.appendChild(add);
    view.appendChild(head);

    const group = el("div", "group");
    const items = (vehicle.items[cat.key] || []).slice().sort((a, b) => {
      if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;          // completed events go last
      const da = daysUntil(a.dueDate), db = daysUntil(b.dueDate);
      if (da === null && db === null) return 0;
      if (da === null) return 1; if (db === null) return -1;
      return isDone(a) ? db - da : da - db;                              // finished: newest first
    });
    if (!items.length) group.appendChild(el("div", "row-empty", t("no_events", { cat: cat.label })));
    items.forEach(item => {
      const val = dueValue(item);
      const row = el("div", "row tappable wrap" + (isDone(item) ? " is-done" : ""), `
        <div class="avatar cat ${CATEGORY_AVATAR[cat.key]}">${CATEGORY_ICONS[cat.key]}</div>
        <div class="row-text">
          <div class="row-title">${escapeHtml(item.label)}</div>
          <div class="row-sub">${eventSub(item)}</div>
        </div>
        <div class="row-right"><div class="row-value ${val.cls}">${val.text}</div>${val.meta ? `<div class="row-meta">${val.meta}</div>` : ""}</div>`);
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.onclick = () => openItemModal(vehicle.id, cat.key, item.id);
      row.onkeydown = (e) => {
        if (e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItemModal(vehicle.id, cat.key, item.id); }
      };
      group.appendChild(row);
    });
    view.appendChild(group);
  });
}

function renderVehicle() {
  mainEl.innerHTML = "";
  const vehicle = state.data.vehicles.find(v => v.id === state.activeVehicleId);
  const view = el("div", "view");
  if (vehicle) renderVehiclePage(view, vehicle); else renderHome(view);
  mainEl.appendChild(view);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- App bar ---------------- */
const appbarEl = document.querySelector(".appbar");
const backBtn = document.getElementById("backBtn");
backBtn.onclick = () => { if (state.activeVehicleId) closeNav(); };
function updateAppbar() {
  const vehicle = state.data.vehicles.find(v => v.id === state.activeVehicleId);
  backBtn.hidden = !vehicle;
  document.getElementById("appbarTitle").textContent = vehicle ? vehicle.name
    : state.tab === "upcoming" ? t("tab_upcoming") : state.tab === "settings" ? t("settings") : "My Fleet";   // the app's name is the same in both languages
}
window.addEventListener("scroll", () => appbarEl.classList.toggle("scrolled", window.scrollY > 48), { passive: true });

let lastRenderDay = null;
function render() {
  lastRenderDay = localISO();
  const onVehicle = !!state.data.vehicles.find(v => v.id === state.activeVehicleId);
  const onSettings = !onVehicle && state.tab === "settings";
  mainEl.hidden = onSettings;
  document.getElementById("settingsPage").hidden = !onSettings;
  if (onSettings) refreshSettingsPage();
  else if (!onVehicle && state.tab === "upcoming") renderUpcoming();
  else renderVehicle();
  updateAppbar();
  updateTabbar(onVehicle);
}

/* ---------------- Bottom menu: Home / Upcoming / Settings ----------------
   Home is the bottom of the back-gesture history. Opening another tab adds one step, moving
   between the other tabs replaces it, so the phone's back gesture always returns Home. */
const TABS = ["home", "upcoming", "settings"];
function switchTab(tab) {
  if (!TABS.includes(tab) || navClosing) return;
  if (tab === state.tab) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (tab === "home") { closeNav(); return; }            // the back step itself switches to Home
  if (state.tab === "home") pushNav(); else replaceNav();
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#tabbar .tab").forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });
function updateTabbar(onVehicle) {
  document.getElementById("tabbar").hidden = onVehicle;   // a vehicle page is a step inside a tab
  document.querySelectorAll("#tabbar .tab").forEach(b => {
    if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const overdue = attentionItems().filter(d => d.days < 0).length;
  const badge = document.getElementById("upcomingBadge");
  badge.hidden = !overdue;
  badge.textContent = overdue > 9 ? "9+" : String(overdue);
}

/* ---------------- Upcoming: every open event across all vehicles, by date ---------------- */
function openEventFromList(v, c, it) {
  if (navClosing) return;
  pushNav();                       // step 1: the vehicle page
  state.activeVehicleId = v.id;
  render();
  window.scrollTo(0, 0);
  openItemModal(v.id, c.key, it.id);   // step 2: the event
}
function renderUpcoming() {
  mainEl.innerHTML = "";
  const view = el("div", "view");
  view.appendChild(el("h1", "page-title", t("tab_upcoming")));
  const lead = soonDays(), all = [];
  state.data.vehicles.forEach(v => CATEGORIES.forEach(c => (v.items[c.key] || []).forEach(it => {
    if (isDone(it)) return;
    const days = daysUntil(it.dueDate);
    if (days !== null) all.push({ v, c, it, days });
  })));
  all.sort((a, b) => a.days - b.days);
  const groups = [
    { title: t("up_overdue"), list: all.filter(d => d.days < 0) },
    { title: t("up_soon", { d: lead }), list: all.filter(d => d.days >= 0 && d.days <= lead) },
    { title: t("up_later"), list: all.filter(d => d.days > lead) }
  ];
  if (!all.length) view.appendChild(el("div", "upcoming-empty", t("up_empty")));
  groups.forEach(g => {
    if (!g.list.length) return;
    view.appendChild(el("div", "upcoming-title", g.title));
    const group = el("div", "group");
    g.list.forEach(({ v, c, it }) => {
      const val = dueValue(it);
      const tone = val.cls === "v-red" ? "a-red" : val.cls === "v-amber" ? "a-amber" : "a-blue";
      const row = el("button", "row row-btn wrap", `
        <div class="avatar ${tone}">${vehicleIconSvg(vehicleTypeOf(v))}</div>
        <div class="row-text">
          <div class="row-title">${escapeHtml(it.label)}</div>
          <div class="row-sub">${escapeHtml(v.name)} · ${c.label}</div>
          <div class="row-sub">${formatDate(it.dueDate)}</div>
        </div>
        <div class="row-right"><div class="row-value ${val.cls}">${val.text}</div>${val.meta ? `<div class="row-meta">${val.meta}</div>` : ""}</div>`);
      row.onclick = () => openEventFromList(v, c, it);
      group.appendChild(row);
    });
    view.appendChild(group);
  });
  mainEl.appendChild(view);
}

/* ---------------- Confirm sheet (replaces the browser's confirm box) ---------------- */
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmOk = document.getElementById("confirmOk");
let confirmResolve = null;
function askConfirm({ title, text = "", ok = "OK", danger = false }) {
  if (confirmResolve) finishConfirm(false);
  document.getElementById("confirmTitle").textContent = title;
  const t = document.getElementById("confirmText");
  t.textContent = text;
  t.hidden = !text;
  confirmOk.textContent = ok;
  confirmOk.className = "btn " + (danger ? "btn-danger" : "btn-primary");
  confirmOverlay.classList.add("open");
  return new Promise(resolve => { confirmResolve = resolve; });
}
function finishConfirm(answer) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmOverlay.classList.remove("open");
  resolve(answer);
}
confirmOk.onclick = () => finishConfirm(true);
document.getElementById("confirmCancel").onclick = () => finishConfirm(false);
confirmOverlay.addEventListener("click", (e) => { if (e.target === confirmOverlay) finishConfirm(false); });

// Tapping the dimmed area above a sheet closes it, like Cancel. Not for the event and vehicle
// forms: a stray tap there would throw away what was typed.
document.querySelectorAll("#categoryPickerOverlay, #restoreOverlay").forEach(o => {
  o.addEventListener("click", (e) => { if (e.target === o && o.classList.contains("open")) closeNav(); });
});

/* ---------------- Item modal ---------------- */
const itemOverlay = document.getElementById("itemOverlay");
const itemLabel = document.getElementById("itemLabel");
const itemLast = document.getElementById("itemLast");
const itemDue = document.getElementById("itemDue");
const itemNotes = document.getElementById("itemNotes");
const itemDeleteRow = document.getElementById("itemDeleteRow");
const itemModalTitle = document.getElementById("itemModalTitle");
const itemStateRow = document.getElementById("itemStateRow");
const itemDoneBtn = document.getElementById("itemDoneBtn");
const itemRenewBtn = document.getElementById("itemRenewBtn");
// Done and Renew only change the form. Nothing is stored until Save; Cancel throws it away.
let formDone = false;

// Done / Renew appear only on saved events. Done is a toggle: pressed = completed.
function syncItemForm() {
  itemStateRow.style.display = state.editing && state.editing.itemId ? "flex" : "none";
  itemDoneBtn.setAttribute("aria-pressed", formDone ? "true" : "false");
  itemDoneBtn.textContent = formDone ? t("done_btn_on") : t("done_btn");
}
// Every event repeats yearly: entering Last done fills Next due one year later.
itemLast.addEventListener("change", () => {
  if (itemLast.value) itemDue.value = addMonthsISO(itemLast.value, REPEAT_YEARLY);
});
itemDoneBtn.onclick = () => { formDone = !formDone; syncItemForm(); };
// Renew: the next yearly period. Next due becomes Last done, and Next due moves on one year
// (no Next due yet: the period starts today). Changes only these two dates.
itemRenewBtn.onclick = () => {
  const start = itemDue.value || localISO();
  itemLast.value = start;
  itemDue.value = addMonthsISO(start, REPEAT_YEARLY);
  refreshDateFields();
};
function openItemModal(vehicleId, category, itemId, replace) {
  state.editing = { vehicleId, category, itemId };
  const vehicle = state.data.vehicles.find(v => v.id === vehicleId);
  const item = itemId ? vehicle.items[category].find(i => i.id === itemId) : null;
  itemModalTitle.textContent = item ? t("edit_event_title") : t("add_event_title");
  itemLabel.value = item ? item.label : "";
  itemLast.value = item ? item.lastDate || "" : "";
  itemDue.value = item ? item.dueDate || "" : "";
  formDone = !!(item && item.done);
  itemNotes.value = item ? item.notes || "" : "";
  itemDeleteRow.style.display = item ? "flex" : "none";
  syncItemForm();
  refreshDateFields();
  itemOverlay.classList.add("open");
  if (replace) replaceNav(); else pushNav();
}
function closeItemModal() { closeNav(); }

document.getElementById("itemCancel").onclick = closeItemModal;
function saveItemForm() {
  if (navClosing || !state.editing || !itemOverlay.classList.contains("open")) return;
  const { vehicleId, category, itemId } = state.editing;
  const vehicle = state.data.vehicles.find(v => v.id === vehicleId);
  const target = vehicle && itemId ? vehicle.items[category].find(i => i.id === itemId) : null;
  if (!vehicle || (itemId && !target)) { showToast(t("deleted_elsewhere")); goToRoot(); return; }
  if (!itemLabel.value.trim()) { showToast(t("enter_name")); return; }
  const fields = {
    label: itemLabel.value.trim(),
    lastDate: itemLast.value || null,
    dueDate: itemDue.value || null,
    done: formDone,
    notes: itemNotes.value.trim()
  };
  if (itemId) Object.assign(target, fields);
  else vehicle.items[category].push({ id: uid(), ...fields });
  saveData();
  closeItemModal();
  render();
}
document.getElementById("itemSave").onclick = () => saveItemForm();
document.getElementById("itemDelete").onclick = async () => {
  if (navClosing || !state.editing || !itemOverlay.classList.contains("open")) return;
  const { vehicleId, category, itemId } = state.editing;
  const vehicle = state.data.vehicles.find(v => v.id === vehicleId);
  const item = vehicle && vehicle.items[category].find(i => i.id === itemId);
  if (!item) { showToast(t("deleted_elsewhere")); goToRoot(); return; }
  if (!(await askConfirm({ title: t("delete_q", { name: item.label }), text: t("restore_hint"), ok: t("delete"), danger: true }))) return;
  if (!itemOverlay.classList.contains("open") || !vehicle.items[category].includes(item)) return;
  vehicle.items[category] = vehicle.items[category].filter(i => i.id !== itemId);
  saveData();
  closeItemModal();
  render();
};

const categoryPickerOverlay = document.getElementById("categoryPickerOverlay");

function openCategoryPicker() {
  const list = document.getElementById("categoryPickList");
  list.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "category-pick-item";
    btn.className = "row row-btn";
    btn.innerHTML = `<div class="avatar cat ${CATEGORY_AVATAR[cat.key]}">${CATEGORY_ICONS[cat.key]}</div><div class="row-text"><div class="row-title">${cat.label}</div></div><span class="chev"></span>`;
    btn.onclick = () => {
      if (navClosing || !categoryPickerOverlay.classList.contains("open")) return;
      categoryPickerOverlay.classList.remove("open");
      openItemModal(state.activeVehicleId, cat.key, null, true);
    };
    list.appendChild(btn);
  });
  categoryPickerOverlay.classList.add("open");
  pushNav();
}
document.getElementById("categoryPickCancel").onclick = () => closeNav();

/* ---------------- Vehicle modal (add / rename / delete) ---------------- */
const vehicleOverlay = document.getElementById("vehicleOverlay");
const vehicleModalTitle = document.getElementById("vehicleModalTitle");
const vehicleDeleteRow = document.getElementById("vehicleDeleteRow");
const vehicleTypeGrid = document.getElementById("vehicleTypeGrid");
let editingVehicleId = null;
let selectedVehicleType = DEFAULT_VEHICLE_TYPE;

document.getElementById("vehicleCancel").onclick = () => closeNav();

function renderTypePicker() {
  vehicleTypeGrid.innerHTML = "";
  VEHICLE_TYPES.forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "type-opt";
    btn.setAttribute("aria-pressed", t.key === selectedVehicleType ? "true" : "false");
    btn.innerHTML = vehicleIconSvg(t.key) + `<span>${t.label}</span>`;
    btn.onclick = () => { selectedVehicleType = t.key; renderTypePicker(); };
    vehicleTypeGrid.appendChild(btn);
  });
}

function openVehicleModal() {
  editingVehicleId = null;
  selectedVehicleType = DEFAULT_VEHICLE_TYPE;
  vehicleModalTitle.textContent = t("add_vehicle_title");
  vehicleDeleteRow.style.display = "none";
  document.getElementById("vehicleName").value = "";
  document.getElementById("vehicleReg").value = "";
  document.getElementById("vehicleVin").value = "";
  document.getElementById("vehicleRegDate").value = "";
  document.getElementById("vehicleNote").value = "";
  refreshDateFields();
  renderTypePicker();
  vehicleOverlay.classList.add("open");
  pushNav();
}

function openVehicleEditModal(vehicleId) {
  const v = state.data.vehicles.find(x => x.id === vehicleId);
  if (!v) return;
  editingVehicleId = vehicleId;
  selectedVehicleType = vehicleTypeOf(v);
  vehicleModalTitle.textContent = t("edit_vehicle_title");
  vehicleDeleteRow.style.display = "flex";
  document.getElementById("vehicleName").value = v.name;
  document.getElementById("vehicleReg").value = v.registration || "";
  document.getElementById("vehicleVin").value = v.vin || "";
  document.getElementById("vehicleRegDate").value = v.regDate || "";
  document.getElementById("vehicleNote").value = v.note || "";
  refreshDateFields();
  renderTypePicker();
  vehicleOverlay.classList.add("open");
  pushNav();
}

document.getElementById("vehicleSave").onclick = () => {
  if (navClosing || !vehicleOverlay.classList.contains("open")) return;
  const name = document.getElementById("vehicleName").value.trim();
  const registration = document.getElementById("vehicleReg").value.trim();
  const vin = document.getElementById("vehicleVin").value.trim().toUpperCase();
  const regDate = document.getElementById("vehicleRegDate").value || null;
  const note = document.getElementById("vehicleNote").value.trim();
  if (!name) { showToast(t("enter_vehicle_name")); return; }
  if (editingVehicleId) {
    const v = state.data.vehicles.find(x => x.id === editingVehicleId);
    if (!v) { showToast(t("vehicle_deleted_elsewhere")); goToRoot(); return; }
    v.name = name;
    v.type = selectedVehicleType;
    v.registration = registration;
    v.vin = vin;
    v.regDate = regDate;
    v.note = note;
    saveData();
    render();
    showToast(t("vehicle_updated"));
    closeNav();
  } else {
    const wasAtRoot = !state.activeVehicleId;
    const v = { id: uid(), name, type: selectedVehicleType, registration, vin, regDate, note, items: { maintenance: [], insurance: [], inspection: [] } };
    state.data.vehicles.push(v);
    state.activeVehicleId = v.id;
    saveData();
    render();
    // Creating a vehicle from the root screen both closes this modal and enters
    // vehicle-detail in one motion — net navigation depth is unchanged, so relabel
    // the current history entry instead of popping it.
    if (wasAtRoot) { vehicleOverlay.classList.remove("open"); replaceNav(); }
    else { closeNav(); }
  }
};

document.getElementById("vehicleDelete").onclick = async () => {
  if (navClosing || !editingVehicleId || !vehicleOverlay.classList.contains("open")) return;
  const v = state.data.vehicles.find(x => x.id === editingVehicleId);
  if (!v) return;
  if (!(await askConfirm({ title: t("delete_q", { name: v.name }), text: t("delete_vehicle_hint"), ok: t("delete"), danger: true }))) return;
  if (!vehicleOverlay.classList.contains("open") || !state.data.vehicles.includes(v)) return;
  state.data.vehicles = state.data.vehicles.filter(x => x.id !== editingVehicleId);
  saveData();
  goToRoot();                       // the vehicle you were on is gone: back to the home page
  showToast(t("vehicle_deleted"));
};

/* ---------------- Cloud account & sync ----------------
   The data lives in your account and a copy stays on the phone, so the app works offline.
   Every change is saved on the phone first and sent to the account as soon as there is
   internet. If another phone (a family member) changed the data in the meantime, both sets of
   changes are combined by vehicle and event, and the newest edit of the same field wins. */
const SUPABASE_URL = "https://lsyihonmzxpjnmiueqgp.supabase.co";
const SUPABASE_KEY = "sb_publishable_VOsIQ53p2Lulq6-Ov4m7sg_5KywhXPr";
const AUTH_KEY = "fleetlog_auth";
const SYNC_KEY = "fleetlog_sync_v1";
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;

// sync = { userId, email, version, base, dirty }. base: the account's data as of the last sync,
// needed to tell which side changed what when combining.
function loadSync() {
  try { const v = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); if (v && typeof v === "object") return v; } catch (e) {}
  return {};
}
let sync = loadSync();
function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {} }

// Compares data regardless of key order (the database stores keys in its own order).
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
const same = (a, b) => canon(a) === canon(b);

// Three-way merge: base = last common version, l = this phone, r = the account.
function mergeFields(b, l, r, skip) {
  const out = {};
  new Set([...Object.keys(b || {}), ...Object.keys(l || {}), ...Object.keys(r || {})]).forEach(k => {
    if (skip && skip.includes(k)) return;
    const v = same(l ? l[k] : undefined, b ? b[k] : undefined) ? (r ? r[k] : undefined) : (l ? l[k] : undefined);
    if (v !== undefined) out[k] = v;
  });
  return out;
}
function mergeList(b, l, r, mergeOne) {
  b = b || []; l = l || []; r = r || [];
  const B = new Map(b.map(x => [x.id, x])), L = new Map(l.map(x => [x.id, x])), R = new Map(r.map(x => [x.id, x]));
  const ids = a => a.map(x => x.id);
  const order = same(ids(l), ids(b)) ? ids(r) : ids(l);       // a reorder on this phone wins, otherwise the account's order
  const out = [], seen = new Set();
  [...order, ...ids(l), ...ids(r)].forEach(id => {
    if (seen.has(id)) return;
    seen.add(id);
    const bx = B.get(id), lx = L.get(id), rx = R.get(id);
    if (lx && rx) out.push(bx ? mergeOne(bx, lx, rx) : lx);
    else if (lx) { if (!bx || !same(lx, bx)) out.push(lx); }  // new here, or edited here after being deleted elsewhere
    else if (rx) { if (!bx || !same(rx, bx)) out.push(rx); }
  });
  return out;
}
function mergeVehicle(b, l, r) {
  const v = mergeFields(b, l, r, ["items"]);
  v.items = {};
  CATEGORIES.forEach(c => { v.items[c.key] = mergeList((b.items || {})[c.key], (l.items || {})[c.key], (r.items || {})[c.key], mergeFields); });
  return v;
}
function mergeData(b, l, r) {
  return normalizeData({ vehicles: mergeList((b || {}).vehicles, (l || {}).vehicles, (r || {}).vehicles, mergeVehicle) }) || normalizeData(r) || { vehicles: [] };
}

let syncTimer = null, syncBusy = null, syncFailed = false;
function markDirty() {
  if (!sync.userId) return;
  sync.dirty = true;
  saveSync();
  updateAccountInfo();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 600);
}
function syncNow() {
  if (!syncBusy) {
    syncBusy = doSync().catch(() => { syncFailed = true; }).finally(() => {
      syncBusy = null;
      updateAccountInfo();
      if (sync.dirty && !syncFailed) syncTimer = setTimeout(syncNow, 300);   // changed while sending
    });
  }
  return syncBusy;
}
function applyAccountData(data, row, clean) {
  if (!same(state.data, data)) {
    state.data = data;
    saveData(false);
    render();
  }
  sync.version = row.version;
  sync.base = row.data;
  if (clean) sync.dirty = false;
  saveSync();
}
async function doSync() {
  if (!sb || !sync.userId) return;
  syncFailed = false;
  for (let round = 0; round < 5; round++) {
    if (sync.dirty) {
      const sent = JSON.parse(JSON.stringify(state.data));
      const { data, error } = await sb.rpc("save_fleet", { new_data: sent, base_version: sync.version || 0 });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) { syncFailed = true; return; }
      if (row.ok) {
        sync.version = row.version;
        sync.base = sent;
        if (same(state.data, sent)) sync.dirty = false;            // otherwise: edited meanwhile, send again
        saveSync();
        if (!sync.dirty) return;
      } else {
        // Another phone saved first: combine, then send the combined data.
        applyAccountData(mergeData(sync.base, state.data, row.data), row, false);
      }
    } else {
      const { data, error } = await sb.from("fleets").select("data, version").maybeSingle();
      if (error || !data) { syncFailed = true; return; }
      if (!sync.dirty && data.version !== sync.version) applyAccountData(normalizeData(data.data) || { vehicles: [] }, data, true);
      return;
    }
  }
}

// First login on this phone. Data already on the phone (from before accounts existed) is
// uploaded if the account is empty; data from a different account is never mixed in.
async function firstSync(user) {
  const { data: row, error } = await sb.from("fleets").select("data, version").maybeSingle();
  if (error || !row) return false;
  const remote = normalizeData(row.data) || { vehicles: [] };
  const local = sync.userId && sync.userId !== user.id ? { vehicles: [] } : state.data;
  let result = remote, upload = false;
  if (local.vehicles.length && !same(local, remote)) {
    if (!remote.vehicles.length) { result = local; upload = true; }
    else {
      const known = new Set(remote.vehicles.map(v => v.id));
      const extra = local.vehicles.filter(v => !known.has(v.id));
      if (extra.length && await askConfirm({
        title: t("add_from_phone_title", { n: extra.length }),
        text: t("add_from_phone_text", { n: extra.length }), ok: t("add_to_account") })) {
        result = { vehicles: [...remote.vehicles, ...extra] };
        upload = true;
      }
    }
  }
  state.data = result;
  saveData(false);
  sync = { userId: user.id, email: user.email, version: row.version, base: row.data, dirty: upload };
  saveSync();
  try { localStorage.removeItem("fleetlog_restore_points"); } catch (e) {}   // replaced by restore points in the account
  render();
  if (upload) syncNow();
  return true;
}

function updateAccountInfo() {
  const waiting = !!sync.userId && !!sync.dirty && (syncFailed || !navigator.onLine);
  const status = !sync.userId ? t("st_not_logged") : sync.dirty ? (waiting ? t("st_wait") : t("st_saving")) : t("st_saved");
  const initial = sync.email ? sync.email.trim()[0].toUpperCase() : "·";
  document.getElementById("accountInfo").textContent = status;
  document.getElementById("accountEmail").textContent = sync.email || "";
  document.getElementById("profileInitial").textContent = initial;
  document.getElementById("syncDot").hidden = !waiting;   // small amber dot in the corner while changes wait
}

// The server ("api" function): account creation, notification key, test notification.
async function api(action, body, token) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}` },
    body: JSON.stringify({ action, ...(body || {}) })
  });
  let out = {};
  try { out = await res.json(); } catch (e) {}
  if (!res.ok && !out.error) out.error = "server_error";
  return out;
}
async function accessToken() {
  try { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; } catch (e) { return null; }
}

/* ---------------- Login screen ---------------- */
const loginScreen = document.getElementById("loginScreen");
const loginMsg = document.getElementById("loginMsg");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
function showLogin(msg) {
  loginScreen.hidden = false;
  sayLogin(msg || "");
}
function sayLogin(text, ok) {
  loginMsg.textContent = text;
  loginMsg.className = ok ? "login-msg ok" : "login-msg";
}
const REGISTER_ERRORS = {
  invalid_email: () => t("err_invalid_email"),
  weak_password: () => t("err_weak_password"),
  not_allowed: () => t("err_not_allowed"),
  join_first: r => t("err_join_first", { email: r.join }),
  already_registered: () => t("err_already")
};
let loginBusy = false;
async function doLogin(register) {
  if (loginBusy) return;
  if (!sb) { sayLogin(t("err_not_loaded")); return; }
  const email = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;
  if (!email || !password) { sayLogin(t("enter_credentials")); return; }
  loginBusy = true;
  document.querySelectorAll("#loginForm button").forEach(b => b.disabled = true);
  sayLogin(register ? t("creating") : t("logging_in"), true);
  try {
    if (register) {
      const r = await api("register", { email, password });
      if (r.error) { sayLogin((REGISTER_ERRORS[r.error] || (() => t("err_generic")))(r)); return; }
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      sayLogin(error && /invalid/i.test(error.message) ? t("wrong_credentials") : t("login_failed"));
      return;
    }
    sayLogin(t("loading_data"), true);
    if (sync.userId === data.user.id) { sync.email = data.user.email; saveSync(); syncNow(); }
    else if (!(await firstSync(data.user))) { sayLogin(t("load_failed")); return; }
    loginScreen.hidden = true;
    loginPassword.value = "";
    showToast(register ? t("account_created") : t("logged_in"));
    afterLogin();
  } catch (e) {
    sayLogin(t("server_unreachable"));
  } finally {
    loginBusy = false;
    document.querySelectorAll("#loginForm button").forEach(b => b.disabled = false);
  }
}
document.getElementById("loginForm").onsubmit = (e) => { e.preventDefault(); doLogin(false); };
document.getElementById("registerBtn").onclick = () => doLogin(true);

function afterLogin() {
  updateAccountInfo();
  loadMemberSettings();
  checkNotificationState();
}
// The switch shows what the phone really allows: notifications blocked in the phone's settings
// turn it off. While allowed, the sign-up is refreshed (push services sometimes replace it).
function checkNotificationState() {
  if (!state.settings.notifications) return;
  if (!pushSupported() || Notification.permission !== "granted") {
    state.settings.notifications = false;
    saveSettings();
    if (sb && sync.userId) unsubscribePush().catch(() => {});
    notifToggle.checked = false;
    return;
  }
  if (Date.now() - lastPushRefresh < 6 * 3600 * 1000) return;
  lastPushRefresh = Date.now();
  subscribePush(false).catch(() => { lastPushRefresh = 0; });
}
let lastPushRefresh = 0;

// "Remind me" is stored with the account, so the server uses it for the 08:00 reminder.
async function loadMemberSettings() {
  try {
    const { data } = await sb.from("fleet_members").select("settings").maybeSingle();
    if (!data) return;
    const lead = Number(data.settings && data.settings.leadDays);
    if ([7, 14, 30].includes(lead)) { if (lead !== state.settings.leadDays) { state.settings.leadDays = lead; saveSettings(); render(); } }
    // The server writes reminders in the language this phone uses.
    if (![7, 14, 30].includes(lead) || !data.settings || data.settings.lang !== LANG) saveMemberSettings();
  } catch (e) {}
}
async function saveMemberSettings() {
  if (!sb || !sync.userId) return;
  try { await sb.from("fleet_members").update({ settings: { leadDays: state.settings.leadDays, lang: LANG } }).eq("user_id", sync.userId); } catch (e) {}
}

let loggingOut = false;
document.getElementById("logoutBtn").onclick = async () => {
  const msg = sync.dirty
    ? t("logout_unsynced")
    : t("logout_safe");
  if (!(await askConfirm({ title: t("logout_q"), text: msg, ok: t("log_out"), danger: true }))) return;
  loggingOut = true;
  try { await withTimeout(unsubscribePush(), 6000); } catch (e) {}
  try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  sync = {};
  saveSync();
  state.data = { vehicles: [] };
  saveData(false);
  state.settings = { ...DEFAULT_SETTINGS, theme: state.settings.theme, lang: state.settings.lang };   // theme and language belong to the phone
  saveSettings();
  loggingOut = false;
  goToRoot();
  showLogin();
};

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/* ---------------- Notifications ----------------
   The server sends the reminder every day at 08:00 (Sofia time), even when the app is closed.
   This phone only has to sign up once; the sign-up is stored with the account. */
function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function subscribePush(ask) {
  if (!pushSupported()) throw new Error("unsupported");
  if (Notification.permission !== "granted") {
    if (!ask) return false;
    if (await Notification.requestPermission() !== "granted") throw new Error("denied");
  }
  const reg = await withTimeout(navigator.serviceWorker.ready, 10000);
  const { publicKey } = await api("publicKey");
  if (!publicKey) throw new Error("server");
  let sub = await reg.pushManager.getSubscription();
  const key = sub && sub.options && sub.options.applicationServerKey;
  if (sub && key && bytesToB64u(new Uint8Array(key)) !== publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  if (error) throw new Error("server");
  return true;
}
async function unsubscribePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  if (sb && sync.userId) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/* ---------------- Settings page ---------------- */
const notifToggle = document.getElementById("notifToggle");
function refreshSettingsPage() {
  notifToggle.checked = !!state.settings.notifications;
  document.getElementById("leadDays").value = state.settings.leadDays || 30;
  updateAccountInfo();
}

/* ---------------- Theme: Auto (follows the phone) / Light / Dark ---------------- */
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function applyTheme() {
  const t = ["light", "dark"].includes(state.settings.theme) ? state.settings.theme : "auto";
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.querySelectorAll("#themeSeg button").forEach(b => b.setAttribute("aria-checked", b.dataset.theme === t ? "true" : "false"));
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.getElementById("themeColor").setAttribute("content", bg);   // phone status bar matches
}
document.querySelectorAll("#themeSeg button").forEach(b => {
  b.onclick = () => { state.settings.theme = b.dataset.theme; saveSettings(); applyTheme(); };
});
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", applyTheme);
applyTheme();

/* ---------------- Language: Bulgarian (default) / English ---------------- */
function setLanguage(lang) {
  if (!LANGS.includes(lang)) return;
  LANG = lang;
  state.settings.lang = lang;
  saveSettings();
  applyLanguage();
  saveMemberSettings();
}
function applyLanguage() {
  applyStaticText();
  refreshDateFields();
  document.querySelectorAll("#langSeg button").forEach(b => b.setAttribute("aria-checked", b.dataset.lang === LANG ? "true" : "false"));
  document.getElementById("loginLang").textContent = LANG === "bg" ? "EN" : "БГ";
  if (itemOverlay.classList.contains("open")) syncItemForm();
  render();
  updateAccountInfo();
}
document.querySelectorAll("#langSeg button").forEach(b => { b.onclick = () => setLanguage(b.dataset.lang); });
document.getElementById("loginLang").onclick = () => setLanguage(LANG === "bg" ? "en" : "bg");

notifToggle.onchange = async () => {
  const on = notifToggle.checked;
  notifToggle.disabled = true;
  try {
    if (on) {
      await subscribePush(true);
      showToast(t("reminders_on"));
    } else {
      await unsubscribePush();
    }
    state.settings.notifications = on;
    saveSettings();
  } catch (err) {
    notifToggle.checked = !on;
    const m = err && err.message;
    showToast(m === "unsupported" ? t("notif_unsupported") : m === "denied" ? t("notif_denied") : t("notif_failed"));
  } finally {
    notifToggle.disabled = false;
  }
};
document.getElementById("leadDays").onchange = (e) => {
  state.settings.leadDays = parseInt(e.target.value, 10);
  saveSettings();
  saveMemberSettings();
  render();
};
document.getElementById("testNotifBtn").onclick = async (e) => {
  const btn = e.currentTarget;
  if (!state.settings.notifications) { showToast(t("notif_first")); return; }
  btn.disabled = true;
  try {
    const token = await accessToken();
    if (!token) { showToast(t("connect")); return; }
    const r = await api("test", {}, token);
    if (r.error) showToast(t("send_failed"));
    else if (!r.phones) showToast(t("not_signed_up"));
    else if (r.sent) showToast(t("sent_to", { n: r.sent }));
    else showToast(t("deliver_failed"));
  } catch (err) {
    showToast(t("connect"));
  } finally {
    btn.disabled = false;
  }
};

/* ---------------- Export / Import ---------------- */
// Hands a file to the browser's downloader. The temporary link is released a minute later,
// not immediately: revoking it straight after click() can cancel the download on some phones.
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// "My Fleet 2026-10-03 14-35.json". The time keeps every name unique, so Chrome never finds a
// file with the same name in Downloads and never asks "Download again?".
function backupFileName() {
  const d = new Date();
  return `My Fleet ${localISO(d)} ${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}.json`;
}
function performBackupExport() {
  const payload = JSON.stringify({ vehicles: state.data.vehicles });
  downloadFile(new Blob([payload], { type: "application/json" }), backupFileName());
  showToast(t("exported"));
}

document.getElementById("exportBtn").onclick = () => performBackupExport();
document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
document.getElementById("importFile").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data = null;
    try { data = normalizeData(JSON.parse(reader.result)); } catch (err) {}
    if (!data) { showToast(t("not_backup")); return; }
    const n = data.vehicles.length;
    if (!(await askConfirm({ title: t("replace_q"), text: t("replace_text", { n }), ok: t("replace"), danger: true }))) return;
    state.data = data;
    if (!saveData()) return;
    goToRoot();
    showToast(t("imported"));
  };
  reader.onerror = () => showToast(t("open_failed"));
  reader.readAsText(file);
};

/* ---------------- Restore list ----------------
   The account keeps the last 30 versions of the data (one per saved change), off the phone. */
const restoreOverlay = document.getElementById("restoreOverlay");
function restoreLabel(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (localISO(d) === localISO()) return t("today_at", { time });
  if (localISO(d) === localISO(yesterday)) return t("yesterday_at", { time });
  return `${d.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${time}`;
}
function restoreSummary(data) {
  const vs = (data && data.vehicles) || [];
  const ev = vs.reduce((n, v) => n + CATEGORIES.reduce((m, c) => m + ((v.items && v.items[c.key]) || []).length, 0), 0);
  return t("summary", { v: vs.length, e: ev });
}
let restoreLoading = false;
document.getElementById("restoreBtn").onclick = async () => {
  if (restoreLoading || !sb || !sync.userId) return;
  restoreLoading = true;
  let points = null;
  try {
    const { data, error } = await sb.from("fleet_history").select("created_at, data").order("created_at", { ascending: false }).limit(30);
    if (!error) points = data;
  } catch (e) {}
  restoreLoading = false;
  if (!points) { showToast(t("restore_need_net")); return; }
  if (!points.length) { showToast(t("no_restore")); return; }
  if (state.tab !== "settings" || state.activeVehicleId) return;   // left Settings while loading
  const list = document.getElementById("restoreList");
  list.innerHTML = "";
  points.forEach(p => {
    const data = normalizeData(p.data);
    const at = Date.parse(p.created_at);
    const isNow = !!data && same(data, state.data);
    const btn = document.createElement("button");
    btn.className = "row row-btn restore-item";
    btn.disabled = isNow || !data;
    btn.innerHTML = `<div class="row-text"><div class="row-title">${restoreLabel(at)}${isNow ? t("now_suffix") : ""}</div><div class="row-sub">${restoreSummary(data)}</div></div>${isNow ? "" : '<span class="chev"></span>'}`;
    btn.onclick = async () => {
      if (!(await askConfirm({ title: t("restore_q", { when: restoreLabel(at) }), text: t("restore_text"), ok: t("restore") }))) return;
      state.data = data;
      if (!saveData()) return;          // the restored data becomes the newest version in the account
      goToRoot();
      showToast(t("restored_to", { when: restoreLabel(at) }));
    };
    list.appendChild(btn);
  });
  restoreOverlay.classList.add("open");
  pushNav();
};
document.getElementById("restoreClose").onclick = () => closeNav();

/* ---------------- Service worker registration ---------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// Bring in changes from other phones whenever the app comes back to the front or gets internet.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (lastRenderDay !== localISO()) render();   // day changed while the app sat in the background
  syncNow();
  if (sync.userId) checkNotificationState();
});
window.addEventListener("online", () => syncNow());
// While the app is open: send waiting changes every minute, and look for changes from other
// phones every 2 minutes (a quick read, nothing is sent when nothing changed).
let syncTicks = 0;
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  syncTicks++;
  if (sync.dirty || syncTicks % 2 === 0) syncNow();
}, 60000);

async function startAccount() {
  if (!sb) { if (!sync.userId) showLogin(t("err_not_loaded")); return; }
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {   // never call the account library from inside its own callback
      if (event === "SIGNED_OUT" && sync.userId && !loggingOut) showLogin(t("login_again"));
      if (event === "TOKEN_REFRESHED" && session && session.user.id === sync.userId && sync.dirty) syncNow();
    }, 0);
  });
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
  let savedLogin = false;
  try { savedLogin = !!localStorage.getItem(AUTH_KEY); } catch (e) {}
  if (session && session.user.id === sync.userId) { syncNow(); afterLogin(); }
  else if (session) {
    if (await firstSync(session.user)) afterLogin();
    else showLogin(t("load_failed_login"));
  }
  else if (!(savedLogin && sync.userId)) showLogin();   // a saved login without internet keeps working offline
}

/* ---------------- Init ---------------- */
applyLanguage();   // fills the page text and draws the first screen
restoreRootSentinel(); // root sentinel, so the first back press on the home page can be caught
if (dataLoadProblem) showToast(t("data_unreadable"));
// One-time cleanup of the removed photo/document feature: save the data without the old
// references, and delete the storage area that held the files themselves.
if (hadLegacyFields) saveData(false);
const FILES_REMOVED_KEY = "fleetlog_files_removed";
try {
  if (window.indexedDB && !localStorage.getItem(FILES_REMOVED_KEY)) {
    const req = indexedDB.deleteDatabase("fleetlog_files");
    req.onsuccess = () => { try { localStorage.setItem(FILES_REMOVED_KEY, "1"); } catch (e) {} };
  }
} catch (e) {}
startAccount();
// Ask the browser to keep this app's data even when the phone is low on space. Installed apps
// are usually granted this silently; it doesn't protect against clearing data / uninstalling.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}
