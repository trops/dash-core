/**
 * workspaceEvents.js
 *
 * Main-process notifications about dashboards (workspaces). Today: "a
 * dashboard was deleted", so the Bot Factory can unassign + pause that
 * dashboard's team (bot-teams TEAM-001). Covers every delete path (app IPC
 * and the Dash MCP `delete_dashboard` tool) because both go through
 * workspaceController.deleteWorkspaceForApplication.
 *
 * Pure: no Electron.
 */
"use strict";

const deletedListeners = new Set();

/** @returns {() => void} unsubscribe */
function onWorkspaceDeleted(fn) {
  deletedListeners.add(fn);
  return () => deletedListeners.delete(fn);
}

function emitWorkspaceDeleted(workspaceId) {
  for (const fn of deletedListeners) {
    try {
      fn(workspaceId);
    } catch (_e) {
      // A listener failure must never fail the delete itself.
    }
  }
}

module.exports = { onWorkspaceDeleted, emitWorkspaceDeleted };
