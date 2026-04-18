/**
 * mcpDashServerController.js
 *
 * Manages the hosted MCP server that exposes Dash capabilities to external
 * LLM clients (Claude Desktop, ChatGPT, etc.) via Streamable HTTP transport.
 *
 * This is the MCP *server* — distinct from mcpController.js which is the
 * MCP *client* that connects to external tool servers for widgets.
 *
 * Architecture:
 *   - Node https server bound to 127.0.0.1 (localhost only)
 *   - Auto-generated self-signed TLS certificate for localhost
 *   - StreamableHTTPServerTransport from @modelcontextprotocol/sdk
 *   - McpServer registers tools and resources
 *   - Bearer token authentication on all requests
 *   - Rate limiting via token bucket (60 req/min)
 */
const https = require("https");
const { randomUUID } = require("crypto");
const { BrowserWindow } = require("electron");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const settingsController = require("./settingsController");
const { getOrCreateCert } = require("../mcp/tlsCert");

// Tool-name prefixes that indicate a mutation. After a successful call
// to any of these, the renderer is notified via "dash-mcp:state-changed"
// so it can refresh the relevant UI slice (themes, dashboards, widgets,
// providers, etc.) without requiring a manual reload.
const MUTATING_PREFIXES = [
  "create_",
  "add_",
  "remove_",
  "delete_",
  "update_",
  "apply_",
  "install_",
  "move_",
  "set_",
  "configure_",
];

function isMutatingTool(name) {
  return MUTATING_PREFIXES.some((p) => name.startsWith(p));
}

function broadcastStateChanged(toolName, result) {
  // Best-effort parse of the tool's first text content block. MCP tool
  // results are of shape { content: [{ type: "text", text: "<json>" }] }.
  // Expose the parsed JSON as `result` so renderers can act on specifics
  // (e.g. the new dashboard ID from create_dashboard) without a round
  // trip back to fetch state.
  let parsed = null;
  try {
    const firstText = result?.content?.find?.((c) => c.type === "text")?.text;
    if (firstText) parsed = JSON.parse(firstText);
  } catch {
    /* leave null */
  }
  const payload = { toolName, result: parsed };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send("dash-mcp:state-changed", payload);
      } catch {
        /* ignore */
      }
    }
  }
}

// --- State ---
let mcpServer = null;
let httpsServer = null;
let transport = null;
let startTime = null;
let connectionCount = 0;
let activeWin = null;

// --- Rate Limiting ---
const RATE_LIMIT = 60; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute in ms
const rateBuckets = new Map(); // ip -> { count, resetAt }

function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

// Clean up stale buckets periodically
let cleanupInterval = null;
function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateBuckets) {
      if (now > bucket.resetAt) rateBuckets.delete(ip);
    }
  }, RATE_WINDOW);
}
function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  rateBuckets.clear();
}

// --- Tool, Resource & Prompt Registration ---
// These are populated by other modules (DASH-78, DASH-79, etc.)
// Each entry: { name, description, inputSchema, handler }
const registeredTools = [];
const registeredResources = [];
// Each entry: { name, description, args, handler }
const registeredPrompts = [];

/**
 * Register a tool to be exposed via the MCP server.
 * Call this before starting the server (or restart after registering).
 */
function registerTool(toolDef) {
  registeredTools.push(toolDef);
}

/**
 * Register a resource to be exposed via the MCP server.
 */
function registerResource(resourceDef) {
  registeredResources.push(resourceDef);
}

/**
 * Register a prompt to be exposed via the MCP server.
 * Prompts are guided entry points that LLM clients display as suggested actions.
 */
function registerPrompt(promptDef) {
  registeredPrompts.push(promptDef);
}

const z = require("zod");
const { jsonSchemaToZod } = require("../mcp/jsonSchemaToZod");

/**
 * Apply all registered tools, resources, and prompts to the McpServer instance.
 */
