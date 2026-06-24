const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// refreshGoogleOAuthToken is defined in mcpController.js but that file
// requires @modelcontextprotocol/sdk which isn't installed in dash-core
// (it's provided at runtime by dash-electron). We extract and re-evaluate
// just the function for testing.
const mcpControllerSource = fs.readFileSync(
  path.join(__dirname, "mcpController.js"),
  "utf8",
);

// Extract the refreshGoogleOAuthToken function source
const fnStart = mcpControllerSource.indexOf(
  "async function refreshGoogleOAuthToken(",
);
const fnEnd = mcpControllerSource.indexOf("\n\nconst mcpController", fnStart);
const fnSource = mcpControllerSource.substring(fnStart, fnEnd);

// Create a standalone module with just this function
const testModule = new Function(
  "require",
  "process",
  "os",
  `
    const fs = require("fs");
    ${fnSource}
    return { refreshGoogleOAuthToken };
`,
)(require, process, require("os"));

const { refreshGoogleOAuthToken } = testModule;

describe("refreshGoogleOAuthToken", () => {
  const tmpDir = path.join(require("os").tmpdir(), "mcp-test-" + Date.now());
  const credPath = path.join(tmpDir, "credentials.json");
  const keysPath = path.join(tmpDir, "gcp-oauth.keys.json");

  const validKeys = {
    installed: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    },
  };

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.unlinkSync(credPath);
    } catch {}
    try {
      fs.unlinkSync(keysPath);
    } catch {}
  });

  it("skips refresh when credential files don't exist", async () => {
    await refreshGoogleOAuthToken({
      credentialsPath: path.join(tmpDir, "nonexistent-creds.json"),
      oauthKeysPath: path.join(tmpDir, "nonexistent-keys.json"),
    });
    // Should not throw
  });

  it("skips refresh when token is still valid (expiry > 5 min)", async () => {
    const creds = {
      access_token: "valid-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() + 60 * 60 * 1000,
    };
    fs.writeFileSync(credPath, JSON.stringify(creds));
    fs.writeFileSync(keysPath, JSON.stringify(validKeys));

    await refreshGoogleOAuthToken({
      credentialsPath: credPath,
      oauthKeysPath: keysPath,
    });

    const result = JSON.parse(fs.readFileSync(credPath, "utf8"));
    assert.equal(result.access_token, "valid-token");
  });

  it("skips when missing refresh_token", async () => {
    const creds = {
      access_token: "expired-token",
      expiry_date: Date.now() - 1000,
    };
    fs.writeFileSync(credPath, JSON.stringify(creds));
    fs.writeFileSync(keysPath, JSON.stringify(validKeys));

    await refreshGoogleOAuthToken({
      credentialsPath: credPath,
      oauthKeysPath: keysPath,
    });

    const result = JSON.parse(fs.readFileSync(credPath, "utf8"));
    assert.equal(result.access_token, "expired-token");
  });

  it("skips when missing client_id/client_secret", async () => {
    const creds = {
      access_token: "expired-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() - 1000,
    };
    fs.writeFileSync(credPath, JSON.stringify(creds));
    fs.writeFileSync(keysPath, JSON.stringify({ installed: {} }));

    await refreshGoogleOAuthToken({
      credentialsPath: credPath,
      oauthKeysPath: keysPath,
    });

    const result = JSON.parse(fs.readFileSync(credPath, "utf8"));
    assert.equal(result.access_token, "expired-token");
  });

  it("handles web key format (keysFile.web instead of installed)", async () => {
    const creds = {
      access_token: "valid-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() + 60 * 60 * 1000,
    };
    const webKeys = {
      web: {
        client_id: "web-client-id",
        client_secret: "web-client-secret",
      },
    };
    fs.writeFileSync(credPath, JSON.stringify(creds));
    fs.writeFileSync(keysPath, JSON.stringify(webKeys));

    await refreshGoogleOAuthToken({
      credentialsPath: credPath,
      oauthKeysPath: keysPath,
    });

    const result = JSON.parse(fs.readFileSync(credPath, "utf8"));
    assert.equal(result.access_token, "valid-token");
  });
});

