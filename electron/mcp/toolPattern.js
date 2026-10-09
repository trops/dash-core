/**
 * toolPattern — wildcard MCP tool names.
 *
 * Some MCP servers name tools after the user's own data, e.g. Algolia's
 * hosted server exposes one `algolia_search_<index>` tool per index the
 * user added. A widget calls them with a template literal
 * (`callTool(\`algolia_search_${selectedIndex}\`)`), so the real names
 * aren't known until the server is connected.
 *
 * The scanner turns such a template into a pattern (`algolia_search_*`)
 * and the gate treats `*` as "any characters". A pattern must keep some
 * literal text — a bare `${toolName}` would grant every tool, so it is
 * dropped and the call falls through to JIT consent instead.
 */
"use strict";

const MIN_LITERAL_CHARS = 3;

function isToolPattern(name) {
  return typeof name === "string" && name.includes("*");
}

/**
 * `algolia_search_${selectedIndex}` → `algolia_search_*`.
 * Returns the name unchanged when it has no `${…}`, or null when the
 * template has too little literal text to be a safe pattern.
 */
function toolPatternFromTemplate(raw) {
  if (typeof raw !== "string") return null;
  if (!raw.includes("${")) return raw;
  const pattern = raw.replace(/\$\{[^}]*\}/g, "*").replace(/\*+/g, "*");
  const literal = pattern.replace(/\*/g, "");
  if (literal.length < MIN_LITERAL_CHARS || /[${}]/.test(literal)) return null;
  return pattern;
}

function _patternRegex(pattern) {
  const body = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + "$");
}

/** True when `entry` (a tool name or pattern) covers `toolName`. */
function toolMatches(entry, toolName) {
  if (typeof entry !== "string" || typeof toolName !== "string") return false;
  if (entry === toolName) return true;
  return isToolPattern(entry) && _patternRegex(entry).test(toolName);
}

/** True when any entry in `tools` covers `toolName`. */
function toolListAllows(tools, toolName) {
  return Array.isArray(tools) && tools.some((t) => toolMatches(t, toolName));
}

module.exports = {
  isToolPattern,
  toolPatternFromTemplate,
  toolMatches,
  toolListAllows,
};
