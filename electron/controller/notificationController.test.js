/**
 * notificationController.test.js
 *
 * Regression-pin for the per-widget scoping of `setPreferences`,
 * one of the four `widget-passthru` channels flagged by the IPC
 * audit. The controller already keys preferences by widgetId; this
 * test fails loudly if a future refactor accidentally writes to a
 * shared key, lets one widget overwrite another's prefs without
 * keying, or merges across widgetIds.
 *
 * Implementation note: this is a *source-inspection* pin rather than
 * a behavior pin. Behavior-loading the controller would pull in
 * `electron-store` whose native-binding lookup makes node:test's
 * per-test fork bootstrap unbearably slow (60s+ in our environment
 * for trivial assertions). The inspection-pin asserts the
 * widget-keyed-merge pattern is present in the source verbatim,
 * which is the property we want to protect from silent regression.
 * Companion behavior pin lives in
 * `electron/controller/schedulerController.test.js` where the
 * controller loads cleanly (no electron-store at module-load that
 * blocks workers).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "notificationController.js"),
  "utf8",
);

test("setPreferences keys by widgetId — write goes to instances[widgetId]", () => {
  // Pin the literal merge expression. If a refactor changes the key
  // scheme (e.g. instances[somethingElse]) or drops the per-widget
  // key entirely, this fails and forces the developer to either
  // update the audit verdict or restore the per-widget keying.
  const pattern =
    /instances\[widgetId\]\s*=\s*\{\s*\.\.\.\(?instances\[widgetId\]/;
  assert.ok(
    pattern.test(SRC),
    "notificationController.setPreferences must merge into " +
      "instances[widgetId]; per-widget keying is the audited scoping " +
      "mechanism (see docs/security/ipc-surface-audit.md verdicts).",
  );
});

test("setPreferences accepts widgetId as the first param", () => {
  const pattern = /setPreferences:\s*\(\s*widgetId\s*,/;
  assert.ok(
    pattern.test(SRC),
    "setPreferences signature must take widgetId first — the IPC " +
      "handler layer assumes positional widgetId.",
  );
});

test("setPreferences body never reaches a non-widget-keyed write", () => {
  // Slice out the function body and confirm there is no
  // `instances[<other>] = ...` mutation. Loose check: a literal
  // `instances[` access in the body must be followed by `widgetId]`.
  const m = SRC.match(/setPreferences:[\s\S]*?\n  \},/);
  assert.ok(m, "found the setPreferences body");
  const body = m[0];
  const accesses = body.match(/instances\[[^\]]+\]/g) || [];
  for (const a of accesses) {
    assert.match(
      a,
      /widgetId/,
      "every instances[…] access in setPreferences must use widgetId — " +
        "found `" +
        a +
        "`",
    );
  }
});
