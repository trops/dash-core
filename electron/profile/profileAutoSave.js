/**
 * profileAutoSave.js
 *
 * Auto-save to the account (dash-profiles v3, Slice 3): a profile kept in
 * the account can save itself — "When I make changes" (30 seconds after
 * the last change) or "Every day at" a time (if Dash was closed then, on
 * the next launch). Manually is the default.
 *
 * It never publishes (a profile save never does) and never overwrites a
 * newer copy saved from another computer: that save is refused, the
 * reason is recorded, and the updates dialog offers the choice. A save
 * happens only when the profile changed since it was last saved or loaded
 * (profileDigest) — a bot run or opening a dashboard isn't a change. After
 * a save that didn't go through it tries again no sooner than 15 minutes
 * (a daily save too — a short network blip doesn't cost the day).
 *
 * Changes are noticed by watching the files a profile's setup lives in,
 * so every way of changing them counts. Saves — automatic and manual —
 * run one at a time (`exclusive`). Settings are kept per signed-in user
 * and profile in `profileAutoSave.json`:
 *   { owner: { profileId: { mode, time, since, options, last } } }
 */
const fs = require("fs");
const path = require("path");

const FILE = "profileAutoSave.json";
const MODES = new Set(["manual", "changes", "daily"]);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEBOUNCE_MS = 30 * 1000;
const TICK_MS = 60 * 1000;
const LAUNCH_MS = 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
// The files a profile's setup lives in (the app's folder and userData).
const WATCHED = new Set([
  "workspaces.json",
  "themes.json",
  "menuItems.json",
  "profiles.json",
  "dash-bots.json",
  "registry.json",
]);

function defaultDeps() {
  const appFile = (appId, name) =>
    require("../utils/appPaths").getAppFilePath(appId, name);
  return {
    appId: () => require("./activeProfile").getAppId(),
    filePath: (appId) => appFile(appId, FILE),
    owner: () => {
      try {
        const auth = require("../controller/registryAuthController");
        return (auth.getStoredUsername && auth.getStoredUsername()) || null;
      } catch (_e) {
        return null;
      }
    },
    links: (appId, owner) => require("./profileAccount").allLinks(appId, owner),
    profileIds: (appId) =>
      require("./profileStore")
        .list(appId)
        .map((p) => p.id),
    changed: (appId, profileId, link) => {
      const {
        profileDigest,
        digestChanges,
        cleanDigest,
      } = require("./profileDigest");
      const now = profileDigest(appId, profileId);
      return digestChanges(cleanDigest(link && link.digest), now).total > 0;
    },
    save: (win, appId, profileId, options) =>
      require("./profileSaveV3").executeSave(win, appId, profileId, options, {
        target: "account",
      }),
    watchDirs: (appId) => {
      let userData = null;
      try {
        userData = require("electron").app.getPath("userData");
      } catch (_e) {
        userData = null;
      }
      return [
        path.dirname(appFile(appId, "workspaces.json")),
        userData,
        userData ? path.join(userData, "widgets") : null,
      ].filter(Boolean);
    },
    watch: (dir, onChange) => {
      fs.mkdirSync(dir, { recursive: true });
      return fs.watch(dir, onChange);
    },
    now: () => new Date(),
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (...a) => setInterval(...a),
    clearInterval: (t) => clearInterval(t),
  };
}

// ---- one save at a time ------------------------------------------------------

let chain = Promise.resolve();

/**
 * Run `fn` when no other save is running (an auto-save pass or a manual
 * save to the account) — so two saves never race over one revision.
 */
function exclusive(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// ---- settings ---------------------------------------------------------------

const ownerKey = (owner) => String(owner || "").toLowerCase();

function readAll(appId, d) {
  const file = d.filePath(appId);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_e) {
    return {};
  }
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (_e) {
    // Damaged: kept aside (never silently overwritten), then started over.
    try {
      fs.copyFileSync(file, `${file}.bak`);
    } catch (_e2) {
      // nothing to keep
    }
    return {};
  }
}

function writeAll(appId, all, d) {
  const file = d.filePath(appId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written whole or not at all.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file);
}

/** One profile's setting, checked (anything odd reads as Manually). */
function clean(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = {
    mode: MODES.has(s.mode) ? s.mode : "manual",
    time: typeof s.time === "string" && TIME.test(s.time) ? s.time : "09:00",
    since: typeof s.since === "string" ? s.since : null,
    options: {
      bots: !(s.options && s.options.bots === false),
      settings: !(s.options && s.options.settings === false),
    },
    last: null,
  };
  if (s.last && typeof s.last === "object" && typeof s.last.at === "string") {
    out.last = { at: s.last.at, ok: s.last.ok === true };
    for (const k of ["error", "savedAt", "retryAt"]) {
      if (typeof s.last[k] === "string") out.last[k] = s.last[k];
    }
    if (s.last.transient === true) out.last.transient = true;
  }
  return out;
}

