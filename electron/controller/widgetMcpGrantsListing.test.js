/**
 * widgetMcpGrantsListing.test.js
 *
 * Pins the pure-helper that joins the installed-widgets list with the
 * grants store and the declared-permissions cache. This is the data
 * source for the Settings → Privacy & Security panel — if this drifts,
 * unmanifested widgets disappear from the audit (or the panel breaks).
 *
 * Run: `node --test electron/controller/widgetMcpGrantsListing.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildGrantsListing } = require("./widgetMcpGrantsListing");

test("buildGrantsListing: includes installed widgets with no manifest and no grant", () => {
  const installed = [{ name: "@trops/widget-x" }];
  const grants = new Map();
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    widgetId: "@trops/widget-x",
    declared: null,
    granted: null,
    hasManifest: false,
    grantOrigin: null,
  });
});

test("buildGrantsListing: manifested widget with a grant carries grantOrigin", () => {
  const installed = [{ name: "@trops/widget-y" }];
  const grants = new Map([
    [
      "@trops/widget-y",
      {
        servers: { github: { tools: ["search_repositories"] } },
        grantOrigin: "declared",
      },
    ],
  ]);
  const declared = new Map([
    [
      "@trops/widget-y",
      { servers: { github: { tools: ["search_repositories"] } } },
    ],
  ]);
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].hasManifest, true);
  assert.strictEqual(rows[0].grantOrigin, "declared");
});

test("buildGrantsListing: unmanifested widget with manual grant", () => {
  const installed = [{ name: "@trops/widget-z" }];
  const grants = new Map([
    [
      "@trops/widget-z",
      {
        servers: { filesystem: { tools: ["read_file"], readPaths: ["/x"] } },
        grantOrigin: "manual",
      },
    ],
  ]);
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows[0].hasManifest, false);
  assert.strictEqual(rows[0].grantOrigin, "manual");
});

test("buildGrantsListing: orphan grants (granted but uninstalled) are surfaced", () => {
  const installed = []; // nothing installed
  const grants = new Map([
    [
      "@trops/orphan",
      {
        servers: { github: { tools: ["x"] } },
        grantOrigin: "declared",
      },
    ],
  ]);
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].widgetId, "@trops/orphan");
  assert.strictEqual(rows[0].hasManifest, false);
});

test("buildGrantsListing: grantOrigin missing on legacy grants is null in output", () => {
  const installed = [{ name: "@trops/legacy" }];
  // Pre-grant-origin grant: no grantOrigin field
  const grants = new Map([
    ["@trops/legacy", { servers: { github: { tools: ["x"] } } }],
  ]);
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows[0].grantOrigin, null);
});

test("buildGrantsListing: returns empty array when nothing is installed and nothing granted", () => {
  const rows = buildGrantsListing([], new Map(), new Map());
  assert.deepStrictEqual(rows, []);
});

test("buildGrantsListing: tolerates malformed installed entries", () => {
  const installed = [
    null,
    undefined,
    {},
    { name: null },
    { name: "@trops/ok" },
  ];
  const grants = new Map();
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].widgetId, "@trops/ok");
});
