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

  it("every Google-tagged entry has tokenRefresh config", () => {
    const googleServers = catalog.servers.filter((s) =>
      s.tags?.includes("google"),
    );
    assert.ok(googleServers.length > 0, "Should have Google-tagged servers");

    for (const server of googleServers) {
      // Skip servers that don't use OAuth (e.g., google-calendar uses its own auth)
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
