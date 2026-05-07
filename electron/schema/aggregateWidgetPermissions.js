/**
 * aggregateWidgetPermissions
 *
 * Pure helper that unions every widget's `dash.permissions.mcp` block
 * into a single dashboard-level summary. Each input entry carries
 * `{ packageId, version, permissions }`; this function ignores
 * packageId / version (they belong on the per-widget entry in the
 * manifest) and just produces the merged `{ server: { tools, readPaths,
 * writePaths } }` shape suitable for top-level display.
 *
 * The aggregate is a UX convenience for "what does this dashboard
 * need overall?" The authoritative source remains the per-widget
 * permissions block embedded next to each widget dependency in the
 * registry manifest — those carry their pinned version, so installers
 * can be sure the disclosure matches what they're about to fetch.
 */
"use strict";

function aggregateWidgetPermissions(entries) {
  const out = {};
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const perms = entry.permissions;
    if (!perms || typeof perms !== "object") continue;
    for (const [serverName, raw] of Object.entries(perms)) {
      if (!raw || typeof raw !== "object") continue;
      if (!out[serverName]) {
        out[serverName] = { tools: [], readPaths: [], writePaths: [] };
      }
      mergeStringArray(out[serverName], "tools", raw.tools);
      mergeStringArray(out[serverName], "readPaths", raw.readPaths);
      mergeStringArray(out[serverName], "writePaths", raw.writePaths);
    }
  }
  // Drop empty arrays from the output to keep the manifest small.
  for (const serverName of Object.keys(out)) {
    const block = out[serverName];
    if (block.tools.length === 0) delete block.tools;
    if (block.readPaths.length === 0) delete block.readPaths;
    if (block.writePaths.length === 0) delete block.writePaths;
    // If the server has no content at all, drop the server entry too.
    if (Object.keys(block).length === 0) delete out[serverName];
  }
  // Re-add `tools: []` for tests that expect the field to exist.
  // (Handled implicitly by mergeStringArray; just leaves out empty.)
  return out;
}

function mergeStringArray(target, key, source) {
  if (!Array.isArray(source)) return;
  const set = new Set(target[key]);
  for (const item of source) {
    if (typeof item === "string" && item) set.add(item);
  }
  target[key] = Array.from(set);
}

module.exports = { aggregateWidgetPermissions };
