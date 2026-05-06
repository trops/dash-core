/**
 * grantDiff.test.js
 *
 * Pins for `isBroadening(currentGrant, newGrant)`. Used by the
 * widget-mcp:set-grant handler to decide whether to gate the change
 * behind an OS-native confirmation dialog. A broadening change is
 * any addition of a server, tool, path, host, or `*` wildcard not
 * already present in the current grant. Reductions, equality, and
 * narrowing changes pass through without prompting.
 *
 * The pure-function shape lets us test every dimension cheaply.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { isBroadening } = require("./grantDiff");

test("null/undefined current + non-empty new → broadening", () => {
  const r = isBroadening(null, {
    servers: { fs: { tools: ["read_file"] } },
  });
  assert.strictEqual(r.broadening, true);
  assert.ok(r.summary.length > 0);
});

test("equal grants → not broadening", () => {
  const g = { servers: { fs: { tools: ["read_file"], readPaths: ["/x"] } } };
  const r = isBroadening(g, JSON.parse(JSON.stringify(g)));
  assert.strictEqual(r.broadening, false);
});

test("removing a tool → not broadening (narrowing)", () => {
  const cur = { servers: { fs: { tools: ["read_file", "write_file"] } } };
  const next = { servers: { fs: { tools: ["read_file"] } } };
  assert.strictEqual(isBroadening(cur, next).broadening, false);
});

test("adding a new server → broadening", () => {
  const cur = { servers: { fs: { tools: ["read_file"] } } };
  const next = {
    servers: {
      fs: { tools: ["read_file"] },
      github: { tools: ["search_repositories"] },
    },
  };
  const r = isBroadening(cur, next);
  assert.strictEqual(r.broadening, true);
  assert.ok(r.summary.some((s) => /github/.test(s)));
});

test("adding a tool to existing server → broadening", () => {
  const cur = { servers: { fs: { tools: ["read_file"] } } };
  const next = { servers: { fs: { tools: ["read_file", "write_file"] } } };
  const r = isBroadening(cur, next);
  assert.strictEqual(r.broadening, true);
  assert.ok(r.summary.some((s) => /write_file/.test(s)));
});

test("adding a readPath to existing server → broadening", () => {
  const cur = { servers: { fs: { tools: ["read_file"], readPaths: ["/a"] } } };
  const next = {
    servers: { fs: { tools: ["read_file"], readPaths: ["/a", "/b"] } },
  };
  assert.strictEqual(isBroadening(cur, next).broadening, true);
});

test("adding * wildcard to a path list → broadening", () => {
  const cur = { servers: { fs: { tools: ["read_file"], readPaths: ["/a"] } } };
  const next = {
    servers: { fs: { tools: ["read_file"], readPaths: ["/a", "*"] } },
  };
  const r = isBroadening(cur, next);
  assert.strictEqual(r.broadening, true);
  assert.ok(r.summary.some((s) => /\*/.test(s)));
});

test("adding a domains.fs block from scratch → broadening", () => {
  const cur = { servers: {} };
  const next = {
    servers: {},
    domains: { fs: { readPaths: ["x.json"], writePaths: [] } },
  };
  assert.strictEqual(isBroadening(cur, next).broadening, true);
});

test("adding a host to domains.network → broadening", () => {
  const cur = {
    servers: {},
    domains: { network: { hosts: ["api.example.com"] } },
  };
  const next = {
    servers: {},
    domains: { network: { hosts: ["api.example.com", "evil.example.com"] } },
  };
  const r = isBroadening(cur, next);
  assert.strictEqual(r.broadening, true);
  assert.ok(r.summary.some((s) => /evil\.example\.com/.test(s)));
});

test("removing a host from domains.network → not broadening", () => {
  const cur = {
    servers: {},
    domains: { network: { hosts: ["a.example.com", "b.example.com"] } },
  };
  const next = {
    servers: {},
    domains: { network: { hosts: ["a.example.com"] } },
  };
  assert.strictEqual(isBroadening(cur, next).broadening, false);
});

test("empty new grant after non-empty current → not broadening", () => {
  // Effectively a revoke-everything; not a broadening.
  const cur = { servers: { fs: { tools: ["read_file"] } } };
  const next = { servers: {} };
  assert.strictEqual(isBroadening(cur, next).broadening, false);
});

test("grantOrigin / extra fields don't trigger broadening on their own", () => {
  const cur = { servers: { fs: { tools: ["read_file"] } } };
  const next = {
    grantOrigin: "manual",
    servers: { fs: { tools: ["read_file"] } },
  };
  assert.strictEqual(isBroadening(cur, next).broadening, false);
});
