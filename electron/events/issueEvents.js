/**
 * Event Constants File - Issue Events
 *
 * IPC channel constants for Issues: what went wrong in widgets, bots and
 * providers (issues PRD).
 */
const ISSUES_RECORD = "issues-record";
const ISSUES_RESOLVE_WORKED = "issues-resolve-worked";
const ISSUES_LIST = "issues-list";
const ISSUES_COUNTS = "issues-counts";
const ISSUES_RESOLVE = "issues-resolve";
const ISSUES_RESOLVE_ASSET = "issues-resolve-asset";
const ISSUES_CLEAR_RESOLVED = "issues-clear-resolved";

// Main → every window: { counts, issue? }
const ISSUES_CHANGED = "issues:changed";

module.exports = {
  ISSUES_RECORD,
  ISSUES_RESOLVE_WORKED,
  ISSUES_LIST,
  ISSUES_COUNTS,
  ISSUES_RESOLVE,
  ISSUES_RESOLVE_ASSET,
  ISSUES_CLEAR_RESOLVED,
  ISSUES_CHANGED,
};
