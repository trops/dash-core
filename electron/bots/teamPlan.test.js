/**
 * teamPlan.test.js — the Dash team's plan format, checked against the six
 * walked-through scenarios (docs: dash-electron dash-team-scenarios.md).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractPlan, validatePlan } = require("./teamPlan");

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
