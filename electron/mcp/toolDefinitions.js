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

const widgetTools = [
  {
    name: "add_widget",
    description:
      "Add a widget to a dashboard by component name. Use list_widgets or search_widgets to find available widget names.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description:
            "Dashboard ID to add the widget to. Omit to use the active dashboard.",
        },
        widgetName: {
          type: "string",
          description:
            "Component name of the widget to add (e.g. 'Clock', 'WeatherWidget')",
        },
      },
      required: ["widgetName"],
    },
  },
  {
    name: "remove_widget",
    description: "Remove a widget instance from a dashboard by its ID",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "Dashboard ID. Omit to use the active dashboard.",
        },
        widgetId: {
          type: "string",
          description: "ID of the widget instance to remove",
        },
      },
      required: ["widgetId"],
    },
  },
  {
    name: "configure_widget",
    description:
      "Update a widget's configuration. The config object is merged into the existing config.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "Dashboard ID. Omit to use the active dashboard.",
        },
        widgetId: {
          type: "string",
          description: "ID of the widget instance to configure",
        },
        config: {
          type: "object",
          description:
            "Configuration object to merge into existing widget config",
        },
      },
      required: ["widgetId", "config"],
    },
  },
  {
    name: "list_widgets",
    description:
      "List available widgets from the registry, including name, description, and provider info",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "search_widgets",
    description:
      "Search the widget registry by keyword. Returns matching widgets with name, description, and provider info.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword to match against widget names, descriptions, and tags",
        },
      },
      required: ["query"],
    },
  },
];

module.exports = { dashboardTools, widgetTools };
