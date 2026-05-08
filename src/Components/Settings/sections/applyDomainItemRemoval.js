/**
 * applyDomainItemRemoval
 *
 * Per-item delete helper for the parallel `granted.domains.{fs,network}`
 * grant shape used by Slice 2 (fs gate) and Slice 3 (network gate).
 * Sister to applyPathRemoval, which handles the MCP-server-shaped
 * `granted.servers[name]` block.
 *
 *   domain: "fs" | "network"
 *   kind:
 *     fs      → "readPaths" | "writePaths" | "actions"
 *     network → "hosts" | "actions"
 *   value: the string to remove
 *
 * If the resulting domain block is structurally empty (every array
 * gone), the entire domain entry is pruned. If the entire grant has
 * no surviving servers AND no surviving domains, returns null so the
 * caller knows to call `revoke(widgetId)` instead of writing an
 * empty-shape grant the gate's sanitizePerms would reject.
 *
 * Pure. Does not mutate the input grant.
 */
"use strict";

const VALID_KINDS = {
  fs: new Set(["readPaths", "writePaths", "actions"]),
  network: new Set(["hosts", "actions"]),
};

export function applyDomainItemRemoval(grant, domain, kind, value) {
  if (!grant || typeof grant !== "object") return null;
  if (typeof value !== "string" || !value) return null;

  // Carry domains forward, deep-copying only the touched domain.
  const inDomains =
    grant.domains && typeof grant.domains === "object" ? grant.domains : {};
  const newDomains = {};
  for (const [k, v] of Object.entries(inDomains)) {
    newDomains[k] = v;
  }

  if (
    VALID_KINDS[domain] &&
    VALID_KINDS[domain].has(kind) &&
    inDomains[domain] &&
    typeof inDomains[domain] === "object"
  ) {
    const block = inDomains[domain];
    const arr = Array.isArray(block[kind]) ? block[kind] : [];
    const next = arr.filter((s) => s !== value);
    const nextBlock = { ...block, [kind]: next };

    // If the entire domain block has nothing left, drop it.
    const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
    if (
      !nonEmpty(nextBlock.readPaths) &&
      !nonEmpty(nextBlock.writePaths) &&
      !nonEmpty(nextBlock.actions) &&
      !nonEmpty(nextBlock.hosts)
    ) {
      delete newDomains[domain];
    } else {
      newDomains[domain] = nextBlock;
    }
  }

  // Carry servers untouched.
  const inServers =
    grant.servers && typeof grant.servers === "object" ? grant.servers : {};
  const hasServers = Object.keys(inServers).length > 0;
  const hasDomains = Object.keys(newDomains).length > 0;
  if (!hasServers && !hasDomains) return null;

  return {
    ...grant,
    servers: inServers,
    domains: newDomains,
  };
}
