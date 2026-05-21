const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const catalogPath = path.join(__dirname, "mcpServerCatalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

describe("mcpServerCatalog structural validation", () => {
  it("catalog has servers array", () => {
    assert.ok(Array.isArray(catalog.servers));
    assert.ok(catalog.servers.length > 0);
  });

  it("every Google-tagged entry has tokenRefresh config or bundled credentials", () => {
    const googleServers = catalog.servers.filter((s) =>
      s.tags?.includes("google"),
    );
    assert.ok(googleServers.length > 0, "Should have Google-tagged servers");

    for (const server of googleServers) {
      // Skip servers that handle token refresh internally
      // (e.g., bundled PKCE credentials — no external tokenRefresh needed)
      if (
        Object.keys(server.credentialSchema || {}).length === 0 &&
        !server.mcpConfig.tokenRefresh
      ) {
        continue;
      }
      // Skip servers that don't use OAuth
      if (!server.mcpConfig.staticEnv && !server.mcpConfig.tokenRefresh) {
        continue;
      }
      assert.ok(
        server.mcpConfig.tokenRefresh,
        `Server "${server.id}" is Google-tagged but missing tokenRefresh config`,
      );
    }
  });

  it("tokenRefresh entries have both credentialsPath and oauthKeysPath", () => {
    for (const server of catalog.servers) {
      const tr = server.mcpConfig.tokenRefresh;
      if (!tr) continue;
      assert.ok(
        tr.credentialsPath,
        `Server "${server.id}" tokenRefresh missing credentialsPath`,
      );
      assert.ok(
        tr.oauthKeysPath,
        `Server "${server.id}" tokenRefresh missing oauthKeysPath`,
      );
    }
  });

  it("no entries reference the deprecated @modelcontextprotocol/server-gdrive", () => {
    for (const server of catalog.servers) {
      const args = server.mcpConfig.args || [];
      const hasDeprecated = args.some((a) =>
        String(a).includes("@modelcontextprotocol/server-gdrive"),
      );
      assert.ok(
        !hasDeprecated,
        `Server "${server.id}" still references deprecated @modelcontextprotocol/server-gdrive`,
      );

      // Also check authCommand
      const authArgs = server.authCommand?.args || [];
      const authHasDeprecated = authArgs.some((a) =>
        String(a).includes("@modelcontextprotocol/server-gdrive"),
      );
      assert.ok(
        !authHasDeprecated,
        `Server "${server.id}" authCommand still references deprecated @modelcontextprotocol/server-gdrive`,
      );
    }
  });

  it("no entries reference the deprecated @modelcontextprotocol/server-slack", () => {
    // The reference Slack server was archived along with most of the
    // modelcontextprotocol/servers repo. Catalog now points at the
    // actively-maintained `slack-mcp-server` (korotovsky) which supports
    // bot/user/browser-session auth and a much wider tool surface.
    for (const server of catalog.servers) {
      const args = server.mcpConfig.args || [];
      const hasDeprecated = args.some((a) =>
        String(a).includes("@modelcontextprotocol/server-slack"),
      );
      assert.ok(
        !hasDeprecated,
        `Server "${server.id}" still references deprecated @modelcontextprotocol/server-slack`,
      );
    }
  });

  it("slack entry uses slack-mcp-server with the expected env vocabulary", () => {
    const slack = catalog.servers.find((s) => s.id === "slack");
    assert.ok(slack, "slack catalog entry missing");
    assert.deepEqual(slack.mcpConfig.args, ["-y", "slack-mcp-server"]);
    // Env vars must use the SLACK_MCP_* names the new server reads, not
    // the SLACK_BOT_TOKEN/SLACK_TEAM_ID names from the deprecated server.
    const envKeys = Object.keys(slack.mcpConfig.envMapping || {});
    for (const key of envKeys) {
      assert.ok(
        key.startsWith("SLACK_MCP_"),
        `slack envMapping key "${key}" should be a SLACK_MCP_* var (new server vocabulary)`,
      );
    }
    assert.ok(
      slack.mcpConfig.staticEnv?.SLACK_MCP_ADD_MESSAGE_TOOL === "true",
      "slack entry should enable the add_message tool via staticEnv (off by default in the server)",
    );
  });

  it("every server has required fields", () => {
    for (const server of catalog.servers) {
      assert.ok(server.id, "Server missing id");
      assert.ok(server.name, "Server missing name");
      assert.ok(server.mcpConfig, `Server "${server.id}" missing mcpConfig`);
      assert.ok(
        server.mcpConfig.transport,
        `Server "${server.id}" missing mcpConfig.transport`,
      );
    }
  });
});