function applyRegistrations(server) {
  for (const tool of registeredTools) {
    const zodSchema = jsonSchemaToZod(tool.inputSchema);
    // Wrap mutating tool handlers so a successful invocation broadcasts
    // "dash-mcp:state-changed" to all renderer windows. Read-only tools
    // (list_, get_, search_) are passed through unwrapped.
    const mutating = isMutatingTool(tool.name);
    const handler = mutating
      ? async (...args) => {
          const result = await tool.handler(...args);
          if (result && !result.isError) {
            broadcastStateChanged(tool.name, result);
          }
          return result;
        }
      : tool.handler;
    // server.tool() expects a raw Zod shape (e.g. { name: z.string() }),
    // NOT a z.object() wrapper. Extract .shape from the Zod object.
    server.tool(tool.name, tool.description, zodSchema.shape || {}, handler);
  }
  for (const resource of registeredResources) {
    server.resource(
      resource.name,
      resource.uri,
      resource.metadata || {},
      resource.handler,
    );
  }
  for (const prompt of registeredPrompts) {
    if (prompt.args && Object.keys(prompt.args).length > 0) {
      // Prompt with arguments — use the 4-arg overload
      // Build a Zod-compatible arg schema from our plain arg definitions
      const shape = {};
      for (const [key, def] of Object.entries(prompt.args)) {
        shape[key] = def.required
          ? z.string().describe(def.description)
          : z.string().optional().describe(def.description);
      }
      server.prompt(prompt.name, prompt.description, shape, prompt.handler);
    } else {
      // Prompt with no arguments — use the 2-arg overload
      server.prompt(prompt.name, prompt.description, prompt.handler);
    }
  }
}

// --- Settings Helpers ---
function getMcpServerSettings(win) {
  const result = settingsController.getSettingsForApplication(win);
  const settings = result?.settings || {};
  return settings.mcpDashServer || {};
}

function saveMcpServerSettings(win, mcpSettings) {
  const result = settingsController.getSettingsForApplication(win);
  const settings = result?.settings || {};
  settings.mcpDashServer = mcpSettings;
  settingsController.saveSettingsForApplication(win, settings);
}

// --- App ID Resolution ---
/**
 * Resolve the appId by scanning the userData/Dashboard directory for
 * subdirectories containing workspaces.json. Falls back to the default.
 */
function resolveAppId() {
  const { app } = require("electron");
  const fs = require("fs");
  const path = require("path");
  const dashboardDir = path.join(app.getPath("userData"), "Dashboard");
  try {
    const entries = fs.readdirSync(dashboardDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const wsFile = path.join(dashboardDir, entry.name, "workspaces.json");
        if (fs.existsSync(wsFile)) {
          return entry.name;
        }
      }
    }
  } catch (e) {
    // Directory may not exist yet
  }
  return "@trops/dash-electron";
}

/**
 * Get the current server context (win + appId) for tool handlers.
 * Returns null if the server is not running.
 */
function getServerContext() {
  if (!activeWin) return null;
  return { win: activeWin, appId: resolveAppId() };
}

