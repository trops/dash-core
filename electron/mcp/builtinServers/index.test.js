/**
 * index.test.js — built-in providers connect in-process: a normal MCP Client
 * on the returned transport sees the server's tools (the path
 * mcpController.startServer takes for `transport: "in_process"`).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  createBuiltinTransport,
  isBuiltinTransport,
  BUILTIN_SERVERS,
} = require("./index");

describe("built-in providers", () => {
  it("registers web-fetch", () => {
    assert.ok(BUILTIN_SERVERS["web-fetch"]);
  });

  it("recognises an in_process config", () => {
    assert.equal(
      isBuiltinTransport({ transport: "in_process", builtin: "web-fetch" }),
      true,
    );
    assert.equal(isBuiltinTransport({ transport: "stdio" }), false);
    assert.equal(isBuiltinTransport(null), false);
  });

  it("a client on the returned transport lists the server's tools", async () => {
    const transport = await createBuiltinTransport(
      { transport: "in_process", builtin: "web-fetch" },
      { maxImages: "3" },
      { serverName: "Web Fetch (test)" },
    );
    const client = new Client({ name: "dash", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "fetch_image",
      "fetch_url",
    ]);
    await client.close();
  });

  it("an unknown built-in fails with a clear message", async () => {
    await assert.rejects(
      createBuiltinTransport({ transport: "in_process", builtin: "nope" }, {}),
      /Unknown built-in provider: nope/,
    );
  });
});
