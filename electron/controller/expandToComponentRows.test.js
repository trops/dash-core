/**
 * expandToComponentRows.test.js
 *
 * Pin for the helper that fans a registry's package-level widget
 * entries out into component-level rows for the Privacy & Security
 * panel. Without this fan-out, the panel only renders one row per
 * package (e.g. `@trops/gmail`), but grants are stored per component
 * (`trops.gmail.GmailCompose`). The orphan-grant loop used to plug
 * the gap, but it disappears the moment the grant is fully revoked —
 * making the panel forget the widget exists.
 *
 * Fan-out keeps a row per component permanently (as long as the
 * package is installed), so toggling off the last tool no longer
 * erases the user's record of "this widget was authorized."
 *
 * Run: `node --test electron/controller/expandToComponentRows.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { expandToComponentRows } = require("./expandToComponentRows");

test("expandToComponentRows: scoped package fans out to <scope>.<pkg>.<comp>", () => {
  const installed = [
    {
      name: "@trops/gmail",
      packageId: "@trops/gmail",
      scope: "trops",
      componentNames: ["GmailCompose", "GmailInbox", "GmailSearch"],
    },
  ];
  const out = expandToComponentRows(installed);
  assert.deepStrictEqual(out.map((r) => r.name).sort(), [
    "trops.gmail.GmailCompose",
    "trops.gmail.GmailInbox",
    "trops.gmail.GmailSearch",
  ]);
});

test("expandToComponentRows: unscoped package fans out to <pkg>.<comp>", () => {
  const installed = [
    {
      name: "pipeline",
      packageId: "pipeline",
      scope: null,
      componentNames: ["AutomationHub"],
    },
  ];
  const out = expandToComponentRows(installed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "pipeline.AutomationHub");
});

test("expandToComponentRows: scope with leading @ is normalized away", () => {
  const installed = [
    {
      name: "@ai-built/widget-pkg",
      packageId: "@ai-built/widget-pkg",
      scope: "@ai-built", // some entries store the scope WITH the @
      componentNames: ["MyWidget"],
    },
  ];
  const out = expandToComponentRows(installed);
  assert.strictEqual(out[0].name, "ai-built.widget-pkg.MyWidget");
});

test("expandToComponentRows: entries with no componentNames pass through unchanged", () => {
  const installed = [
    { name: "@trops/no-components", packageId: "@trops/no-components" },
  ];
  const out = expandToComponentRows(installed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "@trops/no-components");
});

test("expandToComponentRows: entries with empty componentNames pass through unchanged", () => {
  const installed = [
    {
      name: "@trops/empty",
      packageId: "@trops/empty",
      scope: "trops",
      componentNames: [],
    },
  ];
  const out = expandToComponentRows(installed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "@trops/empty");
});

test("expandToComponentRows: each fanned-out row carries packageId for grouping", () => {
  const installed = [
    {
      name: "@trops/gmail",
      packageId: "@trops/gmail",
      scope: "trops",
      componentNames: ["GmailCompose"],
    },
  ];
  const out = expandToComponentRows(installed);
  // Critical for groupRowsByPackage to bucket components together.
  assert.strictEqual(out[0].packageId, "@trops/gmail");
});

test("expandToComponentRows: tolerates malformed inputs (null/undefined/missing)", () => {
  assert.deepStrictEqual(expandToComponentRows(null), []);
  assert.deepStrictEqual(expandToComponentRows(undefined), []);
  assert.deepStrictEqual(expandToComponentRows([]), []);
  assert.deepStrictEqual(
    expandToComponentRows([null, undefined, {}, { name: null }]),
    [], // every entry is malformed → nothing emitted
  );
});

test("expandToComponentRows: multiple packages preserved independently", () => {
  const installed = [
    {
      name: "@trops/gmail",
      packageId: "@trops/gmail",
      scope: "trops",
      componentNames: ["GmailCompose"],
    },
    {
      name: "@trops/slack",
      packageId: "@trops/slack",
      scope: "trops",
      componentNames: ["SlackWidget"],
    },
  ];
  const out = expandToComponentRows(installed);
  assert.deepStrictEqual(out.map((r) => r.name).sort(), [
    "trops.gmail.GmailCompose",
    "trops.slack.SlackWidget",
  ]);
});
