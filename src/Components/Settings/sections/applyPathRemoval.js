/**
 * applyPathRemoval
 *
 * Per-path delete helper for the Privacy & Security panel. Removes a
 * single read or write path from a server's grant block, fanning the
 * change across every provider INSTANCE LABEL the user is operating
 * on (the renderer resolves type → labels via AppContext.providers).
 *
 * Returns null when the resulting grant has no surviving server
 * content AND no domain content — caller treats that as a full
 * revoke (the gate's sanitizePerms rejects empty grants).
 *
 * Pure. Does not mutate the input grant.
 */
"use strict";

const VALID_KINDS = new Set(["readPaths", "writePaths"]);

export function applyPathRemoval(grant, labels, kind, path) {
  if (!grant || typeof grant !== "object") return null;
  if (!Array.isArray(labels) || labels.length === 0) return null;
  if (typeof path !== "string" || !path) return null;

  const inServers =
    grant.servers && typeof grant.servers === "object" ? grant.servers : {};
  const newServers = {};

  for (const [k, v] of Object.entries(inServers)) {
    newServers[k] = {
      tools: Array.isArray(v.tools) ? [...v.tools] : [],
      readPaths: Array.isArray(v.readPaths) ? [...v.readPaths] : [],
      writePaths: Array.isArray(v.writePaths) ? [...v.writePaths] : [],
    };
  }

  if (VALID_KINDS.has(kind)) {
    for (const label of labels) {
      if (!newServers[label]) continue;
      const arr = newServers[label][kind];
      newServers[label][kind] = arr.filter((p) => p !== path);
    }
  }

  // Drop any server entry that's now structurally empty.
  for (const [k, v] of Object.entries(newServers)) {
    if (
      v.tools.length === 0 &&
      v.readPaths.length === 0 &&
      v.writePaths.length === 0
    ) {
      delete newServers[k];
    }
  }

  const hasServers = Object.keys(newServers).length > 0;
  const hasDomains = grant.domains && Object.keys(grant.domains).length > 0;
  if (!hasServers && !hasDomains) return null;

  return { ...grant, servers: newServers };
}
