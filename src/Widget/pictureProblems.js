/**
 * pictureProblems.js — a picture a widget couldn't show, said in the app
 * (widget side panel, approved mockup frame 3): the exact address it tried
 * and why, so nobody has to open a terminal to find out.
 *
 * Kept per copy of a widget (its `data-widget-uuid`, else its package key
 * `data-widget-key`), from the window's capture-phase events:
 *   error  on an <img> inside a widget's box   → a problem
 *   load   on an <img> inside a widget's box   → that address works now
 *   securitypolicyviolation (img-src)          → Dash's rules blocked it
 *
 * Why it failed:
 *   "not-address"  the src isn't a web address (no http:// or https:// —
 *                  "http//10.0.0.107/…" becomes a file path and fails)
 *   "blocked"      Dash's security rules don't allow that address
 *   "failed"       nothing came back as a picture (not found, the server
 *                  didn't answer, or it isn't a picture)
 */

const MAX_PER_COPY = 20;
const problems = new Map(); // copy → Map(address → problem)
const blocked = new Set(); // addresses Dash's rules blocked
const listeners = new Set();

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (_e) {
      // a listener's own problem
    }
  }
}

/** Listen for changes (a picture failed, or loaded after all). */
export function subscribePictures(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Written like a web address, but isn't one: "http//host", "http:/host",
// or a server path with no server in front ("/api/…" → file:///api/…).
const BROKEN_WEB = /^(https?(?!:\/\/)[:/]|\/(?!\/))/i;
const MAX_COPIES = 200;

/**
 * Why a picture failed, from its src as written (`raw`) and as the page
 * resolved it (`resolved`).
 */
export function pictureReason(raw, resolved = "", wasBlocked = false) {
  const src = String(raw || "").trim();
  if (src && BROKEN_WEB.test(src)) return "not-address";
  if (wasBlocked || blocked.has(resolved) || blocked.has(src)) return "blocked";
  return "failed";
}

/** The words for a reason, about this address. */
export function pictureReasonText(reason, address = "") {
  const a = String(address || "");
  if (reason === "not-address") {
    if (/^https?\/\//i.test(a)) {
      return 'Not a web address: it\'s missing ":" after http.';
    }
    if (a.startsWith("/")) {
      return "Not a web address: it's a path with no server address in front of it.";
    }
    return "Not a web address: it should start with http:// or https://.";
  }
  if (reason === "blocked") {
    return "Dash blocked it: its security rules don't allow this address.";
  }
  return "Nothing came back as a picture: the address wasn't found, the server didn't answer, or it isn't a picture.";
}

/** The copy a widget's element belongs to, from its box. */
function copyOf(target) {
  if (!target || typeof target.closest !== "function") return null;
  const box = target.closest("[data-widget-key]");
  if (!box) return null;
  return (
    box.getAttribute("data-widget-uuid") || box.getAttribute("data-widget-key")
  );
}

/** A picture of `copy` failed. */
export function notePictureFailed(copy, raw, resolved = "", now = Date.now()) {
  if (!copy) return;
  const reason = pictureReason(raw, resolved);
  const address =
    reason === "not-address"
      ? String(raw || "").trim()
      : String(resolved || raw || "");
  if (!address) return;
  const list = problems.get(copy) || new Map();
  const had = list.get(address);
  if (had && had.reason === reason) return;
  if (!had && list.size >= MAX_PER_COPY) return;
  list.set(address, { address, raw: String(raw || ""), reason, at: now });
  problems.delete(copy);
  problems.set(copy, list);
  // Never grows without end: the copies heard from longest ago go first.
  while (problems.size > MAX_COPIES) {
    problems.delete(problems.keys().next().value);
  }
  notify();
}

/** A picture of `copy` loaded: that address is no problem any more. */
export function notePictureLoaded(copy, raw, resolved = "") {
  const list = copy && problems.get(copy);
  if (!list) return;
  const gone =
    list.delete(String(resolved || "")) ||
    list.delete(String(raw || "").trim());
  if (!list.size) problems.delete(copy);
  if (gone) notify();
}

/** Dash's rules blocked an address — a problem with it says so. */
export function noteBlocked(address) {
  const a = String(address || "");
  if (!a) return;
  blocked.add(a);
  let changed = false;
  for (const list of problems.values()) {
    const p = list.get(a);
    if (p && p.reason === "failed") {
      list.set(a, { ...p, reason: "blocked" });
      changed = true;
    }
  }
  if (changed) notify();
}

/** The pictures a copy couldn't show (newest first). */
export function pictureProblemsFor(...copies) {
  const out = [];
  for (const c of copies) {
    const list = c != null && problems.get(String(c));
    if (list) out.push(...list.values());
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Forget a copy's problems (its settings were saved, its code changed). */
export function clearPictureProblems(copy) {
  if (problems.delete(String(copy))) notify();
}

const installedOn = new WeakSet();
/** Watch the window's pictures (once). */
export function installPictureWatch(
  win = typeof window !== "undefined" ? window : null,
) {
  if (!win || !win.addEventListener || installedOn.has(win)) return;
  installedOn.add(win);
  const isImg = (t) => t && String(t.tagName || "").toUpperCase() === "IMG";
  win.addEventListener(
    "error",
    (e) => {
      const t = e && e.target;
      if (!isImg(t)) return;
      notePictureFailed(
        copyOf(t),
        t.getAttribute("src"),
        t.currentSrc || t.src || "",
      );
    },
    true,
  );
  win.addEventListener(
    "load",
    (e) => {
      const t = e && e.target;
      if (!isImg(t)) return;
      notePictureLoaded(
        copyOf(t),
        t.getAttribute("src"),
        t.currentSrc || t.src || "",
      );
    },
    true,
  );
  const doc = win.document;
  if (doc && doc.addEventListener) {
    doc.addEventListener("securitypolicyviolation", (e) => {
      const directive = String(
        (e && (e.effectiveDirective || e.violatedDirective)) || "",
      );
      if (directive.startsWith("img-src")) noteBlocked(e.blockedURI);
    });
  }
}

/** Tests: forget everything. */
export function _resetPictures() {
  problems.clear();
  blocked.clear();
  listeners.clear();
}
