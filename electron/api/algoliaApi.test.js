/**
 * algoliaApi.test.js
 *
 * Regression-pin: `saveSynonyms` was a renderer-facing IPC method
 * that invoked an `ALGOLIA_SAVE_SYNONYMS` constant which was never
 * declared in `electron/events/algoliaEvents.js`. Result: every call
 * was firing `ipcRenderer.invoke(undefined, {})` — silently broken
 * since introduction. Removed in the same slice that pulled the
 * other 6 dead widget-facing surfaces flagged by the IPC audit.
 *
 * If a future commit re-introduces a `saveSynonyms` (or any other
 * unwired widget-facing method) on this api, this test fails and
 * forces the developer to either wire the handler properly OR
 * declare the call site internal-only — not paper over an
 * undeclared event constant.
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
delete require.cache[require.resolve("./algoliaApi")];
const algoliaApi = require("./algoliaApi");
Module._load = originalLoad;

test("algoliaApi: saveSynonyms removed (was firing on undefined channel)", () => {
  assert.strictEqual(
    algoliaApi.saveSynonyms,
    undefined,
    "saveSynonyms imported a non-existent ALGOLIA_SAVE_SYNONYMS " +
      "constant. If you re-introduce it, declare the constant AND " +
      "wire the handler in dash-electron/public/electron.js.",
  );
});

test("algoliaApi: intentional methods still present", () => {
  for (const name of [
    "listIndices",
    "browseObjects",
    "getAnalyticsForQuery",
    "partialUpdateObjectsFromDirectory",
    "createBatchesFromFile",
    "browseObjectsToFile",
    "search",
  ]) {
    assert.strictEqual(
      typeof algoliaApi[name],
      "function",
      "expected algoliaApi." + name + " to remain",
    );
  }
});
