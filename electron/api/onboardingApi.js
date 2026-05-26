/**
 * onboardingApi.js
 *
 * IPC bridge for the first-run onboarding flow (renderer side).
 * Exposed via contextBridge through `window.mainApi.onboarding`.
 */
const { ipcRenderer } = require("electron");
const {
  ONBOARDING_GET_STATUS,
  ONBOARDING_MARK_COMPLETED,
} = require("../events");

const onboardingApi = {
  /**
   * Read the current onboarding state. Always resolves; never rejects.
   * Returns `{ completed, completedAt, source }`. `completed:false` is
   * the "never seen" state — the renderer can treat that as the gate
   * to show the OnboardingModal.
   */
  getStatus: () => ipcRenderer.invoke(ONBOARDING_GET_STATUS),

  /**
   * Pin onboarding as completed. Idempotent — safe to call multiple
   * times; the first stamp wins.
   *
   * @param {Object} [opts]
   * @param {string} [opts.source] - "kitchen-sink", "dismissed", etc.
   * @returns {Promise<{ completed: true, completedAt: string, source: string|null }>}
   */
  markCompleted: (opts = {}) =>
    ipcRenderer.invoke(ONBOARDING_MARK_COMPLETED, opts),
};

module.exports = onboardingApi;
