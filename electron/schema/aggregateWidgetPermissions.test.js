/**
 * aggregateWidgetPermissions.test.js
 *
 * Pin for the helper that unions every widget's `dash.permissions.mcp`
 * block into a single dashboard-level summary. The aggregate is the
 * "this dashboard needs these tools, in total" view shown in the
 * registry detail panel — pure UX convenience derived from the
 * authoritative per-widget permissions.
 *
 * Run: `node --test electron/schema/aggregateWidgetPermissions.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { aggregateWidgetPermissions } = require("./aggregateWidgetPermissions");

test("aggregateWidgetPermissions: empty input returns empty object", () => {
  assert.deepStrictEqual(aggregateWidgetPermissions([]), {});
  assert.deepStrictEqual(aggregateWidgetPermissions(null), {});
  assert.deepStrictEqual(aggregateWidgetPermissions(undefined), {});
});

test("aggregateWidgetPermissions: single widget, single server", () => {
  const out = aggregateWidgetPermissions([
    {
      packageId: "@trops/gmail",
      version: "1.0.0",
      permissions: { gmail: { tools: ["read_email", "send_email"] } },
    },
  ]);
  assert.deepStrictEqual(out, {
    gmail: { tools: ["read_email", "send_email"] },
  });
});

test("aggregateWidgetPermissions: unions tools across widgets sharing a server", () => {
  const out = aggregateWidgetPermissions([
    {
      packageId: "@trops/gmail-compose",
      version: "1.0.0",
      permissions: { gmail: { tools: ["send_email"] } },
    },
    {
      packageId: "@trops/gmail-inbox",
      version: "1.0.0",
      permissions: { gmail: { tools: ["read_email", "search_emails"] } },
    },
  ]);
  assert.deepStrictEqual(out.gmail.tools.sort(), [
    "read_email",
    "search_emails",
    "send_email",
  ]);
});

test("aggregateWidgetPermissions: dedupes tools when multiple widgets request the same one", () => {
  const out = aggregateWidgetPermissions([
    { permissions: { gmail: { tools: ["read_email"] } } },
    { permissions: { gmail: { tools: ["read_email"] } } },
  ]);
  assert.deepStrictEqual(out.gmail.tools, ["read_email"]);
});

test("aggregateWidgetPermissions: keeps separate keys for different servers", () => {
  const out = aggregateWidgetPermissions([
    { permissions: { gmail: { tools: ["send_email"] } } },
    { permissions: { filesystem: { tools: ["read_file"] } } },
  ]);
  assert.deepStrictEqual(Object.keys(out).sort(), ["filesystem", "gmail"]);
});

test("aggregateWidgetPermissions: skips entries missing a permissions field", () => {
  const out = aggregateWidgetPermissions([
    { packageId: "@trops/gmail", permissions: { gmail: { tools: ["x"] } } },
    { packageId: "@trops/no-perms" }, // no permissions field
    { packageId: "@trops/null-perms", permissions: null },
  ]);
  assert.deepStrictEqual(out.gmail.tools, ["x"]);
  assert.strictEqual(Object.keys(out).length, 1);
});

test("aggregateWidgetPermissions: preserves readPaths and writePaths in output", () => {
  const out = aggregateWidgetPermissions([
    {
      permissions: {
        filesystem: {
          tools: ["read_file"],
          readPaths: ["/safe"],
          writePaths: ["/tmp"],
        },
      },
    },
  ]);
  assert.deepStrictEqual(out.filesystem.readPaths, ["/safe"]);
  assert.deepStrictEqual(out.filesystem.writePaths, ["/tmp"]);
});

test("aggregateWidgetPermissions: unions readPaths/writePaths across widgets", () => {
  const out = aggregateWidgetPermissions([
    {
      permissions: {
        filesystem: { readPaths: ["/a"], writePaths: ["/x"] },
      },
    },
    {
      permissions: {
        filesystem: { readPaths: ["/b", "/a"], writePaths: ["/y"] },
      },
    },
  ]);
  assert.deepStrictEqual(out.filesystem.readPaths.sort(), ["/a", "/b"]);
  assert.deepStrictEqual(out.filesystem.writePaths.sort(), ["/x", "/y"]);
});

test("aggregateWidgetPermissions: malformed entries don't throw", () => {
  const out = aggregateWidgetPermissions([
    null,
    undefined,
    { permissions: "not-an-object" },
    { permissions: { server: "not-an-object" } },
    { permissions: { server: { tools: "not-an-array" } } },
    { permissions: { gmail: { tools: ["valid"] } } },
  ]);
  assert.deepStrictEqual(out.gmail.tools, ["valid"]);
});
