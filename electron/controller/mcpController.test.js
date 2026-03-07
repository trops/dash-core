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
  `
    const fs = require("fs");
    ${fnSource}
    return { refreshGoogleOAuthToken };
`,
)(require, process);

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
