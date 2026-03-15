/**
 * webSocketController.js
 *
 * Manages WebSocket connections in the main process.
 * Mirrors mcpController.js architecture:
 *   - activeConnections Map (keyed by provider name) for connection pooling
 *   - pendingConnects Map for in-flight deduplication
 *   - Status constants matching MCP pattern
 *
 * Uses the `ws` package (installed in dash-electron) for WebSocket clients.
 * Multiple widgets referencing the same provider share a single socket.
 */
const WebSocket = require("ws");

/**
 * Active WebSocket connections
 * Map<string, { socket: WebSocket, status: string, config: object,
 *               consumers: Set<number>, messageCount: number,
 *               connectedAt: number|null, lastMessageAt: number|null }>
 */
const activeConnections = new Map();

/**
 * In-flight connect promises for deduplication.
 * Prevents multiple simultaneous connect calls for the same provider
 * from opening duplicate sockets.
 * Map<string, Promise<result>>
 */
const pendingConnects = new Map();

/**
 * WebSocket connection status constants
 */
const STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
};

/**
 * Interpolate {{fieldName}} placeholders in a string with credential values.
 * Reuses the same pattern as mcpController for URL and header templates.
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
 * Broadcast a status change to all renderer windows subscribed to this provider.
 *
 * @param {string} providerName - The provider whose status changed
 * @param {string} status - New status value
 * @param {object} extra - Additional fields (error, etc.)
 */
function broadcastStatusChange(providerName, status, extra = {}) {
  const { WS_STATUS_CHANGE } = require("../events/webSocketEvents");
  const { BrowserWindow } = require("electron");

  const payload = { provider: providerName, status, ...extra };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(WS_STATUS_CHANGE, payload);
    }
  }
}

/**
 * Broadcast an incoming WebSocket message to all renderer windows.
 *
 * @param {string} providerName - The provider the message came from
 * @param {*} data - The message data
 */
function broadcastMessage(providerName, data) {
  const { WS_MESSAGE } = require("../events/webSocketEvents");
  const { BrowserWindow } = require("electron");

  const payload = {
    provider: providerName,
    data,
    timestamp: Date.now(),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(WS_MESSAGE, payload);
    }
  }
}

