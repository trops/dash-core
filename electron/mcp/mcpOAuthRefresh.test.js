/**
 * mcpOAuthRefresh.test.js
 *
 * An OAuth MCP server's token expiring mid-session (QA 2026-10-24), against
 * a fake sign-in server + MCP server on localhost — no real provider, no
 * real credentials. Uses the real SDK client and Dash's OAuthClientProvider
 * (with `electron` and `providerController` mocked, as in
 * mcpOAuthProvider.test.js).
 *
 * - A token that expires mid-session is refreshed and the call goes
 *   through, with no browser opening. (Before, a provider without a fixed
 *   callback port had no redirect URL outside a sign-in, so the SDK took it
 *   for a non-interactive client and never tried the refresh.)
 * - A refresh the server refuses opens no browser either: the call fails
 *   with UnauthorizedError, which mcpController turns into "sign-in
 *   expired" and a disconnect.
 */
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const {
  UnauthorizedError,
} = require("@modelcontextprotocol/sdk/client/auth.js");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

// --- Dash's OAuth provider, with electron + providerController mocked ---
let oauthStore = {};
let openedUrls = [];
function loadOAuthModule() {
  const source = fs.readFileSync(
    path.join(__dirname, "mcpOAuthProvider.js"),
    "utf8",
  );
  const customRequire = (mod) => {
    if (mod === "electron")
      return { shell: { openExternal: async (u) => openedUrls.push(u) } };
    if (mod === "../controller/providerController")
      return {
        saveOAuthState: (_w, appId, name, state) => {
          oauthStore[`${appId}:${name}`] = JSON.parse(JSON.stringify(state));
          return { success: true };
        },
        getOAuthState: (_w, appId, name) => {
          const v = oauthStore[`${appId}:${name}`];
          return v ? { oauth: JSON.parse(JSON.stringify(v)) } : {};
        },
      };
    return require(mod);
  };
  const m = { exports: {} };
  new Function("require", "module", "exports", "console", source)(
    customRequire,
    m,
    m.exports,
    console,
  );
  return m.exports;
}
const { createMcpOAuthProvider } = loadOAuthModule();

// --- Fake sign-in server + MCP server ---
let base;
let server;
const validTokens = new Set();
let tokenRequests = [];

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

async function handleMcp(req, res) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !validTokens.has(token)) {
    return json(
      res,
      401,
      { error: "invalid_token" },
      {
        "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      },
    );
  }
  const mcp = new McpServer({ name: "fake", version: "1.0.0" });
  mcp.tool("ping", async () => ({ content: [{ type: "text", text: "pong" }] }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    mcp.close();
  });
  await mcp.connect(transport);
  const body = req.method === "POST" ? JSON.parse(await readBody(req)) : null;
  await transport.handleRequest(req, res, body);
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/token") {
      const params = new URLSearchParams(await readBody(req));
      tokenRequests.push(Object.fromEntries(params));
      if (
        params.get("grant_type") === "refresh_token" &&
        params.get("refresh_token") === "good-refresh"
      ) {
        validTokens.add("fresh-access");
        return json(res, 200, {
          access_token: "fresh-access",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "good-refresh",
        });
      }
      return json(res, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") return handleMcp(req, res);
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  oauthStore = {};
  openedUrls = [];
  tokenRequests = [];
  validTokens.clear();
});

// Connected with a valid token, the way a widget or bot would be.
async function connected(refreshToken) {
  validTokens.add("first-access");
  const provider = createMcpOAuthProvider({
    win: null,
    appId: "test-app",
    serverName: "Fake",
    mcpConfig: { oauth: { clientId: "dash-test" } },
  });
  provider.saveTokens({
    access_token: "first-access",
    token_type: "Bearer",
    refresh_token: refreshToken,
  });
  const client = new Client({ name: "dash", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      authProvider: provider,
    }),
  );
  return { client, provider };
}

