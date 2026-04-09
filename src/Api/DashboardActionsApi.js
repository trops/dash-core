/**
 * DashboardActionsApi
 *
 * Provides programmatic control over dashboard-level actions.
 * Widgets can call these methods directly (not via events) to
 * control the dashboard they are rendered in.
 *
 * Write actions internally dispatch CustomEvents on `window` so the
 * API stays decoupled from the React component tree. Read methods
 * return values from `window.__dashState`, which DashboardStage
 * keeps up-to-date as workspace/page state changes.
 */
export const DashboardActionsApi = {
  // ─── Page Navigation ──────────────────────────────────────────────

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

  /**
   * Navigate to the previous page in history (browser-style back).
   */
  goBack() {
    window.dispatchEvent(new CustomEvent("dash:go-back"));
  },

  // ─── Workspace Nav Sidebar (far-left DashSidebar) ─────────────────

  /**
   * Collapse the workspace nav sidebar.
   */
  closeSidebar() {
    window.dispatchEvent(
      new CustomEvent("dash:set-nav-sidebar", { detail: { collapsed: true } }),
    );
  },

  /**
   * Expand the workspace nav sidebar.
   */
  openSidebar() {
    window.dispatchEvent(
      new CustomEvent("dash:set-nav-sidebar", { detail: { collapsed: false } }),
    );
  },

  /**
   * Toggle the workspace nav sidebar.
   */
  toggleSidebar() {
    window.dispatchEvent(new CustomEvent("dash:toggle-nav-sidebar"));
  },

  // ─── Workspace (Dashboard) Navigation ─────────────────────────────

  /**
   * Open another dashboard in a tab by name.
   * @param {string} name - The display name of the dashboard
   */
  openDashboardByName(name) {
    window.dispatchEvent(
      new CustomEvent("dash:open-dashboard", { detail: { name } }),
    );
  },

  /**
   * Close a dashboard tab. Closes the active tab if no name is given.
   * @param {string} [name] - Optional: name of the dashboard tab to close
   */
  closeDashboard(name) {
    window.dispatchEvent(
      new CustomEvent("dash:close-dashboard", { detail: { name } }),
    );
  },

  // ─── Notifications (in-app toasts) ────────────────────────────────

  /**
   * Show an in-app toast notification.
   * @param {string} message - The toast message
   * @param {object} [options]
   * @param {"success"|"error"|"info"|"warning"} [options.type="info"]
   * @param {string} [options.title]
   * @param {number} [options.duration=4000] - Auto-dismiss after ms
   */
  notify(message, options = {}) {
    window.dispatchEvent(
      new CustomEvent("dash:notify", {
        detail: {
          message,
          type: options.type || "info",
          title: options.title,
          duration: options.duration || 4000,
        },
      }),
    );
  },

  // ─── Read Methods (synchronous, from window.__dashState) ──────────

  /**
   * @returns {string|null} The ID of the active page
   */
  getCurrentPageId() {
    return window.__dashState?.currentPageId || null;
  },

  /**
   * @returns {string|null} The display name of the active page
   */
  getCurrentPageName() {
    return window.__dashState?.currentPageName || null;
  },

  /**
   * @returns {number|null} The ID of the active dashboard
   */
  getCurrentDashboardId() {
    return window.__dashState?.currentDashboardId || null;
  },

  /**
   * @returns {string|null} The display name of the active dashboard
   */
  getCurrentDashboardName() {
    return window.__dashState?.currentDashboardName || null;
  },

  /**
   * @returns {Array<{id: string, name: string, order: number}>}
   *   Pages in the current dashboard
   */
  listPages() {
    return window.__dashState?.pages || [];
  },
};
