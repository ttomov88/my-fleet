/* ---------------- Data layer ---------------- */
const STORAGE_KEY = "fleetlog_v1";
const SETTINGS_KEY = "fleetlog_settings_v1";
const CATEGORIES = [
  { key: "maintenance", label: "Maintenance" },
  { key: "insurance", label: "Insurance" },
  { key: "inspection", label: "Technical Inspection" }
];

const CATEGORY_ACCENT = { maintenance: "#2F9E5B", insurance: "#7FA9E0", inspection: "#E8A33D" };
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
        ...i, id: freshId(i.id), label: str(i.label) || "Untitled", dueDate: date(i.dueDate), lastDate: date(i.lastDate),
        notes: str(i.notes), done: i.done === true
      }));
    });
    const { photo, ...rest } = v;   // vehicle photos were removed too
    return { ...rest, id: freshId(v.id), name: str(v.name) || "Unnamed vehicle",
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
    showToast("Couldn't save. Phone storage may be full");
    return false;
  }
  if (sync) markDirty();
  return true;
}

const DEFAULT_SETTINGS = { notifications: false, leadDays: 30 };
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) { const st = JSON.parse(raw); if (st && typeof st === "object") return { ...DEFAULT_SETTINGS, ...st }; }
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {} }

const state = {
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
function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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
function statusClass(days) {
  if (days === null) return "badge-none";
  if (days < 0) return "badge-red";
  if (days <= soonDays()) return "badge-amber";
  return "badge-green";
}
function humanDue(days, dateStr) {
  if (days === null) return "No date set";
  const formatted = formatDate(dateStr);
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} · ${formatted}`;
  if (days === 0) return `Due today · ${formatted}`;
  return `Due in ${days} day${days === 1 ? "" : "s"} · ${formatted}`;
}

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
// Inner SVG markup for each vehicle type. viewBox is 0 0 64 40; everything uses currentColor.
const iconRing = (cx, cy, r, hub) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z M${cx - hub} ${cy} a${hub} ${hub} 0 1 0 ${2 * hub} 0 a${hub} ${hub} 0 1 0 ${-2 * hub} 0 Z`;

const sedan = `
<path fill-rule="evenodd" d="M3 29 L3 22 Q3 19.4 5.6 18.9 L16 17.2 L22.2 9.4 Q23.3 8 25 8 L38.5 8 Q40.2 8 41.4 9.2 L49.6 17.6 L58.4 19.6 Q61.5 20.4 61.5 24 L61.5 29 L57 29 A8 8 0 0 0 41 29 L23 29 A8 8 0 0 0 7 29 Z
M19.4 16.4 L24 10.6 Q24.5 10 25.3 10 L30.2 10 L30.2 16.4 Z
M32.8 10 L38 10 Q38.8 10 39.4 10.6 L45.2 16.4 L32.8 16.4 Z"/>
<path fill-rule="evenodd" d="${iconRing(15, 29, 6, 2.2)}"/>
<path fill-rule="evenodd" d="${iconRing(49, 29, 6, 2.2)}"/>`;

const suv = `
<path fill-rule="evenodd" d="M3 28.5 L3 18 Q3 15.8 5 15.4 L9.5 14.6 L11.4 8.4 Q12 6.5 14 6.5 L43 6.5 Q45 6.5 46.2 8 L52 15 L58.6 16.8 Q62 17.8 62 21.5 L62 28.5 L59 28.5 A9 9 0 0 0 41 28.5 L24 28.5 A9 9 0 0 0 6 28.5 Z
M12.8 14 L14.2 9 L26 9 L26 14 Z
M28.6 9 L42 9 Q43 9 43.6 9.8 L47.8 14 L28.6 14 Z"/>
<path fill-rule="evenodd" d="${iconRing(15, 28.5, 7, 2.4)}"/>
<path fill-rule="evenodd" d="${iconRing(50, 28.5, 7, 2.4)}"/>`;

const motorbike = `
<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="27" r="7.7"/>
  <circle cx="53" cy="27" r="7.7"/>
  <path d="M45.4 13 L53 27"/>
  <path d="M44.8 11.8 L41 9.6"/>
  <path d="M11 27 L27 27.6"/>
</g>
<circle cx="11" cy="27" r="1.8" fill="currentColor"/>
<circle cx="53" cy="27" r="1.8" fill="currentColor"/>
<rect x="25" y="20.4" width="15" height="10.4" rx="3" fill="currentColor"/>
<path fill="currentColor" d="M6.8 18.6 Q6.8 16.8 8.8 16.6 L24.2 16 Q26.4 15.8 27.4 13.8 Q28.8 11.2 32 11.2 L38.2 11.6 Q40.8 12 41.2 14.4 L41.4 19 L37.6 20 L24 20.4 L9.6 20.4 Q6.8 20.4 6.8 18.6 Z"/>
<circle cx="46.6" cy="16" r="3.2" fill="currentColor"/>`;

const scooter = `
<path fill-rule="evenodd" d="M6.5 29.5 Q3.8 24.5 5.6 19 Q7.4 14.4 13 14 L27 14 C29.4 17.6 30.4 21.4 31 24.5 L31 29.5 L22.5 29.5 A7.5 7.5 0 0 0 7.5 29.5 Z"/>
<path fill="currentColor" d="M9.2 14.6 Q9.2 10.8 13 10.6 L25.2 10.6 Q28.4 10.8 28.8 13.6 L28.8 14.6 Z"/>
<rect x="27.5" y="24" width="16" height="4.6" rx="2.2" fill="currentColor"/>
<path fill="currentColor" d="M39.8 28.6 L39.8 25 Q41.4 17 43.2 10.8 Q43.8 8.8 45.8 9.2 L47.4 9.7 Q48.4 10.3 48 11.8 Q46.2 19 45.4 25 L45.4 28.6 Z"/>
<circle cx="49.6" cy="12" r="3" fill="currentColor"/>
<path fill="currentColor" d="M41.4 8 L49.6 8 Q50.6 8 50.6 9 Q50.6 10 49.6 10 L41.4 10 Q40.4 10 40.4 9 Q40.4 8 41.4 8 Z"/>
<path d="M47.4 15 L51 29.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
<path fill="currentColor" d="M45.6 22 Q50.6 18.4 56.6 23 L57 25.2 Q51.6 21.8 46.6 24.8 Z"/>
<path fill-rule="evenodd" d="${iconRing(15, 29.5, 5.6, 2)}"/>
<path fill-rule="evenodd" d="${iconRing(51, 29.5, 5.6, 2)}"/>`;

// ATV: knobby fat tyres, flat fenders with cargo racks front and rear, low body, seat, upright bars.
const iconKnobs = (cx, cy, r, n, kr) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * 2 * Math.PI;
  return `<circle cx="${(cx + r * Math.cos(a)).toFixed(2)}" cy="${(cy + r * Math.sin(a)).toFixed(2)}" r="${kr}"/>`;
}).join("");
const atvWheel = (cx, cy) => `<path fill-rule="evenodd" d="${iconRing(cx, cy, 7.9, 3.2)}"/><circle cx="${cx}" cy="${cy}" r="1.5"/>${iconKnobs(cx, cy, 7.95, 16, 0.85)}`;
const atv = `
${atvWheel(13, 28.6)}
${atvWheel(51, 28.6)}
<path d="M2.6 18.6 Q2.6 15.2 6 15.2 L22.5 15.2 L24 18.6 Z"/>
<path d="M40 18.6 L41.5 15.2 L58.4 15.2 Q61.8 15.2 61.8 18.6 Z"/>
<path d="M21.5 15.2 L42.5 15.2 L44.6 23.6 Q44.6 26.4 41.8 26.4 L24.4 26.4 Q21.6 26.4 21.4 23.6 Z"/>
<rect x="17.8" y="10.4" width="17.4" height="5.4" rx="2.7"/>
<path d="M35 15.6 L36.4 11.6 Q37 10.4 38.4 10.4 L42.2 10.4 L43.6 15.6 Z"/>
<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <path d="M4 11.2 L16 11.2 M5.6 11.2 L5.6 15.2 M10.4 11.2 L10.4 15.2 M15 11.2 L15 15.2"/>
  <path d="M46.6 11.2 L60.4 11.2 M48 11.2 L48 15.2 M53.4 11.2 L53.4 15.2 M58.8 11.2 L58.8 15.2"/>
</g>
<g fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round">
  <path d="M43.4 13.8 L41.6 6.6"/>
  <path d="M38.8 6.4 L44.2 6.4"/>
</g>`;


