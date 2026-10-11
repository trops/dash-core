/**
 * Where a widget in the Add panel comes from (create-entry CRE-010 AC2):
 *   - "builtin"   ships with Dash (`dash.*` keys)
 *   - "mine"      my @ai-built/ scope, or my registry username's scope
 *   - "installed" anyone else's package
 *
 * A widget's scope comes from its `package` ("@scope/name") when present,
 * else from its component key ("scope.name.Component").
 */

const clean = (s) =>
  String(s || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

function scopeOf({ key, widget }) {
  const pkg = widget && widget.package;
  if (typeof pkg === "string" && pkg.startsWith("@") && pkg.includes("/")) {
    return clean(pkg.split("/")[0]);
  }
  const parts = String(key || "").split(".");
  return parts.length > 1 ? clean(parts[0]) : "";
}

/**
 * @param {{ key: string, widget: object }} entry
 * @param {string} [username] the signed-in registry username, if any
 * @returns {"builtin"|"mine"|"installed"}
 */
export function widgetSource(entry, username = "") {
  const scope = scopeOf(entry);
  if (scope === "dash") return "builtin";
  if (scope === "ai-built") return "mine";
  const me = clean(username);
  if (me && scope === me) return "mine";
  return "installed";
}

/** Does `entry` pass the Add panel's source filter ("all" passes all)? */
export function matchesSource(entry, filter, username = "") {
  if (!filter || filter === "all") return true;
  return widgetSource(entry, username) === filter;
}
