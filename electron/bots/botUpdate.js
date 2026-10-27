/**
 * botUpdate.js
 *
 * Updating a bot already on this computer from a newer copy of its registry
 * package (dash-profiles v2): what the bot does comes from the package —
 * name, instructions, model, engine, schedules, what it publishes — while
 * how it runs here stays: its providers and tool choices, approval policy,
 * subscriptions (its wiring), dashboard, session and run state.
 *
 * A provider type the new version uses that the bot isn't connected to is
 * reported, never added: adding one would give the bot new tools without
 * the user choosing to.
 */
"use strict";

/**
 * @param {object} existing  the stored bot
 * @param {{definition: object, needs?: Array<{type: string, chosen: string|null}>}} member
 *   one member of planTeamInstall(...) for the new version
 * @param {object} [extra]  fields to set as well (installedFrom, registryRef)
 * @returns {{patch: object, missingProviders: string[]}}
 */
function botUpdatePatch(existing, member, extra = {}) {
  const planned = (member && member.definition) || {};
  const patch = {
    name: planned.name,
    instructions: planned.instructions,
    engine: planned.engine === undefined ? existing.engine : planned.engine,
    schedules: Array.isArray(planned.schedules)
      ? planned.schedules
      : existing.schedules,
    publishes: Array.isArray(planned.publishes)
      ? planned.publishes
      : existing.publishes,
    ...extra,
  };
  // The package's model only when this computer has that AI (the plan
  // leaves it out otherwise); else the bot keeps the one it runs on here.
  if (planned.provider) {
    patch.provider = planned.provider;
    patch.model = planned.model;
  }
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete patch[key];
  }
  const connected = new Set(existing.mcpServers || []);
  const missingProviders = (member.needs || [])
    .filter((n) => !(n.chosen && connected.has(n.chosen)))
    .filter((n) => !(n.options || []).some((name) => connected.has(name)))
    .map((n) => n.type);
  return { patch, missingProviders };
}

module.exports = { botUpdatePatch };
