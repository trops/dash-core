/**
 * webSocketController.js
 *
 * Manages WebSocket connections in the main process.
 * Mirrors mcpController.js architecture:
 *   - activeConnections Map (keyed by provider name) for connection pooling
 *   - pendingConnects Map for in-flight deduplication
 *   - Status constants matching MCP pattern
 *
 * Features:
 *   - Auto-reconnect with exponential backoff (1s → 2s → 4s → 8s → 16s, max 30s, 5 retries)
 *   - Heartbeat ping/pong keepalive (30s interval, 10s pong timeout)
 *
 * Uses the `ws` package (installed in dash-electron) for WebSocket clients.
 * Multiple widgets referencing the same provider share a single socket.
 */
const WebSocket = require("ws");

/**
 * Active WebSocket connections
 * Map<string, { socket: WebSocket, status: string, config: object,
 *               consumers: Set<number>, messageCount: number,
 *               connectedAt: number|null, lastMessageAt: number|null,
 *               retryCount: number, retryTimer: NodeJS.Timeout|null,
 *               heartbeatTimer: NodeJS.Timeout|null, pongTimer: NodeJS.Timeout|null,
 *               intentionalClose: boolean }>
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
 * Reconnect configuration
 */
const RECONNECT = {
  BASE_DELAY: 1000, // 1 second
  MULTIPLIER: 2,
  MAX_DELAY: 30000, // 30 seconds
  MAX_RETRIES: 5,
};

/**
 * Heartbeat configuration
 */
