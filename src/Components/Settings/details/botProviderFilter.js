/**
 * botProviderFilter — the bot form's Providers list filters: a search, the
 * kind (All / MCP / Claude connectors) and Picked only. Filtering only
 * changes what shows: a picked provider the filters hide stays picked.
 */

export const KIND_ALL = "all";
export const KIND_MCP = "mcp";
export const KIND_CONNECTOR = "connector";

// The search bar shows above this many providers.
export const FILTER_MIN_PROVIDERS = 6;

// A provider no longer set up has no known kind: it shows under All only.
const kindOf = (s) =>
  s.missing ? null : s.connector ? KIND_CONNECTOR : KIND_MCP;

/**
 * @param {Array<{serverName, label, connector}>} servers
 * @param {{query?, kind?, pickedOnly?, pickedOnlyNames?: string[],
 *          picked?: string[]}} filters  `pickedOnlyNames`: what was picked
 *   when Picked only was turned on (default: `picked`).
 */
export function filterBotProviders(servers, filters = {}) {
  const list = Array.isArray(servers) ? servers : [];
  const picked = Array.isArray(filters.picked) ? filters.picked : [];
  const kind = filters.kind || KIND_ALL;
  const pinned = Array.isArray(filters.pickedOnlyNames)
    ? filters.pickedOnlyNames
    : picked;
  const q = String(filters.query || "")
    .trim()
    .toLowerCase();
  const shown = list.filter(
    (s) =>
      (kind === KIND_ALL || kindOf(s) === kind) &&
      (!q ||
        String(s.label || "")
          .toLowerCase()
          .includes(q) ||
        String(s.serverName || "")
          .toLowerCase()
          .includes(q)) &&
      (!filters.pickedOnly || pinned.includes(s.serverName)),
  );
  const pickedCount = list.filter((s) => picked.includes(s.serverName)).length;
  const hiddenPicked = list.filter(
    (s) => picked.includes(s.serverName) && !shown.includes(s),
  ).length;
  return { shown, pickedCount, hiddenPicked };
}

/** The kind switch's options with counts; null when only one kind is there. */
export function kindOptions(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const mcp = list.filter((s) => kindOf(s) === KIND_MCP).length;
  const connectors = list.filter((s) => kindOf(s) === KIND_CONNECTOR).length;
  if (!mcp || !connectors) return null;
  return [
    { value: KIND_ALL, label: `All ${list.length}` },
    { value: KIND_MCP, label: `MCP ${mcp}` },
    { value: KIND_CONNECTOR, label: `Claude connectors ${connectors}` },
  ];
}

/** "3 picked · showing 2 of 14" */
export function filterSummary({ pickedCount, shownCount, total }) {
  return `${pickedCount} picked · showing ${shownCount} of ${total}`;
}

/** "1 picked provider is hidden by the filter — still on" */
export function hiddenPickedNote(n) {
  if (!n) return null;
  return `${n} picked ${
    n === 1 ? "provider is" : "providers are"
  } hidden by the filter — still on`;
}
