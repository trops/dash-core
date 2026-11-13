/**
 * The widget wizard's model, step 1 (Reads from): the app — not the AI —
 * finds which of the user's providers can serve the widget, from their
 * saved tools, and only the user's pick counts.
 */
import {
  widgetLabel,
  foundLine,
  pinFromPicked,
  readsFromStep,
  wizardIndex,
} from "./widgetSpec";

// The user's real kinds of providers (names as on their Providers page).
const PROVIDERS = {
  "Google Calendar": {
    name: "Google Calendar",
    type: "google-calendar",
    providerClass: "mcp",
    allowedTools: ["list-calendars", "list-events", "create-event"],
  },
  "Home Assistant MCP": {
    name: "Home Assistant MCP",
    type: "home-assistant-mcp",
    providerClass: "mcp",
    isDefaultForType: true,
    allowedTools: ["ha_get_state", "ha_config_get_calendar_events"],
  },
  "Google Calendar (Claude connector)": {
    name: "Google Calendar (Claude connector)",
    type: "claude-connector",
    providerClass: "connector",
    mcpConfig: { server: "claude.ai Google Calendar" },
    allowedTools: ["list_events", "list_calendars"],
  },
  "Gmail 3": {
    name: "Gmail 3",
    type: "gmail",
    providerClass: "mcp",
    allowedTools: ["search_messages"],
  },
};

const calendarPlan = (over = {}) => ({
  summary: "x",
  pieces: [
    {
      kind: "widget",
      name: "Today's Calendar",
      source: "new",
      providers: ["google-calendar"],
      ...over,
    },
  ],
});

describe("which widget the wizard is for", () => {
  test("one new widget (with or without its layout)", () => {
    expect(wizardIndex(calendarPlan())).toBe(0);
    expect(
      wizardIndex({
        pieces: [{ kind: "layout", name: "L" }, calendarPlan().pieces[0]],
      }),
    ).toBe(1);
  });
  test("not several widgets, bots, or a change to a placed one", () => {
    const w = calendarPlan().pieces[0];
    expect(wizardIndex({ pieces: [w, { ...w, name: "B" }] })).toBe(-1);
    expect(wizardIndex({ pieces: [w, { kind: "bot", name: "B" }] })).toBe(-1);
    expect(wizardIndex({ pieces: [{ ...w, source: "update" }] })).toBe(-1);
  });
});

describe("step 1 · Reads from — found by the app, picked by the user", () => {
  test("a calendar: the calendar provider, Home Assistant by its saved tools, the connector (off)", () => {
    const step = readsFromStep(calendarPlan().pieces[0], PROVIDERS, []);
    expect(step.candidates).toEqual([
      "Google Calendar",
      "Google Calendar (Claude connector)",
      "Home Assistant MCP",
    ]);
    expect(step.usable).toEqual(["Google Calendar", "Home Assistant MCP"]);
    expect(step.done).toBe(false);
    expect(step.none).toBe(false);
  });

  test("the Planner pinning it itself doesn't count — only the user's pick does", () => {
    const piece = calendarPlan({
      provider: { "google-calendar": "Google Calendar" },
    }).pieces[0];
    expect(readsFromStep(piece, PROVIDERS, []).done).toBe(false);
    expect(readsFromStep(piece, PROVIDERS, ["Google Calendar"]).done).toBe(
      true,
    );
  });

  test("always asked — even with only one that can", () => {
    const one = { "Gmail 3": PROVIDERS["Gmail 3"] };
    const step = readsFromStep(
      { kind: "widget", name: "Inbox", providers: ["gmail"] },
      one,
      [],
    );
    expect(step.usable).toEqual(["Gmail 3"]);
    expect(step.done).toBe(false);
  });

  test("none of theirs can: the step says so", () => {
    const step = readsFromStep(
      { kind: "widget", name: "Tickets", providers: ["jira"] },
      PROVIDERS,
      [],
    );
    expect(step.none).toBe(true);
    expect(foundLine({ name: "Tickets" }, step)).toBe(
      "none of your providers can do Tickets yet",
    );
  });

  test("a widget that reads from nothing has nothing to pick", () => {
    expect(
      readsFromStep({ kind: "widget", name: "Clock" }, PROVIDERS, []).done,
    ).toBe(true);
  });
});

describe("the user's pick survives a new plan", () => {
  test("a plan that left it out (or named another) gets the user's pick", () => {
    const next = pinFromPicked(
      calendarPlan({ provider: { "google-calendar": "Other" } }),
      ["Google Calendar"],
      PROVIDERS,
    );
    expect(next.pieces[0].provider).toEqual({
      "google-calendar": "Google Calendar",
    });
    const kept = calendarPlan({
      provider: { "google-calendar": "Google Calendar" },
    });
    expect(pinFromPicked(kept, ["Google Calendar"], PROVIDERS)).toBe(kept);
  });

  test("a connector is never pinned on a widget", () => {
    const plan = calendarPlan({ providers: ["claude-connector"] });
    expect(
      pinFromPicked(plan, ["Google Calendar (Claude connector)"], PROVIDERS),
    ).toBe(plan);
  });
});

test("a widget's code name reads as words", () => {
  expect(widgetLabel({ name: "GoogleCalendarWidget" })).toBe(
    "Google Calendar Widget",
  );
  expect(widgetLabel({ name: "Today's Calendar" })).toBe("Today's Calendar");
  expect(widgetLabel({})).toBe("the widget");
});

test("what the widget reads from, by the names the user picked", () => {
  const { readsFromNames } = require("./widgetSpec");
  const piece = {
    kind: "widget",
    providers: ["google-calendar"],
    provider: { "google-calendar": "Google Calendar" },
  };
  expect(readsFromNames(piece, PROVIDERS, ["Google Calendar"])).toBe(
    "Google Calendar",
  );
  // The Planner's own pin isn't the user's pick.
  expect(readsFromNames(piece, PROVIDERS, [])).toBe("");
});

test("the plan said plainly (frame 4): the widget, where, what it reads, then the question", () => {
  const { planSays, planCardFor } = require("./widgetSpec");
  const piece = {
    kind: "widget",
    name: "TodaysAgenda",
    source: "new",
    notes:
      "Shows today's events from `list-events`, all-day first. Refreshes every 5 minutes.",
  };
  expect(
    planSays(piece, {
      where: "the empty cell in row 1, column 2",
      reads: "Google Calendar",
    }),
  ).toBe(
    "Todays Agenda — a new widget in the empty cell in row 1, column 2. It reads from Google Calendar. Shows today's events from list-events, all-day first. Do you want it built?",
  );
  expect(
    planCardFor(piece, { where: "row 1, column 2", reads: "Google Calendar" }),
  ).toEqual({
    title: "Todays Agenda (new)",
    sub: "Built for you · row 1, column 2 · reads from Google Calendar",
  });
});
