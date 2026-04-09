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
   * Switch the active page by its internal ID.
   * @param {string} pageId - The ID of the page to switch to
   */
  switchPage(pageId) {
    window.dispatchEvent(
      new CustomEvent("dash:switch-page", { detail: { pageId } }),
    );
  },

  /**
   * Switch the active page by its display name.
   * @param {string} pageName - The display name of the page (e.g. "Opp Detail")
   */
  switchPageByName(pageName) {
    window.dispatchEvent(
      new CustomEvent("dash:switch-page", { detail: { pageName } }),
    );
  },
};
