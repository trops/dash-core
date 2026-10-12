/**
 * teamWidgets.test.js — a team inside a dashboard package carries its
 * results, its widget triggers and its result listeners, and an import
 * re-points them to the new bots and dashboard (create-entry phase 5a,
 * bot-teams TEAM-007 AC5, bot-factory US-027 AC1/AC7).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  wireTeam,
  wireWidgets,
  stripBotListeners,
} = require("./teamManifest");

const DASH = 77;
const greeter = {
  id: "bot_greet",
  name: "Greeter",
  workspaceId: DASH,
  instructions: "Greet.",
  publishes: [{ name: "greeting", label: "Greeting" }],
  subscriptions: [
    {
      eventType: "ai-built.ask.Ask[2].askClicked",
      source: {
        kind: "widget",
        ref: "ai-built.ask.Ask",
        instanceId: "2",
        event: "askClicked",
        workspaceId: String(DASH),
      },
      label: "Ask › askClicked",
      note: "say hi",
    },
    // Another dashboard's widget: can't travel.
    {
      eventType: "x.y.Z[9].go",
      source: {
        kind: "widget",
        ref: "x.y.Z",
        instanceId: "9",
        event: "go",
        workspaceId: "5",
      },
      label: "Z › go",
    },
  ],
};
const poster = {
  id: "bot_post",
  name: "Poster",
  workspaceId: DASH,
  instructions: "Post the greeting.",
  subscriptions: [
    {
      eventType: "bot:local/greeter[bot_greet].result.greeting",
      source: {
        kind: "bot",
        ref: "local/greeter",
        instanceId: "bot_greet",
        event: "result.greeting",
      },
      label: "Greeter › result.greeting",
    },
  ],
};
const workspace = {
  id: DASH,
  name: "Ask Test",
  layout: [
    {
      id: 2,
      component: "ai-built.ask.Ask",
      listeners: {
        showGreeting: [
          "bot:local/greeter[bot_greet].result.greeting",
          "other.W[4].ping",
        ],
      },
    },
    {
      id: 4,
      component: "other.W",
      listeners: { onlyBot: ["bot:local/greeter[bot_greet].result.greeting"] },
    },
  ],
  pages: [
    {
      id: "p1",
      layout: [
        {
          id: 2,
          component: "ai-built.ask.Ask",
          listeners: {
            showGreeting: ["bot:local/greeter[bot_greet].result.greeting"],
          },
        },
      ],
    },
  ],
};

const build = () =>
  buildTeamManifest({
    name: "Ask Team",
    bots: [greeter, poster],
    providers: [],
    dashboardId: DASH,
    workspace,
  });

describe("export: results, triggers and listeners travel by role", () => {
  it("members keep their results; bot → bot wiring can be on a result", () => {
    const { manifest } = build();
    const g = manifest.members.find((m) => m.role === "greeter");
    assert.deepEqual(g.embedded.publishes, [
      { name: "greeting", label: "Greeting", description: "" },
    ]);
    assert.deepEqual(manifest.wiring, [
      { role: "poster", on: { role: "greeter", event: "result.greeting" } },
    ]);
  });

  it("a widget on this dashboard that starts a bot is a trigger; others aren't included", () => {
    const { manifest, notIncluded } = build();
    assert.deepEqual(manifest.triggers, [
      {
        role: "greeter",
        widget: "2",
        component: "ai-built.ask.Ask",
        event: "askClicked",
        note: "say hi",
      },
    ]);
    assert.ok(notIncluded.some((n) => /Z › go/.test(n)));
  });

  it("widgets showing a bot's result are listeners, once each", () => {
    const { manifest } = build();
    assert.deepEqual(manifest.listeners, [
      {
        widget: "2",
        component: "ai-built.ask.Ask",
        handler: "showGreeting",
        role: "greeter",
        result: "greeting",
      },
      {
        widget: "4",
        component: "other.W",
        handler: "onlyBot",
        role: "greeter",
        result: "greeting",
      },
    ]);
  });

  it("the exported layout loses the bot entries (no bot ids), keeps the rest", () => {
    const ws = stripBotListeners(workspace, ["bot_greet", "bot_post"]);
    const text = JSON.stringify(ws);
    assert.doesNotMatch(text, /bot_greet|bot_post/);
    assert.deepEqual(ws.layout[0].listeners, {
      showGreeting: ["other.W[4].ping"],
    });
    assert.deepEqual(ws.layout[1].listeners, {});
    assert.deepEqual(ws.pages[0].layout[0].listeners, {});
    // The original is untouched.
    assert.equal(workspace.layout[1].listeners.onlyBot.length, 1);
  });

  it("the manifest round-trips through validation", () => {
    const { manifest } = build();
    const v = validateTeamManifest(JSON.parse(JSON.stringify(manifest)));
    assert.equal(v.valid, true, v.errors.join("; "));
    assert.deepEqual(v.manifest, manifest);
  });
});

describe("validation", () => {
  const base = () => JSON.parse(JSON.stringify(build().manifest));

  it("a listener must name a result its bot sends", () => {
    const m = base();
    m.listeners[0].result = "nope";
    const v = validateTeamManifest(m);
    assert.equal(v.valid, false);
    assert.match(v.errors.join(" "), /greeter doesn't send "nope"/);
  });

  it("triggers need a role, widget, component and event", () => {
    const m = base();
    m.triggers.push({ role: "ghost", widget: "2", component: "a", event: "b" });
    m.triggers.push({
      role: "greeter",
      widget: "2",
      component: "a",
      event: "has space",
    });
    const v = validateTeamManifest(m);
    assert.equal(v.valid, false);
    assert.equal(v.errors.filter((e) => /^trigger/.test(e)).length, 2);
  });

  it("results must have valid names", () => {
    const m = base();
    m.members[0].embedded.publishes.push({ name: "1bad" });
    assert.equal(validateTeamManifest(m).valid, false);
  });

  it("an older file without these fields is still fine", () => {
    const m = base();
    delete m.triggers;
    delete m.listeners;
    for (const mem of m.members) delete mem.embedded.publishes;
    const v = validateTeamManifest(m);
    assert.equal(v.valid, true);
    assert.deepEqual(v.manifest.triggers, []);
    assert.deepEqual(v.manifest.members[0].embedded.publishes, []);
  });
});

describe("install: re-pointed to the new bots and dashboard", () => {
  const { manifest } = validateTeamManifest(build().manifest);
  const plan = planTeamInstall(manifest, { workspaceId: 500, providers: [] });
  const created = {
    greeter: { id: "bot_new1", ref: "local/greeter", name: "Greeter" },
    poster: { id: "bot_new2", ref: "local/poster", name: "Poster" },
  };

  it("definitions keep their results; the plan carries triggers and listeners", () => {
    const g = plan.members.find((m) => m.role === "greeter");
    assert.deepEqual(g.definition.publishes, [
      { name: "greeting", label: "Greeting", description: "" },
    ]);
    assert.equal(plan.triggers.length, 1);
    assert.equal(plan.listeners.length, 2);
  });

  it("bot → bot results wire to the new bot", () => {
    const subs = wireTeam(plan.wiring, created);
    assert.equal(
      subs.poster[0].eventType,
      "bot:local/greeter[bot_new1].result.greeting",
    );
  });

  it("triggers become subscriptions on the new dashboard; listeners name the new bot", () => {
    const w = wireWidgets(plan, created, 500);
    assert.deepEqual(w.subscriptions.greeter, [
      {
        eventType: "ai-built.ask.Ask[2].askClicked",
        source: {
          kind: "widget",
          ref: "ai-built.ask.Ask",
          instanceId: "2",
          event: "askClicked",
          workspaceId: "500",
        },
        label: "Ask › askClicked",
        note: "say hi",
      },
    ]);
    assert.deepEqual(w.listeners[0], {
      widget: "2",
      component: "ai-built.ask.Ask",
      handler: "showGreeting",
      eventType: "bot:local/greeter[bot_new1].result.greeting",
    });
  });

  it("a bot left out takes its triggers and listeners with it", () => {
    const partial = planTeamInstall(manifest, {
      workspaceId: 500,
      providers: [],
      roles: ["poster"],
    });
    assert.deepEqual(partial.triggers, []);
    assert.deepEqual(partial.listeners, []);
  });
});

describe("controllers are wired (pins)", () => {
  const ctrl = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  const dash = fs.readFileSync(
    path.join(__dirname, "..", "controller", "dashboardConfigController.js"),
    "utf8",
  );
  it("export: the team, and the layout without bot listeners", () => {
    assert.match(ctrl, /^  teamForDashboard\(workspace,/m);
    assert.match(ctrl, /workspace: stripBotListeners\(/);
    assert.match(dash, /options\.includeBots === false/);
    assert.match(
      dash,
      /\.\.\.\(teamExport\.team \? \{ team: teamExport\.team \} : \{\}\)/,
    );
  });
  it("import: bots installed paused and wired to the new dashboard", () => {
    assert.match(ctrl, /^  installDashboardTeam\(workspaceId, manifest\)/m);
    assert.match(
      ctrl,
      /const widgetWiring = wireWidgets\(plan, created, dashboardId\);/,
    );
    assert.match(
      ctrl,
      /addWidgetListener\(ws, l\.widget, l\.handler, l\.eventType, l\.component\)/,
    );
    assert.match(ctrl, /this\._pause\.pauseBot\(bot\.id\);/);
    assert.match(
      dash,
      /botsSummary = installTeamForImport\(workspace\.id, dashboardConfig\.team\);/,
    );
  });
});

describe("Bot results widgets keep their bot (5b)", () => {
  const ws = {
    id: 77,
    layout: [
      {
        id: 6,
        component: "dash.bots.BotResults",
        userPrefs: { botId: "bot_greet" },
      },
      {
        id: 7,
        component: "dash.bots.BotResults",
        userPrefs: { botId: "bot_other" },
      },
    ],
  };
  const g = {
    id: "bot_greet",
    name: "Greeter",
    workspaceId: 77,
    instructions: "Greet.",
  };
  it("export names the role a results widget shows; import plans to rebind it", () => {
    const { manifest } = buildTeamManifest({
      name: "T",
      bots: [g],
      providers: [],
      dashboardId: 77,
      workspace: ws,
    });
    assert.deepEqual(manifest.resultWidgets, [
      { widget: "6", role: "greeter" },
    ]);
    const v = validateTeamManifest(JSON.parse(JSON.stringify(manifest)));
    assert.equal(v.valid, true);
    const plan = planTeamInstall(v.manifest, { workspaceId: 1, providers: [] });
    assert.deepEqual(plan.resultWidgets, [{ widget: "6", role: "greeter" }]);
    const bad = JSON.parse(JSON.stringify(manifest));
    bad.resultWidgets.push({ widget: "9", role: "ghost" });
    assert.equal(validateTeamManifest(bad).valid, false);
  });
  it("the controller rebinds them with setWidgetPrefs", () => {
    const ctrl = fs.readFileSync(
      path.join(__dirname, "..", "controller", "botController.js"),
      "utf8",
    );
    assert.match(ctrl, /for \(const r of plan\.resultWidgets \|\| \[\]\)/);
    assert.match(
      ctrl,
      /setWidgetPrefs\(ws, r\.widget, \{ botId: bot\.id \}, BOT_WIDGETS\.results\)/,
    );
  });
});
