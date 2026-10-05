/**
 * catalogReadOnly.test.js — the catalog's `readOnlyTools` list marks tools
 * read-only for servers that don't annotate their own tools (e.g. the Gmail
 * server), matched by catalog name or by the same command + args (a provider
 * named "Gmail 3" still runs the catalog's Gmail package).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { findCatalogEntry, markReadOnlyTools } = require("./catalogReadOnly");

const gmail = {
  id: "gmail",
  name: "Gmail",
  mcpConfig: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
  },
  readOnlyTools: ["read_email", "search_emails"],
};
const catalog = [gmail, { id: "x", name: "Other", mcpConfig: { url: "u" } }];

describe("findCatalogEntry", () => {
  it("matches by catalog name", () => {
    assert.equal(findCatalogEntry(catalog, "Gmail", {}), gmail);
  });

  it("matches a renamed provider running the same command + args", () => {
    assert.equal(
      findCatalogEntry(catalog, "Gmail 3", {
        command: "npx",
        args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
      }),
      gmail,
    );
  });

  it("no match for a different command or args", () => {
    assert.equal(
      findCatalogEntry(catalog, "Mine", {
        command: "npx",
        args: ["-y", "some-other-server"],
      }),
      null,
    );
    assert.equal(findCatalogEntry(catalog, "Mine", null), null);
    assert.equal(findCatalogEntry(null, "Gmail", {}), null);
  });
});

describe("markReadOnlyTools", () => {
  it("marks listed tools read-only when the server didn't say", () => {
    const tools = [
      { name: "read_email" },
      { name: "send_email" },
      { name: "search_emails", annotations: { title: "Search" } },
    ];
    const out = markReadOnlyTools(tools, ["read_email", "search_emails"]);
    assert.equal(out[0].annotations.readOnlyHint, true);
    assert.equal(out[1].annotations, undefined);
    assert.deepEqual(out[2].annotations, {
      title: "Search",
      readOnlyHint: true,
    });
    // Inputs are not mutated.
    assert.equal(tools[0].annotations, undefined);
  });

  it("never overrides what the server itself declares", () => {
    const out = markReadOnlyTools(
      [{ name: "read_email", annotations: { readOnlyHint: false } }],
      ["read_email"],
    );
    assert.equal(out[0].annotations.readOnlyHint, false);
  });

  it("returns tools unchanged with no list", () => {
    const tools = [{ name: "a" }];
    assert.equal(markReadOnlyTools(tools, undefined), tools);
  });
});

describe("the shipped catalog", () => {
  const shipped = require("./mcpServerCatalog.json").servers;
  const entry = shipped.find((s) => s.id === "gmail");

  it("lists Gmail's read-only tools — reads only, no sends or saves", () => {
    assert.deepEqual(entry.readOnlyTools, [
      "read_email",
      "search_emails",
      "list_email_labels",
      "get_filter",
      "list_filters",
    ]);
    assert.ok(!entry.readOnlyTools.includes("download_attachment"));
  });
});
