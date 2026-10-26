/**
 * sessionController.js
 *
 * Manages session persistence: recently opened dashboards and
 * open tab state for session restore on relaunch.
 *
 * Uses electron-store (unencrypted) for lightweight persistence.
 */

const MAX_RECENTS = 20;

// Recents and open tabs are per profile. Default keeps the keys used
// before profiles existed; other profiles use profiles.<id>.<key>.
function key(name) {
  const { getActiveProfileId } = require("../profile/activeProfile");
  const profileId = getActiveProfileId();
  return profileId === "default" ? name : `profiles.${profileId}.${name}`;
}

// Lazy-load electron-store to avoid issues when not installed
let store = null;
function getStore() {
  if (!store) {
    const Store = require("electron-store");
    store = new Store({ name: "dash-session" });
  }
  return store;
}

/**
 * Get recently opened dashboards.
 *
 * @returns {Array<{ workspaceId: string, name: string, openedAt: string }>}
 */
function getRecentDashboards() {
  try {
    const s = getStore();
    const recents = s.get(key("recents"), []);
    return recents
      .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/**
 * Add (or upsert) a recent dashboard entry.
 *
 * @param {string} workspaceId
 * @param {string} name
 * @returns {Array} Updated recents list
 */
function addRecentDashboard(workspaceId, name) {
  try {
    const s = getStore();
    let recents = s.get(key("recents"), []);

    // Remove existing entry for this workspace (upsert)
    recents = recents.filter((r) => r.workspaceId !== workspaceId);

    // Prepend new entry
    recents.unshift({
      workspaceId,
      name: name || "Untitled",
      openedAt: new Date().toISOString(),
    });

    // Cap at MAX_RECENTS
    recents = recents.slice(0, MAX_RECENTS);

    s.set(key("recents"), recents);
    return recents;
  } catch {
    return [];
  }
}

/**
 * Remove one dashboard from the recents (e.g. it was deleted).
 *
 * @param {string} workspaceId
 * @returns {Array} Updated recents list
 */
function removeRecentDashboard(workspaceId) {
  try {
    const s = getStore();
    const recents = s
      .get(key("recents"), [])
      .filter((r) => String(r.workspaceId) !== String(workspaceId));
    s.set(key("recents"), recents);
    return recents;
  } catch {
    return [];
  }
}

/**
 * Clear all recent dashboards.
 */
function clearRecentDashboards() {
  try {
    const s = getStore();
    s.set(key("recents"), []);
  } catch {
    // ignore
  }
}

/**
 * Get saved session state (open tabs + active tab).
 *
 * @returns {{ openTabIds: string[], activeTabId: string | null } | null}
 */
function getSessionState() {
  try {
    const s = getStore();
    const state = s.get(key("sessionState"), null);
    return state || null;
  } catch {
    return null;
  }
}

/**
 * Save session state (open tabs + active tab).
 *
 * @param {string[]} openTabIds
 * @param {string|null} activeTabId
 */
function saveSessionState(openTabIds, activeTabId) {
  try {
    const s = getStore();
    s.set(key("sessionState"), { openTabIds, activeTabId });
  } catch {
    // ignore
  }
}

/**
 * Clear saved session state.
 */
function clearSessionState() {
  try {
    const s = getStore();
    s.delete(key("sessionState"));
  } catch {
    // ignore
  }
}

module.exports = {
  getRecentDashboards,
  addRecentDashboard,
  removeRecentDashboard,
  clearRecentDashboards,
  getSessionState,
  saveSessionState,
  clearSessionState,
};
