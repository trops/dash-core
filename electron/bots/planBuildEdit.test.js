/**
 * planBuildEdit.test.js — a change to one widget the user has (consolidation
 * Phase 3): the cell build's steps for that widget — the Builder writes a
 * draft, the Checker checks it against the widget as it was, the user
 * previews it (with the cell's own connection and settings), then it's
 * installed. Nothing touches a dashboard.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  planSteps,
  createPlanBuild,
  buildRequest,
  checkRequest,
  STATUS,
} = require("./planBuild");

const update = {
  package: "@jg/inbox",
  component: "jg.inbox.Inbox",
  componentName: "Inbox",
  displayName: "Inbox",
  mode: "update",
  settings: { maxMessages: 20 },
  providers: { gmail: "Work Gmail" },
};
const asNew = { ...update, mode: "new" };

const updatePlan = {
  summary: "Inbox gets a date filter",
  pieces: [
    {
      kind: "widget",
      name: "Inbox",
      source: "update",
      package: "@jg/inbox",
      adds: "A date filter above the list, last 7 days by default.",
      keeps: ["Max messages", "Gmail", "messageSelected"],
    },
  ],
};
const newPlan = {
  summary: "Inbox with a date filter, as a new widget",
  pieces: [
    {
      kind: "widget",
      name: "Inbox Date Filter",
      source: "new",
      adds: "A date filter.",
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
            output: "Wrote draft:Inbox.",
            builds: [{ ok: true, package: "@jg/inbox", draft: "draft:Inbox" }],
          }
        : { status: "completed", output: "VERDICT: PASSED" };
    },
    installBuilt: async (draft) => {
      calls.push(["installBuilt", draft]);
      return { success: true, widgetName: "@jg/inbox" };
    },
    resolveComponent: async (pkg, name) => {
      calls.push(["resolve", pkg, name]);
      return "jg.inbox.Inbox";
    },
    previewConfig: async () => ({
      configCode:
        'export default { component: "Inbox", userConfig: { maxMessages: { type: "number", defaultValue: 10 }, range: { type: "select", defaultValue: "7d" } }, providers: [{ type: "gmail", providerClass: "mcp" }] };',
      componentName: "Inbox",
    }),
    useDashboard: async () => {
      throw new Error("a change touched the dashboard");
    },
    createDashboard: async () => {
      throw new Error("a change made a dashboard");
    },
    placeWidget: async () => {
      throw new Error("a change placed on disk");
    },
    emit: () => {},
    now: () => "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

describe("a change to a widget — steps", () => {
  it("build → check → preview → save, labelled as a change", () => {
    const steps = planSteps(updatePlan, { edit: update });
    assert.deepEqual(
      steps.map((s) => s.id),
      ["build:0", "check:0", "preview:0", "save:0"],
    );
    assert.deepEqual(
      steps.map((s) => s.label),
      [
        "Write the change into a draft",
        "Check the draft",
        "Preview Inbox",
        "Update Inbox",
      ],
    );
  });

  it("saved as new: the last step installs the new widget", () => {
    const steps = planSteps(newPlan, { edit: asNew });
    assert.equal(steps[3].label, "Install Inbox Date Filter");
    assert.equal(steps[2].label, "Preview Inbox Date Filter");
  });

  it("only ever the one widget", () => {
    const two = {
      ...updatePlan,
      pieces: [
        ...updatePlan.pieces,
        { kind: "widget", name: "X", source: "new" },
      ],
    };
    assert.equal(planSteps(two, { edit: update }).length, 4);
  });
});

describe("a change to a widget — what the Builder and Checker are told", () => {
  it("in place: read it, keep its name, change only its two files", () => {
    const text = buildRequest(updatePlan, updatePlan.pieces[0], null, {
      edit: update,
    });
    assert.match(text, /Change the user's widget Inbox \(package @jg\/inbox\)/);
    assert.match(
      text,
      /read_widget with name "@jg\/inbox" and component "Inbox"/,
    );
    assert.match(text, /Keep the name Inbox/);
    assert.match(text, /update: true/);
    assert.match(text, /The change: A date filter/);
    assert.match(text, /Keep: Max messages; Gmail; messageSelected\./);
    assert.match(text, /Don't place or install it/);
  });

  it("as new: a new name, built in a copy of the package, no update", () => {
    const text = buildRequest(newPlan, newPlan.pieces[0], null, {
      edit: asNew,
    });
    assert.match(text, /Make a new widget from the user's widget Inbox/);
    assert.match(
      text,
      /new PascalCase name based on "Inbox Date Filter" \(not Inbox\)/,
    );
    assert.match(text, /built inside a copy of the package/);
    assert.doesNotMatch(text, /update: true/);
  });

  it("a change the user asked for at the preview goes to the same draft", () => {
    const text = buildRequest(
      updatePlan,
      updatePlan.pieces[0],
      { change: true, draft: "draft:Inbox", problem: "smaller rows" },
      { edit: update },
    );
    assert.match(text, /^Change the draft you wrote \(draft:Inbox\)/);
    assert.match(text, /What to change: smaller rows/);
  });

  it("the Checker compares it with the widget as it was", () => {
    const text = checkRequest(
      updatePlan,
      updatePlan.pieces[0],
      { draft: "draft:Inbox" },
      { edit: update },
    );
    assert.match(text, /which is in use/);
    assert.match(text, /fails it, unless the plan says to drop it/);
    assert.match(text, /The change it should make: A date filter/);
    assert.doesNotMatch(
      checkRequest(updatePlan, updatePlan.pieces[0], { draft: "draft:Inbox" }),
      /which is in use/,
    );
  });
});

describe("a change to a widget — the build", () => {
  it("waits at the preview, started from the cell's connection and settings", async () => {
    const d = deps();
    const b = createPlanBuild(updatePlan, d, { edit: update });
    const state = await b.run();
    assert.equal(state.status, "waiting-for-you");
    const preview = state.steps.find((s) => s.id === "preview:0");
    assert.equal(preview.status, STATUS.needsYou);
    assert.deepEqual(state.made[0].preview.provider, { gmail: "Work Gmail" });
    assert.deepEqual(state.made[0].preview.settings, { maxMessages: 20 });
    assert.ok(!d.calls.some((c) => c[0] === "installBuilt"));
  });

  it("the plan's own settings win over the cell's", async () => {
    const d = deps();
    const plan = {
      ...updatePlan,
      pieces: [{ ...updatePlan.pieces[0], settings: { range: "30d" } }],
    };
    const state = await createPlanBuild(plan, d, { edit: update }).run();
    assert.deepEqual(state.made[0].preview.settings, {
      maxMessages: 20,
      range: "30d",
    });
  });

  it("Looks good installs the checked draft and says which component it is", async () => {
    const d = deps();
    const b = createPlanBuild(updatePlan, d, { edit: update });
    await b.run();
    const state = await b.approve("preview:0", {
      settings: { maxMessages: 20, range: "7d" },
    });
    assert.equal(state.status, "done");
    assert.deepEqual(
      d.calls.filter((c) => c[0] === "installBuilt"),
      [["installBuilt", "draft:Inbox"]],
    );
    assert.equal(state.made[0].component, "jg.inbox.Inbox");
    assert.deepEqual(state.made[0].inputs.settings, {
      maxMessages: 20,
      range: "7d",
    });
  });

  it("in place, the component is the one the change was opened on — whatever the Planner called it", async () => {
    // A package with several widgets: looking it up by the piece's name
    // would find none, and the change would never reach the dashboards.
    const d = deps({
      resolveComponent: async () => {
        throw new Error("looked up by the Planner's name");
      },
    });
    const renamed = {
      ...updatePlan,
      pieces: [{ ...updatePlan.pieces[0], name: "Inbox with date filter" }],
    };
    const b = createPlanBuild(renamed, d, { edit: update });
    await b.run();
    const state = await b.approve("preview:0", {});
    assert.equal(state.status, "done");
    assert.equal(state.made[0].component, "jg.inbox.Inbox");
  });
});
