/**
 * applyToolToggle
 *
 * Pure helper for the per-tool toggle UX in Privacy & Security.
 *
 * Given a current grant object plus the list of provider INSTANCE
 * LABELS the user is operating on (resolved by the renderer using
 * `AppContext.providers`, since the panel displays per-TYPE rows but
 * the runtime grant store keys by label), returns an updated grant
 * with the tool added or removed from each label's tools array.
 *
 * Returns null when the grant becomes structurally empty (no servers
 * have any tools/paths AND no domains are present). Callers should
 * treat null as a signal to call `revoke(widgetId)` instead of
 * `setGrant(widgetId, ...)` — sanitizePerms in the gate rejects
 * empty grants.
 *
 * Does NOT mutate the input grant.
 */
"use strict";

export function applyToolToggle(grant, labels, tool, on) {
  if (!grant || typeof grant !== "object") return null;
  if (!Array.isArray(labels) || labels.length === 0) return null;
  if (typeof tool !== "string" || !tool) return null;

  const inServers =
    grant.servers && typeof grant.servers === "object" ? grant.servers : {};
  const newServers = {};

  // Carry over every existing server unchanged first.
  for (const [k, v] of Object.entries(inServers)) {
    newServers[k] = {
      tools: Array.isArray(v.tools) ? [...v.tools] : [],
      readPaths: Array.isArray(v.readPaths) ? [...v.readPaths] : [],
      writePaths: Array.isArray(v.writePaths) ? [...v.writePaths] : [],
    };
  }

  // Apply the toggle to each target label.
  for (const label of labels) {
    if (!newServers[label]) {
      if (!on) continue; // toggle OFF on absent label = no-op
      newServers[label] = { tools: [tool], readPaths: [], writePaths: [] };
      continue;
    }
    const tools = new Set(newServers[label].tools);
    if (on) tools.add(tool);
    else tools.delete(tool);
    newServers[label] = { ...newServers[label], tools: Array.from(tools) };
  }

  // Drop server entries that have no tools and no paths — they're
  // structurally empty and the gate would never grant anything.
  for (const [k, v] of Object.entries(newServers)) {
    if (
      (!Array.isArray(v.tools) || v.tools.length === 0) &&
      (!Array.isArray(v.readPaths) || v.readPaths.length === 0) &&
      (!Array.isArray(v.writePaths) || v.writePaths.length === 0)
    ) {
      delete newServers[k];
    }
  }

  const hasServers = Object.keys(newServers).length > 0;
  const hasDomains = grant.domains && Object.keys(grant.domains).length > 0;
  if (!hasServers && !hasDomains) return null;

  return {
    ...grant,
    servers: newServers,
  };
}