/** `owner`'s settings here: { profileId: setting }. */
function getSettings(appId, owner, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const mine = readAll(appId, d)[ownerKey(owner)] || {};
  const out = {};
  for (const [id, s] of Object.entries(mine)) out[id] = clean(s);
  return out;
}

function update(appId, owner, profileId, fn, d) {
  if (!owner) throw new Error("Sign in to keep profiles in your account.");
  const all = readAll(appId, d);
  const key = ownerKey(owner);
  all[key] = all[key] && typeof all[key] === "object" ? all[key] : {};
  all[key][profileId] = fn(clean(all[key][profileId]));
  writeAll(appId, all, d);
  return clean(all[key][profileId]);
}

/** Set how a profile saves itself: { mode, time }. */
function setSetting(appId, owner, profileId, { mode, time } = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!MODES.has(mode)) throw new Error("Pick how it saves.");
  if (mode === "daily" && !TIME.test(String(time || ""))) {
    throw new Error("Pick a time, like 09:00.");
  }
  return update(
    appId,
    owner,
    profileId,
    (s) => ({
      ...s,
      mode,
      ...(mode === "daily" ? { time } : {}),
      // A daily save counts from now: setting it at 10:00 for 09:00
      // doesn't save at once.
      since: d.now().toISOString(),
    }),
    d,
  );
}

/** A manual save to the account: what it chose is what auto-save uses. */
function recordManualSave(appId, owner, profileId, options, result, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!owner) return null;
  return update(
    appId,
    owner,
    profileId,
    (s) => ({
      ...s,
      options: {
        bots: !(options && options.bots === false),
        settings: !(options && options.settings === false),
      },
      last: lastFrom(result, d),
    }),
    d,
  );
}

/** Forget a deleted profile's settings, for everyone. */
function forgetProfile(appId, profileId, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const all = readAll(appId, d);
  let touched = false;
  for (const mine of Object.values(all)) {
    if (mine && typeof mine === "object" && mine[profileId]) {
      delete mine[profileId];
      touched = true;
    }
  }
  if (touched) writeAll(appId, all, d);
}

/**
 * How a save went, as `last`. A failure is tried again no sooner than
 * RETRY_MS; one that may pass by itself (the network, the registry) is
 * `transient` — a daily save retries it the same day.
 */
function lastFrom(result, d) {
  const now = d.now();
  const at = now.toISOString();
  if (result && result.success) {
    return {
      at,
      ok: true,
      ...(result.account && result.account.savedAt
        ? { savedAt: result.account.savedAt }
        : {}),
    };
  }
  let error = (result && result.error) || "Couldn't save.";
  let transient = false;
  if (result && result.conflict && !result.conflict.missing) {
    error =
      "Your account has a newer copy, saved from another computer — open Check for updates in your account menu to choose which to keep.";
  } else if (result && result.conflict && result.conflict.missing) {
    error =
      "It isn't in your account any more — save it to your account again to add it back.";
  } else if (result && result.signInRequired) {
    error = "Sign in to the registry to save it.";
  } else if (!/too big/i.test(error)) {
    transient = true;
  }
  return {
    at,
    ok: false,
    error,
    retryAt: new Date(now.getTime() + RETRY_MS).toISOString(),
    ...(transient ? { transient: true } : {}),
  };
}

// ---- when ------------------------------------------------------------------

/**
 * The most recent "HH:MM" at or before `now` (local time): today's, or
 * yesterday's when today's hasn't come yet.
 */
function lastOccurrence(time, now) {
  const m = TIME.exec(String(time || ""));
  if (!m) return null;
  const at = new Date(now.getTime());
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (at.getTime() > now.getTime()) at.setDate(at.getDate() - 1);
  return at;
}

/** Whether a failed save waits a while before it's tried again. */
function waiting(setting, now) {
  const last = setting && setting.last;
  if (!last || last.ok) return false;
  const retry = Date.parse(last.retryAt || "");
  return Number.isFinite(retry) && now.getTime() < retry;
}

/**
 * Whether a daily save is due: its time passed since it was set or last
 * tried — a try that failed for a while (`transient`) doesn't count, so
 * it's tried again after the wait.
 */
function dailyDue(setting, now) {
  if (!setting || setting.mode !== "daily") return false;
  const at = lastOccurrence(setting.time, now);
  if (!at) return false;
  if (waiting(setting, now)) return false;
  const since = Date.parse(setting.since || "");
  const last = setting.last;
  const tried =
    last && !last.transient ? Date.parse(last.at || "") : Number.NaN;
  const after = Math.max(
    Number.isFinite(since) ? since : 0,
    Number.isFinite(tried) ? tried : 0,
  );
  return at.getTime() > after;
}

// ---- running ---------------------------------------------------------------

/**
 * One pass: each profile here kept in the account with auto-save on is
 * saved when it's due and changed. `reason`: "change" (files changed, after
 * the wait), "launch", or "tick" (the daily check).
 *
 * @returns {Promise<Array<{profileId, saved?, skipped?, error?}>>}
 */
