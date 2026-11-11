/**
 * issuesApi.js
 *
 * Preload-side IPC bindings for Issues — what went wrong in widgets, bots
 * and providers (issues PRD). Exposed to the renderer as mainApi.issues.
 * Changes arrive on "issues:changed" ({ counts, issue? }) via mainApi.on.
 */
const { ipcRenderer } = require("electron");
const {
  ISSUES_RECORD,
  ISSUES_RESOLVE_WORKED,
  ISSUES_LIST,
  ISSUES_COUNTS,
  ISSUES_RESOLVE,
  ISSUES_RESOLVE_ASSET,
  ISSUES_CLEAR_RESOLVED,
} = require("../events");

const issuesApi = {
  /**
   * Record a failure the renderer saw (a widget's provider call, a widget
   * that crashed). @param {object} input  { asset, severity?, title,
   * message?, call?: { provider, tool, args, error }, hint?, shown? }
   */
  record: (input) => ipcRenderer.invoke(ISSUES_RECORD, input),

  /** The same call worked again: its issue is resolved. */
  resolveWorked: (input) => ipcRenderer.invoke(ISSUES_RESOLVE_WORKED, input),

  /** @param {{ status?, kind?, workspaceId?, asset? }} filter */
  list: (filter = {}) => ipcRenderer.invoke(ISSUES_LIST, filter),

  /** Open issues: { total, widget, bot, provider }. */
  counts: () => ipcRenderer.invoke(ISSUES_COUNTS),

  resolve: (id) => ipcRenderer.invoke(ISSUES_RESOLVE, { id }),

  resolveAsset: (asset) => ipcRenderer.invoke(ISSUES_RESOLVE_ASSET, asset),

  clearResolved: () => ipcRenderer.invoke(ISSUES_CLEAR_RESOLVED),
};

module.exports = issuesApi;
