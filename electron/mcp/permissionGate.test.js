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

// Stub jitConsent.requestApproval BEFORE permissionGate is required so the
// JIT-flow tests can drive the renderer-decision side without touching real
// IPC. Tests assign a function to `__mockApproval` per-case; default rejects
// to make accidental escalation visible.
let __mockApproval = (_req, _opts) => {
  throw new Error("__mockApproval was called but the test didn't set one");
};
const jitConsentPath = require.resolve("./jitConsent");
require.cache[jitConsentPath] = {
  id: jitConsentPath,
  filename: jitConsentPath,
  loaded: true,
  exports: {
    requestApproval: (req, opts) => __mockApproval(req, opts),
  },
};

const {
  gateToolCall,
  gateToolCallWithJit,
  isWriteTool,
} = require("./permissionGate");
const { parseManifestPermissions, clearCache } = require("./widgetPermissions");
const {
  setGrant,
  getGrant,
  revokeGrant,
  clearCache: clearGrantCache,
} = require("./grantedPermissions");

// Helper: install a fake widget under userData/widgets/ with the supplied
// package.json contents AND (by default) a matching grant — so each
// existing test exercises only its target decision point (allowlist hit,
// path containment, etc.) without first having to model install consent.
//
// Pass `{ writeGrant: false }` to install the manifest WITHOUT a grant —
// used by the Slice-2 baseline test below to prove a declared manifest
// alone does not grant access.
function installFakeWidget(widgetId, pkgJson, opts = {}) {
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
  clearGrantCache();
  // Default: simulate the user having granted exactly what the manifest
  // declared. Slice 2 separates the two; existing tests still want the
  // happy path where consent matches the request.
  if (opts.writeGrant !== false) {
    const declared = parseManifestPermissions(pkgJson);
    if (declared) {
      revokeGrant(widgetId);
      setGrant(widgetId, declared);
    }
  }
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

test("deny: widget has no grant", () => {
  clearCache();
  clearGrantCache();
  const r = gateToolCall({
    widgetId: "@trops/no-grant",
    serverName: "github",
    toolName: "search_repositories",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no MCP permissions granted/i);
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

// Slice 2 — granted-vs-declared separation.
//
// Pre-Slice-2 the manifest was both the request AND the grant: declaring
// `dash.permissions.mcp` granted access. Slice 2 splits those: the manifest
// is just a request, and the gate enforces only what the user has actually
// granted via grantedPermissions (set at install consent time or in
// Settings → Privacy & Security). A widget with a manifest but no grant
// must be denied — fail-closed.
test("Slice 2: declared manifest alone does NOT grant access — user must consent", () => {
  // writeGrant: false → install manifest only, do NOT write a matching grant.
  // This is the post-install / pre-consent state.
  installFakeWidget(
    "@trops/widget-slice2-baseline",
    {
      name: "@trops/widget-slice2-baseline",
      dash: {
        permissions: {
          mcp: { github: { tools: ["search_repositories"] } },
        },
      },
    },
    { writeGrant: false },
  );
  const r = gateToolCall({
    widgetId: "@trops/widget-slice2-baseline",
    serverName: "github",
    toolName: "search_repositories",
    args: { query: "rust" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no MCP permissions granted/i);
});

// ---------------------------------------------------------------
// gateToolCallWithJit — structural escalation
//
// The JIT path used to grep the sync gate's denial-reason string to decide
// whether to escalate. That left two recoverable cases (server-not-in-grant,
// tool-not-in-grant) silently denied without prompting after the widget had
// any prior grant. The structural rewrite escalates whenever the requested
// tool isn't listed in the widget's grant for the requested server, and
// delegates to the sync gate otherwise. Tests below pin both halves.
// ---------------------------------------------------------------

const WID_JIT = "@trops/widget-jit-flow";

function setupJitWidget(initialGrant) {
  installFakeWidget(
    WID_JIT,
    {
      name: WID_JIT,
      dash: {
        permissions: {
          mcp: {
            "google-drive": { tools: ["search"] },
          },
        },
      },
    },
    { writeGrant: false },
  );
  if (initialGrant) {
    setGrant(WID_JIT, initialGrant);
  }
}

test("JIT escalates: widget has no grant at all", async () => {
  setupJitWidget(null);
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        servers: {
          "google-drive": { tools: ["search"], readPaths: [], writePaths: [] },
        },
      },
    };
  };
  const r = await gateToolCallWithJit(
    {
      widgetId: WID_JIT,
      serverName: "google-drive",
      toolName: "search",
      args: { query: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("JIT escalates: server not in grant (recoverable, was silently denied)", async () => {
  setupJitWidget({
    grantOrigin: "live",
    servers: {
      "other-server": { tools: ["search"], readPaths: [], writePaths: [] },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        servers: {
          "google-drive": { tools: ["search"], readPaths: [], writePaths: [] },
        },
      },
    };
  };
  const r = await gateToolCallWithJit(
    {
      widgetId: WID_JIT,
      serverName: "google-drive",
      toolName: "search",
      args: { query: "x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("JIT escalates: tool not in server's allowlist (recoverable, was silently denied)", async () => {
  setupJitWidget({
    grantOrigin: "live",
    servers: {
      "google-drive": {
        tools: ["search"],
        readPaths: [],
        writePaths: [],
      },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        servers: {
          "google-drive": {
            tools: ["list_folder"],
            readPaths: [],
            writePaths: [],
          },
        },
      },
    };
  };
  const r = await gateToolCallWithJit(
    {
      widgetId: WID_JIT,
      serverName: "google-drive",
      toolName: "list_folder",
      args: {},
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, true);
  assert.strictEqual(r.allow, true);
});

test("JIT does NOT escalate: tool IS in grant but path arg traversal — security-critical", async () => {
  setupJitWidget({
    grantOrigin: "live",
    servers: {
      "google-drive": {
        tools: ["read_file"],
        readPaths: ["/safe/dir"],
        writePaths: [],
      },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateToolCallWithJit(
    {
      widgetId: WID_JIT,
      serverName: "google-drive",
      toolName: "read_file",
      args: { path: "/safe/dir/../etc/passwd" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

test("JIT does NOT escalate: tool IS in grant but no paths declared (path-arg gap)", async () => {
  // Known friction: tool is granted but the user never declared any paths
  // for that server. Sync gate denies. JIT does not prompt in this slice
  // (would require path-picker UX in the modal — separate slice).
  setupJitWidget({
    grantOrigin: "live",
    servers: {
      "google-drive": {
        tools: ["read_file"],
        readPaths: [],
        writePaths: [],
      },
    },
  });
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateToolCallWithJit(
    {
      widgetId: WID_JIT,
      serverName: "google-drive",
      toolName: "read_file",
      args: { path: "/anywhere" },
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

test("JIT does NOT escalate: unknown mount token — identity not verifiable", async () => {
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateToolCallWithJit(
    {
      token: "bogus-token-not-in-registry",
      serverName: "google-drive",
      toolName: "search",
      args: {},
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /unknown mount token/i);
});

test("JIT does NOT escalate: no widgetId and no token — caller bug", async () => {
  let approvalCalled = false;
  __mockApproval = async () => {
    approvalCalled = true;
    return { approve: true };
  };
  const r = await gateToolCallWithJit(
    {
      serverName: "google-drive",
      toolName: "search",
      args: {},
    },
    { enableJit: true },
  );
  assert.strictEqual(approvalCalled, false);
  assert.strictEqual(r.allow, false);
});

// ---- package-scope sibling batch grant (slice 5) ----------------------
//
// Resolved siblings are passed to requestApproval in the request
// payload (modal renders the checkbox). On approval, the gate writes
// the same merged grant to every sibling iff `decision.applyToSiblings`
// is true. Each sibling's existing grant is preserved (merge, not
// clobber).

const SIBLINGS_REGISTRY = new Map([
  [
    "@trops/sibtest",
    {
      packageId: "@trops/sibtest",
      componentNames: ["WidgetA", "WidgetB", "WidgetC"],
    },
  ],
]);

function setupSibTestWidget(name) {
  installFakeWidget(
    "trops.sibtest." + name,
    { name: "trops.sibtest." + name },
    { writeGrant: false },
  );
  // Sibling tests share ids — explicitly revoke A/B/C so state from a
  // prior `applyToSiblings: true` test doesn't leak into the next one.
  for (const sib of ["WidgetA", "WidgetB", "WidgetC"]) {
    revokeGrant("trops.sibtest." + sib);
  }
}

test("JIT request payload carries packageId + siblingWidgetIds", async () => {
  setupSibTestWidget("WidgetA");
  let received = null;
  __mockApproval = async (req) => {
    received = req;
    return {
      approve: true,
      granted: {
        grantOrigin: "live",
        servers: { srv: { tools: ["t"], readPaths: [], writePaths: [] } },
      },
    };
  };
  await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  assert.strictEqual(received.packageId, "@trops/sibtest");
  assert.deepStrictEqual(received.siblingWidgetIds, [
    "trops.sibtest.WidgetA",
    "trops.sibtest.WidgetB",
    "trops.sibtest.WidgetC",
  ]);
});

test("applyToSiblings: true → grant written to every sibling", async () => {
  setupSibTestWidget("WidgetA");
  __mockApproval = async () => ({
    approve: true,
    applyToSiblings: true,
    granted: {
      grantOrigin: "live",
      servers: { srv: { tools: ["t"], readPaths: [], writePaths: [] } },
    },
  });
  const r = await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  assert.strictEqual(r.allow, true);
  // Each sibling now has the grant.
  for (const id of [
    "trops.sibtest.WidgetA",
    "trops.sibtest.WidgetB",
    "trops.sibtest.WidgetC",
  ]) {
    const g = getGrant(id);
    assert.ok(g, "expected grant for " + id);
    assert.deepStrictEqual(g.servers.srv.tools, ["t"]);
  }
});

test("applyToSiblings: false → only requesting widget gets the grant", async () => {
  setupSibTestWidget("WidgetA");
  __mockApproval = async () => ({
    approve: true,
    applyToSiblings: false,
    granted: {
      grantOrigin: "live",
      servers: { srv: { tools: ["t"], readPaths: [], writePaths: [] } },
    },
  });
  await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  assert.ok(getGrant("trops.sibtest.WidgetA"));
  assert.strictEqual(getGrant("trops.sibtest.WidgetB"), null);
  assert.strictEqual(getGrant("trops.sibtest.WidgetC"), null);
});

test("applyToSiblings: true preserves siblings' existing grants on other servers", async () => {
  setupSibTestWidget("WidgetA");
  // Pre-existing grant on WidgetB for a DIFFERENT server.
  setGrant("trops.sibtest.WidgetB", {
    grantOrigin: "manual",
    servers: {
      "other-server": { tools: ["other-tool"], readPaths: [], writePaths: [] },
    },
  });
  __mockApproval = async () => ({
    approve: true,
    applyToSiblings: true,
    granted: {
      grantOrigin: "live",
      servers: {
        "google-drive": { tools: ["search"], readPaths: [], writePaths: [] },
      },
    },
  });
  await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "google-drive",
      toolName: "search",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  // WidgetB now has BOTH grants — the prior one wasn't clobbered.
  const b = getGrant("trops.sibtest.WidgetB");
  assert.deepStrictEqual(b.servers["other-server"].tools, ["other-tool"]);
  assert.deepStrictEqual(b.servers["google-drive"].tools, ["search"]);
});

test("applyToSiblings: true with deny → no grants written anywhere", async () => {
  setupSibTestWidget("WidgetA");
  __mockApproval = async () => ({ approve: false, applyToSiblings: true });
  const r = await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  assert.strictEqual(r.allow, false);
  assert.strictEqual(getGrant("trops.sibtest.WidgetA"), null);
  assert.strictEqual(getGrant("trops.sibtest.WidgetB"), null);
  assert.strictEqual(getGrant("trops.sibtest.WidgetC"), null);
});

// ─── per-component sibling filter: grants only land on widgets that
//     actually declare the granted tool ──

/**
 * Install a multi-widget package shipping a `mcpByComponent` block.
 * The package's three widgets each declare a different server, so
 * the sibling filter can distinguish them at gate time.
 */
function installSibtestPackageWithPerComponentManifest() {
  const dir = path.join(tmpRoot, "userData", "widgets", "@trops", "sibtest");
  fs.mkdirSync(dir, { recursive: true });
  const pkgJson = {
    name: "@trops/sibtest",
    version: "1.0.0",
    dash: {
      permissions: {
        // Package-level union — back-compat path the gate doesn't
        // need to consult once mcpByComponent is present.
        mcp: {
          srv: { tools: ["t"] },
          other: { tools: ["other-tool"] },
        },
        mcpByComponent: {
          WidgetA: { servers: { srv: { tools: ["t"] } } },
          WidgetB: { servers: { other: { tools: ["other-tool"] } } },
          // WidgetC declares NOTHING — pure UI widget in the same
          // package. Sibling filter must skip it for srv/t grants.
        },
      },
    },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkgJson));
  clearCache();
  clearGrantCache();
  for (const sib of ["WidgetA", "WidgetB", "WidgetC"]) {
    revokeGrant("trops.sibtest." + sib);
  }
}

test("applyToSiblings: per-component filter — grants ONLY fan out to siblings whose manifest declares the tool", () => {
  // The regression we just shipped: previously the gate wrote the
  // grant to every sibling in the package regardless of whether
  // that sibling's component declared the tool. A Counter widget
  // sitting next to a GoogleDrive widget would inherit the GDrive
  // grant because they share a package. With per-component
  // declarations, the grant lands only on siblings that actually
  // use the tool — plus the originating widget always (its runtime
  // call IS proof of use even if the manifest hasn't been
  // re-scanned).
  installSibtestPackageWithPerComponentManifest();
  __mockApproval = async () => ({
    approve: true,
    applyToSiblings: true,
    granted: {
      grantOrigin: "live",
      servers: { srv: { tools: ["t"], readPaths: [], writePaths: [] } },
    },
  });
  return gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  ).then((r) => {
    assert.strictEqual(r.allow, true);
    // WidgetA: originating widget → always gets the grant.
    assert.ok(
      getGrant("trops.sibtest.WidgetA"),
      "WidgetA (originator) must always have the grant",
    );
    // WidgetB: declares 'other' server, NOT 'srv'/'t' → must be
    // skipped by the filter.
    assert.strictEqual(
      getGrant("trops.sibtest.WidgetB"),
      null,
      "WidgetB declares a different server — must NOT get an srv/t grant",
    );
    // WidgetC: declares nothing at all → must be skipped.
    assert.strictEqual(
      getGrant("trops.sibtest.WidgetC"),
      null,
      "WidgetC declares nothing — must NOT get an srv/t grant",
    );
  });
});

test("applyToSiblings: per-component filter — modal sees the FILTERED sibling list, not the full package", async () => {
  // The "Apply to all N widgets" checkbox count must reflect the
  // applicable subset, not the package total. Otherwise the user
  // is offered "Apply to all 10" when only 3 would actually
  // receive the grant.
  installSibtestPackageWithPerComponentManifest();
  let received = null;
  __mockApproval = async (req) => {
    received = req;
    return { approve: false };
  };
  await gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  );
  // Modal received only WidgetA (the only sibling whose
  // mcpByComponent declares srv/t).
  assert.deepStrictEqual(received.siblingWidgetIds, ["trops.sibtest.WidgetA"]);
});

test("applyToSiblings: back-compat — package without mcpByComponent falls back to full sibling list", () => {
  // A widget package that hasn't been re-scanned with the new
  // per-component scanner. The filter must fall through to the
  // unfiltered sibling list to preserve the pre-existing UX —
  // otherwise users upgrading dash-core would suddenly lose
  // "Apply to all in package" for every existing package.
  //
  // The previous sibling-filter test wrote an @trops/sibtest
  // package.json with mcpByComponent. We're testing the
  // no-mcpByComponent path here, so we explicitly clear that file
  // before running. Cache clear ensures `getWidgetMcpPermissions`
  // re-reads the now-absent file.
  const stalePkgDir = path.join(
    tmpRoot,
    "userData",
    "widgets",
    "@trops",
    "sibtest",
  );
  if (fs.existsSync(stalePkgDir)) {
    fs.rmSync(stalePkgDir, { recursive: true, force: true });
  }
  clearCache();
  for (const sib of ["WidgetA", "WidgetB", "WidgetC"]) {
    setupSibTestWidget(sib);
  }
  __mockApproval = async () => ({
    approve: true,
    applyToSiblings: true,
    granted: {
      grantOrigin: "live",
      servers: { srv: { tools: ["t"], readPaths: [], writePaths: [] } },
    },
  });
  return gateToolCallWithJit(
    {
      widgetId: "trops.sibtest.WidgetA",
      serverName: "srv",
      toolName: "t",
      args: {},
    },
    { enableJit: true, getRegistrySnapshot: () => SIBLINGS_REGISTRY },
  ).then(() => {
    // No per-component data → all 3 siblings get the grant
    // (preserves the previous behavior).
    assert.ok(getGrant("trops.sibtest.WidgetA"));
    assert.ok(getGrant("trops.sibtest.WidgetB"));
    assert.ok(getGrant("trops.sibtest.WidgetC"));
  });
});
