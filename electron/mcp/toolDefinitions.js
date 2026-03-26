/**
 * toolDefinitions.js
 *
 * MCP tool schemas for dashboard/workspace operations and app stats.
 * Each definition includes name, description, and JSON Schema inputSchema.
 */

const dashboardTools = [
  {
    name: "list_dashboards",
    description:
      "List all dashboards with their IDs, names, and widget counts. Use this to discover existing dashboards before creating new ones or to find a dashboard ID for other operations.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_dashboard",
    description:
      "Get full details of a dashboard including layout, widgets, and theme. Omit dashboardId to get the active dashboard. Use this to inspect widget configurations or to understand the current layout before making changes.",
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
    description:
      "Create a new empty dashboard with the given name. Returns the dashboard ID. After creating, use search_widgets or list_widgets to find widgets, then add_widget to populate the dashboard.",
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
      "Delete a dashboard by ID. Cannot delete the last remaining dashboard. Use list_dashboards first to find the dashboard ID.",
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
      "Get application statistics: counts of dashboards, widgets, themes, and providers. Useful for understanding the current state of the app at a glance.",
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
      "Add a widget to a dashboard by component name. Call list_widgets or search_widgets first to discover available widget names. Can be called multiple times to add multiple widgets. Returns the widget instance ID for use with configure_widget.",
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
    description:
      "Remove a widget instance from a dashboard by its ID. Use get_dashboard to find widget instance IDs.",
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
      "Update a widget's configuration. The config object is merged into the existing config (partial update). Use get_dashboard to see current widget configs and discover valid config keys.",
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
      "List all available widgets from the registry, including name, description, and provider requirements. Use this to discover what widgets can be added to dashboards with add_widget.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "search_widgets",
    description:
      "Search the widget registry by keyword. Returns matching widgets with name, description, and provider info. Use the widget name from results with add_widget to add it to a dashboard.",
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
      "List all saved themes with their names and whether they are currently active. Use this to discover available themes before applying one.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_theme",
    description:
      "Get full details of a theme by name, including all color values and shade mappings. Use list_themes first to find theme names.",
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
      "Create a new theme from a colors object. Primary maps to buttons, links, and active states. Secondary maps to backgrounds, cards, and panels. Tertiary maps to accents, badges, and highlights. Example colors: { primary: '#3b82f6', secondary: '#10b981', tertiary: '#f59e0b' }. After creation, use apply_theme to activate it.",
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
      "Extract brand colors from a website URL and generate a matching theme. Loads the page in a hidden browser, extracts colors from meta tags, CSS variables, computed styles, and favicons, then maps them to theme roles. Works best with pages that have visible brand colors. Takes a few seconds to process. After creation, use apply_theme to activate it.",
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
      "Apply a saved theme to the active dashboard. The theme must already exist -- use list_themes to see available themes, or create one first with create_theme or create_theme_from_url.",
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

const guideTools = [
  {
    name: "get_setup_guide",
    description:
      "Get a contextual setup guide for Dash. Returns step-by-step instructions for the requested topic. Call this when the user asks how to get started, what they can do, or needs help with a specific workflow.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["dashboard", "theme", "provider", "widget", "overview"],
          description:
            "Topic to get help with. Use 'overview' or omit for a general capabilities guide.",
        },
      },
      required: [],
    },
  },
];

const providerTools = [
  {
    name: "list_providers",
    description:
      "List all configured providers with their names, types, and status. Credential secrets are never returned. Use this to check which services are already connected.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "add_provider",
    description:
      "Add a new provider configuration. Supports credential providers (API keys) and MCP providers (server connections with tool scoping). Credentials are encrypted at rest. Common types: 'github', 'slack', 'algolia', 'notion', 'openai'. Use list_providers first to check existing connections.",
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

module.exports = {
  dashboardTools,
  widgetTools,
  themeTools,
  providerTools,
  guideTools,
};
