/**
 * A new theme in a plan (lead-workspace theme round): a plan that only makes
 * a theme has one step and no dashboard; a dashboard plan makes it, then
 * applies the one it made.
 *
 * Run: node --test electron/bots/planBuildTheme.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { planSteps, createPlanBuild } = require("./planBuild");

const colors = {
  primary: "#c2562b",
  secondary: "#d9a441",
  tertiary: "#6b7f3a",
  neutral: "#7a6a5c",
};
const autumn = { kind: "theme", name: "Autumn", source: "new", colors };

function themeDeps(over = {}) {
  const calls = [];
  return {
    calls,
    makeTheme: async (req) => {
      calls.push(["make", req]);
      return { key: "theme-1", name: req.name };
    },
    applyTheme: async (req) => {
      calls.push(["apply", req]);
      return { key: req.theme, name: "Autumn", previous: "theme-dusk" };
    },
    useDashboard: async (id) => {
      calls.push(["use", id]);
      return { id, name: "Kitchen Sink" };
    },
    createDashboard: async () => {
      throw new Error("no dashboard should be made");
    },
    askRole: async () => {
      throw new Error("no role should be asked");
    },
    abortRole: () => {},
    placeWidget: async () => {
      throw new Error("nothing should be placed");
    },
    emit: () => {},
    now: () => "2026-10-30T00:00:00.000Z",
    ...over,
  };
}

describe("a plan that only makes a theme", () => {
  const plan = { summary: "Autumn", pieces: [autumn] };

  it("is one step, with its name and colors", () => {
    const steps = planSteps(plan);
    assert.deepEqual(
      steps.map((s) => s.id),
      ["maketheme"],
    );
    assert.equal(steps[0].label, "Make the Autumn theme");
    assert.deepEqual(steps[0].colors, colors);
  });

  it("saves it and is done — no dashboard", async () => {
    const d = themeDeps();
    const state = await createPlanBuild(plan, d).run();
    assert.equal(state.status, "done");
    assert.deepEqual(d.calls, [["make", { name: "Autumn", colors }]]);
    assert.deepEqual(state.madeTheme, {
      key: "theme-1",
      name: "Autumn",
      colors,
    });
  });

  it("a save that fails stops the build and says why", async () => {
    const d = themeDeps({
      makeTheme: async () => {
        throw new Error('there\'s already a theme called "Autumn"');
      },
    });
    const state = await createPlanBuild(plan, d).run();
    assert.notEqual(state.status, "done");
    const step = state.steps.find((s) => s.id === "maketheme");
    assert.equal(step.status, "failed");
    assert.match(step.error, /already a theme called "Autumn"/);
    // A save can be tried again (review fix).
    assert.equal(step.canRetry, true);
  });
});

describe("a new theme on a dashboard you have", () => {
  const plan = {
    summary: "Kitchen Sink, in autumn colors",
    dashboard: { id: "7", name: "Kitchen Sink" },
    pieces: [autumn],
  };

  it("makes it, then applies the one it made", async () => {
    const steps = planSteps(plan).map((s) => s.id);
    assert.deepEqual(steps, ["dashboard", "maketheme", "theme"]);
    const d = themeDeps();
    const state = await createPlanBuild(plan, d).run();
    assert.equal(state.status, "done");
    const apply = d.calls.find((c) => c[0] === "apply")[1];
    // By the id it was saved under, not its name.
    assert.deepEqual(apply, { dashboardId: "7", theme: "theme-1" });
    assert.equal(state.theme.previous, "theme-dusk");
  });
});

describe("a saved theme is unchanged", () => {
  it("no maketheme step", () => {
    const plan = {
      summary: "Dusk",
      dashboard: { id: "7", name: "Kitchen Sink" },
      pieces: [{ kind: "theme", name: "Dusk", source: "yours" }],
    };
    assert.deepEqual(
      planSteps(plan).map((s) => s.id),
      ["dashboard", "theme"],
    );
  });
});

describe("a new theme with bots and no dashboard (review fix)", () => {
  it("isn't theme-only: the bots aren't dropped", () => {
    const plan = {
      summary: "x",
      pieces: [
        autumn,
        { kind: "bot", name: "A", source: "new" },
        { kind: "bot", name: "B", source: "new" },
      ],
    };
    const ids = planSteps(plan).map((s) => s.id);
    assert.ok(ids.includes("dashboard"));
    assert.ok(ids.includes("maketheme"));
  });
});

describe("a change to a saved theme (theme change round)", () => {
  const dusk = { kind: "theme", name: "Dusk", source: "update", colors };
  it("on its own: one step, no dashboard; Remove gets its old colors", async () => {
    const plan = { summary: "warmer", pieces: [dusk] };
    assert.deepEqual(
      planSteps(plan).map((s) => s.id),
      ["changetheme"],
    );
    assert.equal(planSteps(plan)[0].label, "Change the Dusk theme");
    const d = themeDeps({
      changeTheme: async (req) => {
        d.calls.push(["change", req]);
        return {
          key: "theme-dusk",
          name: "Dusk",
          remix: false,
          previous: { primary: "blue" },
        };
      },
    });
    const state = await createPlanBuild(plan, d).run();
    assert.equal(state.status, "done");
    assert.deepEqual(d.calls, [["change", { name: "Dusk", colors }]]);
    assert.equal(state.changedTheme.key, "theme-dusk");
    assert.deepEqual(state.built.changedTheme, {
      key: "theme-dusk",
      name: "Dusk",
      remix: false,
      previous: { primary: "blue" },
      replaced: [],
      appUsesOriginal: false,
    });
  });
  it("on a dashboard too: one step — the change reaches everywhere", async () => {
    const plan = {
      summary: "warmer",
      dashboard: { id: "7", name: "Kitchen Sink" },
      pieces: [dusk],
    };
    assert.deepEqual(
      planSteps(plan).map((s) => s.id),
      ["changetheme"],
    );
    const d = themeDeps({
      changeTheme: async () => ({
        key: "theme-remix",
        name: "Dusk (remix)",
        remix: true,
        of: { key: "theme-dusk", name: "Dusk" },
        replaced: [{ id: "7", name: "Kitchen Sink" }],
      }),
    });
    const state = await createPlanBuild(plan, d).run();
    assert.equal(state.status, "done");
    assert.equal(
      d.calls.some((c) => c[0] === "apply"),
      false,
    );
    // Remove puts the original back where the remix replaced it.
    assert.deepEqual(state.built.changedTheme.replaced, [
      { id: "7", name: "Kitchen Sink" },
    ]);
    assert.equal(state.built.changedTheme.of.key, "theme-dusk");
  });
  it("with a widget on a dashboard: dashboard, change, apply", () => {
    const plan = {
      summary: "x",
      dashboard: { id: "7", name: "Kitchen Sink" },
      pieces: [dusk, { kind: "widget", name: "Clock", source: "yours" }],
    };
    const ids = planSteps(plan).map((s) => s.id);
    assert.deepEqual(ids.slice(0, 3), ["dashboard", "changetheme", "theme"]);
  });
});
