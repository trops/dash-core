/**
 * planBuildSettings.test.js — a change to only a widget's settings
 * (lead-workspace release 6c, frame 40): one step sets them on that copy of
 * the widget; nothing is built, no AI role is asked. And the plan check:
 * exactly that widget, source "settings".
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { planSteps, createPlanBuild } = require("./planBuild");
const { validatePlan } = require("./teamPlan");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);

const plan = {
  summary: "°C and 3 days",
  pieces: [
    {
      kind: "widget",
      name: "Weather",
      source: "settings",
      settings: { units: "c", days: 3 },
    },
  ],
};
const where = {
  workspaceId: 7,
  itemId: 12,
  pageId: "p1",
  scope: "main",
  component: "trops.weather.Weather",
  displayName: "Weather",
};

function deps(over = {}) {
  const calls = [];
  return {
    calls,
    setWidgetSettings: async (req) => {
      calls.push(req);
      return {
        dashboard: { id: "7", name: "Kitchen Sink" },
        changed: Object.keys(req.settings),
        dropped: [],
      };
    },
    askRole: async () => {
      throw new Error("a settings change asked an AI role");
    },
    installWidget: async () => {
      throw new Error("a settings change installed something");
    },
    emit: () => {},
    now: () => "2026-10-29T00:00:00.000Z",
    ...over,
  };
}

describe("settings changes — steps", () => {
  it("one step, named for the widget", () => {
    const steps = planSteps(plan, { settings: where });
    assert.deepEqual(
      steps.map((s) => [s.id, s.kind, s.label]),
      [["settings:0", "settings", "Change Weather's settings"]],
    );
  });
});

describe("settings changes — running", () => {
  it("sets them on that copy; done, on its dashboard; no AI", async () => {
    const d = deps();
    const state = await createPlanBuild(plan, d, { settings: where }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(d.calls, [
      { ...where, settings: { units: "c", days: 3 } },
    ]);
    assert.deepEqual(state.dashboard, {
      id: "7",
      name: "Kitchen Sink",
      targeted: true,
    });
    assert.equal(state.steps[0].detail, "units, days");
  });

  it("a widget that's gone: the step fails, saying why", async () => {
    const d = deps({
      setWidgetSettings: async () => {
        throw new Error("That widget isn't on the dashboard any more.");
      },
    });
    const state = await createPlanBuild(plan, d, { settings: where }).run();
    assert.equal(state.steps[0].status, "failed");
    assert.match(state.steps[0].error, /isn't on the dashboard any more/);
  });
});

describe("settings changes — the plan check", () => {
  it("that one widget, source settings, with what changes", () => {
    assert.deepEqual(validatePlan(plan, { settings: true }).errors, []);
  });
  it("more than the widget, or no settings: not a settings change", () => {
    const two = {
      ...plan,
      pieces: [...plan.pieces, { kind: "bot", name: "B", source: "new" }],
    };
    assert.equal(validatePlan(two, { settings: true }).valid, false);
    const none = {
      ...plan,
      pieces: [{ ...plan.pieces[0], settings: {} }],
    };
    assert.equal(validatePlan(none, { settings: true }).valid, false);
  });
  it("source settings anywhere else is refused", () => {
    const r = validatePlan(plan, {});
    assert.equal(r.valid, false);
    assert.match(r.errors.join(" "), /Only the widget being changed/);
  });
});

describe("settings changes — the main process", () => {
  it("startPlanBuild takes the copy, drops the plan's dashboard, checks it as a settings change", () => {
    assert.match(ctrl, /settings = null,\n    \} = \{\},\n  \) \{/);
    assert.match(ctrl, /settings: !!settingsOf,/);
    assert.match(
      ctrl,
      /setWidgetSettings: \(req\) => this\._planSetWidgetSettings\(req\)/,
    );
  });
  it("sets only the settings the widget has, on that item, and saves", () => {
    assert.match(ctrl, /async _planSetWidgetSettings\(\{/);
    assert.match(
      ctrl,
      /keys = src && src\.success \? settingKeys\(src\.configCode\) : null;/,
    );
    assert.match(
      ctrl,
      /const next = setItemPrefs\(ws, \{ itemId, component, pageId, scope \}, prefs\);/,
    );
    assert.match(
      ctrl,
      /Its settings couldn.t be read, so nothing was changed\./,
    );
  });
});

// One copy of the widget (review fix): that page, or the pinned sidebar.
describe("setItemPrefs — one copy", () => {
  const { setItemPrefs } = require("../utils/placeWidget");
  const W = "trops.weather.Weather";
  const item = (prefs = {}) => ({ id: 2, component: W, userPrefs: prefs });
  const paged = () => ({
    id: 7,
    activePageId: "a",
    layout: [item({ units: "f" })],
    pages: [
      { id: "a", layout: [item({ units: "f" })] },
      { id: "b", layout: [item({ units: "f" })] },
    ],
    sidebarLayout: [item({ units: "f" })],
  });
  const units = (ws) => ({
    top: ws.layout[0].userPrefs.units,
    a: ws.pages[0].layout[0].userPrefs.units,
    b: ws.pages[1].layout[0].userPrefs.units,
    side: ws.sidebarLayout[0].userPrefs.units,
  });

  it("another page's copy: only that one", () => {
    const ws = setItemPrefs(
      paged(),
      { itemId: 2, component: W, pageId: "b" },
      { units: "c" },
    );
    assert.deepEqual(units(ws), { top: "f", a: "f", b: "c", side: "f" });
  });
  it("the shown page's copy: it and the top-level mirror", () => {
    const ws = setItemPrefs(
      paged(),
      { itemId: 2, component: W, pageId: "a" },
      { units: "c" },
    );
    assert.deepEqual(units(ws), { top: "c", a: "c", b: "f", side: "f" });
  });
  it("the pinned sidebar's: only that one", () => {
    const ws = setItemPrefs(
      paged(),
      { itemId: 2, component: W, scope: "sidebar" },
      { units: "c" },
    );
    assert.deepEqual(units(ws), { top: "f", a: "f", b: "f", side: "c" });
  });
  it("a dashboard saved with the bare name still matches; another widget doesn't", () => {
    const ws = {
      id: 7,
      layout: [{ id: 2, component: "Weather", userPrefs: {} }],
    };
    assert.equal(
      setItemPrefs(ws, { itemId: 2, component: W }, { units: "c" }).layout[0]
        .userPrefs.units,
      "c",
    );
    assert.equal(
      setItemPrefs(ws, { itemId: 2, component: "trops.clock.Clock" }, { a: 1 }),
      null,
    );
  });
  it("not there: null", () => {
    assert.equal(
      setItemPrefs(
        paged(),
        { itemId: 9, component: W, pageId: "a" },
        { units: "c" },
      ),
      null,
    );
    assert.equal(
      setItemPrefs(
        paged(),
        { itemId: 2, component: W, pageId: "zz" },
        { units: "c" },
      ),
      null,
    );
  });
});
