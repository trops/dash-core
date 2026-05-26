/**
 * onboardingController.js
 *
 * First-run onboarding state (Phase 3A of the MVP launch audit).
 *
 * Owns a tiny `electron-store` JSON that pins whether the user has
 * already completed (or dismissed) the first-run flow. Persistence
 * lives in the main process so:
 *   - it survives renderer reloads + Electron auto-update
 *   - a compromised iframe can't reach it (no localStorage)
 *   - the renderer reads it via read-only IPC, never via direct fs
 *
 * Storage layout (`dash-onboarding.json` in userData):
 *   {
 *     "onboarding": {
 *       "completed": true,
 *       "completedAt": "<ISO8601>",
 *       "source": "kitchen-sink" | "dismissed"
 *     }
 *   }
 *
 * `source` is a freeform breadcrumb so future onboarding variants can
 * report which path the user took without needing a schema change.
 *
 * The controller exposes a get/mark pair; the modal-vs-not-modal
 * decision lives in the renderer (it also needs workspace + installed-
 * package counts) so this stays a flat state owner.
 */

// Lazy-load electron-store so the test suite can mock it without
// booting an Electron shell. Same pattern as publisherKeyController.
let store = null;
function getStore() {
  if (!store) {
    const Store = require("electron-store");
    store = new Store({ name: "dash-onboarding" });
  }
  return store;
}

function readRecord() {
  return getStore().get("onboarding") || null;
}

function writeRecord(record) {
  getStore().set("onboarding", record);
}

/**
 * Renderer-safe snapshot of the onboarding state.
 *
 * `completed:false` is returned for both "never seen" and "explicitly
 * not done" so the renderer never has to disambiguate. The first-run
 * detector treats both the same way.
 */
function getOnboardingStatus() {
  const record = readRecord();
  if (!record || !record.completed) {
    return { completed: false, completedAt: null, source: null };
  }
  return {
    completed: true,
    completedAt: record.completedAt || null,
    source: record.source || null,
  };
}

/**
 * Pin onboarding as completed. Idempotent — re-calling on a record
 * that's already completed keeps the original completedAt so the
 * audit trail stays accurate.
 *
 * @param {Object} [opts]
 * @param {string} [opts.source] - Breadcrumb identifying which path
 *   completed the flow (e.g. "kitchen-sink", "dismissed").
 * @returns {{ completed: true, completedAt: string, source: string|null }}
 */
function markOnboardingCompleted(opts = {}) {
  const existing = readRecord();
  if (existing && existing.completed && existing.completedAt) {
    return {
      completed: true,
      completedAt: existing.completedAt,
      source: existing.source || null,
    };
  }
  const record = {
    completed: true,
    completedAt: new Date().toISOString(),
    source: typeof opts.source === "string" ? opts.source : null,
  };
  writeRecord(record);
  return record;
}

module.exports = {
  getOnboardingStatus,
  markOnboardingCompleted,
  // exposed for tests
  _readRecord: readRecord,
  _clearRecord: () => getStore().delete("onboarding"),
};
