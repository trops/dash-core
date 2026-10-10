/**
 * grantServerNames — key a grant's servers by provider NAME.
 *
 * Tool calls reach the permission gate with the provider's name
 * ("Algolia Public HR"), and runtime (JIT) approvals are saved under that
 * name. Declared permissions — and so the install / update / manual
 * consent dialogs built from them — are keyed by provider TYPE
 * ("algolia"). A grant saved under the type never matched a call, so the
 * user was asked again on first use.
 *
 * `toProviderNames` rewrites each type key to the names of the user's MCP
 * providers of that type (one grant entry per provider). Keys that are
 * already a provider name are kept, as are keys with no matching provider
 * (nothing to map them to yet).
 */
"use strict";

function _union(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

function _mergeEntry(into, from) {
  if (!into) {
    return {
      ...from,
      tools: [...(from.tools || [])],
      readPaths: [...(from.readPaths || [])],
      writePaths: [...(from.writePaths || [])],
    };
  }
  return {
    ...into,
    tools: _union(into.tools, from.tools),
    readPaths: _union(into.readPaths, from.readPaths),
    writePaths: _union(into.writePaths, from.writePaths),
  };
}

/**
 * @param {object} perms grant blob `{ servers: { [key]: { tools, readPaths, writePaths } }, ... }`
 * @param {Array<{ name: string, type: string, providerClass?: string }>} providers
 * @returns {object} the same blob with type keys replaced by provider names
 */
function toProviderNames(perms, providers) {
  if (!perms || typeof perms !== "object" || !perms.servers) return perms;
  const mcpProviders = (Array.isArray(providers) ? providers : []).filter(
    (p) =>
      p &&
      typeof p.name === "string" &&
      p.name &&
      (p.providerClass || "credential") === "mcp",
  );
  const names = new Set(mcpProviders.map((p) => p.name));
  const servers = {};
  for (const [key, entry] of Object.entries(perms.servers)) {
    if (!entry || typeof entry !== "object") continue;
    const targets = names.has(key)
      ? [key]
      : mcpProviders.filter((p) => p.type === key).map((p) => p.name);
    for (const name of targets.length > 0 ? targets : [key]) {
      servers[name] = _mergeEntry(servers[name], entry);
    }
  }
  return { ...perms, servers };
}

module.exports = { toProviderNames };