async function runOnce(reason, getWin = () => null, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const appId = d.appId();
  const owner = d.owner();
  if (!appId || !owner) return [];
  const settings = getSettings(appId, owner, d);
  const links = d.links(appId, owner);
  const here = new Set(d.profileIds(appId));
  const out = [];
  for (const [profileId, s] of Object.entries(settings)) {
    if (
      s.mode === "manual" ||
      !Object.prototype.hasOwnProperty.call(links, profileId) ||
      !here.has(profileId)
    ) {
      continue;
    }
    // One profile's trouble never stops the others.
    try {
      const now = d.now();
      const due =
        s.mode === "changes"
          ? (reason === "change" || reason === "launch") && !waiting(s, now)
          : dailyDue(s, now);
      if (!due) continue;
      if (!d.changed(appId, profileId, links[profileId])) {
        // Nothing to save (or the copy was taken from the account): in
        // step — an earlier failure no longer stands; a daily check is
        // done for today.
        if (s.mode === "daily" || (s.last && !s.last.ok)) {
          update(
            appId,
            owner,
            profileId,
            (x) => ({ ...x, last: { at: now.toISOString(), ok: true } }),
            d,
          );
        }
        out.push({ profileId, skipped: "unchanged" });
        continue;
      }
      let result;
      try {
        result = await d.save(getWin(), appId, profileId, s.options);
      } catch (e) {
        result = { success: false, error: e.message };
      }
      update(
        appId,
        owner,
        profileId,
        (x) => ({ ...x, last: lastFrom(result, d) }),
        d,
      );
      out.push(
        result && result.success
          ? { profileId, saved: true }
          : { profileId, error: (result && result.error) || "failed" },
      );
    } catch (e) {
      try {
        update(
          appId,
          owner,
          profileId,
          (x) => ({ ...x, last: lastFrom({ error: e.message }, d) }),
          d,
        );
      } catch (_e) {
        // the settings file itself can't be written
      }
      out.push({ profileId, error: e.message });
    }
  }
  return out;
}

const state = {
  watchers: [],
  debounce: null,
  tick: null,
  launch: null,
  busy: false,
  again: false,
  // Bumped by stop(): a pass still running then schedules nothing.
  generation: 0,
  running: false,
};

async function guarded(reason, getWin, d, generation) {
  if (generation !== state.generation) return [];
  // One pass at a time; a change during a pass runs another after it.
  if (state.busy) {
    state.again = true;
    return [];
  }
  state.busy = true;
  try {
    return await exclusive(() => runOnce(reason, getWin, d));
  } catch (_e) {
    return [];
  } finally {
    state.busy = false;
    if (state.again) {
      state.again = false;
      schedule(getWin, d, generation);
    }
  }
}

function schedule(getWin, d, generation) {
  if (generation !== state.generation) return;
  if (state.debounce) d.clearTimeout(state.debounce);
  state.debounce = d.setTimeout(() => {
    state.debounce = null;
    guarded("change", getWin, d, generation);
  }, DEBOUNCE_MS);
}

/**
 * Start watching (the main process, once the window exists). `getWin`: the
 * window saves report to. Safe to call again — it restarts.
 */
function start(getWin = () => null, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  stop(d);
  const appId = d.appId();
  if (!appId) return false;
  const generation = state.generation;
  for (const dir of d.watchDirs(appId)) {
    try {
      const w = d.watch(dir, (_event, name) => {
        if (name && WATCHED.has(path.basename(String(name)))) {
          schedule(getWin, d, generation);
        }
      });
      // A folder removed or moved while watched: stop watching it, never
      // crash (the daily check and the other folders still run).
      if (w && typeof w.on === "function") {
        w.on("error", () => {
          try {
            w.close();
          } catch (_e) {
            // already closed
          }
        });
      }
      state.watchers.push(w);
    } catch (_e) {
      // Can't watch it: the daily check still runs.
    }
  }
  state.launch = d.setTimeout(
    () => guarded("launch", getWin, d, generation),
    LAUNCH_MS,
  );
  state.tick = d.setInterval(
    () => guarded("tick", getWin, d, generation),
    TICK_MS,
  );
  state.running = true;
  return true;
}

function stop(deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  state.generation += 1;
  for (const w of state.watchers) {
    try {
      w.close();
    } catch (_e) {
      // already closed
    }
  }
  state.watchers = [];
  if (state.debounce) d.clearTimeout(state.debounce);
  if (state.launch) d.clearTimeout(state.launch);
  if (state.tick) d.clearInterval(state.tick);
  state.debounce = state.launch = state.tick = null;
  state.again = false;
  state.running = false;
}

module.exports = {
  FILE,
  DEBOUNCE_MS,
  RETRY_MS,
  exclusive,
  getSettings,
  setSetting,
  recordManualSave,
  forgetProfile,
  lastOccurrence,
  dailyDue,
  runOnce,
  start,
  stop,
  isRunning: () => state.running,
};
