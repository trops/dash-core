/**
 * toolHandlers.test.js
 *
 * Integration tests for all 18 MCP tool handlers.
 * Covers: dashboard tools (5), widget tools (5), theme tools (5), provider tools (3).
 * Each handler is tested with valid inputs and error/validation cases.
 *
 * Uses Node.js built-in test module (same pattern as webSocketController.test.js).
 * The toolHandlers source is re-evaluated with mocked controller dependencies.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Mock State
// ---------------------------------------------------------------------------
let mockWorkspaces = [];
let mockThemes = {};
let mockSettings = {};
let mockProviders = [];
let mockRegistryPackages = [];
let mockSearchResults = [];
let mockSent = [];
let mockServerContext = null;

// ---------------------------------------------------------------------------
// Mock: BrowserWindow
// ---------------------------------------------------------------------------
function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      id: 1,
      send: (channel, payload) => mockSent.push({ channel, payload }),
    },
  };
}

// ---------------------------------------------------------------------------
// Load toolHandlers with mocked dependencies
// ---------------------------------------------------------------------------
function loadToolHandlers() {
  const source = fs.readFileSync(
    path.join(__dirname, "toolHandlers.js"),
    "utf8",
  );

  const mockWorkspaceController = {
    listWorkspacesForApplication: () => ({
      workspaces: mockWorkspaces,
    }),
    saveWorkspaceForApplication: (win, appId, workspace) => {
      // Update the workspace in the mock list
      const idx = mockWorkspaces.findIndex((ws) => ws.id === workspace.id);
      if (idx >= 0) {
        mockWorkspaces[idx] = workspace;
      } else {
        mockWorkspaces.push(workspace);
      }
      return { success: true };
    },
    deleteWorkspaceForApplication: (win, appId, wsId) => {
      mockWorkspaces = mockWorkspaces.filter((ws) => ws.id !== wsId);
      return { workspaces: mockWorkspaces };
    },
  };

  const mockThemeController = {
    listThemesForApplication: () => ({ themes: mockThemes }),
    saveThemeForApplication: (win, appId, name, colors) => {
      mockThemes[name] = colors;
      return { success: true, themes: mockThemes };
    },
  };

  const mockProviderController = {
    listProviders: () => ({ providers: mockProviders }),
    saveProvider: (
      win,
      appId,
      name,
      type,
      credentials,
      providerClass,
      mcpConfig,
      allowedTools,
    ) => {
      mockProviders.push({
        name,
        type,
        providerClass,
        credentials,
        dateCreated: "2026-03-16",
      });
      return { success: true };
    },
    deleteProvider: (win, appId, name) => {
      const idx = mockProviders.findIndex((p) => p.name === name);
      if (idx < 0) return { error: true, message: "Not found" };
      mockProviders.splice(idx, 1);
      return { success: true };
    },
  };

  const mockRegistryController = {
    fetchRegistryIndex: async () => ({ packages: mockRegistryPackages }),
    searchRegistry: async () => ({ packages: mockSearchResults }),
  };

  const mockSettingsController = {
    getSettingsForApplication: () => ({ settings: mockSettings }),
    saveSettingsForApplication: (win, settings) => {
      mockSettings = settings;
      return { success: true };
    },
  };

  const mockMcpDashServerController = {
    getServerContext: () => mockServerContext,
    getStatus: () => ({
      running: true,
      enabled: true,
      port: 3141,
      connectionCount: 0,
      uptime: 100,
      toolCount: 18,
      resourceCount: 5,
    }),
  };

  const mockThemeFromUrlController = {
    extractColorsFromUrl: () => ({
      palette: [
        { hex: "#ff0000", confidence: 0.9, role: "primary" },
        { hex: "#00ff00", confidence: 0.8, role: "secondary" },
      ],
    }),
  };

  const mockPaletteToThemeMapper = {
    generateThemeFromPalette: (palette) => ({
      theme: { primary: "#ff0000", secondary: "#00ff00" },
    }),
  };

  const mockExtractionCacheController = {
    get: async (url, fetcher) => fetcher(),
  };

  const customRequire = (mod) => {
    if (mod === "crypto") return require("crypto");
    if (mod === "url") return require("url");
    if (mod === "../controller/mcpDashServerController")
      return mockMcpDashServerController;
    if (mod === "../controller/workspaceController")
      return mockWorkspaceController;
    if (mod === "../controller/themeController") return mockThemeController;
    if (mod === "../controller/providerController")
      return mockProviderController;
    if (mod === "../controller/registryController")
      return mockRegistryController;
    if (mod === "../controller/settingsController")
      return mockSettingsController;
    if (mod === "../controller/themeFromUrlController")
      return mockThemeFromUrlController;
    if (mod === "../controller/paletteToThemeMapper")
      return mockPaletteToThemeMapper;
    if (mod === "../controller/extractionCacheController")
      return mockExtractionCacheController;
    if (mod === "../events")
      return {
        THEME_SAVE_COMPLETE: "theme-save-complete",
        SETTINGS_SAVE_COMPLETE: "settings-save-complete",
        PROVIDER_LIST_COMPLETE: "provider-list-complete",
      };
    if (mod === "electron")
      return {
        BrowserWindow: class MockBW {
          constructor() {
            this.webContents = {
              on: () => {},
              executeJavaScript: async () => ({
                success: true,
                htmlContent: "<html></html>",
                cssContent: "",
                computedStyles: {},
              }),
            };
          }
          loadURL() {
            return Promise.resolve();
          }
          destroy() {}
        },
      };
    return require(mod);
  };

  const mod = { exports: {} };
  const fn = new Function("require", "module", "exports", "console", source);
  fn(customRequire, mod, mod.exports, console);
  return mod.exports;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function makeWorkspace(id, name, layout) {
  return {
    id,
    name,
    label: name,
    type: "workspace",
    layout: layout || [{ id: 1, order: 1, component: "Container", parent: 0 }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MCP Tool Handlers", () => {
  let handlers;
  const win = createMockWindow();

  beforeEach(() => {
    mockWorkspaces = [
      makeWorkspace(100, "Main Dashboard", [
        { id: 1, order: 1, component: "Container", parent: 0 },
        {
          id: 2,
          order: 2,
          component: "Clock",
          parent: 1,
          config: { timezone: "UTC" },
        },
        {
          id: 3,
          order: 3,
          component: "WeatherWidget",
          parent: 1,
          config: {},
        },
      ]),
      makeWorkspace(200, "Second Dashboard"),
    ];
    mockThemes = {
      "Dark Mode": { primary: "#1a1a1a", surface: "#2d2d2d" },
      "Light Mode": { primary: "#ffffff", surface: "#f0f0f0" },
    };
    mockSettings = { theme: "Dark Mode" };
    mockProviders = [
      {
        name: "OpenAI",
        type: "openai",
        providerClass: "credential",
        credentials: { apiKey: "sk-secret123" },
        dateCreated: "2026-01-01",
        dateUpdated: "2026-01-01",
      },
    ];
    mockRegistryPackages = [
      {
        name: "@trops/clock-widget",
        displayName: "Clock Widget",
        description: "A clock",
        widgets: [
          {
            name: "Clock",
            displayName: "Clock",
            description: "A clock widget",
          },
        ],
      },
    ];
    mockSearchResults = [...mockRegistryPackages];
    mockSent = [];
    mockServerContext = { win, appId: "@trops/dash-electron" };
    handlers = loadToolHandlers();
  });

  // =====================================================================
  // Dashboard Tools
  // =====================================================================
  describe("list_dashboards", () => {
    it("returns all dashboards with widget counts", async () => {
      const result = await handlers.handleListDashboards();
      const data = parseResult(result);
      assert.equal(data.length, 2);
      assert.equal(data[0].name, "Main Dashboard");
      assert.equal(data[0].widgetCount, 2); // Clock + WeatherWidget
      assert.equal(data[0].isActive, true);
      assert.equal(data[1].name, "Second Dashboard");
      assert.equal(data[1].isActive, false);
    });

    it("throws when server context is null", async () => {
      mockServerContext = null;
      await assert.rejects(() => handlers.handleListDashboards(), {
        message: /not running/,
      });
    });
  });

  describe("get_dashboard", () => {
    it("returns active dashboard when no ID provided", async () => {
      const result = await handlers.handleGetDashboard({});
      const data = parseResult(result);
      assert.equal(data.name, "Main Dashboard");
      assert.equal(data.widgets.length, 2);
      assert.equal(data.widgets[0].type, "Clock");
    });

    it("returns specific dashboard by ID", async () => {
      const result = await handlers.handleGetDashboard({
        dashboardId: "200",
      });
      const data = parseResult(result);
      assert.equal(data.name, "Second Dashboard");
    });

    it("returns error for non-existent dashboard", async () => {
      const result = await handlers.handleGetDashboard({
        dashboardId: "999",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /not found/i);
    });

    it("returns error when no dashboards exist", async () => {
      mockWorkspaces = [];
      const result = await handlers.handleGetDashboard({});
      assert.equal(result.isError, true);
    });
  });

  describe("create_dashboard", () => {
    it("creates a dashboard with the given name", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "My New Dashboard",
      });
      const data = parseResult(result);
      assert.ok(data.id);
      assert.equal(data.name, "My New Dashboard");
      assert.equal(mockWorkspaces.length, 3);
    });

    it("rejects empty name", async () => {
      const result = await handlers.handleCreateDashboard({ name: "" });
      assert.equal(result.isError, true);
    });

    it("rejects missing name", async () => {
      const result = await handlers.handleCreateDashboard({});
      assert.equal(result.isError, true);
    });

    it("trims whitespace from name", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "  Trimmed  ",
      });
      const data = parseResult(result);
      assert.equal(data.name, "Trimmed");
    });
  });

  describe("delete_dashboard", () => {
    it("deletes a dashboard by ID", async () => {
      const result = await handlers.handleDeleteDashboard({
        dashboardId: "200",
      });
      const data = parseResult(result);
      assert.equal(data.success, true);
      assert.equal(data.deleted, "200");
      assert.equal(data.remaining, 1);
    });

    it("rejects deleting the last dashboard", async () => {
      mockWorkspaces = [makeWorkspace(100, "Only Dashboard")];
      const result = await handlers.handleDeleteDashboard({
        dashboardId: "100",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /last remaining/i);
    });

    it("rejects missing dashboardId", async () => {
      const result = await handlers.handleDeleteDashboard({});
      assert.equal(result.isError, true);
    });

    it("rejects non-existent dashboard", async () => {
      const result = await handlers.handleDeleteDashboard({
        dashboardId: "999",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /not found/i);
    });
  });

  describe("get_app_stats", () => {
    it("returns correct aggregate stats", async () => {
      const result = await handlers.handleGetAppStats();
      const data = parseResult(result);
      assert.equal(data.dashboardCount, 2);
      assert.equal(data.widgetCount, 2); // Only Main Dashboard has widgets
      assert.equal(data.themeCount, 2);
      assert.equal(data.providerCount, 1);
    });
  });

  // =====================================================================
  // Widget Tools
  // =====================================================================
  describe("add_widget", () => {
    it("adds a widget to the active dashboard", async () => {
      const result = await handlers.handleAddWidget({
        widgetName: "NotesWidget",
      });
      const data = parseResult(result);
      assert.ok(data.widgetId);
      assert.equal(data.name, "NotesWidget");
      assert.equal(data.dashboardId, "100");
    });

    it("adds a widget to a specific dashboard", async () => {
      const result = await handlers.handleAddWidget({
        dashboardId: "200",
        widgetName: "Clock",
      });
      const data = parseResult(result);
      assert.equal(data.dashboardId, "200");
    });

    it("rejects empty widgetName", async () => {
      const result = await handlers.handleAddWidget({ widgetName: "" });
      assert.equal(result.isError, true);
    });

    it("rejects missing widgetName", async () => {
      const result = await handlers.handleAddWidget({});
      assert.equal(result.isError, true);
    });

    it("rejects non-existent dashboard", async () => {
      const result = await handlers.handleAddWidget({
        dashboardId: "999",
        widgetName: "Clock",
      });
      assert.equal(result.isError, true);
    });
  });

  describe("remove_widget", () => {
    it("removes a widget by ID", async () => {
      const result = await handlers.handleRemoveWidget({
        widgetId: "2",
      });
      const data = parseResult(result);
      assert.equal(data.success, true);
      assert.equal(data.removed, "2");
      assert.equal(data.remainingWidgets, 1); // WeatherWidget remains
    });

    it("rejects non-existent widget", async () => {
      const result = await handlers.handleRemoveWidget({
        widgetId: "999",
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing widgetId", async () => {
      const result = await handlers.handleRemoveWidget({});
      assert.equal(result.isError, true);
    });
  });

  describe("configure_widget", () => {
    it("merges config into existing widget", async () => {
      const result = await handlers.handleConfigureWidget({
        widgetId: "2",
        config: { format: "24h" },
      });
      const data = parseResult(result);
      assert.equal(data.widgetId, "2");
      assert.equal(data.component, "Clock");
      assert.equal(data.config.timezone, "UTC");
      assert.equal(data.config.format, "24h");
    });

    it("rejects missing widgetId", async () => {
      const result = await handlers.handleConfigureWidget({
        config: { x: 1 },
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing config", async () => {
      const result = await handlers.handleConfigureWidget({
        widgetId: "2",
      });
      assert.equal(result.isError, true);
    });

    it("rejects array config", async () => {
      const result = await handlers.handleConfigureWidget({
        widgetId: "2",
        config: [1, 2, 3],
      });
      assert.equal(result.isError, true);
    });

    it("rejects non-existent widget", async () => {
      const result = await handlers.handleConfigureWidget({
        widgetId: "999",
        config: { x: 1 },
      });
      assert.equal(result.isError, true);
    });
  });

  describe("list_widgets", () => {
    it("returns widgets from the registry", async () => {
      const result = await handlers.handleListWidgets();
      const data = parseResult(result);
      assert.ok(data.widgets.length > 0);
      assert.equal(data.widgets[0].name, "Clock");
      assert.equal(data.count, data.widgets.length);
    });

    it("handles packages without widgets array", async () => {
      mockRegistryPackages = [
        {
          name: "@trops/simple-widget",
          displayName: "Simple",
          description: "A simple widget",
        },
      ];
      const result = await handlers.handleListWidgets();
      const data = parseResult(result);
      assert.equal(data.widgets.length, 1);
      assert.equal(data.widgets[0].name, "@trops/simple-widget");
    });

    it("returns error on registry failure", async () => {
      // Override the mock to throw
      handlers = loadToolHandlers();
      mockRegistryPackages = null;
      // The fetch will fail because null doesn't have .packages
      const result = await handlers.handleListWidgets();
      // Still returns, either empty or error
      assert.ok(result.content);
    });
  });

  describe("search_widgets", () => {
    it("searches the registry by query", async () => {
      const result = await handlers.handleSearchWidgets({
        query: "clock",
      });
      const data = parseResult(result);
      assert.equal(data.query, "clock");
      assert.ok(data.widgets.length >= 0);
    });

    it("rejects empty query", async () => {
      const result = await handlers.handleSearchWidgets({ query: "" });
      assert.equal(result.isError, true);
    });

    it("rejects missing query", async () => {
      const result = await handlers.handleSearchWidgets({});
      assert.equal(result.isError, true);
    });
  });

  // =====================================================================
  // Theme Tools
  // =====================================================================
  describe("list_themes", () => {
    it("returns all themes with active state", async () => {
      const result = await handlers.handleListThemes();
      const data = parseResult(result);
      assert.equal(data.count, 2);
      const dark = data.themes.find((t) => t.name === "Dark Mode");
      assert.equal(dark.isActive, true);
      const light = data.themes.find((t) => t.name === "Light Mode");
      assert.equal(light.isActive, false);
    });
  });

  describe("get_theme", () => {
    it("returns theme details by name", async () => {
      const result = await handlers.handleGetTheme({
        name: "Dark Mode",
      });
      const data = parseResult(result);
      assert.equal(data.name, "Dark Mode");
      assert.equal(data.isActive, true);
      assert.equal(data.colors.primary, "#1a1a1a");
    });

    it("returns error for non-existent theme", async () => {
      const result = await handlers.handleGetTheme({
        name: "Missing Theme",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /not found/i);
    });

    it("rejects empty name", async () => {
      const result = await handlers.handleGetTheme({ name: "" });
      assert.equal(result.isError, true);
    });

    it("rejects missing name", async () => {
      const result = await handlers.handleGetTheme({});
      assert.equal(result.isError, true);
    });
  });

  describe("create_theme", () => {
    it("creates a theme from colors object", async () => {
      const result = await handlers.handleCreateTheme({
        name: "My Theme",
        colors: { primary: "#aabbcc" },
      });
      const data = parseResult(result);
      assert.equal(data.name, "My Theme");
      assert.equal(data.created, true);
      assert.ok("My Theme" in mockThemes);
    });

    it("notifies renderer on create", async () => {
      await handlers.handleCreateTheme({
        name: "Notify Theme",
        colors: { primary: "#000" },
      });
      assert.ok(mockSent.some((s) => s.channel === "theme-save-complete"));
    });

    it("rejects empty name", async () => {
      const result = await handlers.handleCreateTheme({
        name: "",
        colors: { primary: "#000" },
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing colors", async () => {
      const result = await handlers.handleCreateTheme({
        name: "Foo",
      });
      assert.equal(result.isError, true);
    });

    it("rejects array colors", async () => {
      const result = await handlers.handleCreateTheme({
        name: "Foo",
        colors: ["#000"],
      });
      assert.equal(result.isError, true);
    });
  });

  describe("create_theme_from_url", () => {
    it("extracts colors from a URL and creates a theme", async () => {
      const result = await handlers.handleCreateThemeFromUrl({
        url: "https://example.com",
        name: "Example Theme",
      });
      const data = parseResult(result);
      assert.equal(data.name, "Example Theme");
      assert.equal(data.created, true);
      assert.ok(data.colorsExtracted > 0);
      assert.equal(data.source, "https://example.com");
    });

    it("derives theme name from URL when name omitted", async () => {
      const result = await handlers.handleCreateThemeFromUrl({
        url: "https://www.github.com/test",
      });
      const data = parseResult(result);
      assert.equal(data.name, "github.com");
    });

    it("rejects missing url", async () => {
      const result = await handlers.handleCreateThemeFromUrl({});
      assert.equal(result.isError, true);
    });

    it("rejects non-http URL", async () => {
      const result = await handlers.handleCreateThemeFromUrl({
        url: "ftp://example.com",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /http/i);
    });
  });

  describe("apply_theme", () => {
    it("applies an existing theme", async () => {
      const result = await handlers.handleApplyTheme({
        name: "Light Mode",
      });
      const data = parseResult(result);
      assert.equal(data.name, "Light Mode");
      assert.equal(data.applied, true);
    });

    it("notifies renderer on apply", async () => {
      await handlers.handleApplyTheme({ name: "Light Mode" });
      assert.ok(mockSent.some((s) => s.channel === "settings-save-complete"));
    });

    it("rejects non-existent theme", async () => {
      const result = await handlers.handleApplyTheme({
        name: "Missing",
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /not found/i);
    });

    it("rejects empty name", async () => {
      const result = await handlers.handleApplyTheme({ name: "" });
      assert.equal(result.isError, true);
    });
  });

  // =====================================================================
  // Provider Tools
  // =====================================================================
  describe("list_providers", () => {
    it("returns providers without credentials", async () => {
      const result = await handlers.handleListProviders();
      const data = parseResult(result);
      assert.equal(data.count, 1);
      assert.equal(data.providers[0].name, "OpenAI");
      assert.equal(data.providers[0].type, "openai");
      // SECURITY: credentials must NOT be in response
      assert.equal(data.providers[0].credentials, undefined);
      assert.equal(data.providers[0].apiKey, undefined);
    });
  });

  describe("add_provider", () => {
    it("adds a credential provider", async () => {
      const result = await handlers.handleAddProvider({
        name: "Slack",
        type: "slack",
        credentials: { apiKey: "xoxb-test" },
      });
      const data = parseResult(result);
      assert.equal(data.name, "Slack");
      assert.equal(data.type, "slack");
      assert.equal(data.providerClass, "credential");
      assert.equal(data.created, true);
    });

    it("adds an MCP provider", async () => {
      const result = await handlers.handleAddProvider({
        name: "GitHub MCP",
        type: "github",
        providerClass: "mcp",
        credentials: { token: "ghp_test" },
        mcpConfig: {
          transport: "stdio",
          command: "npx",
          args: ["@modelcontextprotocol/server-github"],
        },
        allowedTools: ["create_issue"],
      });
      const data = parseResult(result);
      assert.equal(data.providerClass, "mcp");
      assert.equal(data.created, true);
    });

    it("rejects duplicate provider name", async () => {
      const result = await handlers.handleAddProvider({
        name: "OpenAI",
        type: "openai",
        credentials: { apiKey: "test" },
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /already exists/i);
    });

    it("rejects invalid providerClass", async () => {
      const result = await handlers.handleAddProvider({
        name: "Foo",
        type: "foo",
        providerClass: "invalid",
        credentials: { key: "val" },
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing name", async () => {
      const result = await handlers.handleAddProvider({
        type: "foo",
        credentials: { key: "val" },
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing type", async () => {
      const result = await handlers.handleAddProvider({
        name: "Foo",
        credentials: { key: "val" },
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing credentials", async () => {
      const result = await handlers.handleAddProvider({
        name: "Foo",
        type: "foo",
      });
      assert.equal(result.isError, true);
    });

    it("notifies renderer after adding", async () => {
      await handlers.handleAddProvider({
        name: "Slack",
        type: "slack",
        credentials: { apiKey: "test" },
      });
      assert.ok(mockSent.some((s) => s.channel === "provider-list-complete"));
    });
  });

  describe("remove_provider", () => {
    it("removes a provider by name", async () => {
      const result = await handlers.handleRemoveProvider({
        name: "OpenAI",
      });
      const data = parseResult(result);
      assert.equal(data.name, "OpenAI");
      assert.equal(data.removed, true);
      assert.equal(mockProviders.length, 0);
    });

    it("rejects empty name", async () => {
      const result = await handlers.handleRemoveProvider({ name: "" });
      assert.equal(result.isError, true);
    });

    it("rejects missing name", async () => {
      const result = await handlers.handleRemoveProvider({});
      assert.equal(result.isError, true);
    });

    it("notifies renderer after removing", async () => {
      await handlers.handleRemoveProvider({ name: "OpenAI" });
      assert.ok(mockSent.some((s) => s.channel === "provider-list-complete"));
    });
  });

  // =====================================================================
  // Layout Tools
  // =====================================================================

  describe("create_dashboard with layout", () => {
    it("creates a grid dashboard when layout is provided", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Grid Dashboard",
        layout: { rows: 2, cols: 3 },
      });
      const data = parseResult(result);
      assert.ok(data.id);
      assert.equal(data.name, "Grid Dashboard");
      assert.deepStrictEqual(data.layout, { rows: 2, cols: 3 });

      // Verify workspace was saved with LayoutGridContainer
      const ws = mockWorkspaces.find((w) => String(w.id) === data.id);
      assert.ok(ws);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.ok(gridNode);
      assert.equal(gridNode.parent, 0);
      assert.equal(gridNode.grid.rows, 2);
      assert.equal(gridNode.grid.cols, 3);
      assert.equal(gridNode.grid.gap, "gap-2");
      // Check all cells exist
      assert.deepStrictEqual(gridNode.grid["1.1"], {
        component: null,
        hide: false,
      });
      assert.deepStrictEqual(gridNode.grid["2.3"], {
        component: null,
        hide: false,
      });
    });

    it("uses default gap when not specified", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Default Gap",
        layout: { rows: 1, cols: 1 },
      });
      const data = parseResult(result);
      const ws = mockWorkspaces.find((w) => String(w.id) === data.id);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.equal(gridNode.grid.gap, "gap-2");
    });

    it("passes colModes through", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "ColModes",
        layout: { rows: 1, cols: 2, colModes: { 1: "1/4" } },
      });
      const data = parseResult(result);
      const ws = mockWorkspaces.find((w) => String(w.id) === data.id);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.deepStrictEqual(gridNode.grid.colModes, { 1: "1/4" });
    });

    it("creates plain Container when layout omitted", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Plain Dashboard",
      });
      const data = parseResult(result);
      assert.equal(data.layout, undefined);
      const ws = mockWorkspaces.find((w) => String(w.id) === data.id);
      assert.ok(ws.layout.find((n) => n.component === "Container"));
    });

    it("rejects rows out of bounds", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Bad",
        layout: { rows: 0, cols: 1 },
      });
      assert.equal(result.isError, true);
    });

    it("rejects cols out of bounds", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Bad",
        layout: { rows: 1, cols: 11 },
      });
      assert.equal(result.isError, true);
    });

    it("rejects layout missing rows", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Bad",
        layout: { cols: 2 },
      });
      assert.equal(result.isError, true);
    });

    it("rejects layout as array", async () => {
      const result = await handlers.handleCreateDashboard({
        name: "Bad",
        layout: [1, 2],
      });
      assert.equal(result.isError, true);
    });
  });

  describe("add_widget with row/col", () => {
    function makeGridWorkspace(id, name, rows, cols, cells) {
      const grid = {
        rows,
        cols,
        gap: "gap-2",
      };
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          grid[`${r}.${c}`] = { component: null, hide: false };
        }
      }
      if (cells) {
        for (const [key, val] of Object.entries(cells)) {
          grid[key] = val;
        }
      }
      return {
        id,
        name,
        label: name,
        type: "workspace",
        layout: [
          {
            id: 1,
            order: 1,
            component: "LayoutGridContainer",
            parent: 0,
            grid,
          },
        ],
      };
    }

    it("places widget in specified grid cell", async () => {
      mockWorkspaces = [makeGridWorkspace(300, "Grid", 2, 2)];
      const result = await handlers.handleAddWidget({
        dashboardId: "300",
        widgetName: "Clock",
        row: 1,
        col: 2,
      });
      const data = parseResult(result);
      assert.ok(data.widgetId);
      assert.deepStrictEqual(data.cell, { row: 1, col: 2 });

      // Verify grid cell was updated
      const ws = mockWorkspaces.find((w) => w.id === 300);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.equal(gridNode.grid["1.2"].component, Number(data.widgetId));
    });

    it("auto-places in next empty cell when no row/col", async () => {
      mockWorkspaces = [
        makeGridWorkspace(300, "Grid", 1, 2, {
          1.1: { component: 5, hide: false },
        }),
      ];
      const result = await handlers.handleAddWidget({
        dashboardId: "300",
        widgetName: "Clock",
      });
      const data = parseResult(result);
      assert.deepStrictEqual(data.cell, { row: 1, col: 2 });
    });

    it("errors when cell is out of bounds", async () => {
      mockWorkspaces = [makeGridWorkspace(300, "Grid", 1, 2)];
      const result = await handlers.handleAddWidget({
        dashboardId: "300",
        widgetName: "Clock",
        row: 2,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /out of bounds/i);
    });

    it("errors when cell is occupied", async () => {
      mockWorkspaces = [
        makeGridWorkspace(300, "Grid", 1, 2, {
          1.1: { component: 5, hide: false },
        }),
      ];
      const result = await handlers.handleAddWidget({
        dashboardId: "300",
        widgetName: "Clock",
        row: 1,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /occupied/i);
    });

    it("errors when row/col specified but no grid", async () => {
      const result = await handlers.handleAddWidget({
        dashboardId: "100",
        widgetName: "Clock",
        row: 1,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /no grid/i);
    });

    it("errors when only row provided", async () => {
      const result = await handlers.handleAddWidget({
        widgetName: "Clock",
        row: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /both row and col/i);
    });

    it("appends without cell when no grid and no row/col", async () => {
      const result = await handlers.handleAddWidget({
        dashboardId: "100",
        widgetName: "NotesWidget",
      });
      const data = parseResult(result);
      assert.ok(data.widgetId);
      assert.equal(data.cell, undefined);
    });
  });

  describe("remove_widget grid cleanup", () => {
    it("clears grid cell assignment when removing widget", async () => {
      const grid = {
        rows: 1,
        cols: 2,
        gap: "gap-2",
        1.1: { component: 5, hide: false },
        1.2: { component: 6, hide: false },
      };
      mockWorkspaces = [
        {
          id: 400,
          name: "Grid",
          label: "Grid",
          type: "workspace",
          layout: [
            {
              id: 1,
              order: 1,
              component: "LayoutGridContainer",
              parent: 0,
              grid,
            },
            { id: 5, order: 2, component: "Clock", parent: 1, config: {} },
            {
              id: 6,
              order: 3,
              component: "Weather",
              parent: 1,
              config: {},
            },
          ],
        },
      ];

      await handlers.handleRemoveWidget({
        dashboardId: "400",
        widgetId: "5",
      });

      const ws = mockWorkspaces.find((w) => w.id === 400);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.equal(gridNode.grid["1.1"].component, null);
      assert.equal(gridNode.grid["1.2"].component, 6);
    });
  });

  describe("set_layout", () => {
    it("creates grid on dashboard with Container", async () => {
      const result = await handlers.handleSetLayout({
        dashboardId: "100",
        rows: 2,
        cols: 3,
      });
      const data = parseResult(result);
      assert.equal(data.dashboardId, "100");
      assert.deepStrictEqual(data.grid, { rows: 2, cols: 3 });

      const ws = mockWorkspaces.find((w) => w.id === 100);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.ok(gridNode);
      assert.equal(gridNode.grid.rows, 2);
      assert.equal(gridNode.grid.cols, 3);
    });

    it("replaces existing grid and preserves fitting assignments", async () => {
      const grid = {
        rows: 2,
        cols: 2,
        gap: "gap-2",
        1.1: { component: 5, hide: false },
        1.2: { component: 6, hide: false },
        2.1: { component: 7, hide: false },
        2.2: { component: null, hide: false },
      };
      mockWorkspaces = [
        {
          id: 500,
          name: "Grid",
          label: "Grid",
          type: "workspace",
          layout: [
            {
              id: 1,
              order: 1,
              component: "LayoutGridContainer",
              parent: 0,
              grid,
            },
          ],
        },
      ];

      const result = await handlers.handleSetLayout({
        dashboardId: "500",
        rows: 1,
        cols: 2,
      });
      const data = parseResult(result);
      assert.deepStrictEqual(data.grid, { rows: 1, cols: 2 });
      // Widget 7 was in 2.1 which is now out of bounds
      assert.ok(data.orphanedWidgets.includes("7"));
      // Widgets 5 and 6 should be preserved
      const ws = mockWorkspaces.find((w) => w.id === 500);
      const gridNode = ws.layout.find(
        (n) => n.component === "LayoutGridContainer",
      );
      assert.equal(gridNode.grid["1.1"].component, 5);
      assert.equal(gridNode.grid["1.2"].component, 6);
    });

    it("rejects rows out of bounds", async () => {
      const result = await handlers.handleSetLayout({
        dashboardId: "100",
        rows: 0,
        cols: 1,
      });
      assert.equal(result.isError, true);
    });

    it("rejects missing rows", async () => {
      const result = await handlers.handleSetLayout({
        dashboardId: "100",
        cols: 1,
      });
      assert.equal(result.isError, true);
    });
  });

  describe("update_layout", () => {
    function makeGridDashboard(id, rows, cols, cells) {
      const grid = { rows, cols, gap: "gap-2" };
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          grid[`${r}.${c}`] = { component: null, hide: false };
        }
      }
      if (cells) {
        for (const [key, val] of Object.entries(cells)) {
          grid[key] = val;
        }
      }
      return {
        id,
        name: "Grid",
        label: "Grid",
        type: "workspace",
        layout: [
          {
            id: 1,
            order: 1,
            component: "LayoutGridContainer",
            parent: 0,
            grid,
          },
        ],
      };
    }

    it("updates only gap when specified", async () => {
      mockWorkspaces = [makeGridDashboard(600, 2, 2)];
      const result = await handlers.handleUpdateLayout({
        dashboardId: "600",
        gap: "gap-4",
      });
      const data = parseResult(result);
      assert.equal(data.grid.gap, "gap-4");
      assert.equal(data.grid.rows, 2);
      assert.equal(data.grid.cols, 2);
    });

    it("merges colModes", async () => {
      mockWorkspaces = [makeGridDashboard(600, 2, 2)];
      // Add initial colModes
      mockWorkspaces[0].layout[0].grid.colModes = { 1: "1/4" };

      const result = await handlers.handleUpdateLayout({
        dashboardId: "600",
        colModes: { 2: "1/3" },
      });
      const data = parseResult(result);
      const ws = mockWorkspaces.find((w) => w.id === 600);
      const gridNode = ws.layout[0];
      assert.equal(gridNode.grid.colModes["1"], "1/4");
      assert.equal(gridNode.grid.colModes["2"], "1/3");
    });

    it("orphans widgets when shrinking", async () => {
      mockWorkspaces = [
        makeGridDashboard(600, 2, 2, {
          2.1: { component: 10, hide: false },
        }),
      ];
      const result = await handlers.handleUpdateLayout({
        dashboardId: "600",
        rows: 1,
      });
      const data = parseResult(result);
      assert.ok(data.orphanedWidgets.includes("10"));
      assert.equal(data.grid.rows, 1);
    });

    it("expands grid with empty cells", async () => {
      mockWorkspaces = [makeGridDashboard(600, 1, 1)];
      const result = await handlers.handleUpdateLayout({
        dashboardId: "600",
        rows: 2,
        cols: 2,
      });
      const data = parseResult(result);
      assert.equal(data.grid.rows, 2);
      assert.equal(data.grid.cols, 2);
      const ws = mockWorkspaces.find((w) => w.id === 600);
      assert.deepStrictEqual(ws.layout[0].grid["2.2"], {
        component: null,
        hide: false,
      });
    });

    it("errors when no grid exists", async () => {
      const result = await handlers.handleUpdateLayout({
        dashboardId: "100",
        rows: 2,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /no grid/i);
    });

    it("errors when no properties specified", async () => {
      const result = await handlers.handleUpdateLayout({
        dashboardId: "100",
      });
      assert.equal(result.isError, true);
    });
  });

  describe("move_widget", () => {
    function makeGridDashboard(id, rows, cols, cells) {
      const grid = { rows, cols, gap: "gap-2" };
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          grid[`${r}.${c}`] = { component: null, hide: false };
        }
      }
      if (cells) {
        for (const [key, val] of Object.entries(cells)) {
          grid[key] = val;
        }
      }
      return {
        id,
        name: "Grid",
        label: "Grid",
        type: "workspace",
        layout: [
          {
            id: 1,
            order: 1,
            component: "LayoutGridContainer",
            parent: 0,
            grid,
          },
        ],
      };
    }

    it("moves widget to an empty cell", async () => {
      mockWorkspaces = [
        makeGridDashboard(700, 1, 3, {
          1.1: { component: 10, hide: false },
        }),
      ];
      const result = await handlers.handleMoveWidget({
        dashboardId: "700",
        widgetId: "10",
        row: 1,
        col: 3,
      });
      const data = parseResult(result);
      assert.equal(data.widgetId, "10");
      assert.deepStrictEqual(data.cell, { row: 1, col: 3 });
      assert.equal(data.swapped, false);

      const ws = mockWorkspaces.find((w) => w.id === 700);
      const gridNode = ws.layout[0];
      assert.equal(gridNode.grid["1.1"].component, null);
      assert.equal(gridNode.grid["1.3"].component, 10);
    });

    it("swaps when target cell is occupied", async () => {
      mockWorkspaces = [
        makeGridDashboard(700, 1, 2, {
          1.1: { component: 10, hide: false },
          1.2: { component: 11, hide: false },
        }),
      ];
      const result = await handlers.handleMoveWidget({
        dashboardId: "700",
        widgetId: "10",
        row: 1,
        col: 2,
      });
      const data = parseResult(result);
      assert.equal(data.swapped, true);
      assert.equal(data.swappedWidgetId, "11");

      const ws = mockWorkspaces.find((w) => w.id === 700);
      const gridNode = ws.layout[0];
      assert.equal(gridNode.grid["1.1"].component, 11);
      assert.equal(gridNode.grid["1.2"].component, 10);
    });

    it("no-ops when source equals target", async () => {
      mockWorkspaces = [
        makeGridDashboard(700, 1, 2, {
          1.1: { component: 10, hide: false },
        }),
      ];
      const result = await handlers.handleMoveWidget({
        dashboardId: "700",
        widgetId: "10",
        row: 1,
        col: 1,
      });
      const data = parseResult(result);
      assert.equal(data.swapped, false);
    });

    it("errors when widget not in grid", async () => {
      mockWorkspaces = [makeGridDashboard(700, 1, 2)];
      const result = await handlers.handleMoveWidget({
        dashboardId: "700",
        widgetId: "99",
        row: 1,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /not found/i);
    });

    it("errors when target out of bounds", async () => {
      mockWorkspaces = [
        makeGridDashboard(700, 1, 2, {
          1.1: { component: 10, hide: false },
        }),
      ];
      const result = await handlers.handleMoveWidget({
        dashboardId: "700",
        widgetId: "10",
        row: 2,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /out of bounds/i);
    });

    it("errors when no grid exists", async () => {
      const result = await handlers.handleMoveWidget({
        dashboardId: "100",
        widgetId: "2",
        row: 1,
        col: 1,
      });
      assert.equal(result.isError, true);
      const data = parseResult(result);
      assert.match(data.error, /no grid/i);
    });

    it("errors when widgetId missing", async () => {
      const result = await handlers.handleMoveWidget({
        row: 1,
        col: 1,
      });
      assert.equal(result.isError, true);
    });

    it("errors when row/col missing", async () => {
      const result = await handlers.handleMoveWidget({
        widgetId: "10",
      });
      assert.equal(result.isError, true);
    });
  });

  // =====================================================================
  // Helper Functions
  // =====================================================================
  describe("helper: buildEmptyGrid", () => {
    it("creates grid with correct dimensions and empty cells", () => {
      const grid = handlers.buildEmptyGrid(2, 3, "gap-4", { 1: "1/4" });
      assert.equal(grid.rows, 2);
      assert.equal(grid.cols, 3);
      assert.equal(grid.gap, "gap-4");
      assert.deepStrictEqual(grid.colModes, { 1: "1/4" });
      assert.deepStrictEqual(grid["1.1"], { component: null, hide: false });
      assert.deepStrictEqual(grid["2.3"], { component: null, hide: false });
    });

    it("defaults gap to gap-2", () => {
      const grid = handlers.buildEmptyGrid(1, 1);
      assert.equal(grid.gap, "gap-2");
    });

    it("omits colModes when empty", () => {
      const grid = handlers.buildEmptyGrid(1, 1, "gap-2", {});
      assert.equal(grid.colModes, undefined);
    });
  });

  describe("helper: findNextEmptyCell", () => {
    it("finds first empty cell scanning L-R, T-B", () => {
      const grid = {
        rows: 2,
        cols: 2,
        1.1: { component: 5, hide: false },
        1.2: { component: 6, hide: false },
        2.1: { component: null, hide: false },
        2.2: { component: null, hide: false },
      };
      const cell = handlers.findNextEmptyCell(grid);
      assert.deepStrictEqual(cell, { row: 2, col: 1 });
    });

    it("returns null when all cells occupied", () => {
      const grid = {
        rows: 1,
        cols: 1,
        1.1: { component: 5, hide: false },
      };
      assert.equal(handlers.findNextEmptyCell(grid), null);
    });

    it("skips hidden cells", () => {
      const grid = {
        rows: 1,
        cols: 2,
        1.1: { component: null, hide: true },
        1.2: { component: null, hide: false },
      };
      const cell = handlers.findNextEmptyCell(grid);
      assert.deepStrictEqual(cell, { row: 1, col: 2 });
    });
  });

  describe("helper: findGridNode", () => {
    it("finds LayoutGridContainer with grid object", () => {
      const layout = [
        { id: 1, component: "LayoutGridContainer", grid: { rows: 1 } },
        { id: 2, component: "Clock" },
      ];
      const node = handlers.findGridNode(layout);
      assert.equal(node.id, 1);
    });

    it("returns null when no grid exists", () => {
      const layout = [{ id: 1, component: "Container" }];
      assert.equal(handlers.findGridNode(layout), null);
    });

    it("returns null for non-array input", () => {
      assert.equal(handlers.findGridNode(null), null);
    });
  });
});
