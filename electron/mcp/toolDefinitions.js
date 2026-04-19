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
      "Create a new dashboard with the given name. Defaults to a 1×1 grid layout if `layout` is omitted — the resulting dashboard has a single cell ready for a widget. Pass an explicit `layout` object to use different dimensions. Pass `layout: null` only if the caller specifically wants a layout-less container dashboard (rare — widgets cannot be added without further editing). Returns the dashboard ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new dashboard",
        },
        layout: {
          type: "object",
          description:
            "Optional grid layout configuration. When provided, creates a grid dashboard instead of a simple container.",
          properties: {
            rows: {
              type: "number",
              description: "Number of rows (1-10)",
            },
            cols: {
              type: "number",
              description: "Number of columns (1-10)",
            },
            gap: {
              type: "string",
              description:
                "Tailwind gap class (e.g. 'gap-2', 'gap-4'). Defaults to 'gap-2'.",
            },
            colModes: {
              type: "object",
              description:
                "Per-row column sizing. Keys are row numbers (as strings), values are mode strings: 'equal', '1/4', '1/3', '1/2', '2/3'.",
            },
          },
          required: ["rows", "cols"],
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
  {
    name: "search_registry_dashboards",
    description:
      "Search the online Dash registry for pre-built dashboard templates. Returns matching dashboards with their names, descriptions, and the list of widgets they require. Useful when the user asks for a dashboard by topic (e.g. 'find me a sales dashboard'). If `compatibleWidgetsOnly` is true, only dashboards whose required widgets are ALL already installed are returned — safe to install without additional widget downloads. Otherwise, include dashboards that may require pulling in new widget packages first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword to match against dashboard names, descriptions, and tags",
        },
        compatibleWidgetsOnly: {
          type: "boolean",
          description:
            "When true, restrict results to dashboards whose required widgets are already installed. Defaults to false (returns all matches).",
        },
      },
      required: ["query"],
    },
  },
];

const widgetTools = [
  {
    name: "add_widget",
    description:
      "Add a widget to a dashboard by its scoped component name. IMPORTANT: Use the exact scoped name from list_widgets or search_widgets (format: 'scope.package.WidgetName', e.g. 'trops.gong.GongCallSearch'). Can be called multiple times. Returns the widget instance ID for use with configure_widget. If the dashboard has a grid layout, you can specify row/col for explicit placement, or omit them to auto-place in the next empty cell.",
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
            "Scoped component name from list_widgets/search_widgets (e.g. 'trops.gong.GongCallSearch', 'trops.slack.SlackChannelFeed')",
        },
        row: {
          type: "number",
          description:
            "Grid row to place the widget in (1-indexed). Must be used together with col. Requires a grid layout on the dashboard.",
        },
        col: {
          type: "number",
          description:
            "Grid column to place the widget in (1-indexed). Must be used together with row.",
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
      "List all available widgets from the registry. Returns scoped component names (e.g. 'trops.gong.GongCallSearch') that can be passed directly to add_widget. Each widget includes an 'installed' boolean — if true, use add_widget directly; if false, call install_widget first. Also includes description, provider requirements, and package info.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "search_widgets",
    description:
      "Search the widget registry by keyword. Returns matching widgets with scoped names (e.g. 'trops.slack.SlackChannelFeed') that can be passed directly to add_widget. Each widget includes an 'installed' boolean — if true, use add_widget directly; if false, call install_widget first. Also includes description and provider info.",
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
  {
    name: "install_widget",
    description:
      "Install a widget package from the Dash registry. Requires registry authentication — the user must be signed in via Settings > Account in the Dash app. Use search_widgets first to find available packages, then install by package name (e.g., 'slack', 'gong', 'chat'). After installation, use add_widget to place it on a dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description:
            "Package name from the registry (e.g., 'slack', 'gong', 'chat'). Use the 'package' field from search_widgets results.",
        },
      },
      required: ["packageName"],
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
      "Apply a saved theme. Omit `dashboard` to set the app-wide default theme (affects every dashboard that doesn't have its own override). Pass `dashboard` (name or ID) to set that dashboard's theme override instead — useful when the user asks for a theme on a specific dashboard (e.g. 'apply ocean to my Sales dashboard'). The theme must already exist; use list_themes to see available themes or create one with create_theme / create_theme_from_url.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the theme to apply",
        },
        dashboard: {
          type: "string",
          description:
            "Optional dashboard name or numeric ID. Omit for app-wide application.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_registry_themes",
    description:
      "Search the online Dash registry for themes by keyword. Returns matching theme packages with their names, descriptions, and preview metadata. Useful when the user asks for a theme style (e.g. 'find me a dark purple theme') and the local `list_themes` set doesn't have a good match. Each result includes an `installed` boolean — if false, call `install_registry_theme` to pull it in, then `apply_theme` to activate.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword to match against theme names, descriptions, and tags",
        },
      },
      required: ["query"],
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

const layoutTools = [
  {
    name: "set_layout",
    description:
      "Set or replace the grid layout on a dashboard. Creates a LayoutGridContainer with the specified dimensions. Existing widgets in cells that fit the new grid are preserved; widgets outside the new bounds are orphaned (kept but unassigned). Use this to add a grid to an existing dashboard or to resize the grid.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "Dashboard ID. Omit to use the active dashboard.",
        },
        rows: {
          type: "number",
          description: "Number of rows (1-10)",
        },
        cols: {
          type: "number",
          description: "Number of columns (1-10)",
        },
        gap: {
          type: "string",
          description:
            "Tailwind gap class (e.g. 'gap-2', 'gap-4'). Defaults to 'gap-2'.",
        },
        colModes: {
          type: "object",
          description:
            "Per-row column sizing. Keys are row numbers (as strings), values are mode strings: 'equal', '1/4', '1/3', '1/2', '2/3'.",
        },
      },
      required: ["rows", "cols"],
    },
  },
  {
    name: "update_layout",
    description:
      "Partially update the grid layout. Only specified properties change — omitted properties keep their current values. colModes is merged (not replaced). Widgets in removed rows/columns are orphaned. Dashboard must already have a grid layout.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "Dashboard ID. Omit to use the active dashboard.",
        },
        rows: {
          type: "number",
          description: "New number of rows (1-10). Omit to keep current.",
        },
        cols: {
          type: "number",
          description: "New number of columns (1-10). Omit to keep current.",
        },
        gap: {
          type: "string",
          description: "Tailwind gap class. Omit to keep current.",
        },
        colModes: {
          type: "object",
          description:
            "Column sizing modes to merge. Set a key to null to reset that row to default.",
        },
      },
      required: [],
    },
  },
  {
    name: "move_widget",
    description:
      "Move a widget to a different grid cell. If the target cell is occupied, the two widgets are swapped. The widget must already be placed in a grid cell. Use get_dashboard to find widget IDs and current positions.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: {
          type: "string",
          description: "Dashboard ID. Omit to use the active dashboard.",
        },
        widgetId: {
          type: "string",
          description: "ID of the widget to move",
        },
        row: {
          type: "number",
          description: "Target row (1-indexed)",
        },
        col: {
          type: "number",
          description: "Target column (1-indexed)",
        },
      },
      required: ["widgetId", "row", "col"],
    },
  },
];

module.exports = {
  dashboardTools,
  widgetTools,
  themeTools,
  providerTools,
  guideTools,
  layoutTools,
};
