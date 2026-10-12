/**
 * planBuild.test.js — building an approved plan (create-entry CRE-004,
 * TD-008; phase 4d-1), with fake hooks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  publishesRaw,
  widgetWiring,
  planBotDefinition,
  triggerSubscription,
  wiringLines,
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

describe("bots and wiring (phase 4d-2)", () => {
  const wired = {
    summary: "Ask",
    pieces: [
      {
        kind: "widget",
        name: "Ask button",
        source: "new",
        events: ["askClicked"],
        listens: [
          { bot: "Greeter", result: "greeting", handler: "showGreeting" },
        ],
      },
      {
        kind: "bot",
        name: "Greeter",
        source: "new",
        instructions: "Greet.",
        results: [{ name: "greeting" }],
        on: [{ widget: "Ask button", event: "askClicked" }],
        showResults: true,
      },
      { kind: "layout", name: "Ask Test", source: "new" },
    ],
  };
  function wiredDeps(over = {}) {
    const d = deps({
      askRole: async (role) =>
        role === "builder"
          ? { status: "completed", output: "@ai-built/askbutton" }
          : { status: "completed", output: "VERDICT: PASSED" },
      placeWidget: async (req) => {
        d.calls.push(["place", req.widget]);
        return { component: "ai-built.askbutton.AskButton", widgetId: 5 };
      },
      saveBot: async ({ dashboardId, piece }) => {
        d.calls.push(["saveBot", dashboardId, piece.name]);
        return { id: "bot_9", name: piece.name };
      },
      placeBotResults: async ({ botId }) => {
        d.calls.push(["results", botId]);
        return { component: "dash.bots.BotResults", widgetId: 6 };
      },
      wireTrigger: async (req) => d.calls.push(["trigger", req]),
      wireListener: async (req) => d.calls.push(["listen", req]),
      ...over,
    });
    return d;
  }

  it("steps: place, then save the bot, show its results, wire both ways", () => {
    assert.deepEqual(
      planSteps(wired).map((s) => s.id),
      [
        "dashboard",
        "build:0",
        "check:0",
        "place:0",
        "bot:0",
        "results:0",
        "trigger:0:0",
        "listen:0:0",
      ],
    );
  });

  it("saves the bot on the new dashboard and wires the placed widget's id", async () => {
    const d = wiredDeps();
    const state = await createPlanBuild(wired, d).run();
    assert.equal(state.status, "done");
    assert.deepEqual(state.bots, { 0: { id: "bot_9", name: "Greeter" } });
    assert.deepEqual(
      d.calls.find((c) => c[0] === "saveBot"),
      ["saveBot", "77", "Greeter"],
    );
    assert.deepEqual(
      d.calls.find((c) => c[0] === "results"),
      ["results", "bot_9"],
    );
    assert.deepEqual(d.calls.find((c) => c[0] === "trigger")[1], {
      dashboardId: "77",
      botId: "bot_9",
      widgetId: 5,
      component: "ai-built.askbutton.AskButton",
      event: "askClicked",
    });
    assert.deepEqual(d.calls.find((c) => c[0] === "listen")[1], {
      dashboardId: "77",
      widgetId: 5,
      component: "ai-built.askbutton.AskButton",
      handler: "showGreeting",
      botId: "bot_9",
      result: "greeting",
    });
    const t = state.steps.find((s) => s.id === "trigger:0:0");
    assert.equal(t.detail, "ai-built.askbutton.AskButton[5].askClicked");
    assert.equal(t.role, "dash");
  });

  it("a widget that wasn't placed skips its wiring; the bot is still saved", async () => {
    const d = wiredDeps({
      askRole: async () => ({ status: "completed", output: "no package" }),
    });
    const state = await createPlanBuild(wired, d).run();
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    assert.equal(by["bot:0"].status, "done");
    assert.equal(by["results:0"].status, "done");
    assert.equal(by["trigger:0:0"].status, "skipped");
    assert.equal(by["listen:0:0"].status, "skipped");
    assert.match(by["trigger:0:0"].error, /Place Ask button didn't finish/);
  });

  it("a wiring failure names what's missing and doesn't stop the rest", async () => {
    const d = wiredDeps({
      wireTrigger: async () => {
        throw new Error('Ask button doesn\'t send "askClicked"');
      },
    });
    const state = await createPlanBuild(wired, d).run();
    const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));
    assert.equal(by["trigger:0:0"].status, "failed");
    assert.match(by["trigger:0:0"].error, /doesn't send "askClicked"/);
    assert.equal(by["listen:0:0"].status, "done");
    assert.equal(state.status, "finished-with-problems");
  });

  it("the Builder is told the events and handlers to declare", () => {
    const lines = wiringLines(wired, wired.pieces[0]).join("\n");
    assert.match(
      lines,
      /publishEvent .*askClicked \(they start the Greeter bot/,
    );
    assert.match(
      lines,
      /event handler showGreeting .*Greeter bot's "greeting" result/,
    );
  });
});

describe("saved bots and triggers (phase 4d-2)", () => {
  const sources = [
    {
      name: "Work Gmail",
      type: "gmail",
      tools: ["search_emails", "send_email"],
    },
  ];
  it("a planned bot becomes a definition with its providers and tools chosen", () => {
    const def = planBotDefinition(
      {
        name: "Inbox digest",
        instructions: "Summarize unread mail.",
        tools: [{ provider: "gmail", tools: ["search_emails"] }],
        schedule: { cron: "0 8 * * *" },
        results: [{ name: "digest", label: "Digest" }],
      },
      { dashboardId: "77", sources, team: [] },
    );
    assert.equal(def.name, "Inbox digest");
    assert.equal(def.workspaceId, "77");
    assert.deepEqual(def.mcpServers, ["Work Gmail"]);
    assert.deepEqual(def.toolSelections, { "Work Gmail": ["search_emails"] });
    assert.deepEqual(def.schedules, [{ cron: "0 8 * * *" }]);
    assert.deepEqual(def.publishes, [{ name: "digest", label: "Digest" }]);
    assert.equal(def.approvalPolicy, "ask");
  });
  it("a provider that isn't connected fails instead of saving a bot that can't work", () => {
    assert.throws(
      () =>
        planBotDefinition(
          {
            name: "Poster",
            instructions: "Post.",
            tools: [{ provider: "slack", tools: [] }],
          },
          { dashboardId: "77", sources, team: [] },
        ),
      /Poster needs slack, which isn't connected/,
    );
  });
  it("a trigger is the placed widget's exact event on that dashboard", () => {
    assert.deepEqual(
      triggerSubscription({
        dashboardId: 77,
        widgetId: 5,
        component: "ai-built.ask.Ask",
        event: "askClicked",
      }),
      {
        eventType: "ai-built.ask.Ask[5].askClicked",
        source: {
          kind: "widget",
          ref: "ai-built.ask.Ask",
          instanceId: "5",
          event: "askClicked",
          workspaceId: "77",
        },
        label: "Ask › askClicked",
      },
    );
  });
});

describe("widgetWiring — what a built widget sends and handles (4d-2)", () => {
  it("reads events and eventHandlers from the .dash.js source", () => {
    const src = [
      'import { AskWireTest } from "./AskWireTest";',
      "export default {",
      "  component: AskWireTest,",
      '  type: "widget",',
      '  events: ["askClicked", { name: "reset" }],',
      '  eventHandlers: ["showGreeting"],',
      "  userConfig: {},",
      "};",
    ].join("\n");
    assert.deepEqual(widgetWiring(src), {
      events: ["askClicked", "reset"],
      handlers: ["showGreeting"],
      rawPublish: false,
    });
  });
  it("none declared → empty lists; unreadable → null (not checked)", () => {
    assert.deepEqual(widgetWiring('export default { type: "widget" };'), {
      events: [],
      handlers: [],
      rawPublish: false,
    });
    assert.equal(widgetWiring(""), null);
    assert.equal(widgetWiring("not a config"), null);
  });
});

describe("raw api.publishEvent — bots can't hear it (4d-2)", () => {
  it("spots api.publishEvent, not useWidgetEvents' publishEvent", () => {
    assert.equal(
      publishesRaw('props.api.publishEvent("askClicked", {})'),
      true,
    );
    assert.equal(publishesRaw("api?.publishEvent('x')"), true);
    assert.equal(
      publishesRaw("const { api } = props; api . publishEvent ( 'x' )"),
      true,
    );
    assert.equal(
      publishesRaw(
        'const { publishEvent } = useWidgetEvents(); publishEvent("askClicked", {});',
      ),
      false,
    );
    assert.equal(publishesRaw("props.publishEvent('x')"), false);
  });
  it("widgetWiring reports it from the component code", () => {
    const cfg = 'export default { type: "widget", events: ["askClicked"] };';
    assert.equal(
      widgetWiring(cfg, "props.api.publishEvent('askClicked')").rawPublish,
      true,
    );
  });
  it("an action widget's Builder request asks for useWidgetEvents, a title and a sent status", () => {
    const lines = wiringLines(
      {
        pieces: [
          {
            kind: "bot",
            name: "G",
            source: "new",
            on: [{ widget: "Ask", event: "go" }],
          },
        ],
      },
      { kind: "widget", name: "Ask", source: "new", events: ["go"] },
    ).join("\n");
    assert.match(
      lines,
      /publishEvent from useWidgetEvents \(never api\.publishEvent/,
    );
    assert.match(lines, /action widget: give it a title.*sent status/);
  });
});
