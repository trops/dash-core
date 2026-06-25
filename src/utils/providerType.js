/**
 * providerType.js
 *
 * Helpers for assigning a stable, UNIQUE `type` to a provider.
 *
 * A provider's identity in the widget system is its `type` string (widgets
 * declare `requiredProviders: [{ type }]`, runtime resolves by type). Catalog
 * providers each carry a unique type (`slack`, `github`, …). Hand-rolled
 * custom MCP servers historically all shared `type: "custom"`, which conflates
 * multiple customs at binding/runtime. These helpers give each NEW custom
 * provider a unique slug derived from its name so it behaves like a catalog
 * provider.
 *
 * Forward-only: existing providers are never renamed here (that would break
 * widgets already built against their type). Only the create path uses this.
 */

/**
 * Convert a provider name into a kebab-case type slug.
 * "My Granola Server" → "my-granola-server". Falls back to a sane default
 * when the name has no slug-able characters.
 */
export function slugifyProviderType(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // drop punctuation/symbols
    .replace(/[\s_]+/g, "-") // whitespace/underscores → hyphen
    .replace(/-+/g, "-") // collapse repeats
    .replace(/^-+|-+$/g, ""); // trim hyphens
  return slug || "custom-provider";
}

/**
 * Produce a slug type unique against the already-configured provider types.
 * Appends `-2`, `-3`, … on collision so two providers can never share a type.
 *
 * @param {string} name provider instance name
 * @param {Iterable<string>} existingTypes types already in use (e.g.
 *   Object.values(providers).map(p => p.type))
 * @returns {string}
 */
export function uniqueProviderType(name, existingTypes = []) {
  const base = slugifyProviderType(name);
  const taken = new Set(existingTypes || []);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
