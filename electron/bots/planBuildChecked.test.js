/**
 * planBuildChecked.test.js — a plan build installs only what the Checker
 * passed (consolidation Phase 1b): the Builder writes a draft, the Checker
 * checks that draft, and only a pass installs it (the Install step) and
 * puts it on the dashboard. A widget that never passes is never installed,
 * so Remove has nothing of it to clean up; an update replaces the live
 * widget only after it passes.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  planSteps,
  createPlanBuild,
  buildRequest,
  builtSummary,
} = require("./planBuild");

const plan = {
  summary: "Brief",
  pieces: [
    { kind: "widget", name: "Hello", source: "new", notes: "a greeting" },
    {
      kind: "widget",
      name: "Slack",
      source: "update",
      package: "@ai-built/slackpack",
    },
    { kind: "layout", name: "Morning Brief", source: "new" },
  ],
};

const DRAFTS = {
  Hello: { draft: "draft:Hello", package: "@ai-built/hello" },
  Slack: { draft: "draft:SlackPack", package: "@ai-built/slackpack" },
};
const whichWidget = (request) =>
  /Widget: Slack/.test(request) || /draft:SlackPack/.test(request)
    ? "Slack"
    : "Hello";

function deps({ verdicts = {}, install = null, writesDraft = true } = {}) {
  const calls = [];
  return {
    calls,
    createDashboard: async (name) => {
      calls.push(["dashboard", name]);
      return { id: 77, name };
    },
    askRole: async (role, request) => {
      const w = whichWidget(request);
      calls.push([role, w, request]);
      if (role === "builder") {
        return {
          status: "completed",
          output: `Wrote ${DRAFTS[w].draft}.`,
          builds: writesDraft ? [{ ok: true, ...DRAFTS[w] }] : [],
        };
      }
      return {
        status: "completed",
        output: `VERDICT: ${verdicts[w] || "PASSED"}`,
      };
    },
    installBuilt: async (draft) => {
      calls.push(["installBuilt", draft]);
      if (install) return install(draft);
      const w = Object.keys(DRAFTS).find((k) => DRAFTS[k].draft === draft);
      return { success: true, widgetName: DRAFTS[w].package };
    },
    placeWidget: async (req) => {
      calls.push(["place", req.widget]);
      return { component: req.widget };
    },
    abortRole: () => {},
    emit: () => {},
    now: () => "2026-10-16T00:00:00.000Z",
  };
}

describe("a plan build installs only what the Checker passed", () => {
  it("each built widget is Build → Check → Install → Place", () => {
    const ids = planSteps(plan).map((s) => s.id);
    assert.deepEqual(ids, [
      "dashboard",
      "build:0",
      "check:0",
      "save:0",
      "build:1",
      "check:1",
      "save:1",
      "place:0",
      "place:1",
    ]);
    const save = planSteps(plan).find((s) => s.id === "save:0");
    assert.equal(save.label, "Install Hello");
    assert.equal(save.role, "dash");
  });

  it("the Checker checks the draft; a pass installs that draft, then it's placed", async () => {
    const d = deps();
    const state = await createPlanBuild(plan, d).run();
    assert.equal(state.status, "done");
    const order = d.calls
      .filter(
        (c) =>
          c[1] === "Hello" ||
          c[1] === "draft:Hello" ||
          c[1] === "@ai-built/hello",
      )
      .map((c) => c[0]);
    assert.deepEqual(order, ["builder", "checker", "installBuilt", "place"]);
    const check = d.calls.find((c) => c[0] === "checker" && c[1] === "Hello");
    assert.match(check[2], /draft:Hello/);
    assert.deepEqual(
      d.calls.filter((c) => c[0] === "place").map((c) => c[1]),
      ["@ai-built/hello", "@ai-built/slackpack"],
    );
  });

  it("a widget that fails the Checker is never installed — Remove has nothing of it", async () => {
    const d = deps({ verdicts: { Hello: "FAILED" } });
    const build = createPlanBuild(plan, d, { autoFix: false });
    const state = await build.run();
    assert.ok(
      !d.calls.some((c) => c[0] === "installBuilt" && c[1] === "draft:Hello"),
    );
    assert.equal(state.steps.find((s) => s.id === "save:0").status, "skipped");
    assert.equal(state.steps.find((s) => s.id === "place:0").status, "skipped");
    assert.ok(
      !builtSummary(build.state, plan).widgets.includes("@ai-built/hello"),
    );
  });

  it("an update replaces the live widget only after it passes", async () => {
    const failed = deps({ verdicts: { Slack: "FAILED" } });
    const b1 = createPlanBuild(plan, failed, { autoFix: false });
    await b1.run();
    assert.ok(
      !failed.calls.some(
        (c) => c[0] === "installBuilt" && c[1] === "draft:SlackPack",
      ),
    );
    assert.ok(
      !builtSummary(b1.state, plan).updated.includes("@ai-built/slackpack"),
    );

    const passed = deps();
    const b2 = createPlanBuild(plan, passed);
    await b2.run();
    assert.ok(
      builtSummary(b2.state, plan).updated.includes("@ai-built/slackpack"),
    );
    assert.ok(builtSummary(b2.state, plan).widgets.includes("@ai-built/hello"));
  });

  it("a Builder that never wrote a draft can't have anything installed", async () => {
    const d = deps({ writesDraft: false });
    const state = await createPlanBuild(plan, d, { autoFix: false }).run();
    assert.ok(!d.calls.some((c) => c[0] === "installBuilt"));
    assert.equal(state.steps.find((s) => s.id === "build:0").status, "failed");
  });

  it("an install the app refuses fails the Install step — the Builder can fix it", async () => {
    const d = deps({
      install: () => ({ success: false, error: "It didn't pass its checks." }),
    });
    const state = await createPlanBuild(plan, d, { autoFix: false }).run();
    const save = state.steps.find((s) => s.id === "save:0");
    assert.equal(save.status, "failed");
    assert.match(save.error, /didn't pass its checks/);
    assert.equal(save.canFix, true);
    assert.equal(state.steps.find((s) => s.id === "place:0").status, "skipped");
  });

  it("Let Builder fix it rewrites the draft and checks it again", async () => {
    let checks = 0;
    const d = deps();
    const askRole = d.askRole;
    d.askRole = async (role, request) => {
      if (role === "checker" && whichWidget(request) === "Hello") {
        checks += 1;
        d.calls.push(["checker", "Hello", request]);
        return {
          status: "completed",
          output: checks === 1 ? "VERDICT: FAILED" : "VERDICT: PASSED",
        };
      }
      return askRole(role, request);
    };
    const build = createPlanBuild(plan, d, { autoFix: false });
    await build.run();
    await build.fix("check:0");
    const state = build.state;
    assert.equal(state.steps.find((s) => s.id === "save:0").status, "done");
    assert.equal(state.steps.find((s) => s.id === "place:0").status, "done");
    const fixRequest = d.calls
      .filter((c) => c[0] === "builder" && c[1] === "Hello")
      .pop()[2];
    assert.match(fixRequest, /draft:Hello/);
  });
});

describe("the Builder's fix request", () => {
  it("names the draft, and a new widget isn't built as an update", () => {
    const req = buildRequest(plan, plan.pieces[0], {
      package: "@ai-built/hello",
      draft: "draft:Hello",
      problem: "the Checker found problems",
    });
    assert.match(req, /draft:Hello/);
    assert.doesNotMatch(req, /update: true/);
  });
  it("an update stays an update", () => {
    const req = buildRequest(plan, plan.pieces[1], {
      package: "@ai-built/slackpack",
      draft: "draft:SlackPack",
      problem: "x",
    });
    assert.match(req, /update: true/);
  });
});

// Review fixes (Phase 1b).
const clone = (o) => JSON.parse(JSON.stringify(o));
describe("Continue building and Edit plan keep what was installed", () => {
  it("an unchanged widget installed earlier isn't installed again — and Remove still finds it", async () => {
    const first = deps();
    const b1 = createPlanBuild(plan, first);
    await b1.run();
    const again = deps();
    const b2 = createPlanBuild(plan, again, {
      resume: { plan, state: clone(b1.state) },
    });
    const state = await b2.run();
    assert.equal(state.status, "done");
    assert.ok(!again.calls.some((c) => c[0] === "installBuilt"));
    assert.equal(state.steps.find((s) => s.id === "save:0").reused, true);
    assert.ok(builtSummary(b2.state, plan).widgets.includes("@ai-built/hello"));
  });

  it("one that was checked but never installed is built and checked again", async () => {
    const first = deps({
      install: () => ({ success: false, error: "disk full" }),
    });
    const b1 = createPlanBuild(plan, first);
    await b1.run();
    const again = deps();
    const b2 = createPlanBuild(plan, again, {
      resume: { plan, state: clone(b1.state) },
    });
    await b2.run();
    const order = again.calls
      .filter((c) => c[1] === "Hello" || c[1] === "draft:Hello")
      .map((c) => c[0]);
    assert.deepEqual(order, ["builder", "checker", "installBuilt"]);
  });

  it("a build saved before this (no Install step) counts its built widgets as installed", async () => {
    const first = deps();
    const b1 = createPlanBuild(plan, first);
    await b1.run();
    const old = clone(b1.state);
    old.steps = old.steps.filter((s) => s.kind !== "save");
    for (const k of Object.keys(old.made)) delete old.made[k].draft;
    assert.ok(builtSummary(old, plan).widgets.includes("@ai-built/hello"));
    assert.ok(builtSummary(old, plan).updated.includes("@ai-built/slackpack"));
    const again = deps();
    const b2 = createPlanBuild(plan, again, { resume: { plan, state: old } });
    const state = await b2.run();
    assert.equal(state.status, "done");
    assert.ok(
      !again.calls.some((c) => c[0] === "installBuilt" || c[0] === "builder"),
    );
    assert.ok(builtSummary(b2.state, plan).widgets.includes("@ai-built/hello"));
  });
});

describe("fixes and retries around the Install step", () => {
  it("an install that fails for an outside reason can be tried again, not fixed by the Builder", async () => {
    const d = deps({
      install: () => ({ success: false, error: "ENOSPC: no space left" }),
    });
    const state = await createPlanBuild(plan, d, { autoFix: false }).run();
    const save = state.steps.find((s) => s.id === "save:0");
    assert.equal(save.canRetry, true);
    assert.equal(save.canFix, false);
  });

  it("fixing a widget that's already installed builds it as an update", () => {
    const req = buildRequest(plan, plan.pieces[0], {
      package: "@ai-built/hello",
      draft: "draft:Hello",
      installed: true,
      problem: "the wiring failed",
    });
    assert.match(req, /update: true/);
  });

  it("the build step shows the draft, not a package that isn't installed yet", async () => {
    const state = await createPlanBuild(plan, deps()).run();
    assert.equal(
      state.steps.find((s) => s.id === "build:0").detail,
      "draft:Hello",
    );
    assert.equal(
      state.steps.find((s) => s.id === "save:0").detail,
      "@ai-built/hello",
    );
  });
});
