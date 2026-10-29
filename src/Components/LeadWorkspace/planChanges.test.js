/**
 * planChanges (lead-workspace release 3c, frame 30): a plan for a dashboard
 * the user has, as what changes — its grid now and after, placed where the
 * build places it, and a row per change.
 */
import { changesLine, planChanges, widgetLabel } from "./planChanges";
import { planLine, seedConversation, yesLabel } from "./workspacePlan";
import { stepFromCall } from "./handoffSteps";

// Kitchen Sink: a 2×3 grid, four widgets, two cells free.
const grid = (cells) => ({
  id: 1,
  component: "LayoutGridContainer",
  grid: { rows: 2, cols: 3, ...cells },
});
const KITCHEN = {
  id: 7,
  name: "Kitchen Sink",
  layout: [
    grid({
      1.1: { component: 2 },
      1.2: { component: 3 },
      1.3: { component: null },
      2.1: { component: 4 },
      2.2: { component: 5 },
      2.3: { component: null },
    }),
    { id: 2, component: "trops.inbox.InboxWatch", userPrefs: {} },
    { id: 3, component: "MorningBrief", userPrefs: {} },
    {
      id: 4,
      component: "ai-built.clock.BigClock",
      userPrefs: { title: "Clock" },
    },
    { id: 5, component: "trops.notes.Notes" },
  ],
};
const PLAN = {
  summary: "Weather on Kitchen Sink",
  dashboard: { id: "7", name: "Kitchen Sink" },
  pieces: [
    {
      kind: "widget",
      name: "Weather",
      source: "registry",
      package: "@trops/weather",
    },
  ],
};

test("widgets are named as people read them", () => {
  expect(
    widgetLabel({ component: "ai-built.fridaycountdown.FridayCountdown" }),
  ).toBe("Friday Countdown");
  expect(
    widgetLabel({ component: "x.y.Z", userPrefs: { title: "Mine" } }),
  ).toBe("Mine");
});

test("an addition goes in the next free cell; the rest stay", () => {
  const c = planChanges(KITCHEN, PLAN);
  expect(c.name).toBe("Kitchen Sink");
  expect(c.cols).toBe(3);
  expect(c.now.flat().map((x) => x.name)).toEqual([
    "Inbox Watch",
    "Morning Brief",
    "",
    "Clock",
    "Notes",
    "",
  ]);
  expect(c.after.flat().map((x) => [x.name, x.kind])).toEqual([
    ["Inbox Watch", "keep"],
    ["Morning Brief", "keep"],
    ["Weather", "add"],
    ["Clock", "keep"],
    ["Notes", "keep"],
    ["", "empty"],
  ]);
  expect(c.rows).toEqual([
    {
      mark: "+",
      main: "Weather — added",
      sub: "@trops/weather from the registry",
    },
  ]);
  expect(c.unchanged).toEqual([
    "Inbox Watch",
    "Morning Brief",
    "Clock",
    "Notes",
  ]);
  expect(changesLine(c)).toBe("1 added");
});

test("a full grid gets a new row, as the build does; a bot's results card is placed too", () => {
  const plan = {
    ...PLAN,
    pieces: [
      ...PLAN.pieces,
      { kind: "widget", name: "Lights", source: "new" },
      { kind: "widget", name: "Camera", source: "new" },
      { kind: "bot", name: "Lights-off", source: "new", showResults: true },
    ],
  };
  const c = planChanges(KITCHEN, plan);
  expect(c.after.length).toBe(3);
  expect(c.after[2].map((x) => [x.name, x.kind])).toEqual([
    ["Camera", "add"],
    ["Lights-off results", "add"],
    ["", "empty"],
  ]);
  expect(c.added).toBe(4);
});

test("the dashboard's shown page is the one changed; a new dashboard's plan isn't a change", () => {
  const paged = {
    id: 7,
    activePageId: "p2",
    pages: [
      { id: "p1", layout: KITCHEN.layout },
      { id: "p2", layout: [grid({ 1.1: { component: null } })] },
    ],
  };
  expect(
    planChanges(paged, PLAN)
      .now.flat()
      .map((x) => x.kind),
  ).toEqual(["empty", "empty", "empty", "empty", "empty", "empty"]);
  const { dashboard, ...fresh } = PLAN;
  expect(planChanges(KITCHEN, fresh)).toBeNull();
  expect(planChanges(null, PLAN)).toBeNull();
});

