/**
 * memoryTools.test.js — in-process memory_* tools (P1: FR-010).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { BotMemory } = require("./BotMemory");
const {
  MEMORY_SERVER,
  MEMORY_TOOLS,
  handleMemoryTool,
} = require("./memoryTools");

function newMemory() {
  let blob = { scopes: {} };
  return new BotMemory({
    persistence: { read: () => blob, write: (o) => (blob = o) },
  });
}

describe("memoryTools", () => {
  it("exposes four tools under the bot-memory server", () => {
    assert.equal(MEMORY_SERVER, "bot-memory");
    assert.deepEqual(MEMORY_TOOLS.map((t) => t.name).sort(), [
      "memory_delete",
      "memory_get",
      "memory_list",
      "memory_set",
    ]);
    for (const t of MEMORY_TOOLS) assert.ok(t.inputSchema.type === "object");
  });

  it("set then get round-trips (workspace scope by default)", () => {
    const m = newMemory();
    const set = handleMemoryTool(m, { workspaceId: "w1" }, "memory_set", {
      key: "lastPR",
      value: 482,
    });
    assert.equal(set.isError, false);
    assert.match(set.text, /v1/);
    const get = handleMemoryTool(m, { workspaceId: "w1" }, "memory_get", {
      key: "lastPR",
    });
    assert.equal(get.text, "482");
    // A different workspace can't see it.
    const other = handleMemoryTool(m, { workspaceId: "w2" }, "memory_get", {
      key: "lastPR",
    });
    assert.match(other.text, /No value stored/);
  });

  it("global scope is shared across workspaces", () => {
    const m = newMemory();
    handleMemoryTool(m, { workspaceId: "w1" }, "memory_set", {
      key: "k",
      value: "shared",
      scope: "global",
    });
    const get = handleMemoryTool(m, { workspaceId: "w2" }, "memory_get", {
      key: "k",
      scope: "global",
    });
    assert.equal(get.text, "shared");
  });

  it("list and delete work", () => {
    const m = newMemory();
    handleMemoryTool(m, { workspaceId: "w1" }, "memory_set", {
      key: "a",
      value: 1,
    });
    handleMemoryTool(m, { workspaceId: "w1" }, "memory_set", {
      key: "b",
      value: 2,
    });
    const list = handleMemoryTool(m, { workspaceId: "w1" }, "memory_list", {});
    assert.match(list.text, /a \(v1\)/);
    assert.match(list.text, /b \(v1\)/);
    const del = handleMemoryTool(m, { workspaceId: "w1" }, "memory_delete", {
      key: "a",
    });
    assert.match(del.text, /Deleted 'a'/);
    assert.equal(
      handleMemoryTool(m, { workspaceId: "w1" }, "memory_get", { key: "a" })
        .text,
      "No value stored for 'a' (workspace).",
    );
  });

  it("errors on missing key and unknown tool", () => {
    const m = newMemory();
    assert.equal(handleMemoryTool(m, {}, "memory_get", {}).isError, true);
    assert.equal(
      handleMemoryTool(m, {}, "memory_nope", { key: "x" }).isError,
      true,
    );
  });
});

describe("memoryTools — bots with no dashboard get private memory", () => {
  const set = (m, ctx, key, value, scope) =>
    handleMemoryTool(m, ctx, "memory_set", {
      key,
      value,
      ...(scope ? { scope } : {}),
    });
  const get = (m, ctx, key, scope) =>
    handleMemoryTool(m, ctx, "memory_get", { key, ...(scope ? { scope } : {}) })
      .text;

  it("two unassigned bots don't see each other's keys", () => {
    const m = newMemory();
    set(m, { botId: "b1" }, "last_checked", "monday");
    assert.match(get(m, { botId: "b2" }, "last_checked"), /No value stored/);
    assert.match(get(m, { botId: "b1" }, "last_checked"), /monday/);
  });

  it("bots on the same dashboard still share team memory", () => {
    const m = newMemory();
    set(m, { botId: "b1", workspaceId: "7" }, "k", "shared");
    assert.match(get(m, { botId: "b2", workspaceId: "7" }, "k"), /shared/);
  });

  it("global is still shared by everyone", () => {
    const m = newMemory();
    set(m, { botId: "b1" }, "k", "g", "global");
    assert.match(get(m, { botId: "b2", workspaceId: "7" }, "k", "global"), /g/);
  });

  it("a numeric dashboard id counts as a team", () => {
    const m = newMemory();
    set(m, { botId: "b1", workspaceId: 7 }, "k", "team");
    assert.match(get(m, { botId: "b2", workspaceId: "7" }, "k"), /team/);
  });
});
