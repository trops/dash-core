/**
 * planBuildCell.test.js — a widget for one cell (consolidation Phase 2b):
 * built and checked, then it waits for the user's preview; Looks good
 * installs it, Change something goes back to the Builder; nothing touches
 * the dashboard (the editor places it).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  planSteps,
  createPlanBuild,
  buildRequest,
  STATUS,
} = require("./planBuild");

const newWidget = {
  summary: "Unread threads",
  pieces: [{ kind: "widget", name: "Slack Threads", source: "new" }],
};
const registryWidget = {
  summary: "Threads inbox",
  pieces: [
    {
      kind: "widget",
      name: "Threads Inbox",
      source: "registry",
      package: "@trops/threads-inbox",
    },
  ],
};
const yoursWidget = {
  summary: "Unreads",
  pieces: [
    {
      kind: "widget",
      name: "Slack Unreads",
      source: "ai-built",
      package: "@ai-built/slack-pack",
    },
  ],
};

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    askRole: async (role, request) => {
      calls.push([role, request]);
      return role === "builder"
        ? {
            status: "completed",
            output: "Wrote draft:SlackThreads.",
            builds: [
              {
                ok: true,
                package: "@ai-built/slackthreads",
                draft: "draft:SlackThreads",
              },
            ],
          }
        : { status: "completed", output: "VERDICT: PASSED" };
    },
    installBuilt: async (draft) => {
      calls.push(["installBuilt", draft]);
      return { success: true, widgetName: "@ai-built/slackthreads" };
    },
    installWidget: async (pkg) => {
      calls.push(["install", pkg]);
      return { component: "trops.threads-inbox.ThreadsInbox" };
    },
    resolveComponent: async (pkg, name) => {
      calls.push(["resolve", pkg, name]);
      return pkg === "@ai-built/slackthreads"
        ? "ai-built.slackthreads.SlackThreads"
        : "ai-built.slack-pack.SlackUnreads";
    },
    // Must never be called for a cell build.
    useDashboard: async () => {
      throw new Error("a cell build touched the dashboard");
    },
    createDashboard: async () => {
      throw new Error("a cell build made a dashboard");
    },
    placeWidget: async () => {
      throw new Error("a cell build placed on disk");
    },
    emit: () => {},
    now: () => "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

const ids = (plan) => planSteps(plan, { cell: true }).map((s) => s.id);

describe("cell builds — steps", () => {
  it("a new widget: build → check → preview → install; no dashboard or place", () => {
    assert.deepEqual(ids(newWidget), [
      "build:0",
      "check:0",
      "preview:0",
      "save:0",
    ]);
  });
  it("a registry widget: install → preview", () => {
    assert.deepEqual(ids(registryWidget), ["install:0", "preview:0"]);
  });
  it("one of yours: just the preview", () => {
    assert.deepEqual(ids(yoursWidget), ["preview:0"]);
  });
  it("the Builder is told not to place it", () => {
    const text = buildRequest(newWidget, newWidget.pieces[0], null, {
      cell: true,
    });
    assert.match(text, /don't place it/);
    assert.doesNotMatch(
      buildRequest(newWidget, newWidget.pieces[0]),
      /don't place it/,
    );
  });
});

describe("cell builds — the preview waits for the user", () => {
  it("stops at the preview, waiting for you; nothing installed yet", async () => {
    const d = deps();
    const b = createPlanBuild(newWidget, d, { cell: true });
    const state = await b.run();
    assert.equal(state.status, "waiting-for-you");
    const preview = state.steps.find((s) => s.id === "preview:0");
    assert.equal(preview.status, STATUS.needsYou);
    assert.equal(state.steps.find((s) => s.id === "save:0").status, "waiting");
    assert.equal(state.made[0].draft, "draft:SlackThreads");
    assert.ok(!d.calls.some((c) => c[0] === "installBuilt"));
  });

  it("Looks good installs exactly the checked draft and keeps the picks", async () => {
    const d = deps();
    const b = createPlanBuild(newWidget, d, { cell: true });
    await b.run();
    const state = await b.approve("preview:0", {
      providers: { slack: "Work Slack" },
      settings: { rows: 10 },
      extra: "ignored",
    });
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.filter((c) => c[0] === "installBuilt"),
      [["installBuilt", "draft:SlackThreads"]],
    );
    assert.equal(state.made[0].component, "ai-built.slackthreads.SlackThreads");
    assert.deepEqual(state.made[0].inputs, {
      providers: { slack: "Work Slack" },
      settings: { rows: 10 },
    });
  });

  it("Change something: the Builder changes it, it's checked and previewed again", async () => {
    const d = deps();
    const b = createPlanBuild(newWidget, d, { cell: true });
    await b.run();
    const state = await b.revise("preview:0", "Make the rows smaller");
    const builds = d.calls.filter((c) => c[0] === "builder");
    assert.equal(builds.length, 2);
    assert.match(builds[1][1], /Change the widget you wrote/);
    assert.match(builds[1][1], /What to change: Make the rows smaller/);
    assert.equal(d.calls.filter((c) => c[0] === "checker").length, 2);
    assert.equal(state.status, "waiting-for-you");
    assert.equal(state.revisions[0], 1);
    // The user's changes don't use up the Builder's own fixes.
    assert.equal(state.fixes[0], undefined);
    assert.ok(!d.calls.some((c) => c[0] === "installBuilt"));
  });

  it("an empty change, or deciding twice, is refused", async () => {
    const b = createPlanBuild(newWidget, deps(), { cell: true });
    await b.run();
    assert.deepEqual(await b.revise("preview:0", "  "), {
      error: "Say what to change.",
    });
    await b.approve("preview:0", {});
    assert.deepEqual(await b.approve("preview:0", {}), {
      error: "Nothing is waiting there.",
    });
  });

  it("a registry widget is installed, then previewed; Looks good finishes", async () => {
    const d = deps();
    const b = createPlanBuild(registryWidget, d, { cell: true });
    let state = await b.run();
    assert.equal(state.status, "waiting-for-you");
    assert.equal(state.made[0].component, "trops.threads-inbox.ThreadsInbox");
    state = await b.approve("preview:0", {});
    assert.equal(state.status, "done");
    assert.deepEqual(await b.revise("preview:0", "x"), {
      error: "Nothing is waiting there.",
    });
  });

  it("one of yours is previewed by its component; it can't be rebuilt", async () => {
    const d = deps();
    const b = createPlanBuild(yoursWidget, d, { cell: true });
    const state = await b.run();
    assert.equal(state.made[0].component, "ai-built.slack-pack.SlackUnreads");
    assert.deepEqual(await b.revise("preview:0", "smaller"), {
      error: "This widget wasn't built here — ask the Planner for another.",
    });
  });
});

describe("cell builds — the preview's inputs", () => {
  const CONFIG = `export default {
  component: "SlackThreads",
  type: "widget",
  providers: [{ type: "slack", providerClass: "mcp", required: true }],
  userConfig: {
    rows: { type: "number", displayName: "Rows to show", defaultValue: 10 },
  },
};`;
  it("reads the settings and providers from the draft's config, with the plan's picks", async () => {
    const seen = [];
    const plan = {
      ...newWidget,
      pieces: [
        {
          ...newWidget.pieces[0],
          provider: { slack: "Work Slack" },
          settings: { rows: 5 },
        },
      ],
    };
    const b = createPlanBuild(
      plan,
      deps({
        previewConfig: async (req) => {
          seen.push(req);
          return { configCode: CONFIG, componentName: "SlackThreads" };
        },
      }),
      { cell: true },
    );
    const state = await b.run();
    assert.deepEqual(seen, [{ draft: "draft:SlackThreads", component: null }]);
    const p = state.made[0].preview;
    assert.equal(p.componentName, "SlackThreads");
    assert.deepEqual(Object.keys(p.userConfig), ["rows"]);
    assert.equal(p.providers[0].type, "slack");
    assert.deepEqual(p.provider, { slack: "Work Slack" });
    assert.deepEqual(p.settings, { rows: 5 });
  });
  it("a config it can't parse leaves no inputs, and the preview still waits", async () => {
    const b = createPlanBuild(
      newWidget,
      deps({
        previewConfig: async () => ({ configCode: "not js {" }),
      }),
      { cell: true },
    );
    const state = await b.run();
    assert.equal(state.status, "waiting-for-you");
    assert.deepEqual(state.made[0].preview.userConfig, {});
  });
});

describe("cell builds — review fixes", () => {
  it("Let Builder fix it after a failed Install shows the new code again first", async () => {
    let installs = 0;
    const d = deps({
      installBuilt: async (draft) => {
        installs += 1;
        return installs === 1
          ? {
              success: false,
              error: "draft:SlackThreads hasn't passed the Checker yet",
            }
          : { success: true, widgetName: "@ai-built/slackthreads" };
      },
    });
    const b = createPlanBuild(newWidget, d, { cell: true });
    await b.run();
    let state = await b.approve("preview:0", { settings: { rows: 3 } });
    const save = state.steps.find((s) => s.id === "save:0");
    assert.equal(save.status, "failed");
    assert.equal(save.canFix, true);
    state = await b.fix("save:0");
    // Rebuilt and checked, then it waits for the user again — not installed.
    assert.equal(state.status, "waiting-for-you");
    assert.equal(installs, 1);
    assert.equal(state.made[0].inputs, undefined);
    assert.equal(
      state.steps.find((s) => s.id === "preview:0").approved,
      undefined,
    );
  });

  it("only plain objects are kept from the preview's picks", async () => {
    const b = createPlanBuild(newWidget, deps(), { cell: true });
    await b.run();
    const state = await b.approve("preview:0", {
      providers: ["Work Slack"],
      settings: "rows=5",
    });
    assert.deepEqual(state.made[0].inputs, { providers: null, settings: null });
  });

  it("at most five changes", async () => {
    const b = createPlanBuild(newWidget, deps(), { cell: true });
    await b.run();
    for (let i = 0; i < 5; i++) await b.revise("preview:0", `change ${i}`);
    assert.match(
      (await b.revise("preview:0", "one more")).error,
      /That's 5 changes/,
    );
  });

  it("a component the plan names is used; none at all fails the preview clearly", async () => {
    const named = {
      ...yoursWidget,
      pieces: [
        {
          ...yoursWidget.pieces[0],
          component: "ai-built.slack-pack.SlackThreadsView",
        },
      ],
    };
    let state = await createPlanBuild(named, deps(), { cell: true }).run();
    assert.equal(
      state.made[0].component,
      "ai-built.slack-pack.SlackThreadsView",
    );
    state = await createPlanBuild(
      yoursWidget,
      deps({ resolveComponent: async () => null }),
      { cell: true },
    ).run();
    const preview = state.steps.find((s) => s.id === "preview:0");
    assert.equal(preview.status, "failed");
    assert.match(preview.error, /couldn't tell which widget/);
  });
});

describe("cell builds — a preview that couldn't find its widget", () => {
  it("offers Try again, which looks again", async () => {
    let calls = 0;
    const b = createPlanBuild(
      yoursWidget,
      deps({
        resolveComponent: async () => {
          calls += 1;
          return calls === 1 ? null : "ai-built.slack-pack.SlackUnreads";
        },
      }),
      { cell: true },
    );
    let state = await b.run();
    const preview = state.steps.find((s) => s.id === "preview:0");
    assert.equal(preview.canRetry, true);
    state = await b.retry("preview:0");
    assert.equal(state.status, "waiting-for-you");
    assert.equal(state.made[0].component, "ai-built.slack-pack.SlackUnreads");
  });
});
