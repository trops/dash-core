/**
 * teamPlan.test.js — the Dash team's plan format, checked against the six
 * walked-through scenarios (docs: dash-electron dash-team-scenarios.md).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractPlan,
  planPages,
  planTarget,
  validatePlan,
} = require("./teamPlan");

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

  // Not an error (Phase 1b): the build waits on that step ("needs a
  // provider", CRE-004 AC5) — the plan can still be built.
  it("a provider the user hasn't connected is a warning, not an error", () => {
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
    assert.match(res.warnings.join(" "), /needs notion, which isn't connected/);
    assert.equal(res.valid, true);
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

  // Shown, not built (Phase 1b): a missing summary or estimate is a
  // warning — the build doesn't need them.
  it("a missing summary or estimate is a warning", () => {
    const res = validatePlan({
      pieces: [{ kind: "layout", name: "l", source: "new" }],
    });
    assert.match(res.warnings.join(" "), /summary is missing/);
    assert.match(res.warnings.join(" "), /estimate\.build is missing/);
    assert.equal(res.valid, true);
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
  it("access that isn't a list of sentences is a warning", () => {
    assert.match(
      validatePlan({ ...base, access: "read" }).warnings.join(" "),
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

describe("validatePlan — pages, connections and settings (Create build fixes 2)", () => {
  const widget = (name, extra = {}) => ({
    kind: "widget",
    name,
    source: "yours",
    package: "@trops/algolia",
    providers: ["algolia"],
    ...extra,
  });
  const plan = (layout, widgets = [widget("Rules"), widget("Ranking")]) => ({
    summary: "x",
    estimate: { build: "1 min" },
    pieces: [
      { kind: "layout", name: "Merch", source: "new", ...layout },
      ...widgets,
    ],
  });

  it("a layout's pages name their widgets", () => {
    const ok = plan({
      pages: [
        { name: "Curate", widgets: ["Rules"] },
        { name: "Rank", widgets: ["Ranking"] },
      ],
    });
    assert.equal(validatePlan(ok, { providers: PROVIDERS }).valid, true);
    assert.match(
      validatePlan(plan({ pages: "Curate" })).errors.join(" "),
      /pieces\[0\]\.pages must be a list/,
    );
    assert.match(
      validatePlan(plan({ pages: [{ widgets: [] }] })).errors.join(" "),
      /pieces\[0\]\.pages\[0\] needs a name and a list of widgets/,
    );
  });

  it("a page naming a widget the plan doesn't have is a warning", () => {
    const res = validatePlan(
      plan({ pages: [{ name: "A", widgets: ["Rules", "Nope"] }] }),
      { providers: PROVIDERS },
    );
    assert.equal(res.valid, true);
    assert.match(
      res.warnings.join(" "),
      /names "Nope", which isn't a widget in the plan/,
    );
  });

  it("a widget's connection and settings are objects", () => {
    const good = plan({}, [
      widget("Rules", {
        provider: { algolia: "Algolia John G Demos" },
        settings: { indexName: "products" },
      }),
    ]);
    assert.equal(validatePlan(good, { providers: PROVIDERS }).valid, true);
    const bad = plan({}, [
      widget("Rules", { provider: "Algolia", settings: [1] }),
    ]);
    const errs = validatePlan(bad).errors.join(" ");
    assert.match(
      errs,
      /pieces\[1\]\.provider must map a provider type to a connection name/,
    );
    assert.match(errs, /pieces\[1\]\.settings must be an object/);
  });
});

describe("planPages — the pages a new dashboard gets", () => {
  const p = (pages) => ({
    pieces: [
      { kind: "layout", name: "L", source: "new", pages },
      { kind: "widget", name: "Rules", source: "new" },
      { kind: "widget", name: "Ranking", source: "new" },
      { kind: "widget", name: "Compare", source: "new" },
    ],
  });

  it("each widget goes on the first page that names it (any case)", () => {
    const pages = planPages(
      p([
        { name: "Curate", widgets: ["rules", "Compare"] },
        { name: "Rank", widgets: ["Ranking", "Rules"] },
      ]),
    );
    assert.deepEqual(pages, [
      { name: "Curate", widgets: [0, 2] },
      { name: "Rank", widgets: [1] },
    ]);
  });

  it("widgets no page names go on the first page", () => {
    assert.deepEqual(
      planPages(
        p([
          { name: "A", widgets: ["Rules"] },
          { name: "B", widgets: ["Ranking"] },
        ]),
      ),
      [
        { name: "A", widgets: [0, 2] },
        { name: "B", widgets: [1] },
      ],
    );
  });

  it("no pages or bad pages: none; one page keeps its name (plan grids)", () => {
    assert.deepEqual(planPages(p(undefined)), []);
    assert.deepEqual(planPages(p([{ name: "Only", widgets: ["Rules"] }])), [
      { name: "Only", widgets: [0, 1, 2] },
    ]);
    assert.deepEqual(planPages(p("x")), []);
    assert.deepEqual(planPages({ pieces: [] }), []);
  });

  it("pages with the same name, or blank names, are merged or dropped", () => {
    assert.deepEqual(
      planPages(
        p([
          { name: "A", widgets: ["Rules"] },
          { name: " ", widgets: ["Ranking"] },
          { name: "a", widgets: ["Compare"] },
          { name: "B", widgets: ["Ranking"] },
        ]),
      ),
      [
        { name: "A", widgets: [0, 2] },
        { name: "B", widgets: [1] },
      ],
    );
  });
});

describe("validatePlan — a layout is always new", () => {
  it("a layout piece without source is fine; a widget without one isn't", () => {
    const plan = {
      summary: "x",
      estimate: { build: "1 min" },
      pieces: [
        { kind: "layout", name: "Notes & Counts" },
        { kind: "widget", name: "Counter" },
      ],
    };
    const errs = validatePlan(plan).errors.join(" ");
    assert.doesNotMatch(errs, /pieces\[0\]\.source/);
    assert.match(errs, /pieces\[1\]\.source must be one of/);
  });
});

describe("plan grids — where each widget goes", () => {
  const store = () => ({
    summary: "Storefront",
    pieces: [
      {
        kind: "layout",
        name: "Algolia Storefront",
        source: "new",
        pages: [
          {
            name: "Search",
            widgets: [
              "Search Box",
              "Brand Filter",
              "Category Filter",
              "Hits",
              "Pagination",
            ],
            grid: {
              cols: 2,
              rows: 4,
              colWidths: { 1: "1/4" },
              rowHeights: { 1: "shrink", 4: "shrink" },
              cells: [
                { widget: "Search Box", row: 1, col: 1, colSpan: 2 },
                { widget: "Brand Filter", row: 2, col: 1 },
                { widget: "Category Filter", row: 3, col: 1 },
                { widget: "Hits", row: 2, col: 2, rowSpan: 2 },
                { widget: "Pagination", row: 4, col: 1, colSpan: 2 },
              ],
            },
          },
        ],
      },
      {
        kind: "widget",
        name: "Search Box",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaSearchBox",
      },
      {
        kind: "widget",
        name: "Brand Filter",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaRefinementList",
      },
      {
        kind: "widget",
        name: "Category Filter",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaRefinementList",
      },
      {
        kind: "widget",
        name: "Hits",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaHits",
      },
      {
        kind: "widget",
        name: "Pagination",
        source: "yours",
        package: "@trops/algolia-search",
        component: "AlgoliaPagination",
      },
    ],
    checks: ["Search and see hits"],
    estimate: { build: "small" },
  });

  it("planPages carries the page's grid: sizes, and each widget's cell", () => {
    const pages = planPages(store());
    assert.equal(pages.length, 1);
    assert.equal(pages[0].name, "Search");
    assert.deepEqual(pages[0].widgets, [0, 1, 2, 3, 4]);
    assert.deepEqual(pages[0].grid, {
      cols: 2,
      rows: 4,
      colModes: { 1: "1/4" },
      rowModes: { 1: "shrink", 2: "grow", 3: "grow", 4: "shrink" },
      cells: [
        { piece: 0, row: 1, col: 1, rowSpan: 1, colSpan: 2 },
        { piece: 1, row: 2, col: 1, rowSpan: 1, colSpan: 1 },
        { piece: 2, row: 3, col: 1, rowSpan: 1, colSpan: 1 },
        { piece: 3, row: 2, col: 2, rowSpan: 2, colSpan: 1 },
        { piece: 4, row: 4, col: 1, rowSpan: 1, colSpan: 2 },
      ],
    });
  });

  it("a widget given a cell goes on that page even if the page didn't list it", () => {
    const plan = store();
    plan.pieces[0].pages[0].widgets = ["Search Box"];
    assert.deepEqual(planPages(plan)[0].widgets, [0, 1, 2, 3, 4]);
  });

  it("a good grid passes", () => {
    const r = validatePlan(store());
    assert.deepEqual(r.errors, []);
  });

  // Warnings, not errors (Phase 1b): cells that don't fit are skipped when
  // it's placed, so the plan still builds.
  it("cells outside the grid, overlapping, or twice for one widget are warnings", () => {
    const plan = store();
    const cells = plan.pieces[0].pages[0].grid.cells;
    cells[4].row = 5; // Pagination below the 4 rows
    cells[2].row = 2; // Category on Brand's cell
    cells.push({ widget: "Hits", row: 3, col: 2 }); // Hits twice
    const { warnings: errors } = validatePlan(plan);
    assert.ok(
      errors.some((e) => /Pagination.*outside the 4×2 grid/.test(e)),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((e) => /Category Filter.*overlaps Brand Filter/.test(e)),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((e) => /Hits has more than one cell/.test(e)),
      errors.join("\n"),
    );
  });

  it("unknown sizes and an unknown widget are warnings", () => {
    const plan = store();
    const grid = plan.pieces[0].pages[0].grid;
    grid.colWidths = { 1: "1/5" };
    grid.rowHeights = { 2: "tall" };
    grid.cells.push({ widget: "Nope", row: 3, col: 2 });
    grid.cells[3].rowSpan = 1;
    const { warnings } = validatePlan(plan);
    const errors = warnings;
    assert.ok(
      errors.some((e) => /colWidths.*1\/5/.test(e)),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((e) => /rowHeights.*tall/.test(e)),
      errors.join("\n"),
    );
    assert.ok(
      warnings.some((w) => /"Nope", which isn't a widget in the plan/.test(w)),
      warnings.join("\n"),
    );
  });

  it("a grid needs whole numbers of columns and rows (a warning)", () => {
    const plan = store();
    plan.pieces[0].pages[0].grid.cols = 0;
    const { warnings: errors } = validatePlan(plan);
    assert.ok(
      errors.some((e) => /grid needs cols \(1–6\) and rows \(1–12\)/.test(e)),
      errors.join("\n"),
    );
  });
});
