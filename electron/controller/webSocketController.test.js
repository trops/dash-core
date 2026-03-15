/**
 * webSocketController.test.js
 *
 * Integration tests for the WebSocket provider system.
 * Covers: connection pool dedup, consumer ref counting, reconnect
 * with exponential backoff, heartbeat ping/pong, message routing
 * to multiple renderer windows, and error handling.
 *
 * Uses Node.js built-in test module (same pattern as mcpController.test.js).
 * The controller source is re-evaluated with mocked `ws` and `electron`
 * dependencies to test in isolation.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

// ---------------------------------------------------------------------------
// Mock: WebSocket class
// ---------------------------------------------------------------------------
let mockSocketInstances = [];

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocols, options) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    this.readyState = MockWebSocket.CONNECTING;
    this._sent = [];
    this._pinged = false;
    this._closed = false;
    this._closeCode = null;
    this._shouldFailConnect = false;
    this._connectDelay = 0;
    mockSocketInstances.push(this);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this._sent.push(data);
  }

  ping() {
    this._pinged = true;
  }

  close(code, reason) {
    this._closed = true;
    this._closeCode = code;
    this.readyState = MockWebSocket.CLOSED;
    // Emit close asynchronously like real WebSocket
    process.nextTick(() => this.emit("close", code, reason));
  }

  terminate() {
    this._closed = true;
    this.readyState = MockWebSocket.CLOSED;
    process.nextTick(() => this.emit("close", 1006, "Connection terminated"));
  }

  // Test helper: simulate server opening the connection
  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  // Test helper: simulate server sending a message
  _simulateMessage(data) {
    const buf = Buffer.from(
      typeof data === "string" ? data : JSON.stringify(data),
    );
    this.emit("message", buf);
  }

  // Test helper: simulate an error
  _simulateError(message) {
    this.emit("error", new Error(message));
  }

  // Test helper: simulate server closing
  _simulateClose(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", code, reason);
  }

  // Test helper: simulate pong response
  _simulatePong() {
    this.emit("pong");
  }
}

// ---------------------------------------------------------------------------
// Mock: Electron BrowserWindow
// ---------------------------------------------------------------------------
let mockWindows = [];

function createMockWindow(id) {
  const sent = [];
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel, payload) => sent.push({ channel, payload }),
    },
    _sent: sent,
  };
}

const MockBrowserWindow = {
  getAllWindows: () => mockWindows,
};

// ---------------------------------------------------------------------------
// Load webSocketEvents directly (no external deps)
// ---------------------------------------------------------------------------
const webSocketEvents = require("../events/webSocketEvents");

// ---------------------------------------------------------------------------
// Load webSocketController with mocked dependencies
// ---------------------------------------------------------------------------
function loadController() {
  const source = fs.readFileSync(
    path.join(__dirname, "webSocketController.js"),
    "utf8",
  );

  const customRequire = (mod) => {
    if (mod === "ws") return MockWebSocket;
    if (mod === "electron") return { BrowserWindow: MockBrowserWindow };
    if (mod === "../events/webSocketEvents") return webSocketEvents;
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

/**
 * Connect a provider and auto-open the mock socket.
 * Returns the mock socket instance that was created.
 */
async function connectProvider(controller, win, name, config) {
  const countBefore = mockSocketInstances.length;
  const promise = controller.connect(
    win,
    name,
    config || { url: "ws://test.local" },
  );

  // Wait for the WebSocket constructor to fire
  await new Promise((r) => setTimeout(r, 5));
  const socket = mockSocketInstances[countBefore];
  if (socket && socket.readyState === MockWebSocket.CONNECTING) {
    socket._simulateOpen();
  }

  return { result: await promise, socket };
}

