/**
 * teams.js
 *
 * A dashboard's team is the set of bots whose `workspaceId` is that
 * dashboard (bot-teams PRD TEAM-001). Bots with no `workspaceId` are
 * unassigned and keep working as before.
 *
 * Pure (NFR-006): no Electron, no I/O — the store and pause controller are
 * passed in.
 */
"use strict";

/** Dashboard ids are compared as strings; empty → null (unassigned). */
function normalizeWorkspaceId(id) {
  if (id === undefined || id === null || id === "") return null;
  return String(id);
}

function isOnTeam(bot, workspaceId) {
  const want = normalizeWorkspaceId(workspaceId);
  return !!bot && normalizeWorkspaceId(bot.workspaceId) === want;
}

/** A dashboard's bots; `null` lists the unassigned bots. */
function teamOf(bots, workspaceId) {
  if (!Array.isArray(bots)) return [];
  return bots.filter((b) => isOnTeam(b, workspaceId));
}

/**
 * A dashboard was deleted: its bots become unassigned AND paused — never
 * deleted, and never left running somewhere unexpected.
 * @returns {string[]} ids of the bots that were unassigned
 */
function unassignTeam({ store, pause }, workspaceId) {
  if (normalizeWorkspaceId(workspaceId) === null) return [];
  const moved = [];
  for (const bot of teamOf(store.list(), workspaceId)) {
    try {
      store.update(bot.id, { workspaceId: null });
      pause.pauseBot(bot.id);
      moved.push(bot.id);
    } catch (_e) {
      // One bad record mustn't strand the rest of the team.
    }
  }
  return moved;
}

module.exports = { normalizeWorkspaceId, isOnTeam, teamOf, unassignTeam };
