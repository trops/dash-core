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

const themeTools = [
  {
    name: "list_themes",
    description:
      "List all saved themes with their names and whether they are currently active",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_theme",
    description:
      "Get full details of a theme by name, including all color values",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the theme to retrieve",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_theme",
    description:
      "Create a new theme from a colors object. The colors object should contain color role keys (e.g. primary, secondary, surface, background) mapped to hex values or shade objects.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new theme",
        },
        colors: {
          type: "object",
          description:
            "Theme colors object with role keys mapped to hex values or shade objects",
        },
      },
      required: ["name", "colors"],
    },
  },
  {
    name: "create_theme_from_url",
    description:
      "Extract brand colors from a website URL and generate a theme. Loads the page, extracts colors from meta tags, CSS variables, computed styles, and favicons, then maps them to theme roles.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Website URL to extract colors from (must start with http:// or https://)",
        },
        name: {
          type: "string",
          description:
            "Optional name for the theme. If omitted, a name is derived from the URL hostname.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "apply_theme",
    description:
      "Apply a saved theme to the active dashboard. The theme must already exist (use list_themes to see available themes).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the theme to apply",
        },
      },
      required: ["name"],
    },
  },
];

const providerTools = [
  {
    name: "list_providers",
    description:
      "List all configured providers with their names, types, and status. Credential secrets are never returned.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "add_provider",
    description:
      "Add a new provider configuration. Supports credential providers (API keys) and MCP providers (server connections). Credentials are encrypted at rest.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Unique display name for the provider (e.g. 'Algolia Production', 'Slack')",
        },
        type: {
          type: "string",
          description:
            "Provider type identifier (e.g. 'algolia', 'slack', 'openai', 'github')",
        },
        providerClass: {
          type: "string",
          enum: ["credential", "mcp"],
          description:
            "Provider class: 'credential' for API key providers, 'mcp' for MCP server providers. Defaults to 'credential'.",
        },
        credentials: {
          type: "object",
          description:
            "Credentials object (e.g. { apiKey: '...', appId: '...' }). Encrypted at rest, never returned in responses.",
        },
        mcpConfig: {
          type: "object",
          description:
            "MCP server configuration (transport, command, args, envMapping). Only used when providerClass is 'mcp'.",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of allowed MCP tool names. Only used when providerClass is 'mcp'.",
        },
      },
      required: ["name", "type", "credentials"],
    },
  },
  {
    name: "remove_provider",
    description:
      "Remove a provider by name. This deletes the provider and its stored credentials permanently.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the provider to remove",
        },
      },
      required: ["name"],
    },
  },
];

module.exports = { dashboardTools, widgetTools, themeTools, providerTools };
