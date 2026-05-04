/**
 * mcpServerKey.test.js
 *
 * Pins the compound-key helper used by mcpController to scope MCP
 * server instances per (workspaceId, serverName). Slice 3a's process
 * isolation hinges on this — if the helper drifts, two workspaces
 * accidentally share a server process again.
 *
 * Run: `node --test electron/utils/mcpServerKey.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { serverKey, parseServerKey, NO_WORKSPACE } = require("./mcpServerKey");

test("serverKey: workspaceId + serverName produces a compound string", () => {
  assert.strictEqual(
    serverKey("workspace-abc", "filesystem"),
    "workspace-abc::filesystem",
  );
});

test("serverKey: distinct workspaces yield distinct keys for the same server", () => {
  const a = serverKey("workspace-a", "filesystem");
  const b = serverKey("workspace-b", "filesystem");
  assert.notStrictEqual(a, b);
});

test("serverKey: null/undefined workspaceId falls back to NO_WORKSPACE sentinel", () => {
  assert.strictEqual(
    serverKey(null, "filesystem"),
    NO_WORKSPACE + "::filesystem",
  );
  assert.strictEqual(
    serverKey(undefined, "filesystem"),
    NO_WORKSPACE + "::filesystem",
  );
  assert.strictEqual(
    serverKey("", "filesystem"),
    NO_WORKSPACE + "::filesystem",
  );
});

test("serverKey: missing serverName throws — there's no useful default", () => {
  assert.throws(() => serverKey("workspace-a", ""));
  assert.throws(() => serverKey("workspace-a", null));
  assert.throws(() => serverKey("workspace-a", undefined));
});

test("parseServerKey: round-trips a compound key", () => {
  const key = serverKey("workspace-x", "github");
  assert.deepStrictEqual(parseServerKey(key), {
    workspaceId: "workspace-x",
    serverName: "github",
  });
});

test("parseServerKey: handles NO_WORKSPACE sentinel", () => {
  const key = serverKey(null, "filesystem");
  const parsed = parseServerKey(key);
  assert.strictEqual(parsed.workspaceId, NO_WORKSPACE);
  assert.strictEqual(parsed.serverName, "filesystem");
});

test("parseServerKey: serverName containing :: is preserved", () => {
  // Safety: workspaceId is the prefix up to the first '::', everything
  // else is the server name. Server names can include any character.
  const key = serverKey("workspace-y", "weird::server::name");
  assert.deepStrictEqual(parseServerKey(key), {
    workspaceId: "workspace-y",
    serverName: "weird::server::name",
  });
});

test("Slice 3a: two workspaces with the same server name produce distinct map entries", () => {
  // The use-case: dashboard A and dashboard B both use the filesystem
  // MCP server. Pre-Slice-3a they shared a process keyed by serverName
  // alone. After 3a, they each get their own process keyed by the
  // compound (workspaceId, serverName).
  const map = new Map();
  map.set(serverKey("dash-A", "filesystem"), "instance-A");
  map.set(serverKey("dash-B", "filesystem"), "instance-B");
  assert.strictEqual(map.size, 2);
  assert.strictEqual(map.get(serverKey("dash-A", "filesystem")), "instance-A");
  assert.strictEqual(map.get(serverKey("dash-B", "filesystem")), "instance-B");
});
