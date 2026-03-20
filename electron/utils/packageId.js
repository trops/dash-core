/**
 * Scoped package identity utilities.
 *
 * Follows npm convention: "@scope/name" for scoped packages, "name" for bare.
 */

/**
 * Build a canonical package ID from scope + name.
 * @param {string|null} scope - e.g. "trops" or "@trops"
 * @param {string} name - bare package name
 * @returns {string} e.g. "@trops/slack" or "slack"
 */
function toPackageId(scope, name) {
  if (scope) {
    const normalized = scope.replace(/^@/, "");
    return `@${normalized}/${name}`;
  }
  return name;
}

/**
 * Parse a package ID into scope + name.
 * @param {string} id - e.g. "@trops/slack" or "slack"
 * @returns {{ scope: string|null, name: string }}
 */
function parsePackageId(id) {
  if (id && id.startsWith("@")) {
    const slashIdx = id.indexOf("/");
    if (slashIdx !== -1) {
      return {
        scope: id.slice(1, slashIdx),
        name: id.slice(slashIdx + 1),
      };
    }
  }
  return { scope: null, name: id };
}

module.exports = { toPackageId, parsePackageId };
