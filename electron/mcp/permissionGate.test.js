/**
 * permissionGate.test.js
 *
 * Pins the per-widget MCP gating logic. Each test exercises one
 * decision point: tool-name allowlist hit/miss, path containment
 * pass/fail, and read-vs-write tool classification. The gate is the
 * runtime enforcement boundary; if any of these tests stops passing,
 * widgets can call tools or paths their manifests don't authorize.
 *
 * Run with `node --test electron/mcp/permissionGate.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Mock electron's `app.getPath` before requiring modules under test.
const Module = require("node:module");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "perm-gate-test-"));
const fakeElectron = {
  app: {
    getPath: (key) => {
      if (key === "userData") return path.join(tmpRoot, "userData");
      if (key === "downloads") return path.join(tmpRoot, "Downloads");
      throw new Error("unknown path key: " + key);
    },
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_perm_gate__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_perm_gate__"] = {
  id: "__stub_electron_perm_gate__",
  filename: "__stub_electron_perm_gate__",
  loaded: true,
  exports: fakeElectron,
};

const { gateToolCall, isWriteTool } = require("./permissionGate");
const { clearCache } = require("./widgetPermissions");

// Helper: install a fake widget under userData/widgets/ with the
// supplied package.json contents.
function installFakeWidget(widgetId, pkgJson) {
  const parts = widgetId.startsWith("@") ? widgetId.split("/") : [widgetId];
  const dir = path.join(tmpRoot, "userData", "widgets", ...parts);
  fs.mkdirSync(dir, { recursive: true });
  const allowedRoot = path.join(tmpRoot, "userData", "data");
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(pkgJson, null, 2),
  );
  clearCache();
  return { dir, allowedRoot };
}

test("allow: tool in allowlist, no path arg", () => {
  installFakeWidget("@trops/widget-a", {
    name: "@trops/widget-a",
    dash: {
      permissions: {
        mcp: {
          github: { tools: ["search_repositories"] },
        },
      },
    },
  });
  const r = gateToolCall({
    widgetId: "@trops/widget-a",
    serverName: "github",
    toolName: "search_repositories",
    args: { query: "rust" },
  });
  assert.deepStrictEqual(r, { allow: true });
});

test("deny: widget has no manifest", () => {
  clearCache();
  const r = gateToolCall({
    widgetId: "@trops/no-manifest",
    serverName: "github",
    toolName: "search_repositories",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no MCP permission manifest/i);
});

test("deny: missing widgetId", () => {
  const r = gateToolCall({
    widgetId: "",
    serverName: "github",
    toolName: "x",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /widgetId/i);
});

test("deny: tool name not in allowlist", () => {
  installFakeWidget("@trops/widget-b", {
    name: "@trops/widget-b",
    dash: {
      permissions: {
        mcp: { github: { tools: ["search_repositories"] } },
      },
    },
  });
  const r = gateToolCall({
    widgetId: "@trops/widget-b",
    serverName: "github",
    toolName: "delete_repo",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /not in the allowlist/i);
});

test("deny: server not declared", () => {
  installFakeWidget("@trops/widget-c", {
    name: "@trops/widget-c",
    dash: {
      permissions: { mcp: { github: { tools: ["x"] } } },
    },
  });
  const r = gateToolCall({
    widgetId: "@trops/widget-c",
    serverName: "filesystem",
    toolName: "read_file",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /not authorized to call/i);
});

test("allow: read tool with path inside readPaths", () => {
  const { allowedRoot } = installFakeWidget("@trops/widget-d", {
    name: "@trops/widget-d",
    dash: {
      permissions: {
        mcp: {
          filesystem: {
            tools: ["read_file"],
            readPaths: [path.join(tmpRoot, "userData", "data")],
          },
        },
      },
    },
  });
  const insideFile = path.join(allowedRoot, "ok.txt");
  fs.writeFileSync(insideFile, "hi");
  const r = gateToolCall({
    widgetId: "@trops/widget-d",
    serverName: "filesystem",
    toolName: "read_file",
    args: { path: insideFile },
  });
  assert.deepStrictEqual(r, { allow: true });
});

test("deny: read tool with path outside readPaths", () => {
  installFakeWidget("@trops/widget-e", {
    name: "@trops/widget-e",
    dash: {
      permissions: {
        mcp: {
          filesystem: {
            tools: ["read_file"],
            readPaths: [path.join(tmpRoot, "userData", "data")],
          },
        },
      },
    },
  });
  const r = gateToolCall({
    widgetId: "@trops/widget-e",
    serverName: "filesystem",
    toolName: "read_file",
    args: { path: "/etc/passwd" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /path argument.*rejected/i);
});

test("deny: write tool when only readPaths declared", () => {
  installFakeWidget("@trops/widget-f", {
    name: "@trops/widget-f",
    dash: {
      permissions: {
        mcp: {
          filesystem: {
            tools: ["write_file"],
            readPaths: [path.join(tmpRoot, "userData", "data")],
            writePaths: [],
          },
        },
      },
    },
  });
  const insideFile = path.join(tmpRoot, "userData", "data", "x.txt");
  const r = gateToolCall({
    widgetId: "@trops/widget-f",
    serverName: "filesystem",
    toolName: "write_file",
    args: { path: insideFile },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no writePaths declared/i);
});

test("allow: write tool when path inside writePaths", () => {
  const { allowedRoot } = installFakeWidget("@trops/widget-g", {
    name: "@trops/widget-g",
    dash: {
      permissions: {
        mcp: {
          filesystem: {
            tools: ["write_file"],
            readPaths: [],
            writePaths: [path.join(tmpRoot, "userData", "data")],
          },
        },
      },
    },
  });
  const insideFile = path.join(allowedRoot, "out.txt");
  const r = gateToolCall({
    widgetId: "@trops/widget-g",
    serverName: "filesystem",
    toolName: "write_file",
    args: { path: insideFile },
  });
  assert.deepStrictEqual(r, { allow: true });
});

test("write-tool classification covers common write verb patterns", () => {
  const writeNames = [
    "write_file",
    "create_directory",
    "edit_file",
    "delete_file",
    "remove_file",
    "append_text",
    "move_file",
    "rename_file",
  ];
  for (const n of writeNames) {
    assert.strictEqual(
      isWriteTool(n),
      true,
      `expected ${n} to be classified as write`,
    );
  }
  const readNames = ["read_file", "list_directory", "get_file_info"];
  for (const n of readNames) {
    assert.strictEqual(
      isWriteTool(n),
      false,
      `expected ${n} to be classified as read`,
    );
  }
});

test("path arg under tilde-expanded path resolves correctly", () => {
  // We can't easily test ~ expansion against real homedir in a
  // tmp-fs-only test, but we can verify the parser handles ~ at
  // parse time by checking expandHome via re-exported util.
  const { expandHome } = require("./widgetPermissions");
  const expanded = expandHome("~/Documents/notes");
  assert.ok(
    expanded.startsWith(os.homedir()),
    "expected expanded path to start with homedir, got: " + expanded,
  );
  assert.ok(expanded.endsWith(path.join("Documents", "notes")));
});
