/**
 * mcpController.js
 *
 * Manages MCP (Model Context Protocol) server lifecycle in the main process.
 * Handles starting/stopping MCP servers, calling tools, listing tools/resources.
 *
 * Supports two transport types:
 *   - stdio: spawns a local child process (e.g., npx -y @algolia/mcp)
 *   - streamable_http: connects to a remote HTTP endpoint (e.g., https://mcp.us.algolia.com/...)
 *
 * Uses @modelcontextprotocol/sdk for protocol handling.
 */
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const path = require("path");
const fs = require("fs");
const os = require("os");
const responseCache = require("../utils/responseCache");

/**
 * Tool name prefixes considered safe to cache (read-only).
 * Writes/mutations are NOT cached so they always hit the source.
 */
const READ_ONLY_PREFIXES = [
  "list_",
  "get_",
  "read_",
  "search_",
  "resolve_",
  "find_",
  "fetch_",
  "describe_",
];

const WRITE_PREFIXES = [
  "create_",
  "write_",
  "update_",
  "delete_",
  "remove_",
  "append_",
  "set_",
  "put_",
  "post_",
  "patch_",
  "send_",
  "execute_",
  "run_",
];

function isReadOnlyTool(toolName) {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  // Explicit write prefix wins (in case a tool starts with read_ but actually writes)
  if (WRITE_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return READ_ONLY_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Default TTL for cached MCP tool calls (milliseconds).
 * Short enough to keep data fresh, long enough to dedupe concurrent widget loads.
 */
const DEFAULT_TOOL_CACHE_TTL = 5000;

const IS_WINDOWS = process.platform === "win32";

/**
 * Quote a string for cmd.exe when `shell: true` is in effect. With
 * shell:true on Windows, Node joins command+args into one string and
 * hands it to `cmd.exe /d /s /c`, which tokenizes on whitespace. A
 * path like `C:\Users\First Name\AppData\Local\Programs\Dash\Dash.exe`
 * (what `process.execPath` returns for a packaged app when the user's
 * folder name contains a space) parses as two tokens without quoting
 * and the spawn fails with ENOENT. No-op when the string has no
 * whitespace or quote character.
 */
function windowsQuote(s) {
  const str = String(s);
  if (!/[\s"]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Cached shell PATH result (resolved once, reused for all spawns).
 */
let _shellPath = null;

/**
 * Check if a Node.js major version is compatible (v18, v20, or v22).
 * Node v24+ has stricter ESM resolution that breaks some MCP packages.
 */
function isCompatibleNodeVersion(majorVersion) {
  return majorVersion >= 18 && majorVersion <= 22;
}

/**
 * Detect if an error message indicates Node v24+ ESM incompatibility.
 */
function isNodeEsmError(errorText) {
  if (!errorText) return false;
  return (
    errorText.includes("ERR_PACKAGE_PATH_NOT_EXPORTED") ||
    errorText.includes("ERR_MODULE_NOT_FOUND")
  );
}

/**
 * When a catalog entry says `command: "node"`, spawn Electron itself in
 * ELECTRON_RUN_AS_NODE mode rather than the user's system node. This
 * matters in two ways:
 *
 *   1. In a packaged app the MCP server scripts live inside app.asar.
 *      Electron's fs patches understand asar paths; a standalone Node
 *      does not, so system `node` + asar path produces MODULE_NOT_FOUND.
 *   2. The host no longer depends on the user having a compatible Node
 *      version (18–22) installed on PATH — Electron ships its own.
 *
 * Other commands (`npx`, shell scripts, etc.) still run via the
 * resolved shell PATH, so the PATH/nvm discovery elsewhere in this
 * file stays relevant for them.
 */
function resolveNodeCommand(command, env) {
  if (command === "node" && process.versions.electron) {
    return {
      command: process.execPath,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { command, env };
}

/**
 * Get the user's full shell PATH (including nvm, homebrew, volta, etc.).
 * Electron GUI apps on macOS don't inherit the shell PATH, so we
 * resolve it once by invoking a login shell.
 *
 * On systems where Node v24+ is the default, this will prefer a compatible
 * nvm-managed Node version (v18/v20/v22) to avoid ESM resolution errors
 * in MCP packages.
 */
function getShellPath() {
  if (_shellPath !== null) return _shellPath;

  // Windows: skip the POSIX shell-path discovery entirely. The nvm /
  // homebrew / volta fallback dirs below are *nix-specific, and
  // Windows Electron apps typically inherit a working PATH from the
  // launcher. Users managing Node via nvm-windows or fnm should
  // already have their shims on PATH.
  if (IS_WINDOWS) {
    _shellPath = process.env.PATH || "";
    return _shellPath;
  }

  const { execSync } = require("child_process");
  const fallbackDirs = ["/usr/local/bin", "/opt/homebrew/bin"];

  // Scan nvm versions, tracking both latest and best compatible version
  const home = os.homedir();
  let compatibleNvmBin = null;
  if (home) {
    fallbackDirs.push(`${home}/.volta/bin`);
    fallbackDirs.push(`${home}/.nodenv/shims`);
    try {
      const nvmDir = `${home}/.nvm/versions/node`;
      const versions = fs.readdirSync(nvmDir).sort();
      if (versions.length > 0) {
        // Find the highest compatible version (v18/v20/v22)
        for (let i = versions.length - 1; i >= 0; i--) {
          const match = versions[i].match(/^v(\d+)/);
          if (match && isCompatibleNodeVersion(parseInt(match[1], 10))) {
            compatibleNvmBin = `${nvmDir}/${versions[i]}/bin`;
            break;
          }
        }
        // Always add the latest nvm version as fallback
        fallbackDirs.push(`${nvmDir}/${versions[versions.length - 1]}/bin`);
      }
    } catch {}
  }

  try {
    const shell = process.env.SHELL || "/bin/bash";
    const marker = "__DASH_PATH__";
    const raw = execSync(`${shell} -ilc 'echo "${marker}$PATH${marker}"'`, {
      encoding: "utf8",
      timeout: 5000,
    });
    // Extract PATH between markers, stripping session restore noise
    const startIdx = raw.indexOf(marker);
    const endIdx = raw.lastIndexOf(marker);
    if (startIdx !== -1 && endIdx > startIdx) {
      _shellPath = raw
        .substring(startIdx + marker.length, endIdx)
        .replace(/[\r\n]/g, "");
    } else {
      _shellPath = process.env.PATH || "";
    }
  } catch (err) {
    console.warn("[mcpController] Failed to resolve shell PATH:", err.message);
    _shellPath = process.env.PATH || "";
  }

  // Append fallback dirs that aren't already present
  const currentPaths = _shellPath.split(":");
  for (const dir of fallbackDirs) {
    if (!currentPaths.includes(dir)) {
      _shellPath += `:${dir}`;
    }
  }

  // If system Node is v24+, prepend compatible nvm version so it's found first
  if (compatibleNvmBin) {
    try {
      const nodeVersion = execSync(
        `PATH="${_shellPath}" node --version 2>/dev/null`,
        { encoding: "utf8", timeout: 5000 },
      ).trim();
      const majorMatch = nodeVersion.match(/^v(\d+)/);
      if (majorMatch && !isCompatibleNodeVersion(parseInt(majorMatch[1], 10))) {
        console.log(
          `[mcpController] System Node is ${nodeVersion} (incompatible), ` +
            `prepending compatible nvm path: ${compatibleNvmBin}`,
        );
        _shellPath = `${compatibleNvmBin}:${_shellPath}`;
      }
    } catch {}
  }

  console.log("[mcpController] Resolved PATH:", _shellPath);
  return _shellPath;
}

/**
 * Create a clean environment for MCP child processes.
 * Strips npm_* and ELECTRON_* vars that would force the child
 * to use Electron's or npm's Node binary instead of the PATH one.
 */
function cleanEnvForChildProcess() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("npm_") || key.startsWith("ELECTRON_")) continue;
    env[key] = value;
  }
  env.PATH = getShellPath();
  return env;
}

/**
 * Active MCP server connections
 * Map<string, { client: Client, transport: Transport, tools: Array, status: string }>
 */
const activeServers = new Map();

/**
 * In-flight start promises for deduplication.
 * Prevents multiple simultaneous startServer calls for the same server
 * from spawning duplicate processes (e.g., 4 widgets all calling startServer("Slack")).
 * Map<string, Promise<result>>
 */
const pendingStarts = new Map();

/**
 * MCP Server status constants
 */
const STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

/**
 * Interpolate {{fieldName}} placeholders in a string with credential values.
 * Used for streamable_http URL and header templates.
 *
 * @param {string} template - String containing {{fieldName}} placeholders
 * @param {object} credentials - Credential values to interpolate
 * @returns {string} Interpolated string
 */
function interpolate(template, credentials) {
  if (!template || !credentials) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return credentials[key] !== undefined ? credentials[key] : match;
  });
}

/**
 * Refresh a Google OAuth access token before starting the MCP server.
 * This sidesteps the upstream bug where `new google.auth.OAuth2()` is called
 * without client_id/client_secret, preventing token refresh.
 *
 * Uses only Node built-in `https` — no external dependencies.
 *
 * @param {object} tokenRefresh { credentialsPath, oauthKeysPath }
 */
async function refreshGoogleOAuthToken(tokenRefresh) {
  const home = os.homedir();
  const credPath = tokenRefresh.credentialsPath.replace(/^~/, home);
  const keysPath = tokenRefresh.oauthKeysPath.replace(/^~/, home);

  if (!fs.existsSync(credPath) || !fs.existsSync(keysPath)) {
    console.log(
      "[mcpController] Token refresh skipped: credential files not found",
    );
    return;
  }

  const credentials = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const keysFile = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  const keyData = keysFile.installed || keysFile.web;

  if (
    !credentials.refresh_token ||
    !keyData?.client_id ||
    !keyData?.client_secret
  ) {
    console.log(
      "[mcpController] Token refresh skipped: missing refresh_token or client credentials",
    );
    return;
  }

  // Skip if token is still valid (expiry > 5 minutes from now)
  if (
    credentials.expiry_date &&
    credentials.expiry_date > Date.now() + 5 * 60 * 1000
  ) {
    console.log("[mcpController] Token still valid, skipping refresh");
    return;
  }

  console.log("[mcpController] Refreshing Google OAuth token...");

  const https = require("https");
  const postData = [
    `client_id=${encodeURIComponent(keyData.client_id)}`,
    `client_secret=${encodeURIComponent(keyData.client_secret)}`,
    `refresh_token=${encodeURIComponent(credentials.refresh_token)}`,
    "grant_type=refresh_token",
  ].join("&");

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(
              new Error(`Token refresh failed (${res.statusCode}): ${data}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  credentials.access_token = body.access_token;
  credentials.expiry_date = Date.now() + (body.expires_in || 3600) * 1000;
  if (body.refresh_token) {
    credentials.refresh_token = body.refresh_token;
  }

  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2));
  console.log("[mcpController] Google OAuth token refreshed successfully");
}

const mcpController = {
  /**
   * startServer
   * Start an MCP server with the given config and credentials
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName unique name for this server instance
   * @param {object} mcpConfig { transport, command, args, envMapping }
   * @param {object} credentials decrypted credentials object
   * @returns {{ success, serverName, tools, status } | { error, message }}
   */
  startServer: async (win, serverName, mcpConfig, credentials) => {
    // 1. Already connected? Return existing connection
    const existing = activeServers.get(serverName);
    if (existing && existing.status === STATUS.CONNECTED && existing.client) {
      console.log(`[mcpController] Server already connected: ${serverName}`);
      return {
        success: true,
        serverName,
        tools: existing.tools,
        resources: existing.resources,
        status: STATUS.CONNECTED,
      };
    }

    // 2. Already starting? Piggyback on the pending promise
    if (pendingStarts.has(serverName)) {
      console.log(
        `[mcpController] Server already starting, deduplicating: ${serverName}`,
      );
      return pendingStarts.get(serverName);
    }

    // 3. Fresh start — wrap in a promise and track it
    const startPromise = (async () => {
      try {
        // Stop if in stale/error state
        if (activeServers.has(serverName)) {
          await mcpController.stopServer(win, serverName);
        }

        // Merge with catalog entry to pick up updated command/args
        // (saved provider config may reference a stale or archived package)
        try {
          const { catalog } = mcpController.getCatalog(win);
          const catalogEntry = (catalog || []).find(
            (entry) => entry.name === serverName,
          );
          if (catalogEntry?.mcpConfig) {
            const cat = catalogEntry.mcpConfig;
            if (cat.command) mcpConfig.command = cat.command;
            if (cat.args) mcpConfig.args = [...cat.args];
            if (cat.staticEnv) mcpConfig.staticEnv = cat.staticEnv;
            if (cat.tokenRefresh) mcpConfig.tokenRefresh = cat.tokenRefresh;
            if (cat.envMapping) {
              mcpConfig.envMapping = {
                ...mcpConfig.envMapping,
                ...cat.envMapping,
              };
            }
          }
        } catch (catalogErr) {
          // Non-fatal: proceed with saved config if catalog lookup fails
        }

        console.log(
          `[mcpController] Starting server: ${serverName} (transport: ${
            mcpConfig.transport || "stdio"
          })`,
        );

        // Create transport based on type
        let transport;
        if (mcpConfig.transport === "streamable_http") {
          // Remote HTTP transport - connect to a hosted MCP server
          const url = interpolate(mcpConfig.url, credentials);
          if (!url) {
            throw new Error("Streamable HTTP transport requires a URL");
          }

          // Build request headers from headerTemplate
          const headers = {};
          if (mcpConfig.headerTemplate && credentials) {
            Object.entries(mcpConfig.headerTemplate).forEach(
              ([headerName, template]) => {
                headers[headerName] = interpolate(template, credentials);
              },
            );
          }

          transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: {
              headers,
            },
          });
        } else {
          // stdio transport (default) - spawn a local child process
          const env = cleanEnvForChildProcess();
          if (mcpConfig.envMapping && credentials) {
            Object.entries(mcpConfig.envMapping).forEach(
              ([envVar, credentialKey]) => {
                if (credentials[credentialKey] !== undefined) {
                  env[envVar] = credentials[credentialKey];
                }
              },
            );
          }

          // Merge static env vars from mcpConfig (with ~ expansion)
          if (mcpConfig.staticEnv) {
            Object.entries(mcpConfig.staticEnv).forEach(([envVar, value]) => {
              env[envVar] = value.replace(/^~/, os.homedir());
            });
          }

          // Pre-start token refresh (e.g., Google OAuth)
          if (mcpConfig.tokenRefresh) {
            try {
              await refreshGoogleOAuthToken(mcpConfig.tokenRefresh);
            } catch (err) {
              console.warn(
                "[mcpController] Token refresh failed, continuing:",
                err.message,
              );
            }
          }

          // Build args - start with static args, then append dynamic args from credentials
          const args = [...(mcpConfig.args || [])];
          if (mcpConfig.argsMapping && credentials) {
            Object.entries(mcpConfig.argsMapping).forEach(
              ([credentialKey, config]) => {
                const value = credentials[credentialKey];
                if (value) {
                  if (config.type === "split" && config.delimiter) {
                    args.push(
                      ...value
                        .split(config.delimiter)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    );
                  } else {
                    args.push(value);
                  }
                }
              },
            );
          }

          // Interpolate {{MCP_DIR}} in args to resolve local MCP server scripts
          const mcpDir = path.join(__dirname, "..", "mcp");
          for (let i = 0; i < args.length; i++) {
            if (
              typeof args[i] === "string" &&
              args[i].includes("{{MCP_DIR}}")
            ) {
              args[i] = args[i].replace(/\{\{MCP_DIR\}\}/g, mcpDir);
            }
          }

          const resolved = resolveNodeCommand(mcpConfig.command, env);
          transport = new StdioClientTransport({
            command: resolved.command,
            args,
            env: resolved.env,
          });
        }

        // Update status to connecting
        activeServers.set(serverName, {
          client: null,
          transport,
          tools: [],
          resources: [],
          status: STATUS.CONNECTING,
        });

        // Create MCP client
        const client = new Client({
          name: "dash",
          version: "1.0.0",
        });

        // Connect to the server
        await client.connect(transport);

        // List available tools
        let tools = [];
        try {
          const toolsResult = await client.listTools();
          tools = toolsResult.tools || [];
        } catch (toolsError) {
          console.warn(
            `[mcpController] Could not list tools for ${serverName}:`,
            toolsError.message,
          );
        }

        // List available resources
        let resources = [];
        try {
          const resourcesResult = await client.listResources();
          resources = resourcesResult.resources || [];
        } catch (resourcesError) {
          // Resources are optional, many servers don't support them
        }

        // Store the active connection
        activeServers.set(serverName, {
          client,
          transport,
          tools,
          resources,
          status: STATUS.CONNECTED,
        });

        console.log(
          `[mcpController] Server connected: ${serverName} (${tools.length} tools, ${resources.length} resources)`,
        );

        return {
          success: true,
          serverName,
          tools,
          resources,
          status: STATUS.CONNECTED,
        };
      } catch (error) {
        console.error(
          `[mcpController] Error starting server ${serverName}:`,
          error,
        );

        // Detect Node v24+ ESM compatibility errors and provide actionable message
        let errorMessage = error.message;
        if (isNodeEsmError(error.message)) {
          errorMessage =
            "This MCP server is incompatible with your system Node.js version. " +
            "Install Node.js v22 (LTS) using nvm and restart the app.";
        }

        // Mark as error state
        activeServers.set(serverName, {
          client: null,
          transport: null,
          tools: [],
          resources: [],
          status: STATUS.ERROR,
          error: errorMessage,
        });

        return {
          error: true,
          message: errorMessage,
          serverName,
          status: STATUS.ERROR,
        };
      } finally {
        pendingStarts.delete(serverName);
      }
    })();

    pendingStarts.set(serverName, startPromise);
    return startPromise;
  },

  /**
   * stopServer
   * Stop a running MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server to stop
   * @returns {{ success, serverName } | { error, message }}
   */
  stopServer: async (win, serverName) => {
    try {
      // Wait for any in-flight start to finish before stopping
      if (pendingStarts.has(serverName)) {
        try {
          await pendingStarts.get(serverName);
        } catch (e) {
          /* stopping anyway */
        }
      }

      const server = activeServers.get(serverName);
      if (!server) {
        return {
          success: true,
          serverName,
          message: "Server was not running",
        };
      }

      console.log(`[mcpController] Stopping server: ${serverName}`);

      // Close the client connection
      if (server.client) {
        try {
          await server.client.close();
        } catch (closeError) {
          console.warn(
            `[mcpController] Error closing client for ${serverName}:`,
            closeError.message,
          );
        }
      }

      activeServers.delete(serverName);

      console.log(`[mcpController] Server stopped: ${serverName}`);

      return {
        success: true,
        serverName,
      };
    } catch (error) {
      console.error(
        `[mcpController] Error stopping server ${serverName}:`,
        error,
      );
      // Clean up anyway
      activeServers.delete(serverName);
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * callTool
   * Call a tool on a running MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server to call the tool on
   * @param {string} toolName the tool to call
   * @param {object} args arguments for the tool
   * @param {Array<string>} allowedTools optional whitelist of allowed tool names
   * @returns {{ result } | { error, message }}
   */
  callTool: async (win, serverName, toolName, args, allowedTools = null) => {
    try {
      const server = activeServers.get(serverName);
      if (!server || !server.client) {
        throw new Error(`Server not connected: ${serverName}`);
      }

      // Enforce tool scoping if allowedTools is specified
      if (allowedTools && !allowedTools.includes(toolName)) {
        throw new Error(
          `Tool "${toolName}" is not in the allowed tools list for this widget. Allowed: ${allowedTools.join(
            ", ",
          )}`,
        );
      }

      const doCall = async () => {
        console.log(`[mcpController] Calling tool: ${serverName}/${toolName}`);
        const result = await server.client.callTool({
          name: toolName,
          arguments: args || {},
        });
        return {
          success: true,
          result,
        };
      };

      // Cache read-only tool calls with in-flight dedup.
      // Writes always hit the source (and we invalidate the server's cache).
      if (isReadOnlyTool(toolName)) {
        const key = `mcp:${serverName}:${toolName}:${JSON.stringify(args || {})}`;
        return responseCache.get(key, doCall, {
          ttl: DEFAULT_TOOL_CACHE_TTL,
        });
      }

      // Write/mutation: invalidate any cached reads for this server
      // (safest default — broad invalidation when state changes)
      responseCache.invalidatePrefix(`mcp:${serverName}:`);
      return doCall();
    } catch (error) {
      console.error(
        `[mcpController] Error calling tool ${serverName}/${toolName}:`,
        error,
      );
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * listTools
   * List available tools for a running MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server name
   * @returns {{ tools } | { error, message }}
   */
  listTools: async (win, serverName) => {
    try {
      const server = activeServers.get(serverName);
      if (!server || !server.client) {
        throw new Error(`Server not connected: ${serverName}`);
      }

      // Refresh tool list from server
      const toolsResult = await server.client.listTools();
      const tools = toolsResult.tools || [];

      // Update cached tools
      server.tools = tools;

      return {
        success: true,
        tools,
      };
    } catch (error) {
      console.error(
        `[mcpController] Error listing tools for ${serverName}:`,
        error,
      );
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * listResources
   * List available resources for a running MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server name
   * @returns {{ resources } | { error, message }}
   */
  listResources: async (win, serverName) => {
    try {
      const server = activeServers.get(serverName);
      if (!server || !server.client) {
        throw new Error(`Server not connected: ${serverName}`);
      }

      const resourcesResult = await server.client.listResources();
      const resources = resourcesResult.resources || [];

      // Update cached resources
      server.resources = resources;

      return {
        success: true,
        resources,
      };
    } catch (error) {
      console.error(
        `[mcpController] Error listing resources for ${serverName}:`,
        error,
      );
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * readResource
   * Read a specific resource from a running MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server name
   * @param {string} uri the resource URI
   * @returns {{ resource } | { error, message }}
   */
  readResource: async (win, serverName, uri) => {
    try {
      const server = activeServers.get(serverName);
      if (!server || !server.client) {
        throw new Error(`Server not connected: ${serverName}`);
      }

      const result = await server.client.readResource({ uri });

      return {
        success: true,
        resource: result,
      };
    } catch (error) {
      console.error(
        `[mcpController] Error reading resource ${uri} from ${serverName}:`,
        error,
      );
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * getServerStatus
   * Get the connection status of a server
   *
   * @param {BrowserWindow} win the main window
   * @param {string} serverName the server name
   * @returns {{ status, tools, error }}
   */
  getServerStatus: (win, serverName) => {
    const server = activeServers.get(serverName);
    if (!server) {
      return {
        serverName,
        status: STATUS.DISCONNECTED,
        tools: [],
        resources: [],
      };
    }

    return {
      serverName,
      status: server.status,
      tools: server.tools || [],
      resources: server.resources || [],
      error: server.error || null,
    };
  },

  /**
   * getCatalog
   * Load the MCP server seed catalog
   *
   * @param {BrowserWindow} win the main window
   * @returns {{ catalog } | { error, message }}
   */
  getCatalog: (win) => {
    try {
      const catalogPath = path.join(
        __dirname,
        "..",
        "mcp",
        "mcpServerCatalog.json",
      );

      if (!fs.existsSync(catalogPath)) {
        return {
          catalog: [],
        };
      }

      const catalogData = fs.readFileSync(catalogPath, "utf8");
      const catalog = JSON.parse(catalogData);

      return {
        success: true,
        catalog: catalog.servers || [],
      };
    } catch (error) {
      console.error("[mcpController] Error loading catalog:", error);
      return {
        error: true,
        message: error.message,
        catalog: [],
      };
    }
  },

  /**
   * listConnectedServers
   * Returns all connected servers with their cached tool lists.
   * Used by llmController to discover available MCP tools.
   *
   * @returns {Array<{ serverName, tools, resources, status }>}
   */
  listConnectedServers: () => {
    const servers = [];
    for (const [serverName, server] of activeServers) {
      if (server.status === STATUS.CONNECTED) {
        servers.push({
          serverName,
          tools: server.tools || [],
          resources: server.resources || [],
          status: server.status,
        });
      }
    }
    return servers;
  },

  /**
   * runAuth
   * Run a one-shot auth command (e.g., OAuth browser flow) for an MCP server
   *
   * @param {BrowserWindow} win the main window
   * @param {object} mcpConfig { transport, command, args, envMapping }
   * @param {object} credentials decrypted credentials object
   * @param {object} authCommand { command, args }
   * @returns {{ success } | { error, message }}
   */
  runAuth: async (win, mcpConfig, credentials, authCommand) => {
    const { spawn } = require("child_process");

    const env = cleanEnvForChildProcess();

    // Pre-auth setup: copy credential files to expected locations
    if (authCommand.setup?.copyCredential) {
      const { from, to } = authCommand.setup.copyCredential;
      const sourcePath = credentials?.[from];
      if (sourcePath) {
        const destPath = to.replace(/^~/, os.homedir());
        const destDir = require("path").dirname(destPath);
        try {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(sourcePath, destPath);
        } catch (err) {
          return {
            error: true,
            message: `Failed to copy OAuth keys: ${err.message}`,
          };
        }
      }
    }

    // Inject credentials as env vars using the same envMapping as startServer
    if (mcpConfig?.envMapping && credentials) {
      Object.entries(mcpConfig.envMapping).forEach(
        ([envVar, credentialKey]) => {
          if (credentials[credentialKey] !== undefined) {
            env[envVar] = credentials[credentialKey];
          }
        },
      );
    }

    // Merge static env vars from authCommand (e.g., AUTH_SERVER_PORT)
    if (authCommand.env) {
      Object.entries(authCommand.env).forEach(([key, value]) => {
        env[key] = value;
      });
    }

    // Merge static env vars from authCommand with ~ expansion
    if (authCommand.staticEnv) {
      Object.entries(authCommand.staticEnv).forEach(([key, value]) => {
        env[key] = value.replace(/^~/, os.homedir());
      });
    }

    // Interpolate {{MCP_DIR}} in authCommand args (same as startServer)
    const mcpDir = path.join(__dirname, "..", "mcp");
    const resolvedArgs = (authCommand.args || []).map((arg) =>
      typeof arg === "string" && arg.includes("{{MCP_DIR}}")
        ? arg.replace(/\{\{MCP_DIR\}\}/g, mcpDir)
        : arg,
    );

    return new Promise((resolve) => {
      const resolvedCmd = resolveNodeCommand(authCommand.command, env);
      const spawnCmd = IS_WINDOWS
        ? windowsQuote(resolvedCmd.command)
        : resolvedCmd.command;
      const spawnArgs = IS_WINDOWS
        ? resolvedArgs.map(windowsQuote)
        : resolvedArgs;
      const proc = spawn(spawnCmd, spawnArgs, {
        env: resolvedCmd.env,
        stdio: ["ignore", "pipe", "pipe"],
        // Needed so Windows can launch .cmd/.bat wrappers (npx.cmd, etc).
        shell: IS_WINDOWS,
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ error: true, message: "Auth timed out (120s)" });
      }, 120000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ success: true });
        } else {
          const detail = stderr.trim() || stdout.trim() || "";
          // Detect Node v24+ ESM compatibility errors and provide actionable message
          if (isNodeEsmError(detail)) {
            resolve({
              error: true,
              message:
                "This MCP server is incompatible with your system Node.js version. " +
                "Install Node.js v22 (LTS) using nvm and restart the app.",
            });
            return;
          }
          resolve({
            error: true,
            message: `Auth exited with code ${code}${detail ? ": " + detail : ""}`,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ error: true, message: err.message });
      });
    });
  },

  /**
   * stopAllServers
   * Stop all running MCP servers (called on app quit)
   */
  stopAllServers: async () => {
    // Wait for any in-flight starts to settle before stopping
    if (pendingStarts.size > 0) {
      await Promise.allSettled([...pendingStarts.values()]);
    }

    console.log(
      `[mcpController] Stopping all servers (${activeServers.size} active)`,
    );
    const promises = [];
    for (const [serverName] of activeServers) {
      promises.push(mcpController.stopServer(null, serverName));
    }
    await Promise.allSettled(promises);
    console.log("[mcpController] All servers stopped");
  },
};

module.exports = mcpController;
module.exports.refreshGoogleOAuthToken = refreshGoogleOAuthToken;
