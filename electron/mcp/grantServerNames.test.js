/**
 * grantServerNames.test.js
 *
 * Pins that grants saved from declared (type-keyed) permissions land under
 * provider names — the key tool calls are checked against.
 *
 * Run with `node --test electron/mcp/grantServerNames.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { toProviderNames } = require("./grantServerNames");

const providers = [
  { name: "Algolia Public HR", type: "algolia", providerClass: "mcp" },
  { name: "Algolia Flagship", type: "algolia", providerClass: "mcp" },
  { name: "Algolia Keys", type: "algolia", providerClass: "credential" },
  { name: "Slack", type: "slack", providerClass: "mcp" },
];

const entry = (tools) => ({ tools, readPaths: [], writePaths: [] });

test("a type key becomes one entry per MCP provider of that type", () => {
  const out = toProviderNames(
    {
      grantOrigin: "declared",
      servers: { algolia: entry(["algolia_search_*"]) },
    },
    providers,
  );
  assert.deepStrictEqual(out, {
    grantOrigin: "declared",
    servers: {
      "Algolia Public HR": entry(["algolia_search_*"]),
      "Algolia Flagship": entry(["algolia_search_*"]),
    },
  });
});

test("provider-name keys are kept as they are", () => {
  const perms = { servers: { "Algolia Public HR": entry(["x"]) } };
  assert.deepStrictEqual(toProviderNames(perms, providers), perms);
});

test("a provider named the same as a type stays that provider", () => {
  const perms = { servers: { Slack: entry(["post"]) } };
  assert.deepStrictEqual(toProviderNames(perms, providers).servers, {
    Slack: entry(["post"]),
  });
});

test("merges with an existing entry for the same provider", () => {
  const out = toProviderNames(
    {
      servers: {
        "Algolia Public HR": entry(["algolia_search_index_hr"]),
        algolia: entry(["algolia_search_*"]),
      },
    },
    providers,
  );
  assert.deepStrictEqual(out.servers["Algolia Public HR"].tools, [
    "algolia_search_index_hr",
    "algolia_search_*",
  ]);
});

test("keeps a type key with no matching provider", () => {
  const perms = { servers: { notion: entry(["search"]) } };
  assert.deepStrictEqual(toProviderNames(perms, providers), perms);
});

test("passes through blobs without servers", () => {
  assert.strictEqual(toProviderNames(null, providers), null);
  const domainsOnly = { domains: { fs: {} } };
  assert.strictEqual(toProviderNames(domainsOnly, providers), domainsOnly);
});
