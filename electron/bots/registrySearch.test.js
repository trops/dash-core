/**
 * registrySearch.test.js — the MCP Registry search behind find_providers'
 * community tier: one host only, JSON parsed, results cached briefly.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  searchRegistry,
  REGISTRY_HOST,
  __clearCacheForTest,
} = require("./registrySearch");

function fakeOpen(body, seen) {
  return async (url) => {
    seen.push(url.href);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      destroy() {},
      body: (async function* () {
        yield Buffer.from(JSON.stringify(body));
      })(),
    };
  };
}

beforeEach(() => __clearCacheForTest());

describe("searchRegistry", () => {
  it("queries the registry search and parses JSON", async () => {
    const seen = [];
    const out = await searchRegistry("image", {
      open: fakeOpen({ servers: [{ server: { name: "io.x/a" } }] }, seen),
    });
    assert.equal(out.servers[0].server.name, "io.x/a");
    const url = new URL(seen[0]);
    assert.equal(url.host, REGISTRY_HOST);
    assert.equal(url.pathname, "/v0/servers");
    assert.equal(url.searchParams.get("search"), "image");
    // version=latest makes the registry slow or fail; versions are
    // de-duplicated in findProviders instead.
    assert.equal(url.searchParams.get("version"), null);
  });

  it("caches a query for a few minutes", async () => {
    const seen = [];
    const open = fakeOpen({ servers: [] }, seen);
    await searchRegistry("image", { open });
    await searchRegistry("image", { open });
    assert.equal(seen.length, 1);
  });

  it("rejects a reply that isn't JSON", async () => {
    const open = async () => ({
      statusCode: 200,
      headers: {},
      destroy() {},
      body: (async function* () {
        yield Buffer.from("<html>");
      })(),
    });
    await assert.rejects(searchRegistry("x", { open }), /registry/i);
  });
});
