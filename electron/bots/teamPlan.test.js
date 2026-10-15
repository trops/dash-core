/**
 * teamPlan.test.js — the Dash team's plan format, checked against the six
 * walked-through scenarios (docs: dash-electron dash-team-scenarios.md).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractPlan, planTarget, validatePlan } = require("./teamPlan");

const PROVIDERS = ["gmail", "github", "slack", "algolia"];

// The six scenarios, written as the plans the Planner should produce.
const SCENARIOS = {
  "1 gmail unread widget": {
    summary: "A widget with your unread Gmail count",
    pieces: [
      {
        kind: "widget",
        name: "Gmail unread",
        source: "new",
        providers: ["gmail"],
      },
    ],
    beforeBuilding: [{ kind: "connect", what: "Gmail" }],
    checks: ["Shows a number that matches Gmail's unread count"],
    estimate: { build: "about $0.15 (tokens included in your plan)" },
  },
  "2 PR digest bot + results widget": {
    summary: "A morning PR digest bot and a widget showing its results",
    pieces: [
      {
        kind: "bot",
        name: "PR digest",
        source: "new",
        providers: ["github"],
        notes: "Weekdays 8am; publishes digest",
        instructions: "Summarize yesterday's open pull requests.",
      },
      {
        kind: "widget",
        name: "Bot results",
        source: "yours",
        package: "dash.bots.BotResults",
      },
    ],
    beforeBuilding: [{ kind: "approve", what: "the PR digest bot" }],
    checks: ["The bot's first run publishes a digest the widget shows"],
    estimate: { build: "about $0.10", running: "about $0.04 per run" },
  },
  "3 date filter on existing widget": {
    summary: "Add a date filter to your Inbox widget",
    pieces: [
      {
        kind: "widget",
        name: "Inbox",
        source: "update",
        package: "@ai-built/inbox",
      },
    ],
    beforeBuilding: [],
    checks: ["Old settings still work", "Filtering by date narrows the list"],
    estimate: { build: "about $0.08" },
  },
  "4 algolia from the registry": {
    summary: "An Algolia search widget",
    pieces: [
      {
        kind: "widget",
        name: "Algolia Search",
        source: "registry",
        package: "@trops/algolia",
        providers: ["algolia"],
      },
    ],
    beforeBuilding: [{ kind: "install", what: "@trops/algolia" }],
    checks: [],
    estimate: { build: "nothing to build" },
  },
  "5 slack summary bot": {
    summary: "A bot that posts your daily summary to Slack",
    pieces: [
      {
        kind: "bot",
        name: "Daily summary",
        source: "new",
        providers: ["slack"],
        notes: "Can post to Slack (slack_post_message only)",
        instructions: "Post the day's summary to #general.",
      },
    ],
    beforeBuilding: [{ kind: "approve", what: "the Daily summary bot" }],
    checks: ["Its first post lands in the chosen channel"],
    estimate: { build: "about $0.08", running: "about $0.05 per run" },
  },
  "6 morning brief dashboard": {
    summary: "A morning brief dashboard: calendar, email and Slack",
    questions: [{ question: "Which calendar?", options: ["Work", "Personal"] }],
    pieces: [
      {
        kind: "widget",
        name: "Calendar",
        source: "registry",
        package: "@acme/calendar",
        providers: ["google-calendar"],
      },
      {
        kind: "widget",
        name: "Inbox count",
        source: "ai-built",
        package: "@ai-built/inboxcount",
        providers: ["gmail"],
      },
      {
        kind: "widget",
        name: "Slack channels",
        source: "yours",
        package: "@trops/slack",
        providers: ["slack"],
      },
      { kind: "layout", name: "Morning brief", source: "new" },
    ],
    beforeBuilding: [
      { kind: "connect", what: "Google Calendar (google-calendar)" },
      { kind: "install", what: "@acme/calendar" },
    ],
    checks: ["All three widgets show data"],
    estimate: { build: "about $0.60–1.00", running: "about $1.70/month" },
  },
};

describe("validatePlan — the six scenarios", () => {
  for (const [name, plan] of Object.entries(SCENARIOS)) {
    it(`scenario ${name} is a valid plan`, () => {
      const res = validatePlan(plan, { providers: PROVIDERS });
      assert.deepEqual(res.errors, []);
      assert.equal(res.valid, true);
    });
  }
});

describe("validatePlan — what it catches", () => {
  it("a plan with only questions is fine; an empty one isn't", () => {
    assert.equal(
      validatePlan({
        summary: "x",
        questions: [{ question: "Which account?" }],
        estimate: { build: "?" },
      }).valid,
      true,
    );
    const empty = validatePlan({ summary: "x", estimate: { build: "?" } });
    assert.equal(empty.valid, false);
    assert.match(empty.errors.join(" "), /needs pieces, or questions/);
  });

  it("bad kinds and sources, missing names and packages", () => {
    const res = validatePlan({
      summary: "x",
      pieces: [
        { kind: "gadget", name: "a", source: "new" },
        { kind: "widget", source: "magic" },
        { kind: "widget", name: "b", source: "yours" },
      ],
      estimate: { build: "?" },
    });
    const all = res.errors.join(" | ");
    assert.match(all, /pieces\[0\]\.kind/);
    assert.match(all, /pieces\[1\] has no name/);
    assert.match(all, /pieces\[1\]\.source/);
    assert.match(all, /pieces\[2\] \(yours\) must say which package/);
  });

  it("a provider the user hasn't connected must be in beforeBuilding", () => {
    const res = validatePlan(
      {
        summary: "x",
        pieces: [
          { kind: "widget", name: "w", source: "new", providers: ["notion"] },
        ],
        checks: ["works"],
        estimate: { build: "?" },
      },
      { providers: PROVIDERS },
    );
    assert.match(res.errors.join(" "), /needs notion, which isn't connected/);
  });

  it("warns about a registry widget with no install step, and builds with no checks", () => {
    const res = validatePlan({
      summary: "x",
      pieces: [
        { kind: "widget", name: "a", source: "registry", package: "@x/a" },
        { kind: "widget", name: "b", source: "new" },
      ],
      estimate: { build: "?" },
    });
    assert.equal(res.valid, true);
    assert.equal(res.warnings.length, 2);
  });

  it("needs a summary and an estimate", () => {
    const res = validatePlan({
      pieces: [{ kind: "layout", name: "l", source: "new" }],
    });
    assert.match(res.errors.join(" "), /summary is missing/);
    assert.match(res.errors.join(" "), /estimate\.build is missing/);
    assert.equal(validatePlan(null).valid, false);
  });
});

describe("extractPlan", () => {
  it("reads the JSON inside <plan>, with or without a code fence", () => {
    const plan = SCENARIOS["4 algolia from the registry"];
    assert.deepEqual(
      extractPlan(`You have it already.\n<plan>${JSON.stringify(plan)}</plan>`),
      plan,
    );
    assert.deepEqual(
      extractPlan(
        `<plan>\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\n</plan>`,
      ),
      plan,
    );
  });

  it("null when there's no plan or it isn't JSON", () => {
    assert.equal(extractPlan("no plan here"), null);
    assert.equal(extractPlan("<plan>{not json</plan>"), null);
  });
});

describe("validatePlan — access (phase 4a, CRE-003 AC5)", () => {
  const base = {
    summary: "x",
    pieces: [
      { kind: "bot", name: "Digest", source: "new", instructions: "Digest." },
    ],
    estimate: { build: "?" },
  };
  it("accepts access lines; warns when bots come without them", () => {
    const ok = validatePlan({
      ...base,
      access: ["Bots can read Gmail", "None can send email"],
    });
    assert.ok(!ok.warnings.some((w) => /can and can't/.test(w)));
    assert.match(validatePlan(base).warnings.join(" "), /can and can't do/);
  });
  it("rejects access that isn't a list of sentences", () => {
    assert.match(
      validatePlan({ ...base, access: "read" }).errors.join(" "),
      /access must be a list/,
    );
  });
});

describe("validatePlan — bots and wiring (phase 4d-2)", () => {
  const plan = (pieces) => ({
    summary: "Ask",
    pieces,
    checks: ["the bot answers"],
    access: ["The bot reads nothing"],
    estimate: { build: "?" },
  });
  const button = {
    kind: "widget",
    name: "Ask button",
    source: "new",
    events: ["askClicked"],
    listens: [{ bot: "Greeter", result: "greeting", handler: "showGreeting" }],
  };
  const bot = {
    kind: "bot",
    name: "Greeter",
    source: "new",
    instructions: "Write a one-line greeting.",
    results: [{ name: "greeting" }],
    on: [{ widget: "Ask button", event: "askClicked" }],
    showResults: true,
  };

  it("a wired widget and bot are a valid plan", () => {
    const res = validatePlan(plan([button, bot]));
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings, []);
  });

  it("a new bot needs instructions", () => {
    const { instructions: _i, ...bare } = bot;
    assert.match(
      validatePlan(plan([button, bare])).errors.join(" "),
      /a new bot\) needs instructions/,
    );
  });

  it("on must name a widget in the plan; an unlisted event warns", () => {
    const stray = { ...bot, on: [{ widget: "Nope", event: "x" }] };
    assert.match(
      validatePlan(plan([button, stray])).errors.join(" "),
      /names "Nope", which isn't a widget in the plan/,
    );
    const odd = { ...bot, on: [{ widget: "Ask button", event: "other" }] };
    assert.match(
      validatePlan(plan([button, odd])).warnings.join(" "),
      /doesn't list the event "other"/,
    );
  });

  it("listens must name a bot in the plan, with a result and a handler", () => {
    const w = {
      ...button,
      listens: [{ bot: "Ghost", result: "r", handler: "h" }],
    };
    assert.match(
      validatePlan(plan([w, bot])).errors.join(" "),
      /names "Ghost", which isn't a bot in the plan/,
    );
    const half = { ...button, listens: [{ bot: "Greeter" }] };
    assert.match(
      validatePlan(plan([half, bot])).errors.join(" "),
      /needs a bot, a result and a handler/,
    );
  });
});

describe("validatePlan — changing a dashboard you have (5e-2b)", () => {
  const clock = {
    kind: "widget",
    name: "Clock",
    source: "yours",
    package: "@trops/clock",
  };
  const targeted = (pieces, dashboard = { id: "17", name: "Slack Pack" }) => ({
    summary: "Add a clock to Slack Pack",
    dashboard,
    pieces,
    checks: ["The clock shows on Slack Pack"],
    estimate: { build: "no AI" },
  });

  it("names the dashboard by id; a number id counts", () => {
    assert.deepEqual(planTarget(targeted([clock])), {
      id: "17",
      name: "Slack Pack",
    });
    assert.deepEqual(planTarget(targeted([clock], { id: 17 })), {
      id: "17",
      name: "17",
    });
    assert.equal(planTarget({ summary: "x" }), null);
    assert.equal(validatePlan(targeted([clock])).valid, true);
  });

  it("a dashboard without an id, or one that's gone, is an error", () => {
    assert.match(
      validatePlan(targeted([clock], { name: "Slack Pack" })).errors.join(" "),
      /needs the id/,
    );
    assert.match(
      validatePlan(targeted([clock]), {
        dashboards: [{ id: "3" }],
      }).errors.join(" "),
      /"Slack Pack" dashboard isn't there any more/,
    );
    assert.equal(
      validatePlan(targeted([clock]), { dashboards: [{ id: 17 }] }).valid,
      true,
    );
  });

  it("can't add a layout to a dashboard you have", () => {
    const layout = { kind: "layout", name: "Grid", source: "new" };
    assert.match(
      validatePlan(targeted([clock, layout])).errors.join(" "),
      /can't add a layout/,
    );
  });

  it("a theme is one of your saved themes, one per plan", () => {
    const theme = { kind: "theme", name: "Nordic Frost", source: "yours" };
    assert.equal(validatePlan(targeted([theme])).valid, true);
    assert.equal(
      validatePlan(targeted([theme]), { themes: ["Nordic Frost"] }).valid,
      true,
    );
    assert.match(
      validatePlan(targeted([theme]), { themes: ["Dusk"] }).errors.join(" "),
      /no saved theme called "Nordic Frost"/,
    );
    assert.match(
      validatePlan(targeted([{ ...theme, source: "registry" }])).errors.join(
        " ",
      ),
      /must be one of your saved themes/,
    );
    assert.match(
      validatePlan(targeted([theme, { ...theme, name: "Dusk" }])).errors.join(
        " ",
      ),
      /one theme at most/,
    );
  });
});

describe("validatePlan — a widget's component (Create build fixes)", () => {
  const base = (component) => ({
    summary: "x",
    estimate: { build: "1 min" },
    pieces: [
      {
        kind: "widget",
        name: "Rules",
        source: "yours",
        package: "@trops/algolia",
        component,
      },
    ],
  });
  it("component is text when given", () => {
    assert.equal(validatePlan(base("AlgoliaRulesList")).valid, true);
    assert.match(
      validatePlan(base(3)).errors.join(" "),
      /pieces\[0\]\.component must be the component's name/,
    );
  });
});