describe("an OAuth MCP server's token expiring mid-session", () => {
  it("is refreshed and the call goes through, with no browser", async () => {
    const { client, provider } = await connected("good-refresh");
    try {
      validTokens.delete("first-access"); // the access token expires

      const result = await client.callTool({ name: "ping", arguments: {} });

      assert.equal(result.content[0].text, "pong");
      // Only refreshes (the SDK may refresh once per request that saw the
      // expired token), never a new sign-in.
      assert.ok(tokenRequests.length >= 1);
      for (const r of tokenRequests)
        assert.equal(r.grant_type, "refresh_token");
      assert.equal(provider.tokens().access_token, "fresh-access");
      assert.deepEqual(openedUrls, []);
    } finally {
      await client.close();
    }
  });

  it("a refused refresh opens no browser and fails with UnauthorizedError", async () => {
    const { client, provider } = await connected("revoked-refresh");
    try {
      validTokens.delete("first-access");

      await assert.rejects(
        () => client.callTool({ name: "ping", arguments: {} }),
        (err) => err instanceof UnauthorizedError,
      );
      assert.equal(tokenRequests[0].grant_type, "refresh_token");
      assert.deepEqual(openedUrls, []);
      // The dead tokens are cleared, so the next connect signs in afresh.
      assert.equal(provider.tokens(), undefined);
    } finally {
      await client.close();
    }
  });
});

describe("mcpController on an expired sign-in", () => {
  // mcpController.js needs electron to load, so — like refreshGoogleOAuthToken
  // in mcpController.test.js — just signInExpired is taken out and run with
  // its few dependencies stubbed.
  const source = fs.readFileSync(
    path.join(__dirname, "..", "controller", "mcpController.js"),
    "utf8",
  );
  const fnStart = source.indexOf("async function signInExpired(");
  const fnSource = source.slice(fnStart, source.indexOf("\n}\n", fnStart) + 2);

  function load(active) {
    const stopped = [];
    const mcpController = {
      stopServer: async (win, name, workspaceId) => {
        stopped.push([name, workspaceId]);
        active.delete(`${workspaceId}::${name}`);
      },
    };
    const signInExpired = new Function(
      "require",
      "mcpController",
      "activeServers",
      "serverKey",
      `${fnSource}; return signInExpired;`,
    )(require, mcpController, active, (ws, name) => `${ws}::${name}`);
    return { signInExpired, stopped };
  }

  it("disconnects the server that failed and says to sign in again", async () => {
    const failed = { client: {} };
    const active = new Map([["ws1::Fake", failed]]);
    const { signInExpired, stopped } = load(active);

    const message = await signInExpired(
      new UnauthorizedError(),
      null,
      "Fake",
      "ws1",
      failed,
    );

    assert.match(message, /^Fake's sign-in has expired/);
    assert.deepEqual(stopped, [["Fake", "ws1"]]);
  });

  it("leaves a connection that has since reconnected alone", async () => {
    const failed = { client: {} };
    const reconnected = { client: {} };
    const active = new Map([["ws1::Fake", reconnected]]);
    const { signInExpired, stopped } = load(active);

    const message = await signInExpired(
      new UnauthorizedError(),
      null,
      "Fake",
      "ws1",
      failed,
    );

    assert.ok(message);
    assert.deepEqual(stopped, []);
  });

  it("any other error is left to the caller", async () => {
    const failed = { client: {} };
    const { signInExpired, stopped } = load(new Map([["ws1::Fake", failed]]));
    assert.equal(
      await signInExpired(new Error("boom"), null, "Fake", "ws1", failed),
      null,
    );
    assert.deepEqual(stopped, []);
  });

  it("tool calls and tool lists both use it", () => {
    const uses = source.match(/await signInExpired\(/g) || [];
    assert.equal(uses.length, 2);
    // callTool awaits the call, so a failed one reaches its catch (a
    // returned, un-awaited promise rejected past it — found live).
    assert.match(source, /return await responseCache\.get\(cacheKey, doCall,/);
    assert.match(source, /return await doCall\(\);/);
  });
});
