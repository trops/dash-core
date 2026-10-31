/**
 * widgetGuard.js — one widget can never freeze Dash (widget guard and safe
 * start, approved mockup frames 1-3).
 *
 * The guard: errors are counted per widget package — a throw in its code
 * (its bundle is tagged `//# sourceURL=dash-widget://<key>/…`, so the stack
 * says whose it is), a file it failed to load (the element sits inside its
 * `data-widget-key` box), or a crash its error boundary caught. A widget
 * that fails LIMIT times in WINDOW ms is stopped: WidgetFactory shows
 * "Stopped — it kept failing" in its place (unmounting it stops its timers)
 * until Try again. Only that widget; the rest of the dashboard keeps going.
 *
 * Safe start: a dashboard that's open is marked "opening" until it has run
 * for a while. If Dash froze or quit before that (the mark is still there
 * at the next start), that dashboard opens with its widgets paused. Help ›
 * Start Without Widgets (dash-electron) reloads with `?startPaused=1`:
 * every dashboard opens paused, once. Only the main window takes part.
 */

export const LIMIT = 20;
export const WINDOW = 10000;
// A dashboard that has run this long without freezing finished loading.
export const SETTLE_MS = 15000;
const OPENING_KEY = "dash:dashboard-opening";
const START_PAUSED_KEY = "dash:start-paused";

const failures = new Map(); // key → [timestamps]
// Files that failed to load: the same element or address failing again is
// a loop; one broken picture among many (or going offline) isn't.
let failedElements = new WeakSet();
const failedSources = new Map(); // key → Set of addresses
const stopped = new Map(); // key → { count, why, at }
const listeners = new Set();

/**
 * A widget's package key, whatever names it: "@ai-built/player",
 * "ai-built.player.Player" and "ai-built.player" are all "ai-built.player".
 * A bare component name stays as it is.
 */
export function widgetKey(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (s.startsWith("@") && s.includes("/")) return s.slice(1).replace("/", ".");
  const parts = s.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}` : s;
}

/**
 * The bundle's tag, appended to its source when it's evaluated. The Widget
 * Builder's preview gets its own, never counted: its errors aren't the
 * installed widget's.
 */
export function bundleSourceUrl(name, { preview = false } = {}) {
  const host = encodeURIComponent(widgetKey(name));
  return preview
    ? `dash-widget-preview://${host}/bundle.js`
    : `dash-widget://${host}/bundle.js`;
}

/** Whose code a stack is from, or null. */
export function widgetFromStack(stack) {
  const m = /dash-widget:\/\/([^/\s)]+)\//.exec(String(stack || ""));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_e) {
    return m[1];
  }
}

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (_e) {
      // a listener's own problem
    }
  }
}

/** Listen for changes (a widget stopped or restarted, paused or on). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * One failure of a widget. Past LIMIT in WINDOW, it's stopped.
 * @param {string} key  widgetKey(…)
 * @param {"error"|"load"|"render"} why
 * @returns {boolean} it's stopped now
 */
export function noteFailure(key, why = "error", now = Date.now()) {
  if (!key) return false;
  if (stopped.has(key)) return true;
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW);
  list.push(now);
  failures.set(key, list);
  if (list.length < LIMIT) return false;
  stopped.set(key, { count: list.length, why, at: now });
  failures.delete(key);
  notify();
  return true;
}

/** Why a widget was stopped ({ count, why, at }), or null. */
export function stoppedInfo(key) {
  return stopped.get(key) || null;
}

/** Try again (or new code installed): it runs again, its count from zero. */
export function restart(key) {
  failures.delete(key);
  failedSources.delete(key);
  if (stopped.delete(key)) notify();
}

/** A file a widget failed to load: counted when it fails again. */
function noteLoadFailure(key, target) {
  const src = target.currentSrc || target.src || target.href || "";
  const seen = failedSources.get(key) || new Set();
  const again = failedElements.has(target) || (src && seen.has(src));
  failedElements.add(target);
  if (src && seen.size < 500) {
    seen.add(src);
    failedSources.set(key, seen);
  }
  if (again) noteFailure(key, "load");
}

// Windows already counting (once each, even across _reset).
const installedOn = new WeakSet();
/**
 * Count widget errors from the window (once): a throw from a widget's code
 * (its stack), a file a widget failed to load (its box), an unhandled
 * rejection from a widget's code.
 */
export function installWidgetGuard(
  win = typeof window !== "undefined" ? window : null,
) {
  if (!win || !win.addEventListener || installedOn.has(win)) return;
  installedOn.add(win);
  win.addEventListener(
    "error",
    (e) => {
      const target = e && e.target;
      if (target && target !== win && typeof target.closest === "function") {
        const box = target.closest("[data-widget-key]");
        if (box) noteLoadFailure(box.getAttribute("data-widget-key"), target);
        return;
      }
      const key = widgetFromStack(e && e.error && e.error.stack);
      if (key) noteFailure(key, "error");
    },
    true,
  );
  win.addEventListener("unhandledrejection", (e) => {
    const key = widgetFromStack(e && e.reason && e.reason.stack);
    if (key) noteFailure(key, "error");
  });
}

