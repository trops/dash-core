/**
 * Dashboard packages and today's listener lists (create-entry phase 5a): a
 * layout's listeners are lists of full event names
 * (listeners[handler] = ["Comp[id].event", …]). Export's eventWiring read a
 * list as an object ("0", "1", … as source widgets) and import wrote that
 * back over the real list — so imported dashboards lost their wiring. And a
 * package may now carry its team.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEventWiring,
  applyEventWiringToLayout,
} = require("./dashboardConfigUtils");
const { validateDashboardConfig } = require("./dashboardConfigValidator");

const layout = () => [
  {
    id: 2,
    component: "ai-built.ask.Ask",
    listeners: {
      showGreeting: ["other.W[4].ping", "bot:local/g[bot_1].result.greeting"],
    },
  },
  // The old object format still works.
  {
    id: 3,
    component: "old.Target",
    listeners: { refresh: { "old.Source": "onRefresh" } },
  },
];

test("lists aren't turned into wiring entries; the old format still is", () => {
  const wiring = extractEventWiring(layout());
  assert.deepEqual(wiring, [
    {
      // (the old format keeps the name before the first ".")
      source: { widget: "old", event: "refresh" },
      target: { widget: "old.Target", handler: "onRefresh" },
    },
  ]);
});

test("import never writes over a list the layout carries", () => {
  const l = layout();
  applyEventWiringToLayout(l, [
    // What the old export made from a list:
    {
      source: { widget: "other", event: "showGreeting" },
      target: { widget: "ai-built.ask.Ask", handler: "other.W[4].ping" },
    },
    {
      source: { widget: "old.Source", event: "refresh" },
      target: { widget: "old.Target", handler: "onRefresh" },
    },
  ]);
  assert.deepEqual(l[0].listeners.showGreeting, [
    "other.W[4].ping",
    "bot:local/g[bot_1].result.greeting",
  ]);
  assert.deepEqual(l[1].listeners.refresh, { "old.Source": "onRefresh" });
});

test("a dashboard config may carry its team", () => {
  const config = {
    schemaVersion: 1,
    name: "Ask Test",
    workspace: { id: 1, name: "Ask Test", layout: [] },
    widgets: [],
    providers: [],
    eventWiring: [],
    team: { schemaVersion: 1, type: "bot-team", name: "Ask Team", members: [] },
  };
  const v = validateDashboardConfig(config);
  assert.deepEqual(
    v.errors.filter((e) => /Unknown field/.test(e)),
    [],
  );
});
