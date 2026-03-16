/**
 * resourceDefinitions.js
 *
 * MCP resource definitions for read-only app state via dash:// URIs.
 * Each resource exposes a snapshot of Dash state to external LLM clients.
 */

const dashResources = [
  {
    name: "active-dashboard",
    uri: "dash://dashboards/active",
    description:
      "Current active dashboard — layout, widgets, theme, and widget count",
  },
  {
    name: "all-dashboards",
    uri: "dash://dashboards",
    description:
      "Summary of all dashboards — IDs, names, widget counts, active state",
  },
  {
    name: "all-themes",
    uri: "dash://themes",
    description:
      "All saved themes — names, active state, and color definitions",
  },
  {
    name: "all-providers",
    uri: "dash://providers",
    description:
      "All configured providers — names, types, classes (no credentials or secrets)",
  },
  {
    name: "app-info",
    uri: "dash://app/info",
    description:
      "Application info — version, appId, and counts of dashboards, widgets, themes, providers",
  },
];

module.exports = { dashResources };
