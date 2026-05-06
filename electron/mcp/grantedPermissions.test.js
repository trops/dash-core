/**
 * grantedPermissions.test.js
 *
 * Pins the storage layer for user-granted MCP permissions. The gate reads
 * from this layer at runtime; if these tests stop passing, grant
 * persistence (or its fail-closed semantics) has regressed.
 *
 * Run with `node --test electron/mcp/grantedPermissions.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Mock electron's `app.getPath` to point at a tmp dir before requiring
// the module under test.
const Module = require("node:module");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "granted-perms-test-"));
const fakeElectron = {
  app: {
    getPath: (key) => {
      if (key === "userData") return path.join(tmpRoot, "userData");
      throw new Error("unknown path key: " + key);
    },
  },
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_granted_perms__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_granted_perms__"] = {
  id: "__stub_electron_granted_perms__",
  filename: "__stub_electron_granted_perms__",
  loaded: true,
  exports: fakeElectron,
};

// Make sure userData dir exists so the writes have a place to land.
fs.mkdirSync(path.join(tmpRoot, "userData"), { recursive: true });

const {
  getGrant,
  setGrant,
  revokeGrant,
  revokeServer,
  listAllGrants,
  clearCache,
} = require("./grantedPermissions");

// Helper: clear cache + delete the on-disk file before each test so cases
// don't bleed into each other.
function resetState() {
  clearCache();
  const p = path.join(tmpRoot, "userData", "widgetMcpGrants.json");
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

test("getGrant returns null for unknown widget", () => {
  resetState();
  assert.strictEqual(getGrant("@trops/unknown"), null);
});

test("setGrant + getGrant round-trip", () => {
  resetState();
  const perms = {
    servers: {
      filesystem: {
        tools: ["read_file"],
        readPaths: ["/tmp/notes"],
        writePaths: [],
      },
    },
  };
  assert.strictEqual(setGrant("@trops/widget-a", perms), true);
  const got = getGrant("@trops/widget-a");
  assert.deepStrictEqual(got, perms);
});

test("setGrant persists across cache clear (i.e. reads from disk)", () => {
  resetState();
  setGrant("@trops/widget-b", {
    servers: { github: { tools: ["search_repositories"] } },
  });
  clearCache();
  const got = getGrant("@trops/widget-b");
  assert.ok(got);
  assert.deepStrictEqual(got.servers.github.tools, ["search_repositories"]);
});

test("setGrant rejects malformed perms", () => {
  resetState();
  assert.strictEqual(setGrant("@trops/widget-c", null), false);
  assert.strictEqual(setGrant("@trops/widget-c", "nope"), false);
  assert.strictEqual(setGrant("@trops/widget-c", { servers: null }), false);
  assert.strictEqual(getGrant("@trops/widget-c"), null);
});

test("setGrant sanitizes unknown keys and bad arrays", () => {
  resetState();
  setGrant("@trops/widget-d", {
    servers: {
      fs: {
        tools: ["read_file", 42, null],
        readPaths: ["/tmp/ok", 123],
        writePaths: "not-an-array",
        unknownKey: "ignored",
      },
    },
    extraTopLevel: "ignored",
  });
  const got = getGrant("@trops/widget-d");
  assert.deepStrictEqual(got.servers.fs.tools, ["read_file"]);
  assert.deepStrictEqual(got.servers.fs.readPaths, ["/tmp/ok"]);
  assert.deepStrictEqual(got.servers.fs.writePaths, []);
  assert.ok(!("unknownKey" in got.servers.fs));
  assert.ok(!("extraTopLevel" in got));
});

test("revokeGrant removes the widget entirely", () => {
  resetState();
  setGrant("@trops/widget-e", {
    servers: { github: { tools: ["x"] } },
  });
  assert.strictEqual(revokeGrant("@trops/widget-e"), true);
  assert.strictEqual(getGrant("@trops/widget-e"), null);
});

test("revokeGrant returns false for unknown widget", () => {
  resetState();
  assert.strictEqual(revokeGrant("@trops/never-granted"), false);
});

test("revokeServer leaves other servers intact", () => {
  resetState();
  setGrant("@trops/widget-f", {
    servers: {
      github: { tools: ["x"] },
      filesystem: { tools: ["read_file"] },
    },
  });
  assert.strictEqual(revokeServer("@trops/widget-f", "github"), true);
  const got = getGrant("@trops/widget-f");
  assert.ok(got.servers.filesystem);
  assert.ok(!got.servers.github);
});

test("revokeServer returns false for unknown widget or server", () => {
  resetState();
  assert.strictEqual(revokeServer("@trops/nope", "github"), false);
  setGrant("@trops/widget-g", {
    servers: { github: { tools: ["x"] } },
  });
  assert.strictEqual(revokeServer("@trops/widget-g", "filesystem"), false);
});

test("listAllGrants returns every persisted entry", () => {
  resetState();
  setGrant("@trops/a", { servers: { github: { tools: ["x"] } } });
  setGrant("@trops/b", { servers: { filesystem: { tools: ["y"] } } });
  const all = listAllGrants();
  assert.strictEqual(all.length, 2);
  const ids = all.map((e) => e.widgetId).sort();
  assert.deepStrictEqual(ids, ["@trops/a", "@trops/b"]);
});

test("corrupted grants file is treated as empty (fail-closed)", () => {
  resetState();
  // Write garbage directly to the grants file to simulate corruption.
  const p = path.join(tmpRoot, "userData", "widgetMcpGrants.json");
  fs.writeFileSync(p, "{ this is not json", "utf8");
  clearCache();
  assert.strictEqual(getGrant("@trops/anything"), null);
  // Subsequent set must still work (overwrites the corrupted file).
  setGrant("@trops/recover", { servers: { github: { tools: ["x"] } } });
  assert.ok(getGrant("@trops/recover"));
});

// ---- grantOrigin tracking (scanner/manual-grant slice) -----------------

test("grantOrigin: setGrant + getGrant round-trips a declared grant", () => {
  resetState();
  setGrant("@trops/declared", {
    grantOrigin: "declared",
    servers: { github: { tools: ["x"] } },
  });
  const got = getGrant("@trops/declared");
  assert.strictEqual(got.grantOrigin, "declared");
});

test("grantOrigin: setGrant + getGrant round-trips a discovered grant", () => {
  resetState();
  setGrant("@trops/discovered", {
    grantOrigin: "discovered",
    servers: { filesystem: { tools: ["read_file"] } },
  });
  const got = getGrant("@trops/discovered");
  assert.strictEqual(got.grantOrigin, "discovered");
});

test("grantOrigin: setGrant + getGrant round-trips a manual grant", () => {
  resetState();
  setGrant("@trops/manual", {
    grantOrigin: "manual",
    servers: { filesystem: { tools: ["read_file"], readPaths: ["/x"] } },
  });
  const got = getGrant("@trops/manual");
  assert.strictEqual(got.grantOrigin, "manual");
});

test("grantOrigin: setGrant + getGrant round-trips a live (JIT) grant", () => {
  resetState();
  setGrant("@trops/jit", {
    grantOrigin: "live",
    servers: {
      filesystem: { tools: ["read_file"], readPaths: ["/Users/jane/notes.md"] },
    },
  });
  const got = getGrant("@trops/jit");
  assert.strictEqual(got.grantOrigin, "live");
});

test("grantOrigin: invalid origin is rejected (not silently dropped to a default)", () => {
  resetState();
  setGrant("@trops/bogus", {
    grantOrigin: "bogus-value",
    servers: { github: { tools: ["x"] } },
  });
  const got = getGrant("@trops/bogus");
  // The grant persists, but the bogus origin is dropped to null/missing
  assert.ok(got);
  assert.notStrictEqual(got.grantOrigin, "bogus-value");
});

test("grantOrigin: legacy grants without the field round-trip without crashing", () => {
  resetState();
  // Pre-feature grant: no grantOrigin
  setGrant("@trops/legacy", {
    servers: { github: { tools: ["x"] } },
  });
  const got = getGrant("@trops/legacy");
  assert.ok(got);
  // Field is absent or null — both are acceptable; consumers handle either
  assert.ok(got.grantOrigin == null);
});

// ---- domains.fs (Phase 2 JIT consent) ---------------------------------

test("domains.fs: setGrant + getGrant round-trips a fs grant alongside servers", () => {
  resetState();
  setGrant("@trops/multi-domain", {
    grantOrigin: "manual",
    servers: { github: { tools: ["search_repositories"] } },
    domains: {
      fs: {
        readPaths: ["data.json"],
        writePaths: ["out.json"],
      },
    },
  });
  const got = getGrant("@trops/multi-domain");
  assert.ok(got.servers.github);
  assert.ok(got.domains?.fs);
  assert.deepStrictEqual(got.domains.fs.readPaths, ["data.json"]);
  assert.deepStrictEqual(got.domains.fs.writePaths, ["out.json"]);
});

test("domains.fs: malformed fs entries are sanitized", () => {
  resetState();
  setGrant("@trops/bad-fs", {
    grantOrigin: "manual",
    domains: {
      fs: {
        readPaths: ["good", 42, null, "alsoGood"],
        writePaths: "not-an-array",
        unknownKey: "ignored",
      },
    },
  });
  const got = getGrant("@trops/bad-fs");
  assert.deepStrictEqual(got.domains.fs.readPaths, ["good", "alsoGood"]);
  assert.deepStrictEqual(got.domains.fs.writePaths, []);
  assert.ok(!("unknownKey" in got.domains.fs));
});

test("domains: pre-existing servers grant is preserved when domains added later", () => {
  resetState();
  // Slice 2 era: only servers
  setGrant("@trops/legacy-mcp", {
    grantOrigin: "declared",
    servers: { github: { tools: ["x"] } },
  });
  const before = getGrant("@trops/legacy-mcp");
  assert.ok(before.servers.github);
  assert.strictEqual(before.domains, undefined);
});

// ---- domains.network (Phase 3 JIT consent) ----------------------------

test("domains.network: setGrant + getGrant round-trips a network grant", () => {
  resetState();
  setGrant("@trops/net-widget", {
    grantOrigin: "manual",
    servers: {},
    domains: {
      network: {
        hosts: ["api.example.com", "*"],
      },
    },
  });
  const got = getGrant("@trops/net-widget");
  assert.ok(got.domains?.network);
  assert.deepStrictEqual(got.domains.network.hosts, ["api.example.com", "*"]);
});

test("domains.network: malformed entries are sanitized", () => {
  resetState();
  setGrant("@trops/bad-net", {
    grantOrigin: "manual",
    domains: {
      network: {
        hosts: ["good.example.com", 42, null, "also.example.com"],
      },
    },
  });
  const got = getGrant("@trops/bad-net");
  assert.deepStrictEqual(got.domains.network.hosts, [
    "good.example.com",
    "also.example.com",
  ]);
});

test("domains: fs and network coexist on the same grant", () => {
  resetState();
  setGrant("@trops/multi", {
    grantOrigin: "manual",
    servers: {},
    domains: {
      fs: { readPaths: ["a.json"], writePaths: [] },
      network: { hosts: ["api.example.com"] },
    },
  });
  const got = getGrant("@trops/multi");
  assert.deepStrictEqual(got.domains.fs.readPaths, ["a.json"]);
  assert.deepStrictEqual(got.domains.network.hosts, ["api.example.com"]);
});

// ---- per-action grant scoping (slice 4) ------------------------------
//
// Mirrors MCP's `tools[]` allowlist for fs and network. Without a
// persisted `actions[]` array the gate has no way to enforce
// per-action consent — it'd silently authorize every action in the
// read/write class against the same path scope. Pinning the round-
// trip here is the regression guard: a future sanitize change that
// drops the field re-introduces the bug.

test("domains.fs.actions: array of strings is round-tripped", () => {
  resetState();
  setGrant("@trops/fs-actions", {
    grantOrigin: "live",
    domains: {
      fs: {
        actions: ["saveData", "convertJsonToCsvFile"],
        readPaths: [],
        writePaths: ["/tmp/x"],
      },
    },
  });
  const got = getGrant("@trops/fs-actions");
  assert.deepStrictEqual(got.domains.fs.actions, [
    "saveData",
    "convertJsonToCsvFile",
  ]);
});

test("domains.fs.actions: non-string entries are dropped (defensive sanitize)", () => {
  resetState();
  setGrant("@trops/fs-bad-actions", {
    grantOrigin: "live",
    domains: {
      fs: {
        actions: ["saveData", 42, null, "transformFile"],
        readPaths: [],
        writePaths: ["/tmp/x"],
      },
    },
  });
  const got = getGrant("@trops/fs-bad-actions");
  assert.deepStrictEqual(got.domains.fs.actions, ["saveData", "transformFile"]);
});

test("domains.fs.actions: missing field is preserved as missing (legacy migration)", () => {
  // Option A: grants written before slice 4 omit `actions`. Sanitize
  // must not invent the field — gate logic uses absence as the legacy-
  // fallback signal ("any action allowed").
  resetState();
  setGrant("@trops/fs-legacy", {
    grantOrigin: "manual",
    domains: { fs: { readPaths: ["a.json"], writePaths: [] } },
  });
  const got = getGrant("@trops/fs-legacy");
  assert.ok(got.domains?.fs);
  assert.strictEqual(got.domains.fs.actions, undefined);
});

test("domains.network.actions: array of strings is round-tripped", () => {
  resetState();
  setGrant("@trops/net-actions", {
    grantOrigin: "live",
    domains: {
      network: {
        actions: ["readDataFromURL", "connect"],
        hosts: ["api.example.com"],
      },
    },
  });
  const got = getGrant("@trops/net-actions");
  assert.deepStrictEqual(got.domains.network.actions, [
    "readDataFromURL",
    "connect",
  ]);
});

test("domains.network.actions: missing field is preserved as missing (legacy migration)", () => {
  resetState();
  setGrant("@trops/net-legacy", {
    grantOrigin: "manual",
    domains: { network: { hosts: ["api.example.com"] } },
  });
  const got = getGrant("@trops/net-legacy");
  assert.ok(got.domains?.network);
  assert.strictEqual(got.domains.network.actions, undefined);
});