const HEARTBEAT = {
  PING_INTERVAL: 30000, // 30 seconds
  PONG_TIMEOUT: 10000, // 10 seconds
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
 * @param {object} extra - Additional fields (error, retryCount, retryIn, etc.)
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

/**
 * Calculate the backoff delay for a given retry attempt.
 *
 * @param {number} retryCount - Current retry attempt (0-based)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(retryCount) {
  const delay =
    RECONNECT.BASE_DELAY * Math.pow(RECONNECT.MULTIPLIER, retryCount);
  return Math.min(delay, RECONNECT.MAX_DELAY);
}

/**
 * Clear heartbeat and pong timers for a connection.
 *
 * @param {object} conn - The connection object from activeConnections
 */
function clearHeartbeatTimers(conn) {
  if (conn.heartbeatTimer) {
    clearInterval(conn.heartbeatTimer);
    conn.heartbeatTimer = null;
  }
  if (conn.pongTimer) {
    clearTimeout(conn.pongTimer);
    conn.pongTimer = null;
  }
}

/**
 * Clear the reconnect timer for a connection.
 *
 * @param {object} conn - The connection object from activeConnections
 */
function clearReconnectTimer(conn) {
  if (conn.retryTimer) {
    clearTimeout(conn.retryTimer);
    conn.retryTimer = null;
  }
}

/**
 * Start heartbeat ping/pong for an active connection.
 * Sends a WebSocket ping frame every HEARTBEAT.PING_INTERVAL ms.
 * If no pong is received within HEARTBEAT.PONG_TIMEOUT ms, the connection
 * is considered stale and a reconnect is triggered.
 *
 * @param {string} providerName - The provider name
 */
function startHeartbeat(providerName) {
  const conn = activeConnections.get(providerName);
  if (!conn || !conn.socket) return;

  // Clear any existing heartbeat timers
  clearHeartbeatTimers(conn);

  conn.heartbeatTimer = setInterval(() => {
    const current = activeConnections.get(providerName);
    if (
      !current ||
      !current.socket ||
      current.socket.readyState !== WebSocket.OPEN
    ) {
      clearHeartbeatTimers(current || conn);
      return;
    }

    // Send ping
    try {
      current.socket.ping();
    } catch {
      // Socket errored during ping — will be caught by error/close handlers
      return;
    }

    // Start pong timeout
    current.pongTimer = setTimeout(() => {
      const staleConn = activeConnections.get(providerName);
      if (!staleConn || staleConn.intentionalClose) return;

      console.log(
        `[webSocketController] Heartbeat timeout (no pong): ${providerName}`,
      );

      // Clear heartbeat before triggering reconnect
      clearHeartbeatTimers(staleConn);

      // Close the stale socket to trigger the close handler → reconnect
      if (staleConn.socket) {
        try {
          staleConn.socket.terminate();
        } catch {
          /* already closing */
        }
      }
    }, HEARTBEAT.PONG_TIMEOUT);
  }, HEARTBEAT.PING_INTERVAL);
}

/**
 * Attempt to reconnect a provider with exponential backoff.
 * Called from the socket close handler when the close was unexpected.
 *
 * @param {string} providerName - The provider to reconnect
 */
function scheduleReconnect(providerName) {
  const conn = activeConnections.get(providerName);
  if (!conn) return;

  if (conn.retryCount >= RECONNECT.MAX_RETRIES) {
    console.log(
      `[webSocketController] Max retries (${RECONNECT.MAX_RETRIES}) reached for ${providerName}`,
    );
    activeConnections.set(providerName, {
      ...conn,
      socket: null,
      status: STATUS.ERROR,
      error: `Reconnect failed after ${RECONNECT.MAX_RETRIES} attempts`,
    });
    broadcastStatusChange(providerName, STATUS.ERROR, {
      error: `Reconnect failed after ${RECONNECT.MAX_RETRIES} attempts`,
    });
    return;
  }

  const delay = getBackoffDelay(conn.retryCount);
  console.log(
    `[webSocketController] Reconnecting ${providerName} in ${delay}ms (attempt ${conn.retryCount + 1}/${RECONNECT.MAX_RETRIES})`,
  );

  // Broadcast connecting status with retry info
  broadcastStatusChange(providerName, STATUS.CONNECTING, {
    retryCount: conn.retryCount + 1,
    retryIn: delay,
  });

  conn.retryTimer = setTimeout(async () => {
    const current = activeConnections.get(providerName);
    if (!current || current.intentionalClose) return;

    // Update retry count before attempting
    current.retryCount++;

    try {
      // Use the stored config to reconnect
      const config = current.config;
      const url = config.credentials
        ? interpolate(config.url, config.credentials)
        : config.url;

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

      console.log(
        `[webSocketController] Reconnect attempt ${current.retryCount}/${RECONNECT.MAX_RETRIES}: ${providerName}`,
      );

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

      // Reconnect succeeded — reset retry count, update connection
      const reconnected = activeConnections.get(providerName);
      if (!reconnected || reconnected.intentionalClose) {
        // Was disconnected intentionally during reconnect
        socket.close(1000, "Client disconnect");
        return;
      }

      activeConnections.set(providerName, {
        ...reconnected,
        socket,
        status: STATUS.CONNECTED,
        connectedAt: Date.now(),
        retryCount: 0,
        retryTimer: null,
        error: undefined,
      });

      // Wire up handlers on the new socket
      wireSocketHandlers(providerName, socket);

      // Start heartbeat on the new socket
      startHeartbeat(providerName);

      broadcastStatusChange(providerName, STATUS.CONNECTED);

      console.log(
        `[webSocketController] Reconnected: ${providerName} (after ${current.retryCount} attempt(s))`,
      );
    } catch (err) {
      console.error(
        `[webSocketController] Reconnect attempt ${current.retryCount} failed for ${providerName}:`,
        err.message,
      );

      // Schedule next retry
      scheduleReconnect(providerName);
    }
  }, delay);
}

/**
 * Wire up message, close, error, and pong handlers on a WebSocket instance.
 * Extracted so both initial connect and reconnect use the same handlers.
 *
 * @param {string} providerName - The provider name
 * @param {WebSocket} socket - The WebSocket instance
 */
function wireSocketHandlers(providerName, socket) {
  // Message handler
  socket.on("message", (data) => {
    const conn = activeConnections.get(providerName);
    if (conn) {
      conn.messageCount++;
      conn.lastMessageAt = Date.now();
    }

    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      parsed = data.toString();
    }

    broadcastMessage(providerName, parsed);
  });

  // Close handler — triggers auto-reconnect for unexpected closes
  socket.on("close", (code, reason) => {
    console.log(
      `[webSocketController] Connection closed: ${providerName} (code: ${code})`,
    );
    const conn = activeConnections.get(providerName);
    if (!conn || conn.socket !== socket) return;

    // Clean up heartbeat timers
    clearHeartbeatTimers(conn);

    // Update status
    activeConnections.set(providerName, {
      ...conn,
      socket: null,
      status: STATUS.DISCONNECTED,
    });

    // Normal close (code 1000) or intentional disconnect — don't reconnect
    if (conn.intentionalClose || code === 1000) {
      broadcastStatusChange(providerName, STATUS.DISCONNECTED, {
        code,
        reason: reason?.toString(),
      });
      return;
    }

    // Unexpected close — attempt auto-reconnect
    broadcastStatusChange(providerName, STATUS.DISCONNECTED, {
      code,
      reason: reason?.toString(),
      reconnecting: true,
    });
    scheduleReconnect(providerName);
  });

  // Error handler
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

  // Pong handler — clear the pong timeout when we receive a pong
  socket.on("pong", () => {
    const conn = activeConnections.get(providerName);
    if (conn && conn.pongTimer) {
      clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
    }
  });
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
        // Clean up stale/error state (including any pending reconnect timers)
        if (activeConnections.has(providerName)) {
          const stale = activeConnections.get(providerName);
          clearReconnectTimer(stale);
          clearHeartbeatTimers(stale);
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
          retryCount: 0,
          retryTimer: null,
          heartbeatTimer: null,
          pongTimer: null,
          intentionalClose: false,
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
          retryCount: 0,
          retryTimer: null,
          heartbeatTimer: null,
          pongTimer: null,
          intentionalClose: false,
        });

        // Wire up socket event handlers
        wireSocketHandlers(providerName, socket);

        // Start heartbeat
        startHeartbeat(providerName);

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
          retryCount: 0,
          retryTimer: null,
          heartbeatTimer: null,
          pongTimer: null,
          intentionalClose: false,
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
   * Marks the close as intentional to suppress auto-reconnect.
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

      // Mark as intentional so the close handler doesn't auto-reconnect
      conn.intentionalClose = true;

      // Clear all timers
      clearHeartbeatTimers(conn);
      clearReconnectTimer(conn);

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
      const conn = activeConnections.get(providerName);
      if (conn) {
        clearHeartbeatTimers(conn);
        clearReconnectTimer(conn);
      }
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
   * @returns {{ providerName, status, messageCount, connectedAt, lastMessageAt, error, retryCount }}
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
      retryCount: conn.retryCount || 0,
    };
  },

  /**
   * getAll
   * Returns all active connections with their status.
   *
   * @param {BrowserWindow} win - the requesting window
   * @returns {{ connections: Array<{ providerName, status, messageCount, connectedAt, lastMessageAt, retryCount }> }}
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
        retryCount: conn.retryCount || 0,
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
