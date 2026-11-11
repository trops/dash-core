/**
 * issueController.js
 *
 * The app's issues (issues PRD): what went wrong in widgets, bots and
 * providers, kept in `<userData>/dash-issues.json` and told to every window
 * when it changes (ISSUES_CHANGED). The main process records failures it
 * sees itself (a widget's provider call, a bot run, a provider that couldn't
 * start); the renderer records what only it sees (a widget that crashed).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  createIssueStore,
  assetKey,
  widgetItemId,
} = require("../issues/issueStore");
const { widgetCallIssue, widgetCrashIssue } = require("../issues/issueSources");

/**
 * What the renderer sends — the facts, tagged by `from` — as an issue, with
 * the same words and likely cause as the main process uses. Anything else
 * is taken as an issue already.
 */
function fromRenderer(input) {
  if (!input || typeof input !== "object") return input;
  if (input.from === "widget-call") return widgetCallIssue(input);
  if (input.from === "widget-crash") return widgetCrashIssue(input);
  return input;
}
const { ISSUES_CHANGED } = require("../events/issueEvents");

const FILE = "dash-issues.json";
const SAVE_DELAY_MS = 1000;

let store = null;
let file = null;
let getWindows = () => [];
let saveTimer = null;
// What a widget asked for and the errors it got can hold the user's data:
// the list is sealed at rest like bot runs (secretBox; plain when the OS
// has no keychain).
let box = null;

function defaultBox() {
  try {
    const { createSecretBox } = require("../bots/secretBox");
    return createSecretBox(require("electron").safeStorage);
  } catch (_e) {
    return null;
  }
}

// The file was there but couldn't be read (sealed by a keychain this
// session can't open): it's left as it is, never overwritten with less.
let unreadable = false;

function readList(p) {
  unreadable = false;
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (_e) {
    return []; // No file yet.
  }
  try {
    const raw = JSON.parse(text);
    if (raw && typeof raw.sealed === "string") {
      const opened = box ? box.open(raw.sealed) : raw.sealed;
      if (opened == null) throw new Error("sealed by another keychain");
      const list = JSON.parse(opened);
      return Array.isArray(list) ? list : [];
    }
    return Array.isArray(raw && raw.issues) ? raw.issues : [];
  } catch (_e) {
    unreadable = true;
    return [];
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!store || !file || unreadable) return;
  try {
    const tmp = `${file}.tmp`;
    const json = JSON.stringify(store.all());
    fs.writeFileSync(
      tmp,
      JSON.stringify({ v: 2, sealed: box ? box.seal(json) : json }),
    );
    fs.renameSync(tmp, file);
  } catch (_e) {
    // Best effort: issues are a convenience, never a reason to fail.
  }
}

// Repeated failures save at most once a second.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  if (saveTimer && typeof saveTimer.unref === "function") saveTimer.unref();
}

function broadcast(payload) {
  for (const win of getWindows() || []) {
    try {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(ISSUES_CHANGED, payload);
      }
    } catch (_e) {
      // A closing window.
    }
  }
}

function ensure() {
  if (store) return store;
  if (!box) box = defaultBox();
  let dir = null;
  try {
    dir = require("electron").app.getPath("userData");
  } catch (_e) {
    dir = null;
  }
  file = dir ? path.join(dir, FILE) : null;
  store = createIssueStore({
    initial: file ? readList(file) : [],
    onChange: scheduleSave,
  });
  return store;
}

const issueController = {
  /** @param {{ getWindows?: () => BrowserWindow[], dataDir?: string }} deps */
  init(deps = {}) {
    if (typeof deps.getWindows === "function") getWindows = deps.getWindows;
    box = deps.secretBox || box || defaultBox();
    if (deps.dataDir) {
      file = path.join(deps.dataDir, FILE);
      store = createIssueStore({
        initial: readList(file),
        onChange: scheduleSave,
      });
    }
    ensure();
  },

  /** Record a failure; every window hears about it. */
  record(input) {
    const res = ensure().record(fromRenderer(input));
    if (res) broadcast({ counts: store.counts(), issue: res.issue });
    return res ? res.issue : null;
  },

  list(filter = {}) {
    return ensure().list(filter || {});
  },

  counts() {
    return ensure().counts();
  },

  resolve(id) {
    const ok = ensure().resolve(id);
    if (ok) broadcast({ counts: store.counts() });
    return ok;
  },

  /**
   * Every open issue of an asset resolved (it worked again) — or only one
   * severity's ({ severity: "problem" }).
   */
  resolveAsset(asset, opts = {}) {
    const n = ensure().resolveAsset(asset, opts || {});
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  /** A call that failed before worked: its issue is resolved. */
  resolveWorked(input) {
    const n = ensure().resolveWorked(fromRenderer(input));
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  /** The asset is gone (a deleted bot or provider): its issues go too. */
  forgetAsset(asset) {
    const want = assetKey(asset);
    if (!want) return 0;
    const n = ensure().removeWhere((i) => assetKey(i.asset) === want);
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  /** A deleted dashboard: its widgets' and bots' issues go. */
  forgetWorkspace(workspaceId) {
    if (workspaceId == null) return 0;
    const id = String(workspaceId);
    const n = ensure().removeWhere(
      (i) => i.asset.kind === "widget" && String(i.asset.workspaceId) === id,
    );
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  /**
   * A dashboard was saved: issues of widgets no longer on it go (removed
   * from the layout, or swapped for another widget).
   */
  sweepWorkspace(workspace) {
    if (!workspace || workspace.id == null) return 0;
    const id = String(workspace.id);
    const present = new Set();
    const walk = (items) => {
      for (const item of Array.isArray(items) ? items : []) {
        if (!item || typeof item !== "object") continue;
        if (item.component) {
          const key = widgetItemId(item);
          if (key != null) present.add(`${item.component}#${key}`);
        }
        walk(item.items);
        walk(item.layout);
      }
    };
    walk(workspace.layout);
    for (const p of workspace.pages || []) walk(p && p.layout);
    walk(workspace.sidebarLayout);
    const n = ensure().removeWhere(
      (i) =>
        i.asset.kind === "widget" &&
        String(i.asset.workspaceId) === id &&
        !present.has(`${i.asset.component}#${i.asset.itemId}`),
    );
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  clearResolved() {
    const n = ensure().clearResolved();
    if (n) broadcast({ counts: store.counts() });
    return n;
  },

  /** Write now (the app is quitting). */
  flush: saveNow,

  /** Tests only. */
  _reset() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    store = null;
    file = null;
    box = null;
    getWindows = () => [];
  },
};

module.exports = issueController;
