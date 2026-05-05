/**
 * networkGate.test.js
 *
 * Pins for the Phase 3 network domain gate. Same shape as
 * fsGate.test.js — sync gateNetworkCall + async gateNetworkCallWithJit
 * + grant merge.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// Stub electron + the grants store so we can require the gate without
// an Electron process. The grants store reads/writes from
// app.getPath("userData") via electron-store; we replace it with an
// in-memory Map.
const Module = require("module");
const originalLoad = Module._load;

const grantStore = new Map();
const fakeGrantedPermissions = {
  getGrant: (widgetId) => grantStore.get(widgetId) || null,
  setGrant: (widgetId, perms) => {
    grantStore.set(widgetId, perms);
    return true;
  },
};

const jitDecisions = []; // queue of (req) → decision functions
let jitFailNext = false;
const fakeJitConsent = {
  requestApproval: async (req) => {
    if (jitFailNext) {
      jitFailNext = false;
      throw new Error("test-jit-failure");
    }
    if (jitDecisions.length === 0) {
      throw new Error("no jit decision queued for: " + JSON.stringify(req));
    }
    return jitDecisions.shift()(req);
  },
};

Module._load = function (request, parent, ...rest) {
  if (request === "../mcp/grantedPermissions") return fakeGrantedPermissions;
  if (request === "../mcp/jitConsent") return fakeJitConsent;
  return originalLoad.call(this, request, parent, ...rest);
};

delete require.cache[require.resolve("./networkGate")];
const networkGate = require("./networkGate");
Module._load = originalLoad;

function reset() {
  grantStore.clear();
  jitDecisions.length = 0;
  jitFailNext = false;
}

test("gateNetworkCall: missing widgetId → deny", () => {
  reset();
  const r = networkGate.gateNetworkCall({
    widgetId: null,
    action: "readDataFromURL",
    args: { url: "https://api.example.com/x" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /widgetId/);
});

test("gateNetworkCall: missing url in args → deny", () => {
  reset();
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: {},
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /url/);
});

test("gateNetworkCall: malformed url → deny synchronously (no JIT)", () => {
  reset();
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: { url: "not-a-url" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /malformed/i);
});

test("gateNetworkCall: no grant → deny with the no-grant reason", () => {
  reset();
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: { url: "https://api.example.com/x" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /no network permissions granted/i);
});

test("gateNetworkCall: grant matches host → allow", () => {
  reset();
  fakeGrantedPermissions.setGrant("@e2e/foo", {
    grantOrigin: "manual",
    servers: {},
    domains: { network: { hosts: ["api.example.com"] } },
  });
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: { url: "https://api.example.com/some/path?x=1" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateNetworkCall: grant does not match host → deny", () => {
  reset();
  fakeGrantedPermissions.setGrant("@e2e/foo", {
    grantOrigin: "manual",
    servers: {},
    domains: { network: { hosts: ["api.example.com"] } },
  });
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: { url: "https://attacker.example.org/x" },
  });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /attacker\.example\.org|not in/i);
});

test("gateNetworkCall: '*' wildcard in hosts → allow any host", () => {
  reset();
  fakeGrantedPermissions.setGrant("@e2e/foo", {
    grantOrigin: "manual",
    servers: {},
    domains: { network: { hosts: ["*"] } },
  });
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "wsConnect",
    args: { url: "wss://anything.example.org/" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateNetworkCall: case-insensitive host match", () => {
  reset();
  fakeGrantedPermissions.setGrant("@e2e/foo", {
    grantOrigin: "manual",
    servers: {},
    domains: { network: { hosts: ["API.EXAMPLE.COM"] } },
  });
  const r = networkGate.gateNetworkCall({
    widgetId: "@e2e/foo",
    action: "readDataFromURL",
    args: { url: "https://api.example.com/x" },
  });
  assert.strictEqual(r.allow, true);
});

test("gateNetworkCallWithJit: deny + JIT off → no escalation", async () => {
  reset();
  const r = await networkGate.gateNetworkCallWithJit(
    {
      widgetId: "@e2e/foo",
      action: "readDataFromURL",
      args: { url: "https://api.example.com/x" },
    },
    { enableJit: false },
  );
  assert.strictEqual(r.allow, false);
});

test("gateNetworkCallWithJit: no-grant deny + JIT on + approve → grant persists, retry allows", async () => {
  reset();
  jitDecisions.push(() => ({
    approve: true,
    granted: {
      grantOrigin: "live",
      domains: { network: { hosts: ["api.example.com"] } },
    },
  }));
  const r = await networkGate.gateNetworkCallWithJit(
    {
      widgetId: "@e2e/foo",
      action: "readDataFromURL",
      args: { url: "https://api.example.com/x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(r.allow, true);
  const persisted = fakeGrantedPermissions.getGrant("@e2e/foo");
  assert.deepStrictEqual(persisted.domains.network.hosts, ["api.example.com"]);
  assert.strictEqual(persisted.grantOrigin, "live");
});

test("gateNetworkCallWithJit: deny + JIT on + user declines → final deny", async () => {
  reset();
  jitDecisions.push(() => ({ approve: false }));
  const r = await networkGate.gateNetworkCallWithJit(
    {
      widgetId: "@e2e/foo",
      action: "readDataFromURL",
      args: { url: "https://api.example.com/x" },
    },
    { enableJit: true },
  );
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /declined/i);
});

test("gateNetworkCallWithJit: malformed url denial does NOT escalate to JIT", async () => {
  reset();
  // No decision queued — if JIT fired, requestApproval would throw.
  const r = await networkGate.gateNetworkCallWithJit(
    {
      widgetId: "@e2e/foo",
      action: "readDataFromURL",
      args: { url: "not-a-url" },
    },
    { enableJit: true },
  );
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /malformed/i);
});
