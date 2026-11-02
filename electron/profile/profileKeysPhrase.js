/**
 * profileKeysPhrase.js — the phrase that locks a profile's keys, on this Mac
 * (dash-profiles, "Include keys and passwords", 2026-11-02).
 *
 * The renderer hands the phrase over once, through its own unlogged channel;
 * it never rides along with a save's options. Then:
 *
 *   not remembered  used by the next save only, then forgotten. Auto-saves
 *                   after that reuse the keys as they were last locked
 *                   (`lastLocked`) — new keys wait for the next manual save.
 *   remembered      kept sealed by this Mac's keychain (safeStorage), so
 *                   auto-save locks new keys too.
 *
 * The account copy and a file each keep their own: a file saved with
 * another phrase never becomes what auto-save uploads, and only the account
 * remembers a phrase (only it auto-saves).
 *
 * File: profile-keys.json in the app's folder —
 *   { [profileId]: { phrase?: <sealed>, lastLocked?: <locked blob> },
 *     [profileId + "#file"]: { lastLocked? } }
 * A locked blob is already encrypted with the phrase; it's safe at rest.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { checkKeysPhrase, isLockedKeys } = require("./profileKeys");

const FILE = "profile-keys.json";

function defaultDeps() {
  return {
    filePath: (appId) =>
      require("../utils/appPaths").getAppFilePath(appId, FILE),
    seal: (text) =>
      require("electron")
        .safeStorage.encryptString(String(text))
        .toString("base64"),
    open: (sealed) =>
      require("electron").safeStorage.decryptString(
        Buffer.from(String(sealed), "base64"),
      ),
  };
}

// For the next save only: `${appId}\n${slot}` → { phrase, at }. Not used
// within this long (a cancelled save): forgotten.
const pending = new Map();
const PENDING_MS = 10 * 60 * 1000;
const slotOf = (profileId, target) =>
  target === "file" ? `${profileId}#file` : String(profileId);
const keyOf = (appId, slot) => `${appId}\n${slot}`;

function readAll(appId, d) {
  try {
    const raw = JSON.parse(fs.readFileSync(d.filePath(appId), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (_e) {
    return {};
  }
}

function writeAll(appId, all, d) {
  const file = d.filePath(appId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
}

function entryOf(all, profileId) {
  const e = Object.prototype.hasOwnProperty.call(all, profileId)
    ? all[profileId]
    : null;
  return e && typeof e === "object" ? e : {};
}

/**
 * The phrase for this profile's next save. `remember`: keep it sealed on
 * this Mac (auto-save locks new keys too); otherwise any remembered one is
 * forgotten. An empty phrase with `remember` keeps the remembered one.
 * @returns {{ success: true, short?: boolean } | { success: false, error }}
 */
function setPhrase(
  appId,
  profileId,
  phrase,
  { remember = false, target = "account" } = {},
  deps,
) {
  const d = { ...defaultDeps(), ...deps };
  const slot = slotOf(profileId, target);
  const all = readAll(appId, d);
  const entry = entryOf(all, slot);
  // Only the account copy auto-saves, so only it remembers a phrase.
  const keep = remember && target !== "file";
  if ((phrase == null || phrase === "") && keep && entry.phrase) {
    return { success: true };
  }
  const check = checkKeysPhrase(phrase);
  if (!check.ok) return { success: false, error: check.error };
  pending.set(keyOf(appId, slot), { phrase: String(phrase), at: Date.now() });
  const next = { ...entry };
  if (keep) next.phrase = d.seal(phrase);
  else delete next.phrase;
  all[slot] = next;
  writeAll(appId, all, d);
  return { success: true, ...(check.short ? { short: true } : {}) };
}

/** The phrase a save locks with now: this save's, or the remembered one. */
function takePhrase(appId, profileId, deps, target = "account") {
  const d = { ...defaultDeps(), ...deps };
  const slot = slotOf(profileId, target);
  const k = keyOf(appId, slot);
  for (const [key, v] of pending) {
    if (Date.now() - v.at > PENDING_MS) pending.delete(key);
  }
  if (pending.has(k)) {
    const p = pending.get(k);
    pending.delete(k);
    return p.phrase;
  }
  const entry = entryOf(readAll(appId, d), slot);
  if (!entry.phrase) return null;
  try {
    return d.open(entry.phrase);
  } catch (_e) {
    return null;
  }
}

/** What the save window shows: a phrase remembered, keys locked before. */
function status(appId, profileId, deps, target = "account") {
  const d = { ...defaultDeps(), ...deps };
  const entry = entryOf(readAll(appId, d), slotOf(profileId, target));
  return {
    remembered: !!entry.phrase,
    lockedBefore: isLockedKeys(entry.lastLocked),
  };
}

/** The keys as last locked — reused when there's no phrase (auto-save). */
function lastLocked(appId, profileId, deps, target = "account") {
  const d = { ...defaultDeps(), ...deps };
  const entry = entryOf(readAll(appId, d), slotOf(profileId, target));
  return isLockedKeys(entry.lastLocked) ? entry.lastLocked : null;
}

function setLastLocked(appId, profileId, locked, deps, target = "account") {
  const d = { ...defaultDeps(), ...deps };
  const slot = slotOf(profileId, target);
  const all = readAll(appId, d);
  all[slot] = { ...entryOf(all, slot), lastLocked: locked };
  writeAll(appId, all, d);
}

/**
 * Saved with keys off: this copy's phrase and locked keys are forgotten,
 * so the next save starts with the switch off.
 */
function forgetTarget(appId, profileId, deps, target = "account") {
  const d = { ...defaultDeps(), ...deps };
  const slot = slotOf(profileId, target);
  pending.delete(keyOf(appId, slot));
  const all = readAll(appId, d);
  if (!Object.prototype.hasOwnProperty.call(all, slot)) return;
  delete all[slot];
  writeAll(appId, all, d);
}

/** Forget everything about this profile's keys here (keys option off). */
function forget(appId, profileId, deps) {
  for (const target of ["account", "file"]) {
    forgetTarget(appId, profileId, deps, target);
  }
}

module.exports = {
  setPhrase,
  takePhrase,
  status,
  lastLocked,
  setLastLocked,
  forgetTarget,
  forget,
};
