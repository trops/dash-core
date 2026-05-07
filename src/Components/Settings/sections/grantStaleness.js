/**
 * grantStaleness
 *
 * Pure helpers used by WidgetGrantRow to decide which granted items
 * are "stale" (granted in the past, but the widget's current source
 * code no longer requests them) and whether a whole server's grant
 * is entirely stale.
 *
 * Critical asymmetry:
 *   - TOOL names are extracted by the manifest scanner from literal
 *     `callTool("X", ...)` calls — so they ARE validatable. A granted
 *     tool that isn't in the declared block is genuinely stale.
 *   - File system PATHS are not extractable. Paths are runtime
 *     arguments to `callTool("read_file", { path: arg })`, not part
 *     of the source any static scanner can reach. So the absence of
 *     a declared path means "the scanner doesn't know," not "the
 *     widget no longer needs it." Marking such grants as stale is a
 *     false positive that scares the user into revoking real grants.
 *
 * Both helpers are stateless and side-effect-free.
 */
"use strict";

/**
 * @param {string[]} declaredItems
 * @param {string[]} grantedItems
 * @param {boolean} validatesStale - true for tools (scanner can prove
 *   absence), false for paths (scanner can't see them)
 * @returns {Set<string>} the granted items that are stale
 */
export function computeStaleItems(declaredItems, grantedItems, validatesStale) {
  const out = new Set();
  if (!validatesStale) return out;
  const declared = new Set(Array.isArray(declaredItems) ? declaredItems : []);
  const granted = Array.isArray(grantedItems) ? grantedItems : [];
  for (const item of granted) {
    if (!declared.has(item)) out.add(item);
  }
  return out;
}

/**
 * Returns true when a server's grant block has tools the user
 * authorized but the current manifest declares zero matching tools.
 * Only TOOLS are considered — paths are not validatable (see file
 * header). A grant with no granted tools at all (paths-only or
 * empty) is not "entirely stale" — there's nothing tool-shaped to
 * be stale about.
 *
 * @param {{ tools?: string[], readPaths?: string[], writePaths?: string[] } | null} decl
 * @param {{ tools?: string[], readPaths?: string[], writePaths?: string[] } | null} grant
 * @returns {boolean}
 */
export function isServerEntirelyStale(decl, grant) {
  if (!grant) return false;
  const grantedTools = Array.isArray(grant.tools) ? grant.tools : [];
  if (grantedTools.length === 0) return false;
  const declTools = new Set(
    decl && Array.isArray(decl.tools) ? decl.tools : [],
  );
  return grantedTools.every((t) => !declTools.has(t));
}
