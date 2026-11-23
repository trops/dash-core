/**
 * toolSwitches.js — which of Dash's MCP tools are offered to clients
 * (DASH-37, Settings › MCP Server › Tools).
 *
 * Each tool has a switch. Tools are on unless registered with
 * `defaultOff: true` (the bot tools, answer_approval); the user's choices, saved as
 * `mcpDashServer.tools: { [name]: boolean }`, override that. A tool that's
 * off isn't registered on the request's server at all, and its handler
 * refuses too, in case a client calls it anyway.
 *
 * A tool registered with `onWith: [names]` (confirm_bot) has no switch of
 * its own: it's on while any of those is.
 *
 * Pure: the registered tools and the saved switches are passed in.
 */
"use strict";

// The groups Settings shows, in order. A tool not named here is in "Other".
const TOOL_GROUPS = [
  {
    id: "bots",
    label: "Bots",
    tools: ["list_bots", "create_bot", "update_bot", "set_team_settings"],
  },
  {
    id: "teams",
    label: "Teams and tasks",
    tools: [
      "list_teams",
      "ask_team_lead",
      "give_task",
      "confirm_task",
      "get_task_status",
      "list_tasks",
      // Approvals over MCP (DASH-32): off unless turned on.
      "answer_approval",
    ],
  },
  {
    id: "dashboards",
    label: "Dashboards",
    tools: [
      "list_dashboards",
      "get_dashboard",
      "create_dashboard",
      "delete_dashboard",
      "search_registry_dashboards",
      "get_app_stats",
    ],
  },
  {
    id: "widgets",
    label: "Widgets and layout",
    tools: [
      "list_widgets",
      "search_widgets",
      "install_widget",
      "add_widget",
      "remove_widget",
      "configure_widget",
      "move_widget",
      "set_layout",
      "update_layout",
    ],
  },
  {
    id: "providers",
    label: "Providers",
    tools: [
      "list_providers",
      "add_provider",
      "remove_provider",
      "install_known_mcp_server",
    ],
  },
  {
    id: "themes",
    label: "Themes and guides",
    tools: [
      "list_themes",
      "get_theme",
      "create_theme",
      "create_theme_from_url",
      "apply_theme",
      "search_registry_themes",
      "get_setup_guide",
    ],
  },
];
const OTHER = { id: "other", label: "Other" };

function groupOf(name) {
  const g = TOOL_GROUPS.find((x) => x.tools.includes(name)) || OTHER;
  return { id: g.id, label: g.label };
}

/** Is this tool offered? Unknown tools never are. */
function isToolOn(name, registered = [], switches = {}, seen = new Set()) {
  const tool = registered.find((t) => t && t.name === name);
  if (!tool || seen.has(name)) return false;
  if (Array.isArray(tool.onWith)) {
    seen.add(name);
    return tool.onWith.some((n) => isToolOn(n, registered, switches, seen));
  }
  const set = switches && switches[name];
  return typeof set === "boolean" ? set : !tool.defaultOff;
}

/** What a client that calls a tool that's off is told. */
const offMessage = (name) =>
  `${name} is turned off in Dash (Settings › MCP Server › Tools).`;

/**
 * Every tool with a switch, in group order (Settings' list):
 * [{ name, description, group, groupLabel, on, defaultOff }].
 */
function listToolSwitches(registered = [], switches = {}) {
  const order = (name) => {
    const gi = TOOL_GROUPS.findIndex((g) => g.tools.includes(name));
    return gi < 0 ? TOOL_GROUPS.length : gi;
  };
  return registered
    .filter((t) => t && t.name && !Array.isArray(t.onWith))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => order(a.t.name) - order(b.t.name) || a.i - b.i)
    .map(({ t }) => {
      const g = groupOf(t.name);
      return {
        name: t.name,
        description: t.description || "",
        group: g.id,
        groupLabel: g.label,
        on: isToolOn(t.name, registered, switches),
        defaultOff: !!t.defaultOff,
      };
    });
}

/**
 * The switches with one changed, or null when there's no such switch
 * (an unknown tool, or one that follows others).
 */
function withSwitch(registered = [], switches = {}, name, on) {
  const tool = registered.find((t) => t && t.name === name);
  if (!tool || Array.isArray(tool.onWith)) return null;
  return { ...(switches || {}), [name]: !!on };
}

module.exports = {
  TOOL_GROUPS,
  groupOf,
  isToolOn,
  offMessage,
  listToolSwitches,
  withSwitch,
};
