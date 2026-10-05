/**
 * catalogReadOnly.js
 *
 * Some MCP servers don't annotate their tools (MCP `annotations.readOnlyHint`).
 * A catalog entry can list them in `readOnlyTools`; when a server's tool list
 * is cached, those tools are marked read-only so bots can run them without a
 * prompt under "Ask before external actions". What a server declares itself
 * always wins.
 */
"use strict";

/**
 * The catalog entry for a server: by catalog name, else by the same stdio
 * command + args (a provider renamed "Gmail 3" still runs Gmail's package).
 */
function findCatalogEntry(catalog, serverName, mcpConfig) {
  const list = Array.isArray(catalog) ? catalog : [];
  const byName = list.find((e) => e && e.name === serverName);
  if (byName) return byName;
  if (!mcpConfig || !mcpConfig.command) return null;
  const args = JSON.stringify(mcpConfig.args || []);
  return (
    list.find(
      (e) =>
        e &&
        e.mcpConfig &&
        e.mcpConfig.command === mcpConfig.command &&
        JSON.stringify(e.mcpConfig.args || []) === args,
    ) || null
  );
}

/** Copies of `tools` with the listed ones marked `readOnlyHint: true`. */
function markReadOnlyTools(tools, readOnlyTools) {
  if (!Array.isArray(readOnlyTools) || readOnlyTools.length === 0) {
    return tools;
  }
  return (tools || []).map((tool) => {
    if (!tool || !readOnlyTools.includes(tool.name)) return tool;
    const annotations = tool.annotations || {};
    if (annotations.readOnlyHint !== undefined) return tool;
    return { ...tool, annotations: { ...annotations, readOnlyHint: true } };
  });
}

module.exports = { findCatalogEntry, markReadOnlyTools };