const VEHICLE_TYPES = [
  { key: "scooter", label: "Scooter", art: scooter },
  { key: "motorbike", label: "Motorbike", art: motorbike },
  { key: "atv", label: "ATV", art: atv },
  { key: "sedan", label: "Sedan", art: sedan },
  { key: "suv", label: "SUV", art: suv }
];
const DEFAULT_VEHICLE_TYPE = "sedan";
function vehicleTypeOf(vehicle) {
  return VEHICLE_TYPES.some(t => t.key === vehicle.type) ? vehicle.type : DEFAULT_VEHICLE_TYPE;
}
function vehicleIconSvg(typeKey) {
  const t = VEHICLE_TYPES.find(x => x.key === typeKey) || VEHICLE_TYPES.find(x => x.key === DEFAULT_VEHICLE_TYPE);
  return `<svg viewBox="0 0 64 40" fill="currentColor" aria-hidden="true" focusable="false">${t.art}</svg>`;
}

document.getElementById("brandIcon").innerHTML = vehicleIconSvg("sedan");
document.getElementById("loginIcon").innerHTML = vehicleIconSvg("sedan");
document.getElementById("brandHomeBtn").onclick = () => {
  if (state.activeVehicleId) closeNav();
};

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
  performTopLevelClose();
});
// Close everything and return to the home page in one step, keeping the back-gesture
// history in sync (used after deleting the open vehicle and after importing a backup).
function goToRoot() {
  document.querySelectorAll(".overlay.open").forEach(o => o.classList.remove("open"));   // every panel, incl. any added later
  state.editing = null;
  state.activeVehicleId = null;
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
  if (settingsOverlay.classList.contains("open")) { settingsOverlay.classList.remove("open"); return; }
  if (state.activeVehicleId) { state.activeVehicleId = null; render(); return; }
  // On the home page with nothing open: this press just used up the root sentinel, so the
  // phone is now on the app's first history entry and the NEXT back press closes the app.
  // If that second press doesn't come within 2 seconds, put the sentinel back.
  if (!exitArmed) {
    exitArmed = true;
    showToast("Press back again to exit");
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
        showToast("Vehicle order updated");
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

function renderVehiclePicker() {
  const wrap = document.createElement("div");
  wrap.className = "picker";
  const list = document.createElement("div");
  list.className = "picker-list";
  state.data.vehicles.forEach(v => {
    const card = document.createElement("div");
    card.className = "picker-card";
    const avatar = document.createElement("div");
    avatar.className = "vtype-icon";
    avatar.innerHTML = vehicleIconSvg(vehicleTypeOf(v));
    const info = document.createElement("div");
    info.className = "picker-card-info";
    info.innerHTML = `
      <div class="picker-card-name">${escapeHtml(v.name)}</div>
      <div class="picker-card-sub">${v.registration ? escapeHtml(v.registration) : "No registration on file"}</div>
    `;
    card.appendChild(avatar);
    card.appendChild(info);
    card.insertAdjacentHTML("beforeend", statusCountBadgeHTML(v));
    const grip = document.createElement("span");
    grip.className = "grip-icon";
    grip.innerHTML = GRIP_ICON;
    card.appendChild(grip);
    const openVehicle = () => { pushNav(); state.activeVehicleId = v.id; render(); };
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.onkeydown = (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openVehicle(); } };
    enableDragReorder(card, list, v.id, openVehicle);
    list.appendChild(card);
  });
  wrap.appendChild(list);
  const addTile = document.createElement("button");
  addTile.className = "picker-add";
  addTile.textContent = "+";
  addTile.setAttribute("aria-label", "Add another vehicle");
  addTile.title = "Add another vehicle";
  addTile.onclick = () => openVehicleModal();
  wrap.appendChild(addTile);
  mainEl.appendChild(wrap);
}

function renderVehicle() {
  mainEl.innerHTML = "";
  const vehicle = state.data.vehicles.find(v => v.id === state.activeVehicleId);

  if (!vehicle) {
    if (state.data.vehicles.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `
        <div class="empty-icon">${vehicleIconSvg("sedan")}</div>
        <div class="empty-title">No vehicles yet</div>
        <div class="empty-copy">Add your first vehicle to start tracking maintenance, insurance, and inspection dates in one place.</div>
        <button id="emptyAddVehicle">+ Add your first vehicle</button>
      `;
      mainEl.appendChild(empty);
      document.getElementById("emptyAddVehicle").onclick = () => openVehicleModal();
      return;
    }
    renderVehiclePicker();
    return;
  }

  const header = document.createElement("div");
  header.className = "vehicle-header";
  const subLine = vehicle.registration ? escapeHtml(vehicle.registration) : "No registration on file";
  header.innerHTML = `
    <div class="vtype-icon">${vehicleIconSvg(vehicleTypeOf(vehicle))}</div>
    <div>
      <div class="vh-name">${escapeHtml(vehicle.name)}</div>
      <div class="vh-sub">${subLine}</div>
    </div>
  `;
  const renameBtn = document.createElement("button");
  renameBtn.className = "rename-btn";
  renameBtn.innerHTML = "&#9998;";
  renameBtn.setAttribute("aria-label", "Edit vehicle");
  renameBtn.onclick = () => openVehicleEditModal(vehicle.id);
  header.appendChild(renameBtn);
  mainEl.appendChild(header);

  if (vehicle.vin || vehicle.note) {
    const meta = document.createElement("div");
    meta.className = "vehicle-meta";
    let rows = "";
    if (vehicle.vin) rows += `<div class="meta-row"><span class="meta-label">VIN</span><span class="meta-value">${escapeHtml(vehicle.vin)}</span></div>`;
    if (vehicle.note) rows += `<div class="meta-row"><span class="meta-label">Note</span><span class="meta-value">${escapeHtml(vehicle.note)}</span></div>`;
    meta.innerHTML = rows;
    mainEl.appendChild(meta);
  }

  CATEGORIES.forEach(cat => {
    const section = document.createElement("div");
    section.className = "section";
    section.style.setProperty("--cat-accent", CATEGORY_ACCENT[cat.key]);
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<div class="section-head-title"><span class="cat-icon" style="color:${CATEGORY_ACCENT[cat.key]}">${CATEGORY_ICONS[cat.key]}</span><h2>${cat.label}</h2></div>`;
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", "Add to " + cat.label);
    addBtn.title = "Add to " + cat.label;
    addBtn.onclick = () => openItemModal(vehicle.id, cat.key, null);
    head.appendChild(addBtn);
    section.appendChild(head);

    const items = (vehicle.items[cat.key] || []).slice().sort((a,b) => {
      if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;          // completed events go last
      const da = daysUntil(a.dueDate); const db = daysUntil(b.dueDate);
      if (da === null && db === null) return 0;
      if (da === null) return 1; if (db === null) return -1;
      return isDone(a) ? db - da : da - db;                              // finished: newest first
    });

    if (items.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = `No ${cat.label.toLowerCase()} events yet.`;
      section.appendChild(hint);
    } else {
      items.forEach(item => {
        const days = daysUntil(item.dueDate);
        const done = isDone(item);
        const card = document.createElement("div");
        card.className = done ? "item-card is-done" : "item-card";
        const doneOn = item.lastDate || item.dueDate;
        card.innerHTML = `
          <div class="item-badge ${done ? "badge-none" : statusClass(days)}"></div>
          <div class="item-main">
            <div class="label">${escapeHtml(item.label)}</div>
            <div class="sub">${done ? (doneOn ? "Done · " + formatDate(doneOn) : "Done") : humanDue(days, item.dueDate)}</div>
          </div>
        `;
        // Whole card = edit. Only one explicit action lives on it: Done.
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.onclick = () => openItemModal(vehicle.id, cat.key, item.id);
        card.onkeydown = (e) => {
          if (e.target === card && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openItemModal(vehicle.id, cat.key, item.id);
          }
        };
        section.appendChild(card);
      });
    }
    mainEl.appendChild(section);
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

let lastRenderDay = null;
function render() {
  lastRenderDay = localISO();
  renderVehicle();
  updateFabVisibility();
}

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
  itemDoneBtn.textContent = formDone ? "\u2713 Done" : "Done";
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
};
function openItemModal(vehicleId, category, itemId, replace) {
  state.editing = { vehicleId, category, itemId };
  const vehicle = state.data.vehicles.find(v => v.id === vehicleId);
  const item = itemId ? vehicle.items[category].find(i => i.id === itemId) : null;
  itemModalTitle.textContent = item ? "Edit event" : "Add event";
  itemLabel.value = item ? item.label : "";
  itemLast.value = item ? item.lastDate || "" : "";
  itemDue.value = item ? item.dueDate || "" : "";
  formDone = !!(item && item.done);
  itemNotes.value = item ? item.notes || "" : "";
  itemDeleteRow.style.display = item ? "flex" : "none";
  syncItemForm();
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
  if (!vehicle || (itemId && !target)) { showToast("This was deleted on another phone"); goToRoot(); return; }
  if (!itemLabel.value.trim()) { showToast("Please enter a name"); return; }
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
document.getElementById("itemDelete").onclick = () => {
  if (navClosing || !state.editing || !itemOverlay.classList.contains("open")) return;
  const { vehicleId, category, itemId } = state.editing;
  const vehicle = state.data.vehicles.find(v => v.id === vehicleId);
  const item = vehicle && vehicle.items[category].find(i => i.id === itemId);
  if (!item) { showToast("This was deleted on another phone"); goToRoot(); return; }
  if (!confirm(`Delete "${item.label}"? You can get it back from Settings > Restore point.`)) return;
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
    btn.innerHTML = `<span class="cat-icon" style="color:${CATEGORY_ACCENT[cat.key]}">${CATEGORY_ICONS[cat.key]}</span><span>${cat.label}</span>`;
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

document.getElementById("fabAdd").onclick = () => {
  if (!state.activeVehicleId) { openVehicleModal(); return; }
  openCategoryPicker();
};

function updateFabVisibility() {
  document.getElementById("fabAdd").style.display = state.activeVehicleId ? "flex" : "none";
}

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
  vehicleModalTitle.textContent = "Add vehicle";
  vehicleDeleteRow.style.display = "none";
  document.getElementById("vehicleName").value = "";
  document.getElementById("vehicleReg").value = "";
  document.getElementById("vehicleVin").value = "";
  document.getElementById("vehicleNote").value = "";
  renderTypePicker();
  vehicleOverlay.classList.add("open");
  pushNav();
}

function openVehicleEditModal(vehicleId) {
  const v = state.data.vehicles.find(x => x.id === vehicleId);
  if (!v) return;
  editingVehicleId = vehicleId;
  selectedVehicleType = vehicleTypeOf(v);
  vehicleModalTitle.textContent = "Edit vehicle";
  vehicleDeleteRow.style.display = "flex";
  document.getElementById("vehicleName").value = v.name;
  document.getElementById("vehicleReg").value = v.registration || "";
  document.getElementById("vehicleVin").value = v.vin || "";
  document.getElementById("vehicleNote").value = v.note || "";
  renderTypePicker();
  vehicleOverlay.classList.add("open");
  pushNav();
}

document.getElementById("vehicleSave").onclick = () => {
  if (navClosing || !vehicleOverlay.classList.contains("open")) return;
  const name = document.getElementById("vehicleName").value.trim();
  const registration = document.getElementById("vehicleReg").value.trim();
  const vin = document.getElementById("vehicleVin").value.trim().toUpperCase();
  const note = document.getElementById("vehicleNote").value.trim();
  if (!name) { showToast("Please enter a vehicle name"); return; }
  if (editingVehicleId) {
    const v = state.data.vehicles.find(x => x.id === editingVehicleId);
    if (!v) { showToast("This vehicle was deleted on another phone"); goToRoot(); return; }
    v.name = name;
    v.type = selectedVehicleType;
    v.registration = registration;
    v.vin = vin;
    v.note = note;
    saveData();
    render();
    showToast("Vehicle updated");
    closeNav();
  } else {
    const wasAtRoot = !state.activeVehicleId;
    const v = { id: uid(), name, type: selectedVehicleType, registration, vin, note, items: { maintenance: [], insurance: [], inspection: [] } };
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

document.getElementById("vehicleDelete").onclick = () => {
  if (navClosing || !editingVehicleId || !vehicleOverlay.classList.contains("open")) return;
  const v = state.data.vehicles.find(x => x.id === editingVehicleId);
  if (!v || !confirm(`Delete "${v.name}" and all its events? You can get it back from Settings > Restore point.`)) return;
  state.data.vehicles = state.data.vehicles.filter(x => x.id !== editingVehicleId);
  saveData();
  goToRoot();                       // the vehicle you were on is gone: back to the home page
  showToast("Vehicle deleted");
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
      if (extra.length && confirm(`This phone has ${extra.length} vehicle${extra.length === 1 ? "" : "s"} that ${extra.length === 1 ? "isn't" : "aren't"} in the account. Add ${extra.length === 1 ? "it" : "them"} to the account?`)) {
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
  const el = document.getElementById("accountInfo");
  if (!el) return;
  const status = !sync.userId ? "" : sync.dirty ? (syncFailed || !navigator.onLine ? "Changes wait for internet" : "Saving…") : "All changes saved";
  el.textContent = sync.email ? `${sync.email} · ${status}` : "Not logged in";
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
  invalid_email: () => "That email doesn't look right",
  weak_password: () => "The password needs at least 8 characters",
  not_allowed: () => "This email isn't on the invite list",
  join_first: r => `${r.join} needs to create an account first`,
  already_registered: () => "This email already has an account. Log in instead"
};
let loginBusy = false;
async function doLogin(register) {
  if (loginBusy) return;
  if (!sb) { sayLogin("The app didn't load fully. Check the internet and reopen it"); return; }
  const email = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;
  if (!email || !password) { sayLogin("Enter your email and password"); return; }
  loginBusy = true;
  document.querySelectorAll("#loginForm button").forEach(b => b.disabled = true);
  sayLogin(register ? "Creating account…" : "Logging in…", true);
  try {
    if (register) {
      const r = await api("register", { email, password });
      if (r.error) { sayLogin((REGISTER_ERRORS[r.error] || (() => "Something went wrong. Try again later"))(r)); return; }
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      sayLogin(error && /invalid/i.test(error.message) ? "Wrong email or password" : "Couldn't log in. Check the internet and try again");
      return;
    }
    sayLogin("Loading your data…", true);
    if (sync.userId === data.user.id) { sync.email = data.user.email; saveSync(); syncNow(); }
    else if (!(await firstSync(data.user))) { sayLogin("Couldn't load your data. Check the internet and try again"); return; }
    loginScreen.hidden = true;
    loginPassword.value = "";
    showToast(register ? "Account created" : "Logged in");
    afterLogin();
  } catch (e) {
    sayLogin("Couldn't reach the server. Check the internet and try again");
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
    else saveMemberSettings();
  } catch (e) {}
}
async function saveMemberSettings() {
  if (!sb || !sync.userId) return;
  try { await sb.from("fleet_members").update({ settings: { leadDays: state.settings.leadDays } }).eq("user_id", sync.userId); } catch (e) {}
}

let loggingOut = false;
document.getElementById("logoutBtn").onclick = async () => {
  const msg = sync.dirty
    ? "Some changes haven't reached the account yet and will be lost. Log out anyway?"
    : "Log out? Your data stays in the account.";
  if (!confirm(msg)) return;
  loggingOut = true;
  try { await withTimeout(unsubscribePush(), 6000); } catch (e) {}
  try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  sync = {};
  saveSync();
  state.data = { vehicles: [] };
  saveData(false);
  state.settings = { ...DEFAULT_SETTINGS };
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

/* ---------------- Settings modal ---------------- */
const settingsOverlay = document.getElementById("settingsOverlay");
const notifToggle = document.getElementById("notifToggle");
document.getElementById("settingsBtn").onclick = () => {
  notifToggle.checked = !!state.settings.notifications;
  document.getElementById("leadDays").value = state.settings.leadDays || 30;
  updateAccountInfo();
  settingsOverlay.classList.add("open");
  pushNav();
};
document.getElementById("settingsClose").onclick = () => closeNav();

notifToggle.onchange = async () => {
  const on = notifToggle.checked;
  notifToggle.disabled = true;
  try {
    if (on) {
      await subscribePush(true);
      showToast("Reminders on: every day at 08:00");
    } else {
      await unsubscribePush();
    }
    state.settings.notifications = on;
    saveSettings();
  } catch (err) {
    notifToggle.checked = !on;
    const m = err && err.message;
    showToast(m === "unsupported" ? "Notifications aren't supported here. On iPhone, add the app to the Home Screen first"
      : m === "denied" ? "Notifications are blocked for this app in the phone's settings"
      : "Couldn't change notifications. Check the internet");
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
  if (!state.settings.notifications) { showToast("Turn on reminder notifications first"); return; }
  btn.disabled = true;
  try {
    const token = await accessToken();
    if (!token) { showToast("Connect to the internet and try again"); return; }
    const r = await api("test", {}, token);
    if (r.error) showToast("Couldn't send. Try again later");
    else if (!r.phones) showToast("This phone isn't signed up. Turn notifications off and on again");
    else if (r.sent) showToast(`Sent to ${r.sent} phone${r.sent === 1 ? "" : "s"}. Check your notifications`);
    else showToast("Couldn't deliver. Turn notifications off and on again");
  } catch (err) {
    showToast("Connect to the internet and try again");
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
  showToast("Backup exported");
}

document.getElementById("exportBtn").onclick = () => performBackupExport();
document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
document.getElementById("importFile").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data = null;
    try { data = normalizeData(JSON.parse(reader.result)); } catch (err) {}
    if (!data) { showToast("That file isn't a My Fleet backup"); return; }
    const n = data.vehicles.length;
    if (!confirm(`Replace everything in the app with this backup (${n} vehicle${n === 1 ? "" : "s"})?`)) return;
    state.data = data;
    if (!saveData()) return;
    goToRoot();
    showToast("Backup imported");
  };
  reader.onerror = () => showToast("Couldn't open that file");
  reader.readAsText(file);
};

/* ---------------- Restore list ----------------
   The account keeps the last 30 versions of the data (one per saved change), off the phone. */
const restoreOverlay = document.getElementById("restoreOverlay");
function restoreLabel(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (localISO(d) === localISO()) return `Today ${time}`;
  if (localISO(d) === localISO(yesterday)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}
function restoreSummary(data) {
  const vs = (data && data.vehicles) || [];
  const ev = vs.reduce((n, v) => n + CATEGORIES.reduce((m, c) => m + ((v.items && v.items[c.key]) || []).length, 0), 0);
  return `${vs.length} vehicle${vs.length === 1 ? "" : "s"} · ${ev} event${ev === 1 ? "" : "s"}`;
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
  if (!points) { showToast("Restore points need internet"); return; }
  if (!points.length) { showToast("No restore points yet"); return; }
  if (!settingsOverlay.classList.contains("open")) return;   // closed while loading
  const list = document.getElementById("restoreList");
  list.innerHTML = "";
  points.forEach(p => {
    const data = normalizeData(p.data);
    const t = Date.parse(p.created_at);
    const isNow = !!data && same(data, state.data);
    const btn = document.createElement("button");
    btn.className = "restore-item";
    btn.disabled = isNow || !data;
    btn.innerHTML = `<span class="when">${restoreLabel(t)}${isNow ? " · now" : ""}</span><span class="what">${restoreSummary(data)}</span>`;
    btn.onclick = () => {
      if (!confirm(`Go back to ${restoreLabel(t)}? Changes made after it will be replaced.`)) return;
      state.data = data;
      if (!saveData()) return;          // the restored data becomes the newest version in the account
      goToRoot();
      showToast(`Restored to ${restoreLabel(t)}`);
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
setInterval(() => { if (document.visibilityState === "visible" && sync.dirty) syncNow(); }, 60000);

async function startAccount() {
  if (!sb) { if (!sync.userId) showLogin("The app didn't load fully. Check the internet and reopen it"); return; }
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {   // never call the account library from inside its own callback
      if (event === "SIGNED_OUT" && sync.userId && !loggingOut) showLogin("Please log in again");
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
    else showLogin("Couldn't load your data. Check the internet and log in");
  }
  else if (!(savedLogin && sync.userId)) showLogin();   // a saved login without internet keeps working offline
}

/* ---------------- Init ---------------- */
render();
restoreRootSentinel(); // root sentinel, so the first back press on the home page can be caught
if (dataLoadProblem) showToast("Saved data couldn't be read. Import a backup to restore");
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
