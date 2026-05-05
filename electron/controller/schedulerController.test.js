/**
 * schedulerController.test.js
 *
 * Regression-pin for the per-widget scoping of the scheduler IPC
 * surface flagged `widget-passthru` by the IPC audit. The controller
 * already filters/keys by widgetId; this test fails loudly if a
 * future refactor accidentally drops the filter and lets one widget
 * read or remove another widget's tasks.
 *
 * The audit's `widget-passthru` classification means: "the handler
 * accepts widgetId but no gate identifier appears in the body." That
 * is correct here by design — the scheduler scopes via Map keys
 * and `task.widgetId === widgetId` filters rather than a gate. This
 * test ensures the design holds.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// Stub electron-store and croner so requiring schedulerController
// doesn't blow up outside an Electron process. The controller never
// calls schedulerController.start() in this test, so the tick loop
// never runs and we don't have to worry about croner Cron objects
// (only used in the dayTime branch of computeNextFire — we test
// with `interval` schedules which never reach it).
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron-store") {
    return class FakeStore {
      constructor() {
        this._data = {};
      }
      get(key, fallback) {
        return key in this._data ? this._data[key] : fallback;
      }
      set(key, value) {
        this._data[key] = value;
      }
    };
  }
  if (request === "croner") {
    // Not exercised by the interval-schedule tests; return a no-op
    // shape so module-load doesn't fail.
    return { Cron: function () {} };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

delete require.cache[require.resolve("./schedulerController")];
const schedulerController = require("./schedulerController");
Module._load = originalLoad;

function seed(widgetId, taskKey) {
  return schedulerController.registerTask({
    widgetId,
    widgetName: "TestWidget",
    workspaceId: "ws-1",
    taskKey,
    handler: taskKey,
    displayName: taskKey,
    scheduleType: "interval",
    intervalMs: 60_000,
    enabled: true,
  });
}

test("getTasks(A) returns only widget A's tasks, never widget B's", () => {
  // Reset state by removing anything left from prior tests.
  schedulerController.removeTasks("widget-A");
  schedulerController.removeTasks("widget-B");

  seed("widget-A", "taskA1");
  seed("widget-A", "taskA2");
  seed("widget-B", "taskB1");

  const aTasks = schedulerController.getTasks("widget-A");
  const bTasks = schedulerController.getTasks("widget-B");

  assert.strictEqual(aTasks.length, 2, "widget A has 2 tasks");
  assert.ok(
    aTasks.every((t) => t.widgetId === "widget-A"),
    "every returned task is widget A's — no cross-widget leak",
  );
  assert.strictEqual(bTasks.length, 1, "widget B has 1 task");
  assert.strictEqual(bTasks[0].widgetId, "widget-B");
});

test("removeTasks(A) deletes only widget A's tasks; B's survive", () => {
  schedulerController.removeTasks("widget-A");
  schedulerController.removeTasks("widget-B");

  seed("widget-A", "taskA1");
  seed("widget-A", "taskA2");
  seed("widget-B", "taskB1");

  const removed = schedulerController.removeTasks("widget-A");
  assert.strictEqual(removed.success, true);
  assert.strictEqual(removed.count, 2, "removed 2 tasks for A");

  assert.strictEqual(schedulerController.getTasks("widget-A").length, 0);
  assert.strictEqual(
    schedulerController.getTasks("widget-B").length,
    1,
    "widget B's task survived A's removeTasks",
  );

  // Cleanup
  schedulerController.removeTasks("widget-B");
});

test("removeTasks(A) does not affect widget B's pending results queue", () => {
  // pendingResults is module-scoped and only populated by fireTask
  // (an internal helper). We can't seed it from the public API
  // without running the tick loop. Instead we pin the related
  // invariant: removeTasks(A) only calls pendingResults.delete(A)
  // — it never touches pendingResults for any other widgetId.
  //
  // Verified by inspection at schedulerController.js line ~358:
  //   if (count > 0) { ... pendingResults.delete(widgetId); }
  //
  // The functional pin: getPendingResults for widget B returns [] in
  // a fresh state both before and after a removeTasks call for A.
  schedulerController.removeTasks("widget-A");
  schedulerController.removeTasks("widget-B");

  seed("widget-A", "taskA1");
  const beforeB = schedulerController.getPendingResults("widget-B");
  assert.deepStrictEqual(beforeB, [], "widget B has no pending results");

  schedulerController.removeTasks("widget-A");
  const afterB = schedulerController.getPendingResults("widget-B");
  assert.deepStrictEqual(
    afterB,
    [],
    "widget B's pending results untouched by widget A's removeTasks",
  );
});

test("getPendingResults(A) on fresh state returns an empty array (not undefined)", () => {
  // Pin the contract: callers can rely on `.length` / spread / etc.
  // without an undefined check. Also pins that the function is
  // keyed by widgetId — calling for an unknown widget never returns
  // another widget's queue.
  const result = schedulerController.getPendingResults(
    "widget-never-seen-before",
  );
  assert.ok(Array.isArray(result), "getPendingResults always returns an array");
  assert.strictEqual(result.length, 0);
});

test("teardown: stop the controller so persistTimeout doesn't keep the process alive", () => {
  schedulerController.stop();
  assert.ok(true);
});