const webSocketController = {
  /**
   * connect
   * Open a WebSocket connection for the given provider config.
   * If already connected, returns the existing connection.
   * If a connect is in-flight, piggybacks on the pending promise.
   *
   * @param {BrowserWindow} win - the requesting window
   * @param {string} providerName - unique provider name
   * @param {object} config - { url, headers, subprotocols, credentials }
   * @returns {{ success, providerName, status } | { error, message }}
   */
  connect: async (win, providerName, config) => {
    // 1. Already connected? Return existing connection
    const existing = activeConnections.get(providerName);
    if (existing && existing.status === STATUS.CONNECTED) {
      // Track this window as a consumer
      if (win && !win.isDestroyed()) {
        existing.consumers.add(win.webContents.id);
      }
      console.log(`[webSocketController] Already connected: ${providerName}`);
      return {
        success: true,
        providerName,
        status: STATUS.CONNECTED,
      };
    }

    // 2. Already connecting? Piggyback on the pending promise
    if (pendingConnects.has(providerName)) {
      console.log(
        `[webSocketController] Already connecting, deduplicating: ${providerName}`,
      );
      return pendingConnects.get(providerName);
    }

    // 3. Fresh connect — wrap in a promise and track it
    const connectPromise = (async () => {
      try {
        // Clean up stale/error state
        if (activeConnections.has(providerName)) {
          await webSocketController.disconnect(win, providerName);
        }

        const url = config.credentials
          ? interpolate(config.url, config.credentials)
          : config.url;

        if (!url) {
          throw new Error("WebSocket connection requires a URL");
        }

        console.log(
          `[webSocketController] Connecting: ${providerName} → ${url}`,
        );

        // Build WebSocket options
        const wsOptions = {};
        if (config.headers) {
          const headers = {};
          if (config.credentials) {
            Object.entries(config.headers).forEach(([headerName, template]) => {
              headers[headerName] = interpolate(template, config.credentials);
            });
          } else {
            Object.assign(headers, config.headers);
          }
          wsOptions.headers = headers;
        }

        // Set status to connecting
        const consumers = new Set();
        if (win && !win.isDestroyed()) {
          consumers.add(win.webContents.id);
        }
        activeConnections.set(providerName, {
          socket: null,
          status: STATUS.CONNECTING,
          config,
          consumers,
          messageCount: 0,
          connectedAt: null,
          lastMessageAt: null,
        });
        broadcastStatusChange(providerName, STATUS.CONNECTING);

        // Create WebSocket connection
        const socket = new WebSocket(url, config.subprotocols || [], wsOptions);

        // Wait for open or error
        await new Promise((resolve, reject) => {
          const onOpen = () => {
            socket.removeListener("error", onError);
            resolve();
          };
          const onError = (err) => {
            socket.removeListener("open", onOpen);
            reject(err);
          };
          socket.once("open", onOpen);
          socket.once("error", onError);
        });

        // Store the active connection
        const conn = activeConnections.get(providerName) || {
          consumers,
        };
        activeConnections.set(providerName, {
          socket,
          status: STATUS.CONNECTED,
          config,
          consumers: conn.consumers,
          messageCount: 0,
          connectedAt: Date.now(),
          lastMessageAt: null,
        });

        // Wire up message handler
        socket.on("message", (data) => {
          const conn = activeConnections.get(providerName);
          if (conn) {
            conn.messageCount++;
            conn.lastMessageAt = Date.now();
          }

          // Parse if JSON, otherwise pass as string
          let parsed;
          try {
            parsed = JSON.parse(data.toString());
          } catch {
            parsed = data.toString();
          }

          broadcastMessage(providerName, parsed);
        });

        // Wire up close handler
        socket.on("close", (code, reason) => {
          console.log(
            `[webSocketController] Connection closed: ${providerName} (code: ${code})`,
          );
          const conn = activeConnections.get(providerName);
          if (conn && conn.socket === socket) {
            activeConnections.set(providerName, {
              ...conn,
              socket: null,
              status: STATUS.DISCONNECTED,
            });
            broadcastStatusChange(providerName, STATUS.DISCONNECTED, {
              code,
              reason: reason?.toString(),
            });
          }
        });

        // Wire up error handler
        socket.on("error", (err) => {
          console.error(
            `[webSocketController] Socket error for ${providerName}:`,
            err.message,
          );
          const conn = activeConnections.get(providerName);
          if (conn && conn.socket === socket) {
            activeConnections.set(providerName, {
              ...conn,
              status: STATUS.ERROR,
              error: err.message,
            });
            broadcastStatusChange(providerName, STATUS.ERROR, {
              error: err.message,
            });
          }
        });

        broadcastStatusChange(providerName, STATUS.CONNECTED);

        console.log(`[webSocketController] Connected: ${providerName}`);

        return {
          success: true,
          providerName,
          status: STATUS.CONNECTED,
        };
      } catch (error) {
        console.error(
          `[webSocketController] Error connecting ${providerName}:`,
          error,
        );

        // Mark as error state
        activeConnections.set(providerName, {
          socket: null,
          status: STATUS.ERROR,
          config,
          consumers: new Set(),
          messageCount: 0,
          connectedAt: null,
          lastMessageAt: null,
          error: error.message,
        });
        broadcastStatusChange(providerName, STATUS.ERROR, {
          error: error.message,
        });

        return {
          error: true,
          message: error.message,
          providerName,
          status: STATUS.ERROR,
        };
      } finally {
        pendingConnects.delete(providerName);
      }
    })();

    pendingConnects.set(providerName, connectPromise);
    return connectPromise;
  },

  /**
   * disconnect
   * Close a WebSocket connection and clean up.
   *
   * @param {BrowserWindow} win - the requesting window
   * @param {string} providerName - the provider to disconnect
   * @returns {{ success, providerName } | { error, message }}
   */
  disconnect: async (win, providerName) => {
    try {
      // Wait for any in-flight connect to finish before disconnecting
      if (pendingConnects.has(providerName)) {
        try {
          await pendingConnects.get(providerName);
        } catch {
          /* disconnecting anyway */
        }
      }

      const conn = activeConnections.get(providerName);
      if (!conn) {
        return {
          success: true,
          providerName,
          message: "Connection was not active",
        };
      }

      console.log(`[webSocketController] Disconnecting: ${providerName}`);

      // Close the socket
      if (conn.socket) {
        try {
          conn.socket.close(1000, "Client disconnect");
        } catch (closeError) {
          console.warn(
            `[webSocketController] Error closing socket for ${providerName}:`,
            closeError.message,
          );
        }
      }

      activeConnections.delete(providerName);
      broadcastStatusChange(providerName, STATUS.DISCONNECTED);

      console.log(`[webSocketController] Disconnected: ${providerName}`);

      return {
        success: true,
        providerName,
      };
    } catch (error) {
      console.error(
        `[webSocketController] Error disconnecting ${providerName}:`,
        error,
      );
      // Clean up anyway
      activeConnections.delete(providerName);
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * send
   * Send a message through an active WebSocket connection.
   *
   * @param {BrowserWindow} win - the requesting window
   * @param {string} providerName - the provider to send through
   * @param {*} data - the data to send (will be JSON.stringify'd if object)
   * @returns {{ success } | { error, message }}
   */
  send: async (win, providerName, data) => {
    try {
      const conn = activeConnections.get(providerName);
      if (!conn || !conn.socket) {
        throw new Error(`WebSocket not connected: ${providerName}`);
      }

      if (conn.socket.readyState !== WebSocket.OPEN) {
        throw new Error(
          `WebSocket not in OPEN state: ${providerName} (state: ${conn.socket.readyState})`,
        );
      }

      const payload = typeof data === "string" ? data : JSON.stringify(data);
      conn.socket.send(payload);

      return {
        success: true,
      };
    } catch (error) {
      console.error(
        `[webSocketController] Error sending to ${providerName}:`,
        error,
      );
      return {
        error: true,
        message: error.message,
      };
    }
  },

  /**
   * getStatus
   * Get the connection status of a provider.
   *
   * @param {BrowserWindow} win - the requesting window
   * @param {string} providerName - the provider name
   * @returns {{ providerName, status, messageCount, connectedAt, lastMessageAt, error }}
   */
  getStatus: (win, providerName) => {
    const conn = activeConnections.get(providerName);
    if (!conn) {
      return {
        providerName,
        status: STATUS.DISCONNECTED,
        messageCount: 0,
        connectedAt: null,
        lastMessageAt: null,
      };
    }

    return {
      providerName,
      status: conn.status,
      messageCount: conn.messageCount || 0,
      connectedAt: conn.connectedAt || null,
      lastMessageAt: conn.lastMessageAt || null,
      error: conn.error || null,
    };
  },

  /**
   * getAll
   * Returns all active connections with their status.
   *
   * @param {BrowserWindow} win - the requesting window
   * @returns {{ connections: Array<{ providerName, status, messageCount, connectedAt, lastMessageAt }> }}
   */
  getAll: (win) => {
    const connections = [];
    for (const [providerName, conn] of activeConnections) {
      connections.push({
        providerName,
        status: conn.status,
        messageCount: conn.messageCount || 0,
        connectedAt: conn.connectedAt || null,
        lastMessageAt: conn.lastMessageAt || null,
        error: conn.error || null,
      });
    }
    return { success: true, connections };
  },

  /**
   * disconnectAll
   * Close all active WebSocket connections (called on app quit).
   */
  disconnectAll: async () => {
    // Wait for any in-flight connects to settle
    if (pendingConnects.size > 0) {
      await Promise.allSettled([...pendingConnects.values()]);
    }

    console.log(
      `[webSocketController] Disconnecting all (${activeConnections.size} active)`,
    );
    const promises = [];
    for (const [providerName] of activeConnections) {
      promises.push(webSocketController.disconnect(null, providerName));
    }
    await Promise.allSettled(promises);
    console.log("[webSocketController] All connections closed");
  },
};

module.exports = webSocketController;