const defaultConfig = { url: "ws://test.local" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webSocketController", () => {
  let controller;

  beforeEach(() => {
    mockSocketInstances = [];
    mockWindows = [];
    controller = loadController();
  });

  afterEach(async () => {
    // Clean up all connections
    try {
      await controller.disconnectAll();
    } catch {
      /* already cleaned */
    }
    // Clear any pending timers from reconnect/heartbeat
    mockSocketInstances = [];
    mockWindows = [];
  });

  // =======================================================================
  // Connection Pool Deduplication
  // =======================================================================
  describe("connection pool dedup", () => {
    it("reuses existing connection for same provider", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { result: r1 } = await connectProvider(
        controller,
        win,
        "test-ws",
        defaultConfig,
      );
      assert.equal(r1.success, true);
      assert.equal(r1.status, "connected");
      assert.equal(mockSocketInstances.length, 1);

      // Second connect to same provider should NOT create a new socket
      const r2 = await controller.connect(win, "test-ws", defaultConfig);
      assert.equal(r2.success, true);
      assert.equal(r2.status, "connected");
      assert.equal(
        mockSocketInstances.length,
        1,
        "Should reuse existing socket, not create a new one",
      );
    });

    it("deduplicates in-flight connect calls via pendingConnects", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      // Fire two connect calls simultaneously
      const p1 = controller.connect(win, "dedup-ws", defaultConfig);
      const p2 = controller.connect(win, "dedup-ws", defaultConfig);

      // Wait for socket creation
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(
        mockSocketInstances.length,
        1,
        "Only one socket should be created for concurrent connects",
      );

      // Open the single socket
      mockSocketInstances[0]._simulateOpen();

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1.success, true);
      assert.equal(r2.success, true);
    });

    it("creates separate sockets for different providers", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { result: r1 } = await connectProvider(controller, win, "ws-a", {
        url: "ws://a.local",
      });
      const { result: r2 } = await connectProvider(controller, win, "ws-b", {
        url: "ws://b.local",
      });

      assert.equal(r1.success, true);
      assert.equal(r2.success, true);
      assert.equal(
        mockSocketInstances.length,
        2,
        "Different providers should get different sockets",
      );
    });
  });

  // =======================================================================
  // Consumer Ref Counting
  // =======================================================================
  describe("consumer ref counting", () => {
    it("tracks consumers from different windows", async () => {
      const win1 = createMockWindow(1);
      const win2 = createMockWindow(2);
      mockWindows.push(win1, win2);

      // First window connects
      await connectProvider(controller, win1, "shared-ws", defaultConfig);

      // Second window connects — should reuse same socket
      const r2 = await controller.connect(win2, "shared-ws", defaultConfig);
      assert.equal(r2.success, true);
      assert.equal(
        mockSocketInstances.length,
        1,
        "Second consumer should share the socket",
      );
    });

    it("getStatus reports current state", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      // Before connect
      const s1 = controller.getStatus(win, "status-ws");
      assert.equal(s1.status, "disconnected");

      // After connect
      await connectProvider(controller, win, "status-ws", defaultConfig);
      const s2 = controller.getStatus(win, "status-ws");
      assert.equal(s2.status, "connected");
      assert.equal(s2.messageCount, 0);
      assert.ok(s2.connectedAt > 0);
    });

    it("getAll returns all active connections", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      await connectProvider(controller, win, "all-a", {
        url: "ws://a.local",
      });
      await connectProvider(controller, win, "all-b", {
        url: "ws://b.local",
      });

      const result = controller.getAll(win);
      assert.equal(result.success, true);
      assert.equal(result.connections.length, 2);
      const names = result.connections.map((c) => c.providerName).sort();
      assert.deepEqual(names, ["all-a", "all-b"]);
    });
  });

  // =======================================================================
  // Disconnect and Cleanup
  // =======================================================================
  describe("disconnect and cleanup", () => {
    it("disconnect closes socket and removes from pool", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "disc-ws",
        defaultConfig,
      );
      assert.equal(socket._closed, false);

      await controller.disconnect(win, "disc-ws");
      assert.equal(socket._closed, true);
      assert.equal(socket._closeCode, 1000);

      const status = controller.getStatus(win, "disc-ws");
      assert.equal(status.status, "disconnected");
    });

    it("disconnect on non-existent provider returns success", async () => {
      const win = createMockWindow(1);
      const result = await controller.disconnect(win, "nonexistent");
      assert.equal(result.success, true);
    });

    it("disconnectAll closes all connections", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket: s1 } = await connectProvider(controller, win, "da-a", {
        url: "ws://a.local",
      });
      const { socket: s2 } = await connectProvider(controller, win, "da-b", {
        url: "ws://b.local",
      });

      await controller.disconnectAll();

      assert.equal(s1._closed, true);
      assert.equal(s2._closed, true);

      const all = controller.getAll(win);
      assert.equal(all.connections.length, 0);
    });
  });

  // =======================================================================
  // Auto-Reconnect with Exponential Backoff
  // =======================================================================
  describe("auto-reconnect with exponential backoff", () => {
    it("does NOT reconnect on intentional close (code 1000)", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      await connectProvider(controller, win, "no-recon", defaultConfig);
      const socketsBefore = mockSocketInstances.length;

      // Intentional disconnect
      await controller.disconnect(win, "no-recon");

      // Wait a bit to ensure no reconnect timer fires
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        mockSocketInstances.length,
        socketsBefore,
        "No new socket should be created after intentional disconnect",
      );
    });

    it("schedules reconnect on unexpected close", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "recon-ws",
        defaultConfig,
      );

      // Simulate unexpected close (code 1006)
      socket._simulateClose(1006, "Connection lost");

      // Status should indicate reconnecting
      await new Promise((r) => setTimeout(r, 10));
      const statusChanges = win._sent.filter(
        (s) => s.channel === webSocketEvents.WS_STATUS_CHANGE,
      );
      const connectingBroadcast = statusChanges.find(
        (s) => s.payload.status === "connecting" && s.payload.retryCount === 1,
      );
      assert.ok(
        connectingBroadcast,
        "Should broadcast connecting status with retryCount",
      );

      // Wait for the first reconnect attempt (1 second base delay)
      await new Promise((r) => setTimeout(r, 1100));
      const reconnectSocket = mockSocketInstances.find((s) => s !== socket);
      assert.ok(
        reconnectSocket,
        "A new socket should be created for reconnect",
      );
    });

    it("respects max retry limit", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "max-retry",
        defaultConfig,
      );

      // Simulate unexpected close
      socket._simulateClose(1006, "Lost");

      // Fast-forward through 5 retry attempts
      // Each reconnect attempt creates a new socket that fails immediately
      for (let i = 0; i < 5; i++) {
        // Wait for the backoff delay (1s, 2s, 4s, etc — but capped by test patience)
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        await new Promise((r) => setTimeout(r, delay + 50));

        // Find the newest socket (reconnect attempt)
        const newest = mockSocketInstances[mockSocketInstances.length - 1];
        if (
          newest &&
          newest !== socket &&
          newest.readyState === MockWebSocket.CONNECTING
        ) {
          // Simulate connection failure
          newest._simulateError("Connection refused");
        }
      }

      // After max retries, status should be error
      await new Promise((r) => setTimeout(r, 100));
      const statusResult = controller.getStatus(win, "max-retry");
      assert.equal(statusResult.status, "error");
      assert.match(
        statusResult.error || "",
        /Reconnect failed after 5 attempts/,
      );
    });

    it("calculates exponential backoff delays correctly", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "backoff-ws",
        defaultConfig,
      );

      // Clear broadcasts from initial connect
      win._sent.length = 0;

      // Simulate unexpected close
      socket._simulateClose(1006, "Lost");
      await new Promise((r) => setTimeout(r, 10));

      // Check the broadcasted status for retryIn value
      const statusChanges = win._sent.filter(
        (s) =>
          s.channel === webSocketEvents.WS_STATUS_CHANGE &&
          s.payload.status === "connecting",
      );
      assert.ok(statusChanges.length > 0);
      // First retry should have delay of 1000ms
      assert.equal(
        statusChanges[0].payload.retryIn,
        1000,
        "First backoff delay should be 1000ms",
      );
    });
  });

  // =======================================================================
  // Heartbeat Ping/Pong
  // =======================================================================
  describe("heartbeat ping/pong", () => {
    it("sends ping after PING_INTERVAL (30s)", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "hb-ws",
        defaultConfig,
      );

      assert.equal(socket._pinged, false);

      // Fast-forward 30 seconds to trigger heartbeat
      await new Promise((r) => setTimeout(r, 30100));

      assert.equal(socket._pinged, true, "Ping should be sent after 30s");
    });

    it("clears pong timeout when pong received", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "pong-ws",
        defaultConfig,
      );

      // Trigger heartbeat
      await new Promise((r) => setTimeout(r, 30100));
      assert.equal(socket._pinged, true);

      // Respond with pong
      socket._simulatePong();

      // Wait for pong timeout period — connection should still be alive
      await new Promise((r) => setTimeout(r, 11000));
      const status = controller.getStatus(win, "pong-ws");
      assert.equal(
        status.status,
        "connected",
        "Connection should remain active after pong received",
      );
    });

    it("terminates stale connection when no pong received", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "stale-ws",
        defaultConfig,
      );

      // Trigger heartbeat ping
      await new Promise((r) => setTimeout(r, 30100));
      assert.equal(socket._pinged, true);

      // Do NOT send pong — wait for timeout (10s)
      await new Promise((r) => setTimeout(r, 10100));

      assert.equal(
        socket._closed,
        true,
        "Socket should be terminated after pong timeout",
      );
    });
  });

  // =======================================================================
  // Message Routing and Broadcasting
  // =======================================================================
  describe("message routing", () => {
    it("broadcasts messages to all renderer windows", async () => {
      const win1 = createMockWindow(1);
      const win2 = createMockWindow(2);
      mockWindows.push(win1, win2);

      const { socket } = await connectProvider(
        controller,
        win1,
        "msg-ws",
        defaultConfig,
      );

      // Clear status change broadcasts from connect
      win1._sent.length = 0;
      win2._sent.length = 0;

      // Simulate incoming message
      socket._simulateMessage({ type: "update", value: 42 });

      // Both windows should receive the message
      const win1Msgs = win1._sent.filter(
        (s) => s.channel === webSocketEvents.WS_MESSAGE,
      );
      const win2Msgs = win2._sent.filter(
        (s) => s.channel === webSocketEvents.WS_MESSAGE,
      );

      assert.equal(win1Msgs.length, 1, "Window 1 should receive message");
      assert.equal(win2Msgs.length, 1, "Window 2 should receive message");
      assert.deepEqual(win1Msgs[0].payload.data, {
        type: "update",
        value: 42,
      });
      assert.equal(win1Msgs[0].payload.provider, "msg-ws");
      assert.ok(win1Msgs[0].payload.timestamp > 0);
    });

    it("parses JSON messages and passes through non-JSON as strings", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "parse-ws",
        defaultConfig,
      );
      win._sent.length = 0;

      // JSON message
      socket._simulateMessage({ key: "value" });
      // Plain text message
      socket._simulateMessage("hello world");

      const msgs = win._sent.filter(
        (s) => s.channel === webSocketEvents.WS_MESSAGE,
      );
      assert.equal(msgs.length, 2);
      assert.deepEqual(msgs[0].payload.data, { key: "value" });
      assert.equal(msgs[1].payload.data, "hello world");
    });

    it("tracks message count and last message timestamp", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "count-ws",
        defaultConfig,
      );

      socket._simulateMessage("msg1");
      socket._simulateMessage("msg2");
      socket._simulateMessage("msg3");

      const status = controller.getStatus(win, "count-ws");
      assert.equal(status.messageCount, 3);
      assert.ok(status.lastMessageAt > 0);
    });

    it("broadcasts status changes to all windows", async () => {
      const win1 = createMockWindow(1);
      const win2 = createMockWindow(2);
      mockWindows.push(win1, win2);

      await connectProvider(controller, win1, "sc-ws", defaultConfig);

      // Both windows should have received the CONNECTED status change
      const win1Status = win1._sent.filter(
        (s) =>
          s.channel === webSocketEvents.WS_STATUS_CHANGE &&
          s.payload.status === "connected",
      );
      const win2Status = win2._sent.filter(
        (s) =>
          s.channel === webSocketEvents.WS_STATUS_CHANGE &&
          s.payload.status === "connected",
      );
      assert.ok(win1Status.length > 0, "Window 1 should get status change");
      assert.ok(win2Status.length > 0, "Window 2 should get status change");
    });
  });

  // =======================================================================
  // Send
  // =======================================================================
  describe("send", () => {
    it("sends string data through socket", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "send-ws",
        defaultConfig,
      );

      const result = await controller.send(win, "send-ws", "hello");
      assert.equal(result.success, true);
      assert.deepEqual(socket._sent, ["hello"]);
    });

    it("JSON-stringifies object data", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "json-ws",
        defaultConfig,
      );

      await controller.send(win, "json-ws", { action: "subscribe" });
      assert.equal(socket._sent[0], '{"action":"subscribe"}');
    });

    it("returns error when not connected", async () => {
      const win = createMockWindow(1);
      const result = await controller.send(win, "no-conn", "data");
      assert.equal(result.error, true);
      assert.match(result.message, /not connected/i);
    });
  });

  // =======================================================================
  // Error Handling
  // =======================================================================
  describe("error handling", () => {
    it("handles connection failure (error during connect)", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const promise = controller.connect(win, "fail-ws", {
        url: "ws://fail.local",
      });

      await new Promise((r) => setTimeout(r, 5));
      const socket = mockSocketInstances[mockSocketInstances.length - 1];
      socket._simulateError("Connection refused");

      const result = await promise;
      assert.equal(result.error, true);
      assert.match(result.message, /Connection refused/);

      const status = controller.getStatus(win, "fail-ws");
      assert.equal(status.status, "error");
    });

    it("handles missing URL", async () => {
      const win = createMockWindow(1);
      const result = await controller.connect(win, "no-url", {
        url: "",
      });
      assert.equal(result.error, true);
      assert.match(result.message, /requires a URL/);
    });

    it("reports socket errors to all windows", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const { socket } = await connectProvider(
        controller,
        win,
        "err-ws",
        defaultConfig,
      );
      win._sent.length = 0;

      socket._simulateError("Unexpected server response");

      const errorBroadcast = win._sent.find(
        (s) =>
          s.channel === webSocketEvents.WS_STATUS_CHANGE &&
          s.payload.status === "error",
      );
      assert.ok(errorBroadcast, "Error should be broadcast to windows");
      assert.equal(errorBroadcast.payload.error, "Unexpected server response");
    });
  });

  // =======================================================================
  // Credential Interpolation
  // =======================================================================
  describe("credential interpolation", () => {
    it("interpolates {{placeholders}} in URL", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const config = {
        url: "wss://api.example.com/ws?token={{apiKey}}",
        credentials: { apiKey: "secret123" },
      };

      const countBefore = mockSocketInstances.length;
      const promise = controller.connect(win, "cred-ws", config);

      await new Promise((r) => setTimeout(r, 5));
      const socket = mockSocketInstances[countBefore];
      assert.equal(socket.url, "wss://api.example.com/ws?token=secret123");

      socket._simulateOpen();
      const result = await promise;
      assert.equal(result.success, true);
    });

    it("interpolates {{placeholders}} in headers", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const config = {
        url: "ws://test.local",
        headers: { Authorization: "Bearer {{token}}" },
        credentials: { token: "my-jwt" },
      };

      const countBefore = mockSocketInstances.length;
      const promise = controller.connect(win, "hdr-ws", config);

      await new Promise((r) => setTimeout(r, 5));
      const socket = mockSocketInstances[countBefore];
      assert.deepEqual(socket.options.headers, {
        Authorization: "Bearer my-jwt",
      });

      socket._simulateOpen();
      await promise;
    });

    it("leaves unmatched placeholders as-is", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const config = {
        url: "ws://test.local/{{unknown}}",
        credentials: { other: "value" },
      };

      const countBefore = mockSocketInstances.length;
      const promise = controller.connect(win, "unmatched-ws", config);

      await new Promise((r) => setTimeout(r, 5));
      const socket = mockSocketInstances[countBefore];
      assert.equal(socket.url, "ws://test.local/{{unknown}}");

      socket._simulateOpen();
      await promise;
    });
  });

  // =======================================================================
  // Subprotocols
  // =======================================================================
  describe("subprotocols", () => {
    it("passes subprotocols to WebSocket constructor", async () => {
      const win = createMockWindow(1);
      mockWindows.push(win);

      const config = {
        url: "ws://test.local",
        subprotocols: ["graphql-ws", "graphql-transport-ws"],
      };

      const countBefore = mockSocketInstances.length;
      const promise = controller.connect(win, "proto-ws", config);

      await new Promise((r) => setTimeout(r, 5));
      const socket = mockSocketInstances[countBefore];
      assert.deepEqual(socket.protocols, [
        "graphql-ws",
        "graphql-transport-ws",
      ]);

      socket._simulateOpen();
      await promise;
    });
  });
});
