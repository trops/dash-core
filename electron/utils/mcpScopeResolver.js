/**
 * mcpScopeResolver.js
 *
 * Slice 3b: per-workspace path scope reconfiguration.
 *
 * The Slice-3a process isolation key (`workspaceId::serverName`) is the
 * lifecycle handle. This module computes WHAT the spawned process is
 * configured to see — the union of granted paths from widgets on the
 * active workspace, applied as credential overrides at spawn time.
 *
 * Design:
 *   - The renderer enumerates widgets on the active workspace, looks up
 *     each widget's grant via window.mainApi.widgetMcp.getGrant, and
 *     hands the array to unionPathScope() to compute the workspace
 *     scope for a given server (e.g. "filesystem").
 *   - The renderer passes the resulting scope as `pathScope` to
 *     mcpStartServer.
 *   - mcpController applies the scope to credentials (replacing
 *     allowedPaths etc.) before its existing argsMapping spreads them
 *     into the spawn args. Servers that don't declare argsMapping for
 *     the path keys are unaffected.
 *
 * Feature flag: the controller only applies the override when
 * `security.enforceWidgetMcpPermissions` is on. When off, server starts
 * with credentials as-configured (pre-3b behavior).
 *
 * Out of scope here:
 *   - Hot-respawn on widget add/remove (see Slice 3b plan, deferred).
 *   - Catalog schema for new path-scoped servers (filesystem already
 *     has argsMapping.allowedPaths; others added as discovered).
 */
"use strict";

/**
 * Compute the workspace-scoped path union for a given server.
 *
 * @param {Array<{widgetId, granted}>} grants - widgets-on-workspace + their grants
 * @param {string} serverName - the MCP server name (e.g. "filesystem")
 * @returns {{ readPaths: string[], writePaths: string[], allowedPaths: string[] }}
 *
 * `allowedPaths` is the dedup union of read+write — used by
 * filesystem-style servers that take a single allowed-list. Servers
 * that distinguish read-only vs read-write can use the readPaths /
 * writePaths arrays directly.
 */
function unionPathScope(grants, serverName) {
  const reads = new Set();
  const writes = new Set();

  if (!Array.isArray(grants)) {
    return { readPaths: [], writePaths: [], allowedPaths: [] };
  }

  for (const entry of grants) {
    if (!entry || typeof entry !== "object") continue;
    const granted = entry.granted;
    if (!granted || typeof granted !== "object") continue;
    const servers = granted.servers;
    if (!servers || typeof servers !== "object") continue;
    const serverPerms = servers[serverName];
    if (!serverPerms || typeof serverPerms !== "object") continue;

    if (Array.isArray(serverPerms.readPaths)) {
      for (const p of serverPerms.readPaths) {
        if (typeof p === "string" && p) reads.add(p);
      }
    }
    if (Array.isArray(serverPerms.writePaths)) {
      for (const p of serverPerms.writePaths) {
        if (typeof p === "string" && p) writes.add(p);
      }
    }
  }

  const readPaths = [...reads];
  const writePaths = [...writes];
  const allowedPaths = [...new Set([...reads, ...writes])];

  return { readPaths, writePaths, allowedPaths };
}

/**
 * Override credential keys with values derived from a path scope.
 *
 * Filesystem-style servers expect `allowedPaths` as a comma-separated
 * string (the catalog's `argsMapping.allowedPaths.split` then expands
 * it back into positional args at spawn time). This helper joins the
 * scope's allowedPaths to match that convention.
 *
 * Returns a NEW credentials object — does not mutate the input.
 *
 * If pathScope is empty (no granted paths at all), the existing
 * credentials are returned unchanged so the user's globally-configured
 * allowedPaths still works for the LLM tool path / NO_WORKSPACE bucket.
 */
function applyPathScopeToCredentials(credentials, pathScope) {
  const base =
    credentials && typeof credentials === "object" ? { ...credentials } : {};

  if (!pathScope || typeof pathScope !== "object") return base;

  const allowed = Array.isArray(pathScope.allowedPaths)
    ? pathScope.allowedPaths
    : [];
  if (allowed.length === 0) return base;

  base.allowedPaths = allowed.join(",");
  return base;
}

module.exports = {
  unionPathScope,
  applyPathScopeToCredentials,
};
