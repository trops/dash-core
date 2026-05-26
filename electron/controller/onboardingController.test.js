/**
 * onboardingController.test.js
 *
 * Pins the first-run onboarding state controller (Phase 3A):
 *   - fresh install reads as { completed: false }
 *   - markOnboardingCompleted persists + returns the stamped record
 *   - second call is idempotent (preserves original completedAt)
 *   - source breadcrumb round-trips
 *
 * Uses node:test + Module._load mock for electron-store (same pattern
 * as schedulerController.test.js).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

// Stub electron-store so requiring onboardingController works outside
// an Electron process. Each test invokes resetController() to get a
// fresh in-memory store.
let inMemory = {};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron-store") {
    return class FakeStore {
      get(key, fallback) {
        return key in inMemory ? inMemory[key] : fallback;
      }
      set(key, value) {
        inMemory[key] = value;
      }
      delete(key) {
        delete inMemory[key];
      }
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

function freshController() {
  inMemory = {};
  delete require.cache[require.resolve("./onboardingController")];
  return require("./onboardingController");
}

test("fresh state reads as not-completed", () => {
  const { getOnboardingStatus } = freshController();
  const status = getOnboardingStatus();
  assert.deepStrictEqual(status, {
    completed: false,
    completedAt: null,
    source: null,
  });
});

test("markOnboardingCompleted stamps the record and returns it", () => {
  const { getOnboardingStatus, markOnboardingCompleted } = freshController();
  const result = markOnboardingCompleted({ source: "kitchen-sink" });
  assert.strictEqual(result.completed, true);
  assert.strictEqual(result.source, "kitchen-sink");
  assert.strictEqual(typeof result.completedAt, "string");
  assert.notStrictEqual(
    new Date(result.completedAt).toString(),
    "Invalid Date",
  );

  const status = getOnboardingStatus();
  assert.strictEqual(status.completed, true);
  assert.strictEqual(status.source, "kitchen-sink");
  assert.strictEqual(status.completedAt, result.completedAt);
});

test("re-marking after completion is idempotent (preserves completedAt)", () => {
  const { markOnboardingCompleted } = freshController();
  const first = markOnboardingCompleted({ source: "kitchen-sink" });
  const second = markOnboardingCompleted({ source: "kitchen-sink" });
  assert.strictEqual(second.completedAt, first.completedAt);
  assert.strictEqual(second.source, "kitchen-sink");
});

test("source defaults to null when not provided", () => {
  const { markOnboardingCompleted } = freshController();
  const result = markOnboardingCompleted();
  assert.strictEqual(result.source, null);
});

test("dismissed source is supported (parity with kitchen-sink path)", () => {
  const { markOnboardingCompleted } = freshController();
  const result = markOnboardingCompleted({ source: "dismissed" });
  assert.strictEqual(result.source, "dismissed");
  assert.strictEqual(result.completed, true);
});

// Restore Module._load when the test process exits so the change
// doesn't leak into other test files in the same node --test invocation.
process.on("exit", () => {
  Module._load = originalLoad;
});