test("a change's card and yes say so", () => {
  expect(planLine(PLAN)).toBe("Plan · 1 added · on Kitchen Sink");
  expect(yesLabel(PLAN)).toBe("Yes, make the changes");
  const { dashboard, ...fresh } = PLAN;
  expect(yesLabel(fresh)).toBe("Yes, build it");
});

test("a dashboard lead's Dash team call is a step, marked as the Dash team's", () => {
  expect(
    stepFromCall({
      type: "tool_call",
      id: "t9",
      name: "mcp__bot-team__team_ask_dash_team",
      input: { role: "planner", request: "An AWS bill widget" },
    }),
  ).toEqual({
    who: "step",
    id: "t9",
    bot: "the Planner",
    label: "Brought in the Dash team · asked the Planner",
    request: "An AWS bill widget",
    status: "asking",
    dashTeam: true,
  });
});

test("Open as a plan: the chat becomes a Dash Lead conversation with the plan on its last Planner step", () => {
  const msgs = seedConversation({
    plan: PLAN,
    messages: [
      { who: "you", text: "Weather on my kitchen dashboard" },
      { who: "planner", text: "Which units?" },
      { who: "you", text: "Celsius" },
      { who: "planner", text: "Here's a plan.\nIt adds the weather." },
    ],
  });
  expect(msgs.map((m) => m.who)).toEqual([
    "you",
    "step",
    "you",
    "step",
    "role",
  ]);
  expect(msgs[1].plan).toBeUndefined();
  expect(msgs[3]).toMatchObject({
    bot: "the Planner",
    status: "done",
    result: "Here's a plan.",
    plan: PLAN,
  });
  expect(msgs[4].text).toMatch(/Want me to build it\?$/);
  // No Planner words kept: the plan still gets its step.
  const bare = seedConversation({
    plan: PLAN,
    messages: [{ who: "you", text: "x" }],
  });
  expect(bare.map((m) => m.who)).toEqual(["you", "step", "role"]);
  expect(bare[1].plan).toBe(PLAN);
});

describe("review fixes (release 3c)", () => {
  test("a spanned cell keeps the columns in place; a cell is empty only as the build sees it", () => {
    const ws = {
      id: 7,
      layout: [
        grid({
          1.1: { component: 2 },
          1.2: { component: null, hide: true },
          1.3: { component: 99 },
          2.1: { component: undefined },
          2.2: { component: null },
          2.3: { component: null },
        }),
        { id: 2, component: "trops.inbox.InboxWatch" },
      ],
    };
    const c = planChanges(ws, PLAN);
    expect(c.now.flat().map((x) => `${x.name}:${x.kind}`)).toEqual([
      "Inbox Watch:keep",
      ":hidden",
      // An id with no widget behind it still holds the cell for the build.
      "Widget:keep",
      // { component: undefined } isn't null: the build skips it too.
      "Widget:keep",
      ":empty",
      ":empty",
    ]);
    expect(c.after.flat()[4]).toMatchObject({ name: "Weather", kind: "add" });
  });

  test("a change that fills no cell — a new bot, a theme — has rows, and its card says what it makes", () => {
    const plan = {
      ...PLAN,
      pieces: [
        { kind: "bot", name: "Morning brief", source: "new" },
        { kind: "theme", name: "Dusk" },
      ],
    };
    const c = planChanges(KITCHEN, plan);
    expect(c.added).toBe(0);
    expect(c.rows.map((r) => r.main)).toEqual([
      "Morning brief — new bot",
      "Dusk theme — applied",
    ]);
    expect(planLine(plan)).toMatch(/ · on Kitchen Sink$/);
    expect(planLine(plan)).not.toMatch(/0 added/);
  });

  test("a dashboard with no grid has no cells to draw", () => {
    const c = planChanges({ id: 7, layout: [] }, PLAN);
    expect(c.now).toEqual([]);
  });
});
