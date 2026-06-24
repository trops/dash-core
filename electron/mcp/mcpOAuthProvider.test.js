/**
 * mcpOAuthProvider.test.js
 *
 * Tests for the SDK-native OAuthClientProvider used by custom OAuth MCP
 * servers. Loads the module with mocked `electron` (shell) and
 * `providerController`, and uses the real `http` module to exercise the
 * loopback redirect-capture server.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");

// In-memory OAuth store standing in for providerController.
let oauthStore = {};
const mockProviderController = {
  saveOAuthState: (_win, appId, name, state) => {
    oauthStore[`${appId}:${name}`] = JSON.parse(JSON.stringify(state));
    return { success: true };
  },
  getOAuthState: (_win, appId, name) => {
    const v = oauthStore[`${appId}:${name}`];
    return v ? { oauth: JSON.parse(JSON.stringify(v)) } : {};
  },
};

let openedUrls = [];
const mockElectron = {
  shell: {
    openExternal: async (u) => {
      openedUrls.push(u);
    },
  },
};

function loadModule() {
  const source = fs.readFileSync(
    path.join(__dirname, "mcpOAuthProvider.js"),
    "utf8",
  );
  const customRequire = (mod) => {
    if (mod === "electron") return mockElectron;
    if (mod === "http") return http;
    if (mod === "../controller/providerController")
      return mockProviderController;
    return require(mod);
  };
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "console", source);
  fn(customRequire, m, m.exports, console);
  return m.exports;
}

const { createMcpOAuthProvider } = loadModule();

function createProvider(overrides = {}) {
  return createMcpOAuthProvider({
    win: null,
    appId: "test-app",
    serverName: "Granola",
    mcpConfig: { oauth: {} },
    ...overrides,
  });
}

function hitCallback(port, query) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
        res.resume();
        res.on("end", resolve);
      })
      .on("error", reject);
  });
}

describe("mcpOAuthProvider", () => {
  beforeEach(() => {
    oauthStore = {};
    openedUrls = [];
  });

  it("redirectUrl is undefined until the loopback starts, then matches the port", async () => {
    const p = createProvider();
    assert.equal(p.redirectUrl, undefined);
    const lb = await p._startLoopback();
    assert.equal(p.redirectUrl, `http://127.0.0.1:${lb.port}/callback`);
    p._stopLoopback();
    assert.equal(p.redirectUrl, undefined);
  });

  it("clientMetadata embeds the loopback redirect_uri", async () => {
    const p = createProvider({
      mcpConfig: { oauth: { scopes: "read write" } },
    });
    const lb = await p._startLoopback();
    const meta = p.clientMetadata;
    assert.deepEqual(meta.redirect_uris, [
      `http://127.0.0.1:${lb.port}/callback`,
    ]);
    assert.equal(meta.token_endpoint_auth_method, "none");
    assert.equal(meta.scope, "read write");
    p._stopLoopback();
  });

  it("uses client_secret_post when a client secret is configured", () => {
    const p = createProvider({
      mcpConfig: { oauth: { clientId: "cid", clientSecret: "sek" } },
    });
    assert.equal(
      p.clientMetadata.token_endpoint_auth_method,
      "client_secret_post",
    );
  });

  it("clientInformation: manual clientId beats DCR", () => {
    // Seed a DCR-registered client in the store.
    oauthStore["test-app:Granola"] = {
      clientInformation: { client_id: "dcr-id" },
    };
    const p = createProvider({
      mcpConfig: { oauth: { clientId: "manual-id", clientSecret: "s" } },
    });
    assert.deepEqual(p.clientInformation(), {
      client_id: "manual-id",
      client_secret: "s",
    });
  });

  it("clientInformation falls back to DCR-saved info when no manual id", () => {
    const p = createProvider();
    assert.equal(p.clientInformation(), undefined);
    p.saveClientInformation({ client_id: "dcr-id" });
    assert.deepEqual(p.clientInformation(), { client_id: "dcr-id" });
  });

  it("tokens round-trip through saveTokens/getOAuthState", () => {
    const p = createProvider();
    assert.equal(p.tokens(), undefined);
    p.saveTokens({ access_token: "at", refresh_token: "rt" });
    assert.deepEqual(p.tokens(), { access_token: "at", refresh_token: "rt" });
    // Persisted to the (mock) provider store.
    assert.deepEqual(oauthStore["test-app:Granola"].tokens, {
      access_token: "at",
      refresh_token: "rt",
    });
  });

  it("codeVerifier persists and throws when missing", () => {
    const p = createProvider();
    assert.throws(() => p.codeVerifier(), /code verifier/);
    p.saveCodeVerifier("verifier-xyz");
    assert.equal(p.codeVerifier(), "verifier-xyz");
  });

  it("redirectToAuthorization opens the system browser", async () => {
    const p = createProvider();
    await p.redirectToAuthorization(
      new URL("https://auth.example.com/authorize"),
    );
    assert.deepEqual(openedUrls, ["https://auth.example.com/authorize"]);
  });

  it("invalidateCredentials clears the requested scope", () => {
    const p = createProvider();
    p.saveTokens({ access_token: "at" });
    p.saveClientInformation({ client_id: "dcr" });
    p.invalidateCredentials("tokens");
    assert.equal(p.tokens(), undefined);
    assert.deepEqual(p.clientInformation(), { client_id: "dcr" });
  });

  it("_waitForCode resolves with the loopback authorization code", async () => {
    const p = createProvider();
    const lb = await p._startLoopback();
    const codeP = p._waitForCode(5000);
    await hitCallback(lb.port, "code=abc123");
    assert.equal(await codeP, "abc123");
    p._stopLoopback();
  });

  it("_waitForCode rejects on an OAuth error callback", async () => {
    const p = createProvider();
    const lb = await p._startLoopback();
    const codeP = p._waitForCode(5000);
    // Attach the rejection handler BEFORE firing the callback so the
    // rejection is never momentarily unhandled.
    const rejected = assert.rejects(() => codeP, /access_denied/);
    await hitCallback(lb.port, "error=access_denied");
    await rejected;
    p._stopLoopback();
  });
});
