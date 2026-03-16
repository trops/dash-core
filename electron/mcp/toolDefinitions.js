/**
 * toolDefinitions.js
 *
 * MCP tool schemas for dashboard/workspace operations and app stats.
 * Each definition includes name, description, and JSON Schema inputSchema.
 */

const dashboardTools = [
  {
    name: "list_dashboards",
    description: "List all dashboards with their IDs, names, and widget counts",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_dashboard",
    description:
      "Get full details of a dashboard including layout and widgets. Omit dashboardId to get the active dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description:
            "Dashboard ID. Omit to get the currently active dashboard.",
        },
      },
      required: [],
    },
  },
  {
    name: "create_dashboard",
    description: "Create a new dashboard with the given name",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new dashboard",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_dashboard",
    description:
      "Delete a dashboard by ID. Cannot delete the last remaining dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "ID of the dashboard to delete",
        },
      },
      required: ["dashboardId"],
    },
  },
  {
    name: "get_app_stats",
    description:
      "Get application statistics: counts of dashboards, widgets, themes, and providers",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

module.exports = { dashboardTools };