// ── Safe start ──────────────────────────────────────────────────────

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_e) {
    return null;
  }
}
function read(key) {
  try {
    const s = storage();
    return s ? s.getItem(key) : null;
  } catch (_e) {
    return null;
  }
}
function write(key, value) {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch (_e) {
    // no storage: no safe start, nothing else changes
  }
}

// Popout windows share the main window's storage, so only the main window
// marks, reads or clears it (popouts load "#/popout…").
function isMainWindow() {
  try {
    return !/^#\/popout/.test(window.location.hash || "");
  } catch (_e) {
    return true;
  }
}

// What this start found: the dashboard that didn't finish loading last time,
// or Start without widgets. Read once.
let startState = null;
function start() {
  if (startState) return startState;
  if (!isMainWindow()) {
    startState = { all: false, dashboards: new Set(), on: new Set() };
    return startState;
  }
  let unfinished = null;
  try {
    const raw = read(OPENING_KEY);
    unfinished = raw ? JSON.parse(raw) : null;
  } catch (_e) {
    unfinished = null;
  }
  // Help › Start without widgets reloads the window with ?startPaused=1
  // (the page may be frozen, so it can't be asked to set anything).
  let fromMenu = false;
  try {
    fromMenu = /[?&]startPaused=1(&|$)/.test(window.location.search || "");
    // Once: a later reload starts as usual.
    if (fromMenu) {
      const url = new URL(window.location.href);
      url.searchParams.delete("startPaused");
      window.history.replaceState(window.history.state, "", url.href);
    }
  } catch (_e) {
    fromMenu = false;
  }
  const all = fromMenu || read(START_PAUSED_KEY) === "1";
  write(OPENING_KEY, null);
  write(START_PAUSED_KEY, null);
  startState = {
    all,
    dashboards: new Set(
      unfinished && unfinished.id != null ? [String(unfinished.id)] : [],
    ),
    on: new Set(), // "dashboardId" (all on) or "dashboardId:uuid"
  };
  return startState;
}

/** Why a dashboard's widgets are paused: "unfinished" | "start" | null. */
export function pausedReason(dashboardId) {
  const s = start();
  const id = String(dashboardId);
  if (s.on.has(id)) return null;
  if (s.dashboards.has(id)) return "unfinished";
  return s.all ? "start" : null;
}

/** One widget on a paused dashboard is still paused. */
export function isPaused(dashboardId, uuid) {
  if (dashboardId == null) return false;
  if (!pausedReason(dashboardId)) return false;
  return !start().on.has(`${dashboardId}:${uuid}`);
}

/** Turn one widget on, or (no uuid) every widget on the dashboard. */
export function turnOn(dashboardId, uuid = null) {
  const s = start();
  s.on.add(uuid == null ? String(dashboardId) : `${dashboardId}:${uuid}`);
  // Watched again: if turning it on freezes Dash, the next start pauses it.
  markOpening(dashboardId);
  notify();
}

// The one mark this window holds: a newer one replaces it.
let currentMark = null;

/**
 * A dashboard is open: marked until it has run SETTLE_MS without freezing
 * (a frozen app never gets there, so the next start pauses it). Returns
 * the cleanup for when it closes, which clears the mark if it's still this
 * one (closed before it settled isn't a freeze).
 */
export function markOpening(dashboardId) {
  if (dashboardId == null || !isMainWindow()) return () => {};
  start();
  if (currentMark) currentMark.drop(false);
  const value = JSON.stringify({ id: String(dashboardId), at: Date.now() });
  write(OPENING_KEY, value);
  const mark = {};
  const clear = () => {
    if (read(OPENING_KEY) === value) write(OPENING_KEY, null);
  };
  const t = setTimeout(() => mark.drop(true), SETTLE_MS);
  mark.drop = (clearIt) => {
    clearTimeout(t);
    if (typeof window !== "undefined" && window.removeEventListener)
      window.removeEventListener("beforeunload", clear);
    if (clearIt) clear();
    if (currentMark === mark) currentMark = null;
  };
  if (typeof window !== "undefined" && window.addEventListener)
    window.addEventListener("beforeunload", clear);
  currentMark = mark;
  return () => mark.drop(true);
}

/** Tests: forget everything. */
export function _reset() {
  failures.clear();
  stopped.clear();
  failedSources.clear();
  failedElements = new WeakSet();
  if (currentMark) currentMark.drop(false);
  currentMark = null;
  listeners.clear();
  startState = null;
}
