/**
 * sessionController.js
 *
 * Manages session persistence: recently opened dashboards and
 * open tab state for session restore on relaunch.
 *
 * Uses electron-store (unencrypted) for lightweight persistence.
 */

const MAX_RECENTS = 20;

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
    const recents = s.get("recents", []);
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
    let recents = s.get("recents", []);

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

    s.set("recents", recents);
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
    s.set("recents", []);
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
    const state = s.get("sessionState", null);
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
    s.set("sessionState", { openTabIds, activeTabId });
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
    s.delete("sessionState");
  } catch {
    // ignore
  }
}

module.exports = {
  getRecentDashboards,
  addRecentDashboard,
  clearRecentDashboards,
  getSessionState,
  saveSessionState,
  clearSessionState,
};
