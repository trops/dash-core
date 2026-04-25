/**
 * scopedComponentId.js
 *
 * Single source of truth for the canonical scoped component id used by
 * ComponentManager registration, layout items, and publish-time scope
 * remap. Format: `scope.packageName.ComponentName`.
 *
 * Why a 3-part dotted form (and not `@scope/pkg.Component`)?
 * - Matches existing `config.id` shape that `.dash.js` files already
 *   set when authored explicitly (see ComponentManager.registerWidget:
 *   `const registrationKey = config.id || widgetKey;`).
 * - Trivial to parse (`split(".")` — three parts, ordered).
 * - Avoids slashes inside object keys, which some downstream serializers
 *   (older dash-registry indexers) historically choked on.
 *
 * The upstream package id may arrive in either of two shapes:
 *   - "@scope/pkg" (npm-style)
 *   - "scope/pkg"  (bare scope)
 * Both produce the same scoped id.
 */

/**
 * Build the canonical scoped component id from a package name and a
 * bare component name.
 *
 * @param {string} packageName e.g. "@ai-built/pipeline" or "ai-built/pipeline"
 * @param {string} componentName e.g. "ProspectListColumn"
 * @returns {string} e.g. "ai-built.pipeline.ProspectListColumn"
 */
export function makeScopedComponentId(packageName, componentName) {
  if (!componentName) return "";
  if (!packageName) return componentName;
  const cleaned = String(packageName).replace(/^@/, "").replace(/\//g, ".");
  return `${cleaned}.${componentName}`;
}

/**
 * Parse a scoped component id into its three parts. Returns null when
 * the input isn't a 3-part dotted id (e.g. legacy bare names).
 *
 * @param {string} scopedId
 * @returns {{scope: string, packageName: string, componentName: string} | null}
 */
export function parseScopedComponentId(scopedId) {
  if (typeof scopedId !== "string") return null;
  const parts = scopedId.split(".");
  if (parts.length !== 3) return null;
  return { scope: parts[0], packageName: parts[1], componentName: parts[2] };
}

/**
 * Pull the bare component name from a scoped or unscoped id.
 *
 * @param {string} idOrName
 * @returns {string}
 */
export function bareComponentName(idOrName) {
  if (typeof idOrName !== "string") return "";
  const parts = idOrName.split(".");
  return parts[parts.length - 1] || "";
}
