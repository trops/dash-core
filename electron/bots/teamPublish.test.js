/**
 * teamPublish.test.js — dashboards publish with their bots (create-entry
 * phase 5a-2, bot-factory US-027): the registry gets a display summary and
 * provider types; the publish screen describes each bot; the install
 * preview carries the summary.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  validateTeamManifest,
  teamSummaryFor,
  teamProviderTypes,
  describeTeam,
} = require("./teamManifest");
const {
  generateRegistryManifest,
  buildDashboardPreview,
  buildWidgetDependencies,
  collectDependencyRefsFromWorkspace,
} = require("../schema/dashboardConfigUtils");

const { manifest: team } = validateTeamManifest({
  schemaVersion: 1,
  type: "bot-team",
  name: "Ask Team",
  members: [
    {
      role: "greeter",
      embedded: {
        type: "bot",
        name: "Greeter",
        instructions: "Greet.",
        schedules: [{ cron: "0 9 * * *", prompt: "" }],
        providers: [{ type: "gmail", tools: null }],
        publishes: [{ name: "greeting", label: "Greeting" }],
      },
    },
    {
      role: "poster",
      embedded: {
        type: "bot",
        name: "Poster",
        instructions: "Post.",
        providers: [
          { type: "slack", tools: ["post"] },
          { type: "gmail", tools: null },
        ],
      },
    },
  ],
  wiring: [
    { role: "poster", on: { role: "greeter", event: "result.greeting" } },
  ],
  triggers: [
    {
      role: "greeter",
      widget: "2",
      component: "ai-built.ask.Ask",
      event: "askClicked",
    },
  ],
  listeners: [],
});

describe("the registry's summary", () => {
  it("roles, names and bot → bot wiring — no instructions", () => {
    assert.deepEqual(teamSummaryFor(team), {
      members: [
        { role: "greeter", name: "Greeter" },
        { role: "poster", name: "Poster" },
      ],
      wiring: [
        { role: "poster", on: { role: "greeter", event: "result.greeting" } },
      ],
    });
    assert.deepEqual(teamProviderTypes(team), ["gmail", "slack"]);
  });

  it("a dashboard manifest carries it, and the provider types", () => {
    const m = generateRegistryManifest(
      {
        name: "Ask Test",
        description: "",
        workspace: { layout: [] },
        widgets: [],
        providers: [],
        team,
      },
      {
        githubUser: "me",
        callerScope: "me",
        appOrigin: "@trops/dash-electron",
      },
    );
    assert.deepEqual(m.team, teamSummaryFor(team));
    assert.deepEqual(m.providerTypes, ["gmail", "slack"]);
    assert.doesNotMatch(JSON.stringify(m), /Greet\.|Post\./);
  });

  it("no bots, no summary", () => {
    const m = generateRegistryManifest(
      { name: "Plain", workspace: { layout: [] }, widgets: [], providers: [] },
      { githubUser: "me", callerScope: "me", appOrigin: "x" },
    );
    assert.equal(m.team, undefined);
  });

  it("the install preview passes the summary through", () => {
    const p = buildDashboardPreview({
      name: "Ask Test",
      team: teamSummaryFor(team),
      providerTypes: ["gmail"],
    });
    assert.equal(p.team.members.length, 2);
    assert.deepEqual(p.providerTypes, ["gmail"]);
    assert.equal(buildDashboardPreview({ name: "Plain" }).team, null);
  });
});

describe("the publish screen's words", () => {
  it("what starts each bot and what it uses", () => {
    assert.deepEqual(describeTeam(team), [
      {
        role: "greeter",
        name: "Greeter",
        starts: ["on a schedule", "when Ask sends askClicked"],
        providers: ["gmail"],
      },
      {
        role: "poster",
        name: "Poster",
        starts: ["when Greeter sends its greeting result"],
        providers: ["slack", "gmail"],
      },
    ]);
  });
});

describe("publish is wired (pins)", () => {
  const dash = fs.readFileSync(
    path.join(__dirname, "..", "controller", "dashboardConfigController.js"),
    "utf8",
  );
  it("publish includes the team unless left out, like Export", () => {
    const at = dash.indexOf("async function prepareDashboardForPublish");
    const end = dash.indexOf("\n/**", at + 10);
    const body = dash.slice(at, end > at ? end : undefined);
    assert.match(body, /options\.includeBots === false/);
    assert.match(
      body,
      /\.\.\.\(teamExport\.team \? \{ team: teamExport\.team \} : \{\}\)/,
    );
    assert.match(body, /notIncluded: teamExport\.notIncluded/);
  });
  it("the publish preview describes the bots", () => {
    assert.match(
      dash,
      /bots: teamExport\.team \? describeTeam\(teamExport\.team\) : \[\]/,
    );
  });
});

describe("publishing registry widgets: versions are pinned (bug fixed in 5a-2)", () => {
  const registry = {
    getWidgets: () => [
      {
        name: "@trops/clock",
        packageId: "@trops/clock",
        scope: "trops",
        version: "0.0.882",
        componentNames: ["AnalogClockWidget", "DigitalClockWidget"],
      },
    ],
  };
  const workspace = {
    layout: [
      { id: 1, component: "LayoutGridContainer" },
      {
        id: 2,
        component: "trops.clock.DigitalClockWidget",
        packageId: "@trops/clock",
      },
    ],
  };
  it("a layout item's packageId finds the installed version", () => {
    const deps = buildWidgetDependencies(
      collectDependencyRefsFromWorkspace(workspace),
      registry,
    );
    assert.equal(deps.length, 1);
    assert.equal(deps[0].version, "0.0.882");
    assert.equal(deps[0].scope, "trops");
  });
  it("bare component names (what publish used) come out unpinned", () => {
    const deps = buildWidgetDependencies(
      ["trops.clock.DigitalClockWidget"],
      registry,
    );
    assert.equal(deps[0].version, "*");
  });
  it("publish uses the packageId refs, and has fs for the permissions step", () => {
    const dash = fs.readFileSync(
      path.join(__dirname, "..", "controller", "dashboardConfigController.js"),
      "utf8",
    );
    const at = dash.indexOf("async function prepareDashboardForPublish");
    const end = dash.indexOf("\n/**", at + 10);
    const body = dash.slice(at, end);
    assert.match(
      body,
      /buildWidgetDependencies\(\s*collectDependencyRefsFromWorkspace\(workspace\),/,
    );
    assert.match(dash, /^const fs = require\("fs"\);$/m);
  });
});

describe("built-in bot widgets are not registry dependencies (5b)", () => {
  it("Bot results and Bot activity are left out", () => {
    const deps = buildWidgetDependencies(
      [
        { component: "dash.bots.BotResults", packageId: null },
        { component: "dash.bots.BotActivity", packageId: null },
        {
          component: "trops.clock.DigitalClockWidget",
          packageId: "@trops/clock",
        },
      ],
      {
        getWidgets: () => [
          {
            name: "@trops/clock",
            packageId: "@trops/clock",
            scope: "trops",
            version: "1.0.0",
            componentNames: [],
          },
        ],
      },
    );
    assert.deepEqual(
      deps.map((d) => d.widgetName),
      ["DigitalClockWidget"],
    );
  });
});
