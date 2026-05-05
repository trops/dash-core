/**
 * layoutApi.test.js
 *
 * Regression-pin: `saveLayoutForApplication` was a renderer-facing
 * IPC method invoking `LAYOUT_SAVE`, which had no main-process
 * handler. The matching `layoutController.saveLayoutForApplication`
 * was also dead. Removed alongside the other 6 dead widget-facing
 * surfaces from the IPC audit.
 *
 * If a future commit re-introduces this method, both the handler
 * wiring AND a per-widget gate must be considered — layouts are
 * scoped by appId today; widget-level scoping would need a
 * widgetId param plumbed through fsGate's pattern.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron") {
    return {
      ipcRenderer: {
        invoke: () => Promise.resolve(undefined),
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
delete require.cache[require.resolve("./layoutApi")];
const layoutApi = require("./layoutApi");
Module._load = originalLoad;

test("layoutApi: saveLayoutForApplication removed (was unwired)", () => {
  assert.strictEqual(
    layoutApi.saveLayoutForApplication,
    undefined,
    "saveLayoutForApplication had no main-process handler. " +
      "Re-adding requires both an IPC handler AND a per-widget " +
      "gate decision (layouts today are appId-scoped, not " +
      "widget-scoped).",
  );
});

test("layoutApi: listLayoutsForApplication still present (it is wired)", () => {
  assert.strictEqual(typeof layoutApi.listLayoutsForApplication, "function");
});
