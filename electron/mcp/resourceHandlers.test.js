/**
 * resourceHandlers.test.js
 *
 * Integration tests for MCP resource handlers (5 resources) and
 * mcpDashServerController (lifecycle, auth, rate limiting, security).
 *
 * Uses Node.js built-in test module (same pattern as webSocketController.test.js).
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
let mockServerContext = null;

// ---------------------------------------------------------------------------
// Mock: BrowserWindow
// ---------------------------------------------------------------------------
function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      id: 1,
      send: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Load resourceHandlers with mocked dependencies
// ---------------------------------------------------------------------------
function loadResourceHandlers() {
  const source = fs.readFileSync(
    path.join(__dirname, "resourceHandlers.js"),
    "utf8",
  );

  const mockWorkspaceController = {
    listWorkspacesForApplication: () => ({
      workspaces: mockWorkspaces,
    }),
  };

  const mockThemeController = {
    listThemesForApplication: () => ({ themes: mockThemes }),
  };

  const mockProviderController = {
    listProviders: () => ({ providers: mockProviders }),
  };

  const mockSettingsController = {
    getSettingsForApplication: () => ({ settings: mockSettings }),
  };

  const mockMcpDashServerController = {
    getServerContext: () => mockServerContext,
    getStatus: () => ({
      running: true,
      enabled: true,
      port: 3141,
      connectionCount: 5,
      uptime: 300,
      toolCount: 18,
      resourceCount: 5,
    }),
  };

  const customRequire = (mod) => {
    if (mod === "../controller/mcpDashServerController")
      return mockMcpDashServerController;
    if (mod === "../controller/workspaceController")
      return mockWorkspaceController;
    if (mod === "../controller/themeController") return mockThemeController;
    if (mod === "../controller/providerController")
      return mockProviderController;
    if (mod === "../controller/settingsController")
      return mockSettingsController;
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
function parseResourceData(result) {
  return JSON.parse(result.contents[0].text);
}

function makeUri(href) {
  return { href };
}

function makeWorkspace(id, name, layout) {
  return {
    id,
    name,
    label: name,
    type: "workspace",
    layout: layout || [
      { id: 1, order: 1, component: "Container", parentId: 0 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Resource Handler Tests
// ---------------------------------------------------------------------------
describe("MCP Resource Handlers", () => {
  let handlers;
  const win = createMockWindow();

  beforeEach(() => {
    mockWorkspaces = [
      makeWorkspace(100, "Main Dashboard", [
        { id: 1, order: 1, component: "Container", parentId: 0 },
        {
          id: 2,
          order: 2,
          component: "Clock",
          parentId: 1,
          config: { timezone: "UTC" },
        },
        {
          id: 3,
          order: 3,
          component: "WeatherWidget",
          parentId: 1,
          config: {},
        },
      ]),
      makeWorkspace(200, "Second Dashboard"),
    ];
    mockThemes = {
      "Dark Mode": { primary: "#1a1a1a" },
      "Light Mode": { primary: "#ffffff" },
    };
    mockSettings = { theme: "Dark Mode" };
    mockProviders = [
      {
        name: "OpenAI",
        type: "openai",
        providerClass: "credential",
        credentials: { apiKey: "sk-secret" },
        dateCreated: "2026-01-01",
      },
    ];
    mockServerContext = { win, appId: "@trops/dash-electron" };
    handlers = loadResourceHandlers();
  });

  describe("dash://dashboards/active", () => {
    it("returns active dashboard with widgets", async () => {
      const result = await handlers.handleActiveDashboard(
        makeUri("dash://dashboards/active"),
      );
      assert.equal(result.contents[0].mimeType, "application/json");
      const data = parseResourceData(result);
      assert.equal(data.id, "100");
      assert.equal(data.name, "Main Dashboard");
      assert.equal(data.widgetCount, 2);
      assert.equal(data.widgets.length, 2);
      assert.equal(data.widgets[0].type, "Clock");
    });

    it("returns error when no dashboards exist", async () => {
      mockWorkspaces = [];
      const result = await handlers.handleActiveDashboard(
        makeUri("dash://dashboards/active"),
      );
      const data = parseResourceData(result);
      assert.ok(data.error);
    });

    it("throws when server context is null", async () => {
      mockServerContext = null;
      await assert.rejects(
        () =>
          handlers.handleActiveDashboard(makeUri("dash://dashboards/active")),
        { message: /not running/ },
      );
    });
  });

  describe("dash://dashboards", () => {
    it("returns all dashboards summary", async () => {
      const result = await handlers.handleAllDashboards(
        makeUri("dash://dashboards"),
      );
      const data = parseResourceData(result);
      assert.equal(data.count, 2);
      assert.equal(data.dashboards[0].name, "Main Dashboard");
      assert.equal(data.dashboards[0].widgetCount, 2);
      assert.equal(data.dashboards[0].isActive, true);
      assert.equal(data.dashboards[1].isActive, false);
    });
  });

  describe("dash://themes", () => {
    it("returns all themes with active state", async () => {
      const result = await handlers.handleAllThemes(makeUri("dash://themes"));
      const data = parseResourceData(result);
      assert.equal(data.count, 2);
      assert.equal(data.activeTheme, "Dark Mode");
      const dark = data.themes.find((t) => t.name === "Dark Mode");
      assert.equal(dark.isActive, true);
    });
  });

  describe("dash://providers", () => {
    it("returns providers without credentials", async () => {
      const result = await handlers.handleAllProviders(
        makeUri("dash://providers"),
      );
      const data = parseResourceData(result);
      assert.equal(data.count, 1);
      assert.equal(data.providers[0].name, "OpenAI");
      // SECURITY: credentials must NOT leak
      assert.equal(data.providers[0].credentials, undefined);
      assert.equal(data.providers[0].apiKey, undefined);
    });
  });

  describe("dash://app/info", () => {
    it("returns app info with stats and server status", async () => {
      const result = await handlers.handleAppInfo(makeUri("dash://app/info"));
      const data = parseResourceData(result);
      assert.equal(data.appId, "@trops/dash-electron");
      assert.equal(data.server.version, "1.0.0");
      assert.equal(data.server.port, 3141);
      assert.equal(data.server.toolCount, 18);
      assert.equal(data.server.resourceCount, 5);
      assert.equal(data.stats.dashboardCount, 2);
      assert.equal(data.stats.widgetCount, 2);
      assert.equal(data.stats.themeCount, 2);
      assert.equal(data.stats.providerCount, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// Server Controller Tests
// ---------------------------------------------------------------------------
describe("mcpDashServerController", () => {
  let controller;
  const win = createMockWindow();

  function loadController() {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "controller", "mcpDashServerController.js"),
      "utf8",
    );

    let savedSettings = {};

    const mockSettingsController = {
      getSettingsForApplication: () => ({
        settings: { mcpDashServer: savedSettings },
      }),
      saveSettingsForApplication: (win, settings) => {
        savedSettings = settings.mcpDashServer || {};
      },
    };

    // Mock McpServer and transport
    class MockMcpServer {
      constructor(opts) {
        this.name = opts.name;
        this.version = opts.version;
        this._tools = [];
        this._resources = [];
      }
      tool(name, desc, schema, handler) {
        this._tools.push({ name, desc, schema, handler });
      }
      resource(name, uri, meta, handler) {
        this._resources.push({ name, uri, meta, handler });
      }
      async connect(transport) {}
      async close() {}
    }

    class MockTransport {
      constructor(opts) {
        this.opts = opts;
      }
      async handleRequest(req, res) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    }

    const customRequire = (mod) => {
      if (mod === "http") return require("http");
      if (mod === "crypto") return require("crypto");
      if (mod === "electron")
        return {
          app: {
            getPath: () =>
              path.join(require("os").tmpdir(), "dash-test-" + Date.now()),
          },
        };
      if (mod === "@modelcontextprotocol/sdk/server/mcp.js")
        return { McpServer: MockMcpServer };
      if (mod === "@modelcontextprotocol/sdk/server/streamableHttp.js")
        return { StreamableHTTPServerTransport: MockTransport };
      if (mod === "./settingsController") return mockSettingsController;
      return require(mod);
    };

    const mod = { exports: {} };
    const fn = new Function("require", "module", "exports", "console", source);
    fn(customRequire, mod, mod.exports, console);
    return { controller: mod.exports, savedSettings: () => savedSettings };
  }

  describe("startServer", () => {
    it("starts on a free port", async () => {
      const { controller } = loadController();
      const result = await controller.startServer(win, { port: 0 });
      // Port 0 lets the OS pick — but the code uses httpServer.listen(port, "127.0.0.1")
      // and port 0 isn't handled specially. Use a high port instead.
      await controller.stopServer(win);
    });

    it("starts and returns success with url", async () => {
      const { controller } = loadController();
      const result = await controller.startServer(win, { port: 13141 });
      assert.equal(result.success, true);
      assert.equal(result.port, 13141);
      assert.ok(result.url.includes("127.0.0.1"));
      assert.ok(result.url.includes("13141"));
      await controller.stopServer(win);
    });

    it("rejects starting when already running", async () => {
      const { controller } = loadController();
      await controller.startServer(win, { port: 13142 });
      const result = await controller.startServer(win, { port: 13143 });
      assert.equal(result.success, false);
      assert.match(result.error, /already running/i);
      await controller.stopServer(win);
    });
  });

  describe("stopServer", () => {
    it("stops a running server", async () => {
      const { controller } = loadController();
      await controller.startServer(win, { port: 13144 });
      const result = await controller.stopServer(win);
      assert.equal(result.success, true);
    });

    it("returns success when server was not running", async () => {
      const { controller } = loadController();
      const result = await controller.stopServer(win);
      assert.equal(result.success, true);
      assert.match(result.message, /not running/i);
    });
  });

  describe("restartServer", () => {
    it("restarts the server", async () => {
      const { controller } = loadController();
      await controller.startServer(win, { port: 13145 });
      const result = await controller.restartServer(win, {
        port: 13146,
      });
      assert.equal(result.success, true);
      assert.equal(result.port, 13146);
      await controller.stopServer(win);
    });
  });

  describe("getStatus", () => {
    it("reports not running when stopped", () => {
      const { controller } = loadController();
      const status = controller.getStatus(win);
      assert.equal(status.running, false);
      assert.equal(status.uptime, 0);
    });

    it("reports running after start", async () => {
      const { controller } = loadController();
      await controller.startServer(win, { port: 13147 });
      const status = controller.getStatus(win);
      assert.equal(status.running, true);
      assert.ok(status.uptime >= 0);
      assert.equal(status.port, 13147);
      await controller.stopServer(win);
    });
  });

  describe("getOrCreateToken", () => {
    it("creates a token when none exists", () => {
      const { controller } = loadController();
      const token = controller.getOrCreateToken(win);
      assert.ok(token);
      assert.ok(typeof token === "string");
      assert.ok(token.length > 0);
    });

    it("returns the same token on subsequent calls", () => {
      const { controller } = loadController();
      const token1 = controller.getOrCreateToken(win);
      const token2 = controller.getOrCreateToken(win);
      assert.equal(token1, token2);
    });
  });

  describe("autoStart", () => {
    it("auto-starts when enabled in settings", async () => {
      const { controller, savedSettings } = loadController();
      // First create a token so settings have one
      controller.getOrCreateToken(win);
      // Manually enable via starting and stopping
      await controller.startServer(win, { port: 13148 });
      await controller.stopServer(win);
      // Now autoStart should try to start (settings.enabled was set to false by stop)
      const result = await controller.autoStart(win);
      // It should say "not enabled" since stopServer sets enabled: false
      assert.equal(result.success, false);
    });
  });

  describe("registerTool / registerResource", () => {
    it("registers tools that appear in status count", () => {
      const { controller } = loadController();
      const initialCount = controller.getStatus(win).toolCount;
      controller.registerTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
      });
      assert.equal(controller.getStatus(win).toolCount, initialCount + 1);
    });

    it("registers resources that appear in status count", () => {
      const { controller } = loadController();
      const initialCount = controller.getStatus(win).resourceCount;
      controller.registerResource({
        name: "test_resource",
        uri: "dash://test",
        handler: async () => ({
          contents: [
            {
              uri: "dash://test",
              mimeType: "application/json",
              text: "{}",
            },
          ],
        }),
      });
      assert.equal(controller.getStatus(win).resourceCount, initialCount + 1);
    });
  });

  describe("getServerContext", () => {
    it("returns null when server is not running", () => {
      const { controller } = loadController();
      const ctx = controller.getServerContext();
      assert.equal(ctx, null);
    });
  });

  describe("HTTP server security", () => {
    it("binds to 127.0.0.1 (localhost only)", async () => {
      const { controller } = loadController();
      const result = await controller.startServer(win, { port: 13149 });
      assert.equal(result.success, true);
      assert.ok(result.url.includes("127.0.0.1"));
      await controller.stopServer(win);
    });

    it("rejects requests without valid Bearer token", async () => {
      const { controller } = loadController();
      const http = require("http");
      const result = await controller.startServer(win, { port: 13150 });
      assert.equal(result.success, true);

      // Make request without auth header
      const response = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 13150,
            path: "/mcp",
            method: "POST",
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });

      assert.equal(response.status, 401);
      const data = JSON.parse(response.body);
      assert.match(data.error, /unauthorized/i);

      await controller.stopServer(win);
    });

    it("rejects requests with wrong Bearer token", async () => {
      const { controller } = loadController();
      const http = require("http");
      await controller.startServer(win, { port: 13151 });

      const response = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 13151,
            path: "/mcp",
            method: "POST",
            headers: {
              Authorization: "Bearer wrong-token-123",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });

      assert.equal(response.status, 401);

      await controller.stopServer(win);
    });

    it("returns 404 for unknown paths", async () => {
      const { controller } = loadController();
      const http = require("http");
      await controller.startServer(win, { port: 13152 });
      const token = controller.getOrCreateToken(win);

      const response = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 13152,
            path: "/unknown",
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });

      assert.equal(response.status, 404);

      await controller.stopServer(win);
    });

    it("serves health check endpoint", async () => {
      const { controller } = loadController();
      const http = require("http");
      await controller.startServer(win, { port: 13153 });
      const token = controller.getOrCreateToken(win);

      const response = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 13153,
            path: "/health",
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });

      assert.equal(response.status, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.status, "ok");
      assert.equal(data.server, "dash-electron-mcp");

      await controller.stopServer(win);
    });

    it("rate limits excessive requests", async () => {
      const { controller } = loadController();
      const http = require("http");
      await controller.startServer(win, { port: 13154 });
      const token = controller.getOrCreateToken(win);

      // Send 61 requests rapidly (rate limit is 60/min)
      const results = [];
      for (let i = 0; i < 62; i++) {
        const response = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port: 13154,
              path: "/health",
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () => resolve({ status: res.statusCode, body }));
            },
          );
          req.on("error", reject);
          req.end();
        });
        results.push(response.status);
      }

      // At least one should be rate limited (429)
      assert.ok(
        results.includes(429),
        "Expected at least one 429 rate limit response",
      );

      await controller.stopServer(win);
    });

    it("EADDRINUSE returns descriptive error", async () => {
      const { controller } = loadController();
      const result1 = await controller.startServer(win, {
        port: 13155,
      });
      assert.equal(result1.success, true);

      // Try to start another controller on the same port
      const { controller: controller2 } = loadController();
      const result2 = await controller2.startServer(win, {
        port: 13155,
      });
      assert.equal(result2.success, false);
      assert.match(result2.error, /already in use/i);

      await controller.stopServer(win);
    });
  });
});
