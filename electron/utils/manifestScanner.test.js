/**
 * manifestScanner.test.js
 *
 * Pins the literal-only static scanner that powers three entry points:
 *   1. publish-time CLI (`dash-scan-manifest`)
 *   2. install-time hook in widgetRegistry
 *   3. helper for the manual-grant Settings UI
 *
 * Run: `node --test electron/utils/manifestScanner.test.js`
 *
 * Scope: literal string detection ONLY. Dynamic tool/server names are
 * surfaced as warnings, not silent misses. The runtime gate (Slices 1-3)
 * is the actual security boundary — this module is a developer linter
 * + UX hint, not an enforcement mechanism.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { scanForMcpUsage } = require("./manifestScanner");

test("scanForMcpUsage: detects literal callTool tool names", () => {
  const r = scanForMcpUsage({
    files: {
      "src/Widget.js": `
        mainApi.mcp.callTool("filesystem", "read_file", { path: "/x" });
        mainApi.mcp.callTool("github", "search_repositories", {});
      `,
    },
  });
  assert.ok(r.servers.filesystem, "filesystem server should be detected");
  assert.ok(
    r.servers.filesystem.tools.includes("read_file"),
    "read_file tool should be detected",
  );
  assert.ok(r.servers.github, "github server should be detected");
  assert.ok(
    r.servers.github.tools.includes("search_repositories"),
    "search_repositories tool should be detected",
  );
});

test("scanForMcpUsage: dynamic tool names produce warnings, not silent detections", () => {
  const r = scanForMcpUsage({
    files: {
      "src/Widget.js": `
        const t = "read_file";
        mainApi.mcp.callTool("filesystem", t, {});
      `,
    },
  });
  // No tool detected
  assert.strictEqual(
    Object.keys(r.servers).length === 0 ||
      !r.servers.filesystem ||
      r.servers.filesystem.tools.length === 0,
    true,
  );
  // Warning emitted
  assert.ok(r.warnings.length > 0, "should emit warnings for dynamic args");
  assert.match(r.warnings[0].kind, /dynamic/i);
});

test("scanForMcpUsage: useMcpProvider literal detection", () => {
  const r = scanForMcpUsage({
    files: {
      "src/Widget.js": `
        const { callTool } = useMcpProvider("github");
        callTool("get_issues", {});
      `,
    },
  });
  // useMcpProvider takes provider type, not server name; tools detected
  // via callTool come without server context here.
  assert.ok(r.servers.github, "github server detected via useMcpProvider");
});

test("scanForMcpUsage: dedupes repeated tool names across files", () => {
  const r = scanForMcpUsage({
    files: {
      "src/A.js": `mainApi.mcp.callTool("filesystem", "read_file", {});`,
      "src/B.js": `mainApi.mcp.callTool("filesystem", "read_file", {});`,
    },
  });
  assert.deepStrictEqual(r.servers.filesystem.tools, ["read_file"]);
});

test("scanForMcpUsage: ignores files outside .js/.jsx/.ts/.tsx", () => {
  const r = scanForMcpUsage({
    files: {
      "README.md": `mainApi.mcp.callTool("filesystem", "read_file", {});`,
      "package.json": `{"name":"@trops/x"}`,
      "src/Widget.js": `mainApi.mcp.callTool("github", "search_repositories", {});`,
    },
  });
  assert.ok(!r.servers.filesystem, "markdown should not be scanned");
  assert.ok(r.servers.github, "js source should be scanned");
});

test("scanForMcpUsage: empty input returns empty result without throwing", () => {
  assert.deepStrictEqual(scanForMcpUsage({ files: {} }), {
    servers: {},
    warnings: [],
  });
});

test("scanForMcpUsage: malformed input doesn't throw", () => {
  assert.doesNotThrow(() => scanForMcpUsage(null));
  assert.doesNotThrow(() => scanForMcpUsage({}));
  assert.doesNotThrow(() => scanForMcpUsage({ files: null }));
});

test("scanForMcpUsage: handles tool names with whitespace and quotes", () => {
  const r = scanForMcpUsage({
    files: {
      "src/Widget.js": `
        mainApi.mcp.callTool(  "filesystem"  ,  "read_file"  , {});
        mainApi.mcp.callTool('github', 'list_issues', {});
      `,
    },
  });
  assert.ok(r.servers.filesystem.tools.includes("read_file"));
  assert.ok(r.servers.github.tools.includes("list_issues"));
});

test("scanForMcpUsage: idempotent — same input produces same output", () => {
  const input = {
    files: {
      "src/Widget.js": `mainApi.mcp.callTool("filesystem", "read_file", {});`,
    },
  };
  const a = scanForMcpUsage(input);
  const b = scanForMcpUsage(input);
  assert.deepStrictEqual(a, b);
});