// --- Controller ---
const mcpDashServerController = {
  /**
   * Start the MCP Dash server.
   * @param {BrowserWindow} win
   * @param {Object} options - { port?: number }
   */
  startServer: async (win, options = {}) => {
    if (httpsServer) {
      return {
        success: false,
        error: "Server is already running",
      };
    }

    try {
      const serverSettings = getMcpServerSettings(win);
      const port = options.port || serverSettings.port || 3141;
      const token =
        serverSettings.token || mcpDashServerController.getOrCreateToken(win);

      // Create McpServer
      mcpServer = new McpServer({
        name: "dash-electron",
        version: "1.0.0",
      });

      // Generate or load TLS certificate
      const { app } = require("electron");
      const path = require("path");
      const certsDir = path.join(app.getPath("userData"), "certs");
      const tlsCert = getOrCreateCert(certsDir);

      // Apply registered tools and resources
      applyRegistrations(mcpServer);

      // Create HTTPS server with auth and rate limiting
      httpsServer = https.createServer(
        { key: tlsCert.key, cert: tlsCert.cert },
        async (req, res) => {
          const ip = req.socket.remoteAddress || req.connection.remoteAddress;

          // Rate limiting
          if (isRateLimited(ip)) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Rate limit exceeded" }));
            return;
          }

          // Bearer token auth
          const authHeader = req.headers.authorization;
          if (!authHeader || authHeader !== `Bearer ${token}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }

          // Handle MCP requests on /mcp path
          if (req.url === "/mcp" || req.url?.startsWith("/mcp")) {
            try {
              // Stateless mode: create a fresh server + transport per request
              const reqServer = new McpServer({
                name: "dash-electron",
                version: "1.0.0",
              });
              applyRegistrations(reqServer);
              const reqTransport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
              });
              await reqServer.connect(reqTransport);
              connectionCount++;
              await reqTransport.handleRequest(req, res);
            } catch (err) {
              console.error("[mcpDashServer] Error handling MCP request:", err);
              if (!res.headersSent) {
                res.writeHead(500, {
                  "Content-Type": "application/json",
                });
                res.end(
                  JSON.stringify({
                    error: "Internal server error",
                  }),
                );
              }
            }
          } else {
            // Health check endpoint
            if (req.url === "/health" && req.method === "GET") {
              res.writeHead(200, {
                "Content-Type": "application/json",
              });
              res.end(
                JSON.stringify({
                  status: "ok",
                  server: "dash-electron-mcp",
                  version: "1.0.0",
                }),
              );
              return;
            }
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
          }
        },
      );

      // Bind to localhost only
      await new Promise((resolve, reject) => {
        httpsServer.on("error", (err) => {
          httpsServer = null;
          mcpServer = null;
          if (err.code === "EADDRINUSE") {
            reject(
              new Error(
                `Port ${port} is already in use. Choose a different port in Settings.`,
              ),
            );
          } else {
            reject(err);
          }
        });
        httpsServer.listen(port, "127.0.0.1", () => {
          resolve();
        });
      });

      startTime = Date.now();
      connectionCount = 0;
      activeWin = win;
      startCleanup();

      // Save enabled state
      saveMcpServerSettings(win, {
        ...serverSettings,
        enabled: true,
        port,
        token,
      });

      console.log(
        `[mcpDashServer] Server started on https://127.0.0.1:${port}/mcp`,
      );

      return {
        success: true,
        port,
        url: `https://127.0.0.1:${port}/mcp`,
      };
    } catch (err) {
      console.error("[mcpDashServer] Failed to start server:", err);
      httpsServer = null;
      mcpServer = null;
      return {
        success: false,
        error: err.message,
      };
    }
  },

  /**
   * Stop the MCP Dash server.
   */
  stopServer: async (win) => {
    if (!httpsServer) {
      return { success: true, message: "Server was not running" };
    }

    try {
      stopCleanup();

      await new Promise((resolve) => {
        httpsServer.close(() => resolve());
        // Force close after 5 seconds
        setTimeout(() => resolve(), 5000);
      });

      if (mcpServer) {
        try {
          await mcpServer.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      httpsServer = null;
      mcpServer = null;
      transport = null;
      startTime = null;
      connectionCount = 0;
      activeWin = null;

      // Update settings
      if (win) {
        const serverSettings = getMcpServerSettings(win);
        saveMcpServerSettings(win, {
          ...serverSettings,
          enabled: false,
        });
      }

      console.log("[mcpDashServer] Server stopped");
      return { success: true };
    } catch (err) {
      console.error("[mcpDashServer] Error stopping server:", err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Restart the server (stop + start).
   */
  restartServer: async (win, options = {}) => {
    await mcpDashServerController.stopServer(win);
    return mcpDashServerController.startServer(win, options);
  },

  /**
   * Get server status.
   */
  getStatus: (win) => {
    const serverSettings = getMcpServerSettings(win);
    return {
      running: !!httpsServer,
      enabled: serverSettings.enabled || false,
      port: serverSettings.port || 3141,
      connectionCount,
      uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      toolCount: registeredTools.length,
      resourceCount: registeredResources.length,
    };
  },

  /**
   * Get or create the bearer token.
   */
  getOrCreateToken: (win) => {
    const serverSettings = getMcpServerSettings(win);
    if (serverSettings.token) {
      return serverSettings.token;
    }
    const token = randomUUID();
    saveMcpServerSettings(win, { ...serverSettings, token });
    return token;
  },

  /**
   * Auto-start server if enabled in settings.
   * Called from dash-electron on app ready.
   */
  autoStart: async (win) => {
    const serverSettings = getMcpServerSettings(win);
    if (serverSettings.enabled) {
      console.log("[mcpDashServer] Auto-starting server...");
      return mcpDashServerController.startServer(win, {
        port: serverSettings.port,
      });
    }
    return { success: false, message: "Server not enabled" };
  },

  // Expose registration functions for other controllers
  registerTool,
  registerResource,
  registerPrompt,
  getServerContext,
};

module.exports = mcpDashServerController;
