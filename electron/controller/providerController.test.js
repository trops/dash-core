/**
 * providerController.test.js
 *
 * Tests for provider persistence: saving, listing, and getting providers,
 * with focus on wsConfig round-trip for WebSocket providers.
 *
 * Uses Node.js built-in test module (same pattern as webSocketController.test.js).
 * The controller source is re-evaluated with mocked `electron`, `fs`, and util
 * dependencies to test in isolation.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// In-memory file system for providers.json
// ---------------------------------------------------------------------------
let fileStore = {};

// ---------------------------------------------------------------------------
// Mock: electron (app, safeStorage)
// ---------------------------------------------------------------------------
const mockElectron = {
  app: {
    getPath: () => "/mock/userData",
  },
  safeStorage: {
    encryptString: (str) => Buffer.from(`enc:${str}`),
    decryptString: (buf) => {
      const str = buf.toString();
      if (!str.startsWith("enc:")) throw new Error("Bad encryption");
      return str.slice(4);
    },
  },
};

// ---------------------------------------------------------------------------
// Mock: fs.writeFileSync / readFileSync / existsSync
// ---------------------------------------------------------------------------
const mockFs = {
  writeFileSync: (filepath, data, _opts) => {
    fileStore[filepath] = data;
  },
  readFileSync: (filepath, encoding) => {
    if (filepath in fileStore) return fileStore[filepath];
    // For source loading, delegate to real fs
    return fs.readFileSync(filepath, encoding);
  },
  existsSync: (filepath) => {
    // For catalog path, return false (no catalog needed for tests)
    if (filepath.includes("mcpServerCatalog")) return false;
    // For provider file, check our in-memory store
    if (filepath in fileStore) return true;
    // For source loading, delegate to real fs
    return fs.existsSync(filepath);
  },
  mkdirSync: () => {},
  openSync: () => 0,
  closeSync: () => {},
  readdir: () => {},
  unlink: () => {},
  unlinkSync: () => {},
  readdirSync: () => [],
  lstatSync: () => ({ isDirectory: () => false }),
};

// ---------------------------------------------------------------------------
// Load providerController with mocked dependencies
// ---------------------------------------------------------------------------
function loadController() {
  const source = fs.readFileSync(
    path.join(__dirname, "providerController.js"),
    "utf8",
  );

  const customRequire = (mod) => {
    if (mod === "electron") return mockElectron;
    if (mod === "path") return path;
    if (mod === "fs") return mockFs;
    if (mod === "../utils/file") {
      // Load file utils with our mocked fs
      const fileSource = fs.readFileSync(
        path.join(__dirname, "..", "utils", "file.js"),
        "utf8",
      );
      const fileMod = { exports: {} };
      const fileFn = new Function(
        "require",
        "module",
        "exports",
        "console",
        fileSource,
      );
      fileFn(
        (dep) => {
          if (dep === "path") return path;
          if (dep === "fs") return mockFs;
          return require(dep);
        },
        fileMod,
        fileMod.exports,
        console,
      );
      return fileMod.exports;
    }
    if (mod === "../utils/clientCache") {
      return { invalidate: () => {} };
    }
    return require(mod);
  };

  const mod = { exports: {} };
  const fn = new Function("require", "module", "exports", "console", source);
  fn(customRequire, mod, mod.exports, console);
  return mod.exports;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("providerController", () => {
  let controller;

  beforeEach(() => {
    fileStore = {};
    controller = loadController();
  });

  // ===================================================================
  // saveProvider — wsConfig
  // ===================================================================
  describe("saveProvider wsConfig", () => {
    it("stores wsConfig when providerClass is websocket", () => {
      const wsConfig = {
        url: "wss://example.com/ws",
        headers: { Authorization: "Bearer tok" },
        subprotocols: ["graphql-ws"],
      };

      const result = controller.saveProvider(
        null, // win
        "test-app",
        "My WS Provider",
        "custom-ws",
        { apiKey: "key1" },
        "websocket",
        null, // mcpConfig
        null, // allowedTools
        wsConfig,
      );

      assert.equal(result.success, true);

      // Verify it was persisted in the file
      const filepath = path.join(
        "/mock/userData",
        "Dashboard",
        "test-app",
        "providers.json",
      );
      const stored = JSON.parse(fileStore[filepath]);
      assert.ok(stored["My WS Provider"]);
      assert.deepEqual(stored["My WS Provider"].wsConfig, wsConfig);
      assert.equal(stored["My WS Provider"].providerClass, "websocket");
    });

    it("does NOT store wsConfig when providerClass is not websocket", () => {
      const result = controller.saveProvider(
        null,
        "test-app",
        "My MCP Provider",
        "custom-mcp",
        { apiKey: "key1" },
        "mcp",
        { transport: "stdio", command: "node", args: ["server.js"] },
        null,
        { url: "wss://should-not-be-saved.com" }, // wsConfig should be ignored
      );

      assert.equal(result.success, true);

      const filepath = path.join(
        "/mock/userData",
        "Dashboard",
        "test-app",
        "providers.json",
      );
      const stored = JSON.parse(fileStore[filepath]);
      assert.equal(
        stored["My MCP Provider"].wsConfig,
        undefined,
        "wsConfig should not be saved for non-websocket providers",
      );
      assert.ok(stored["My MCP Provider"].mcpConfig);
    });

    it("does NOT store wsConfig when providerClass is credential", () => {
      const result = controller.saveProvider(
        null,
        "test-app",
        "My Credential Provider",
        "algolia",
        { appId: "abc", apiKey: "123" },
        "credential",
        null,
        null,
        { url: "wss://should-not-be-saved.com" },
      );

      assert.equal(result.success, true);

      const filepath = path.join(
        "/mock/userData",
        "Dashboard",
        "test-app",
        "providers.json",
      );
      const stored = JSON.parse(fileStore[filepath]);
      assert.equal(stored["My Credential Provider"].wsConfig, undefined);
    });
  });

  // ===================================================================
  // listProviders — wsConfig
  // ===================================================================
  describe("listProviders wsConfig", () => {
    it("includes wsConfig for WebSocket providers", () => {
      const wsConfig = {
        url: "wss://example.com/ws",
        headers: {},
        subprotocols: [],
      };

      // Save a websocket provider first
      controller.saveProvider(
        null,
        "test-app",
        "WS Provider",
        "custom-ws",
        { token: "abc" },
        "websocket",
        null,
        null,
        wsConfig,
      );

      // List and verify wsConfig is present
      const result = controller.listProviders(null, "test-app");
      assert.equal(result.providers.length, 1);
      assert.deepEqual(result.providers[0].wsConfig, wsConfig);
      assert.equal(result.providers[0].providerClass, "websocket");
    });

    it("does not include wsConfig for non-WebSocket providers", () => {
      controller.saveProvider(
        null,
        "test-app",
        "Credential Provider",
        "algolia",
        { apiKey: "key" },
        "credential",
      );

      const result = controller.listProviders(null, "test-app");
      assert.equal(result.providers.length, 1);
      assert.equal(result.providers[0].wsConfig, undefined);
    });
  });

  // ===================================================================
  // getProvider — wsConfig
  // ===================================================================
  describe("getProvider wsConfig", () => {
    it("includes wsConfig for WebSocket providers", () => {
      const wsConfig = {
        url: "wss://streaming.example.com",
        headers: { "X-Api-Key": "secret" },
        subprotocols: ["json"],
      };

      controller.saveProvider(
        null,
        "test-app",
        "Stream WS",
        "custom-ws",
        { key: "val" },
        "websocket",
        null,
        null,
        wsConfig,
      );

      const result = controller.getProvider(null, "test-app", "Stream WS");
      assert.ok(result.provider);
      assert.deepEqual(result.provider.wsConfig, wsConfig);
    });
  });

  // ===================================================================
  // Round-trip: save then load
  // ===================================================================
  describe("round-trip persistence", () => {
    it("wsConfig.url, .headers, .subprotocols all survive save/load", () => {
      const wsConfig = {
        url: "wss://api.example.com/realtime",
        headers: {
          Authorization: "Bearer {{token}}",
          "X-Custom": "value",
        },
        subprotocols: ["graphql-ws", "graphql-transport-ws"],
      };

      controller.saveProvider(
        null,
        "test-app",
        "Round Trip WS",
        "custom-ws",
        { token: "jwt123" },
        "websocket",
        null,
        null,
        wsConfig,
      );

      // Verify via getProvider
      const getResult = controller.getProvider(
        null,
        "test-app",
        "Round Trip WS",
      );
      assert.deepEqual(getResult.provider.wsConfig.url, wsConfig.url);
      assert.deepEqual(getResult.provider.wsConfig.headers, wsConfig.headers);
      assert.deepEqual(
        getResult.provider.wsConfig.subprotocols,
        wsConfig.subprotocols,
      );

      // Verify via listProviders
      const listResult = controller.listProviders(null, "test-app");
      const provider = listResult.providers.find(
        (p) => p.name === "Round Trip WS",
      );
      assert.ok(provider);
      assert.deepEqual(provider.wsConfig, wsConfig);

      // Verify credentials also survived
      assert.deepEqual(getResult.provider.credentials, {
        token: "jwt123",
      });
    });

    it("MCP providers still save/load correctly (regression)", () => {
      const mcpConfig = {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@some/mcp-server"],
        envMapping: { API_KEY: "apiKey" },
      };

      controller.saveProvider(
        null,
        "test-app",
        "MCP Provider",
        "github",
        { apiKey: "ghp_xxx" },
        "mcp",
        mcpConfig,
        ["tool1", "tool2"],
      );

      const result = controller.getProvider(null, "test-app", "MCP Provider");
      assert.deepEqual(result.provider.mcpConfig, mcpConfig);
      assert.deepEqual(result.provider.allowedTools, ["tool1", "tool2"]);
      assert.equal(result.provider.wsConfig, undefined);
    });

    it("credential providers still save/load correctly (regression)", () => {
      controller.saveProvider(null, "test-app", "Algolia Prod", "algolia", {
        appId: "ABC",
        apiKey: "xyz",
      });

      const result = controller.getProvider(null, "test-app", "Algolia Prod");
      assert.deepEqual(result.provider.credentials, {
        appId: "ABC",
        apiKey: "xyz",
      });
      assert.equal(result.provider.providerClass, "credential");
      assert.equal(result.provider.mcpConfig, undefined);
      assert.equal(result.provider.wsConfig, undefined);
    });
  });

  // ===================================================================
  // saveOAuthState / getOAuthState — MCP OAuth token storage
  // ===================================================================
  describe("OAuth state", () => {
    it("round-trips an encrypted OAuth blob", () => {
      const oauthState = {
        tokens: { access_token: "at", refresh_token: "rt" },
        clientInformation: { client_id: "dcr-id" },
        codeVerifier: "verifier-123",
      };

      const saveRes = controller.saveOAuthState(
        null,
        "test-app",
        "Granola",
        oauthState,
      );
      assert.equal(saveRes.success, true);

      const got = controller.getOAuthState(null, "test-app", "Granola");
      assert.deepEqual(got.oauth, oauthState);
    });

    it("returns {} when no OAuth state exists", () => {
      const got = controller.getOAuthState(null, "test-app", "Nope");
      assert.deepEqual(got, {});
    });

    it("does not leak the encrypted oauth blob through getProvider", () => {
      // Authorize (writes oauth), then save the provider so it's readable.
      controller.saveOAuthState(null, "test-app", "Granola", {
        tokens: { access_token: "at" },
      });
      controller.saveProvider(
        null,
        "test-app",
        "Granola",
        "custom",
        { someCred: "v" },
        "mcp",
        { transport: "streamable_http", url: "https://x", auth: "oauth" },
      );

      const result = controller.getProvider(null, "test-app", "Granola");
      assert.equal(result.provider.providerClass, "mcp");
      // The encrypted oauth blob must never reach the renderer payload.
      assert.equal(result.provider.oauth, undefined);
    });

    it("preserves the OAuth blob across a provider re-save", () => {
      // Authorize first (writes oauth), then save the provider config.
      controller.saveOAuthState(null, "test-app", "Granola", {
        tokens: { access_token: "keep-me" },
      });
      controller.saveProvider(
        null,
        "test-app",
        "Granola",
        "custom",
        { someCred: "v" },
        "mcp",
        { transport: "streamable_http", url: "https://x", auth: "oauth" },
      );

      // Tokens must survive the re-save.
      const got = controller.getOAuthState(null, "test-app", "Granola");
      assert.deepEqual(got.oauth, { tokens: { access_token: "keep-me" } });
    });
  });
});
