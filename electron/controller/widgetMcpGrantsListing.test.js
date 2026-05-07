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

test("buildGrantsListing: orphan grant with declared manifest pulls declared block + hasManifest:true", () => {
  // Real-world shape: grants store keys per dotted component
  // (`trops.gmail.GmailCompose`); installed widgets enumerate per
  // package (`@trops/gmail`). The controller resolves the dotted form
  // via getWidgetMcpPermissions and stuffs the result into `declared`
  // keyed by the dotted form. The orphan loop must honor it.
  const installed = [{ name: "@trops/gmail" }];
  const grants = new Map([
    [
      "trops.gmail.GmailCompose",
      {
        servers: { gmail: { tools: ["send_email"] } },
        grantOrigin: "live",
      },
    ],
  ]);
  const declared = new Map([
    [
      "trops.gmail.GmailCompose",
      {
        servers: {
          gmail: {
            tools: ["read_email", "search_emails", "send_email"],
            readPaths: [],
            writePaths: [],
          },
        },
      },
    ],
  ]);
  const rows = buildGrantsListing(installed, grants, declared);
  // 2 rows: the package row from `installed` + the orphan row from `grants`.
  const orphan = rows.find((r) => r.widgetId === "trops.gmail.GmailCompose");
  assert.ok(orphan, "expected orphan row for dotted-form grant");
  assert.deepStrictEqual(orphan.declared.servers.gmail.tools, [
    "read_email",
    "search_emails",
    "send_email",
  ]);
  assert.strictEqual(orphan.hasManifest, true);
  assert.strictEqual(orphan.grantOrigin, "live");
});

test("buildGrantsListing: orphan grant without declared manifest still emits null + hasManifest:false", () => {
  const installed = [];
  const grants = new Map([
    [
      "trops.unmanifested.X",
      { servers: { x: { tools: ["t"] } }, grantOrigin: "manual" },
    ],
  ]);
  const declared = new Map();
  const rows = buildGrantsListing(installed, grants, declared);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].declared, null);
  assert.strictEqual(rows[0].hasManifest, false);
});

test("buildGrantsListing: installed-widget loop unaffected by declared lookups for orphans", () => {
  // Declared keyed by BOTH the package id and the dotted-form orphan id.
  // The installed row should resolve via its own package id; orphan
  // resolves via its dotted-form id. Cross-pollination is not allowed.
  const installed = [{ name: "@trops/gmail" }];
  const grants = new Map([
    [
      "trops.gmail.GmailCompose",
      { servers: { gmail: { tools: ["send_email"] } }, grantOrigin: "live" },
    ],
  ]);
  const declared = new Map([
    ["@trops/gmail", { servers: { gmail: { tools: ["read_email"] } } }],
    [
      "trops.gmail.GmailCompose",
      { servers: { gmail: { tools: ["send_email"] } } },
    ],
  ]);
  const rows = buildGrantsListing(installed, grants, declared);
  const installedRow = rows.find((r) => r.widgetId === "@trops/gmail");
  const orphanRow = rows.find((r) => r.widgetId === "trops.gmail.GmailCompose");
  assert.deepStrictEqual(installedRow.declared.servers.gmail.tools, [
    "read_email",
  ]);
  assert.deepStrictEqual(orphanRow.declared.servers.gmail.tools, [
    "send_email",
  ]);
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
