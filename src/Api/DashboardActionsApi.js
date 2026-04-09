/**
 * DashboardActionsApi
 *
 * Provides programmatic control over dashboard-level actions.
 * Widgets can call these methods directly (not via events) to
 * control the dashboard they are rendered in.
 *
 * Internally dispatches CustomEvents on `window` so the API
 * stays decoupled from the React component tree.
 */
export const DashboardActionsApi = {
  /**
   * Switch the active page in the current dashboard.
   * @param {string} pageId - The ID of the page to switch to
   */
  switchPage(pageId) {
    window.dispatchEvent(
      new CustomEvent("dash:switch-page", { detail: { pageId } }),
    );
  },
};
