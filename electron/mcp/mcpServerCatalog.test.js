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

  it("web-fetch is built in, and its number settings match what the provider reads", () => {
    const { NUMBER_SETTINGS } = require("./builtinServers/webFetch");
    const { BUILTIN_SERVERS } = require("./builtinServers");
    const wf = catalog.servers.find((s) => s.id === "web-fetch");
    assert.ok(wf, "web-fetch entry missing");
    assert.equal(wf.mcpConfig.transport, "in_process");
    assert.ok(BUILTIN_SERVERS[wf.mcpConfig.builtin], "unknown builtin id");
    for (const [key, range] of Object.entries(NUMBER_SETTINGS)) {
      const field = wf.credentialSchema[key];
      assert.ok(field, `missing setting ${key}`);
      assert.equal(field.type, "number");
      assert.equal(field.default, range.default, `${key} default`);
      assert.equal(field.min, range.min, `${key} min`);
      assert.equal(field.max, range.max, `${key} max`);
    }
    assert.equal(wf.credentialSchema.allowedSites.type, "text-list");
    assert.equal(wf.credentialSchema.shrinkLargeImages.type, "toggle");
    assert.ok(
      Object.values(wf.credentialSchema).every((f) => f.secret === false),
    );
  });

  it("credentialOptions name only fields in the entry's credentialSchema", () => {
    const slack = catalog.servers.find((s) => s.id === "slack");
    assert.ok(
      Array.isArray(slack.credentialOptions),
      "slack lists its options",
    );
    for (const server of catalog.servers) {
      for (const option of server.credentialOptions || []) {
        assert.ok(
          Array.isArray(option) && option.length,
          `${server.id}: empty option`,
        );
        for (const key of option) {
          assert.ok(
            server.credentialSchema && server.credentialSchema[key],
            `${server.id}: option field "${key}" isn't in credentialSchema`,
          );
        }
      }
    }
  });

  it("worksWithout is only set on fields of the entry's own schema, and Algolia's API key has it", () => {
    const algolia = catalog.servers.find((s) => s.id === "algolia");
    assert.strictEqual(algolia.credentialSchema.apiKey.worksWithout, true);
    assert.notStrictEqual(algolia.credentialSchema.url.worksWithout, true);
    for (const server of catalog.servers) {
      for (const [key, field] of Object.entries(
        server.credentialSchema || {},
      )) {
        if ("worksWithout" in field) {
          assert.strictEqual(
            typeof field.worksWithout,
            "boolean",
            `${server.id}.${key}: worksWithout must be true/false`,
          );
        }
      }
    }
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
