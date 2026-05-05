/**
 * secureStoreApi.test.js
 *
 * Regression-pin for the renderer-facing secure-store API surface.
 *
 * Background: prior to this slice, `secureStoreApi` exposed `saveData`
 * and `getData` to widgets via `mainApi.secureStore`. Neither was wired
 * to an IPC handler in `dash-electron/public/electron.js` — calls
 * silently returned `undefined` — but the surface still appeared on
 * `mainApi`, which made it look like a usable widget-facing storage
 * API. That's a trap: a future commit could wire the handlers, ship
 * the change, and accidentally hand every widget unscoped read/write
 * access to every other widget's keys (no widgetId, no namespace).
 *
 * This test pins the API to exactly `{ isEncryptionAvailable }`. If you want
 * to add `saveData` / `getData` (or any other widget-facing storage
 * method) in the future, you MUST plumb a `widgetId` parameter through
 * the call site AND add a per-widget gate (see fsGate.js / Phase 2 for
 * the pattern). The new method must be named differently or the test
 * must be updated as part of the change that wires its gate — which
 * forces the gate decision to be deliberate, not accidental.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// Stub `electron` so secureStoreApi can be required without an Electron
// process. The api file only needs `ipcRenderer.invoke`, which we
// replace with a recorder.
const Module = require("module");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const invokeCalls = [];
Module._load = function (request, parent, ...rest) {
  if (request === "electron") {
    return {
      ipcRenderer: {
        invoke: (channel, payload) => {
          invokeCalls.push({ channel, payload });
          return Promise.resolve(undefined);
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

// Force a fresh require so the electron stub is picked up.
delete require.cache[require.resolve("./secureStoreApi")];
const secureStoreApi = require("./secureStoreApi");

// Restore module loader so the rest of the test process is unaffected.
Module._load = originalLoad;
Module._resolveFilename = originalResolve;

test("secureStoreApi exports exactly { isEncryptionAvailable }", () => {
  const keys = Object.keys(secureStoreApi).sort();
  assert.deepStrictEqual(
    keys,
    ["isEncryptionAvailable"],
    "secureStoreApi must expose only isEncryptionAvailable. Adding any other " +
      "widget-facing method requires a widgetId param + per-widget gate; " +
      "see electron/security/fsGate.js for the pattern.",
  );
});

test("saveData is not on the surface (would be unscoped credential write)", () => {
  assert.strictEqual(
    secureStoreApi.saveData,
    undefined,
    "secureStoreApi.saveData was previously exposed but never wired. " +
      "Re-adding it without a widgetId-scoped gate would let any " +
      "widget overwrite any other widget's stored credentials.",
  );
});

test("getData is not on the surface (would be unscoped credential read)", () => {
  assert.strictEqual(
    secureStoreApi.getData,
    undefined,
    "secureStoreApi.getData was previously exposed but never wired. " +
      "Re-adding it without a widgetId-scoped gate would let any " +
      "widget read any other widget's stored credentials.",
  );
});

test("isEncryptionAvailable is still callable (proves the kept method works)", async () => {
  invokeCalls.length = 0;
  await secureStoreApi.isEncryptionAvailable();
  assert.strictEqual(
    invokeCalls.length,
    1,
    "isEncryptionAvailable must hit IPC",
  );
  assert.strictEqual(invokeCalls[0].channel, "secure-storage-encryption-check");
});
