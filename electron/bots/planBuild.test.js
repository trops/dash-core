/**
 * planBuild.test.js — building an approved plan (create-entry CRE-004,
 * TD-008; phase 4d-1), with fake hooks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  planSteps,
  builtPackage,
  verdictOf,
  createPlanBuild,
} = require("./planBuild");

const plan = {
  summary: "Brief",
  pieces: [
    {
      kind: "widget",
      name: "Calendar",
      source: "registry",
      package: "@trops/google-calendar",
    },
    { kind: "widget", name: "Hello", source: "new", notes: "a greeting" },
    {
      kind: "widget",
      name: "Slack",
      source: "ai-built",
      package: "@ai-built/slack-pack",
    },
    { kind: "layout", name: "Morning Brief", source: "new" },
  ],
};

function deps(over = {}) {
  const calls = [];
  const states = [];
  const usage = { inputTokens: 1000, outputTokens: 200 };
  return {
    calls,
    states,
    installWidget: async (pkg) => {
      calls.push(["install", pkg]);
      return { component: "trops.google-calendar.GoogleCalendarWidget" };
    },
    createDashboard: async (name, n) => {
      calls.push(["dashboard", name, n]);
      return { id: 77, name };
    },
    askRole: async (role, request) => {
      calls.push([role, request]);
      return role === "builder"
        ? {
            status: "completed",
            output: "Built @ai-built/hello.",
            model: "claude-sonnet-4-6",
            usage,
            cost: { usd: 0, includedInPlan: true },
          }
        : {
            status: "completed",
            output: "PASS compiles\nVERDICT: PASSED",
            model: "claude-sonnet-4-6",
            usage,
            cost: { usd: 0, includedInPlan: true },
          };
    },
    abortRole: (role) => calls.push(["abort", role]),
    placeWidget: async (req) => {
      calls.push(["place", req.component || req.widget, req.dashboardId]);
      return { component: req.component || req.widget };
    },
    emit: (s) => states.push(s),
    now: () => "2026-10-12T00:00:00.000Z",
    ...over,
  };
}

describe("planSteps", () => {
  it("install → dashboard → build/check → place, from the plan", () => {
    assert.deepEqual(
      planSteps(plan).map((s) => s.id),
      [
        "install:0",
        "dashboard",
        "build:1",
        "check:1",
        "place:0",
        "place:1",
        "place:2",
      ],
    );
    const dash = planSteps(plan).find((s) => s.id === "dashboard");
    assert.equal(dash.name, "Morning Brief");
    assert.equal(
      planSteps(plan).find((s) => s.id === "build:1").role,
      "builder",
    );
  });
});

describe("createPlanBuild", () => {
  it("runs every step and places what was installed, built and already yours", async () => {
    const d = deps();
    const build = createPlanBuild(plan, d);
    const state = await build.run();
    assert.equal(state.status, "done");
    assert.ok(state.steps.every((s) => s.status === "done"));
    assert.deepEqual(state.dashboard, { id: "77", name: "Morning Brief" });
    assert.deepEqual(
      d.calls.filter((c) => c[0] === "place").map((c) => c[1]),
      [
        "trops.google-calendar.GoogleCalendarWidget",
        "@ai-built/hello",
        "@ai-built/slack-pack",
      ],
    );
    // Builder + Checker tokens add up; on the plan.
    assert.equal(state.totals.tokens, 2400);
    assert.equal(state.totals.includedInPlan, true);
    const b = state.steps.find((s) => s.id === "build:1");
    assert.equal(b.model, "claude-sonnet-4-6");
    assert.equal(b.tokens, 1200);
    assert.ok(d.states.length > 5);
  });

  it("a failed check is kept; that widget isn't placed; the rest carry on", async () => {
    const d = deps({
      askRole: async (role) =>
        role === "builder"
          ? { status: "completed", output: "@ai-built/hello" }
          : {
              status: "completed",
              output: "FAIL code checks\nVERDICT: FAILED",
            },
    });
    const state = await createPlanBuild(plan, d).run();
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    assert.equal(by["check:1"].status, "failed");
    assert.match(by["check:1"].error, /found problems/);
    assert.equal(by["place:1"].status, "skipped");
    assert.equal(by["place:0"].status, "done");
    assert.equal(by["place:2"].status, "done");
    assert.equal(state.status, "finished-with-problems");
  });

  it("the Builder not naming a package fails the build step", async () => {
    const d = deps({
      askRole: async () => ({ status: "completed", output: "I couldn't." }),
    });
    const state = await createPlanBuild(plan, d).run();
    const step = state.steps.find((s) => s.id === "build:1");
    assert.equal(step.status, "failed");
    assert.match(step.error, /didn't build it/);
  });

  it("Stop aborts the running role and stops the steps after it", async () => {
    let release;
    const d = deps({
      askRole: (role) =>
        new Promise((resolve) => {
          release = () => resolve({ status: "failed", error: "aborted" });
        }),
    });
    const build = createPlanBuild(plan, d);
    const done = build.run();
    await new Promise((r) => setTimeout(r, 10));
    build.stop();
    release();
    const state = await done;
    assert.equal(state.status, "stopped");
    assert.ok(d.calls.some((c) => c[0] === "abort" && c[1] === "builder"));
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    assert.equal(by["install:0"].status, "done");
    assert.equal(by["build:1"].status, "stopped");
    assert.equal(by["place:2"].status, "stopped");
  });
});

describe("helpers", () => {
  it("the last @ai-built package named, and the verdict", () => {
    assert.equal(
      builtPackage("first @ai-built/a then @ai-built/hello-2."),
      "@ai-built/hello-2",
    );
    assert.equal(builtPackage("nothing"), null);
    assert.equal(verdictOf("… VERDICT: passed"), "PASSED");
    assert.equal(verdictOf("no"), null);
  });
});
