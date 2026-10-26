/**
 * profileMembership.js
 *
 * What the active profile holds, for the controllers that list, create
 * and delete dashboards, folders, themes and bots. With only Default (no
 * profiles.json) nothing is filtered and nothing is recorded — Default
 * holds everything, exactly as before profiles existed.
 */
const profileStore = require("./profileStore");

/**
 * Keep only the items the active profile holds.
 *
 * @param {string} appId
 * @param {string} kind "dashboards" | "folders" | "themes" | "bots"
 * @param {Array} items
 * @param {(item) => string|number} idOf
 */
function filterToActive(appId, kind, items, idOf) {
  const ids = profileStore.members(appId, kind);
  if (ids === null) return items;
  const keep = new Set(ids);
  return items.filter((item) => item && keep.has(String(idOf(item))));
}

/** Same, for an object keyed by id (themes.json). */
function filterKeysToActive(appId, kind, byKey, extraKeys = []) {
  const ids = profileStore.members(appId, kind);
  if (ids === null) return byKey;
  const keep = new Set([...ids, ...extraKeys.map(String)]);
  const out = {};
  for (const key of Object.keys(byKey || {})) {
    if (keep.has(key)) out[key] = byKey[key];
  }
  return out;
}

function hasProfiles(appId) {
  return profileStore.hasProfiles(appId);
}

function isActiveMember(appId, kind, id) {
  const ids = profileStore.members(appId, kind);
  return ids === null || ids.includes(String(id));
}

function addToActive(appId, kind, id) {
  profileStore.add(appId, kind, id);
}

function removeEverywhere(appId, kind, id) {
  profileStore.removeEverywhere(appId, kind, id);
}

module.exports = {
  hasProfiles,
  filterToActive,
  filterKeysToActive,
  isActiveMember,
  addToActive,
  removeEverywhere,
};
