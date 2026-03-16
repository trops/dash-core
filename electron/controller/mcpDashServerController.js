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
 *   - Node http server bound to 127.0.0.1 (localhost only)
 *   - StreamableHTTPServerTransport from @modelcontextprotocol/sdk
 *   - McpServer registers tools and resources
 *   - Bearer token authentication on all requests
 *   - Rate limiting via token bucket (60 req/min)
 */
const http = require("http");
const { randomUUID } = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const settingsController = require("./settingsController");

// --- State ---
let mcpServer = null;
let httpServer = null;
let transport = null;
let startTime = null;
let connectionCount = 0;

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

// --- Tool & Resource Registration ---
// These are populated by other controllers (DASH-78, DASH-79, etc.)
// Each entry: { name, description, inputSchema, handler }
const registeredTools = [];
const registeredResources = [];

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
 * Apply all registered tools and resources to the McpServer instance.
 */
function applyRegistrations(server) {
  for (const tool of registeredTools) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }
  for (const resource of registeredResources) {
    server.resource(
      resource.name,
      resource.uri,
      resource.metadata || {},
      resource.handler,
    );
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

// --- Controller ---
const mcpDashServerController = {
  /**
   * Start the MCP Dash server.
   * @param {BrowserWindow} win
   * @param {Object} options - { port?: number }
   */
  startServer: async (win, options = {}) => {
    if (httpServer) {
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

      // Apply registered tools and resources
      applyRegistrations(mcpServer);

      // Create HTTP server with auth and rate limiting
      httpServer = http.createServer(async (req, res) => {
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
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });
            await mcpServer.connect(transport);
            connectionCount++;
            await transport.handleRequest(req, res);
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
      });

      // Bind to localhost only
      await new Promise((resolve, reject) => {
        httpServer.on("error", (err) => {
          httpServer = null;
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
        httpServer.listen(port, "127.0.0.1", () => {
          resolve();
        });
      });

      startTime = Date.now();
      connectionCount = 0;
      startCleanup();

      // Save enabled state
      saveMcpServerSettings(win, {
        ...serverSettings,
        enabled: true,
        port,
        token,
      });

      console.log(
        `[mcpDashServer] Server started on http://127.0.0.1:${port}/mcp`,
      );

      return {
        success: true,
        port,
        url: `http://127.0.0.1:${port}/mcp`,
      };
    } catch (err) {
      console.error("[mcpDashServer] Failed to start server:", err);
      httpServer = null;
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
    if (!httpServer) {
      return { success: true, message: "Server was not running" };
    }

    try {
      stopCleanup();

      await new Promise((resolve) => {
        httpServer.close(() => resolve());
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

      httpServer = null;
      mcpServer = null;
      transport = null;
      startTime = null;
      connectionCount = 0;

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
      running: !!httpServer,
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
};

module.exports = mcpDashServerController;