// ---------------------------------------------------------------------------
// connectStreamableHttpWithOAuth — connect → authorize → reconnect dance.
// Extracted and re-evaluated (like refreshGoogleOAuthToken above) so we can
// inject mock Client / transport classes without the real SDK or electron.
// ---------------------------------------------------------------------------
describe("connectStreamableHttpWithOAuth", () => {
  class MockUnauthorizedError extends Error {}

  const oauthFnStart = mcpControllerSource.indexOf(
    "async function connectStreamableHttpWithOAuth(",
  );
  const oauthFnEnd = mcpControllerSource.indexOf(
    "\n\nconst mcpController",
    oauthFnStart,
  );
  const oauthFnSource = mcpControllerSource.substring(oauthFnStart, oauthFnEnd);

  let finishAuthCalls;

  class MockTransport {
    constructor(url, opts) {
      this.url = url;
      this.opts = opts;
    }
    async finishAuth(code) {
      finishAuthCalls.push(code);
    }
  }

  // `behaviors[i]` controls the i-th constructed client's connect():
  // "ok" resolves, "unauth" throws MockUnauthorizedError.
  function makeClientClass(behaviors) {
    let idx = 0;
    class MockClient {
      constructor() {
        this.idx = idx++;
      }
      async connect(transport) {
        this._transport = transport;
        if (behaviors[this.idx] === "unauth") {
          throw new MockUnauthorizedError("needs auth");
        }
      }
    }
    return MockClient;
  }

  function loadFn(MockClient) {
    return new Function(
      "Client",
      "StreamableHTTPClientTransport",
      "require",
      "console",
      `${oauthFnSource}\nreturn connectStreamableHttpWithOAuth;`,
    )(
      MockClient,
      MockTransport,
      (m) => {
        if (m === "@modelcontextprotocol/sdk/client/auth.js") {
          return { UnauthorizedError: MockUnauthorizedError };
        }
        return require(m);
      },
      console,
    );
  }

  function makeProvider() {
    return {
      started: false,
      stopped: false,
      waited: false,
      async _startLoopback() {
        this.started = true;
      },
      _stopLoopback() {
        this.stopped = true;
      },
      async _waitForCode() {
        this.waited = true;
        return "auth-code";
      },
    };
  }

  beforeEach(() => {
    finishAuthCalls = [];
  });

  it("fast path: valid tokens connect without a browser flow", async () => {
    const fn = loadFn(makeClientClass(["ok"]));
    const provider = makeProvider();

    const res = await fn(new URL("https://mcp.example.com"), provider);

    assert.ok(res.client);
    assert.ok(res.transport);
    assert.equal(provider.started, true);
    assert.equal(provider.stopped, true); // loopback always torn down
    assert.equal(provider.waited, false); // no browser wait
    assert.equal(finishAuthCalls.length, 0);
  });

  it("auth path: UnauthorizedError → finishAuth(code) → reconnect with fresh client", async () => {
    // First client throws UnauthorizedError, second (post-auth) connects.
    const fn = loadFn(makeClientClass(["unauth", "ok"]));
    const provider = makeProvider();

    const res = await fn(new URL("https://mcp.example.com"), provider);

    assert.equal(provider.waited, true);
    assert.deepEqual(finishAuthCalls, ["auth-code"]);
    assert.equal(res.client.idx, 1); // the second, authorized client
    assert.equal(provider.stopped, true);
  });

  it("non-auth errors propagate and still tear down the loopback", async () => {
    const fnSource = loadFn(
      (() => {
        class Boom {
          async connect() {
            throw new Error("network down");
          }
        }
        return Boom;
      })(),
    );
    const provider = makeProvider();

    await assert.rejects(
      () => fnSource(new URL("https://mcp.example.com"), provider),
      /network down/,
    );
    assert.equal(provider.stopped, true);
  });
});
