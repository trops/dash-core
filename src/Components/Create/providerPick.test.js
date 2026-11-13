/**
 * The user picks which provider a widget reads from (widget step by step,
 * release 1): the question's rows, the answer for the Planner, the plan
 * pinned to the pick, and Build waiting until every widget has one.
 */
import {
  buildButtonLabel,
  buildChecklist,
  pinWidgetProviders,
  providerKindLabel,
  providerPickAnswer,
  providerPickRows,
  unpinnedChoices,
} from "./planChecklist";

const PROVIDERS = [
  { name: "Google Calendar", type: "google-calendar", providerClass: "mcp" },
  {
    name: "Home Assistant MCP",
    type: "home-assistant-mcp",
    providerClass: "mcp",
  },
  {
    name: "Google Calendar (Claude connector)",
    type: "claude-connector",
    providerClass: "connector",
  },
  { name: "Notes A", type: "filesystem", providerClass: "mcp" },
  { name: "Notes B", type: "filesystem", providerClass: "mcp" },
  { name: "Search Keys", type: "algolia", providerClass: "credential" },
];

describe("the provider question's rows", () => {
  test("suggested in the Planner's order; a connector off, with why; the rest under others", () => {
    const { suggested, others } = providerPickRows(
      PROVIDERS,
      [
        "Home Assistant MCP",
        "Google Calendar",
        "Google Calendar (Claude connector)",
        "Nope",
      ],
      { reasons: { "Home Assistant MCP": "Calendars in Home Assistant" } },
    );
    expect(suggested.map((r) => r.name)).toEqual([
      "Home Assistant MCP",
      "Google Calendar",
      "Google Calendar (Claude connector)",
    ]);
    expect(suggested[0]).toMatchObject({
      kind: "Tools (MCP)",
      off: false,
      reason: "Calendars in Home Assistant",
    });
    expect(suggested[2]).toMatchObject({
      kind: "Claude connector",
      off: true,
      why: "Widgets can't use Claude connectors yet — bots can.",
    });
    expect(others.map((r) => r.name)).toEqual([
      "Notes A",
      "Notes B",
      "Search Keys",
    ]);
  });
  test("a connector a widget can't use never shows under others", () => {
    const { others } = providerPickRows(PROVIDERS, ["Google Calendar"]);
    expect(others.map((r) => r.name)).not.toContain(
      "Google Calendar (Claude connector)",
    );
    const forBots = providerPickRows(PROVIDERS, ["Google Calendar"], {
      forBots: true,
    });
    expect(forBots.others.map((r) => r.name)).toContain(
      "Google Calendar (Claude connector)",
    );
  });
  test("for a bot, a connector can be picked", () => {
    const { suggested } = providerPickRows(
      PROVIDERS,
      ["Google Calendar (Claude connector)"],
      { forBots: true },
    );
    expect(suggested[0].off).toBe(false);
  });
  test("kinds read as the Providers page says them", () => {
    expect(providerKindLabel({ providerClass: "mcp" })).toBe("Tools (MCP)");
    expect(providerKindLabel({ providerClass: "connector" })).toBe(
      "Claude connector",
    );
    expect(providerKindLabel({ providerClass: "credential" })).toBe(
      "Credentials",
    );
  });
});

describe("the answer for the Planner", () => {
  test("exact names; one the user added is flagged to check", () => {
    expect(
      providerPickAnswer(
        "Which should it read from?",
        [{ name: "Google Calendar" }],
        ["Google Calendar", "Home Assistant MCP"],
      ),
    ).toBe("Which should it read from? — Google Calendar");
    expect(
      providerPickAnswer(
        "Which?",
        [{ name: "Google Calendar" }, { name: "Notes A" }],
        ["Google Calendar"],
      ),
    ).toMatch(
      /I picked Notes A myself — check it can give what the widget needs/,
    );
  });
});

describe("the plan pinned to the user's pick", () => {
  const plan = {
    pieces: [
      {
        kind: "widget",
        name: "Google Calendar",
        source: "yours",
        package: "@trops/google-calendar",
        providers: ["google-calendar"],
      },
    ],
  };
  test("the same provider: kept, pinned by name", () => {
    const { plan: next, note } = pinWidgetProviders(plan, 0, [PROVIDERS[0]]);
    expect(next.pieces[0]).toMatchObject({
      source: "yours",
      package: "@trops/google-calendar",
      providers: ["google-calendar"],
      provider: { "google-calendar": "Google Calendar" },
    });
    expect(note).toBe("Google Calendar reads from Google Calendar");
  });
  test("two providers: a new widget reading both — the user's one was made for other tools", () => {
    const { plan: next, note } = pinWidgetProviders(plan, 0, [
      PROVIDERS[0],
      PROVIDERS[1],
    ]);
    expect(next.pieces[0].source).toBe("new");
    expect(next.pieces[0].package).toBeUndefined();
    expect(next.pieces[0].provider).toEqual({
      "google-calendar": "Google Calendar",
      "home-assistant-mcp": "Home Assistant MCP",
    });
    expect(note).toMatch(/build it new/);
  });
  test("a connector is never pinned on a widget", () => {
    const { plan: next } = pinWidgetProviders(plan, 0, [PROVIDERS[2]]);
    expect(next).toBe(plan);
  });
});

describe("Build waits until every widget's provider is chosen", () => {
  const widget = (over = {}) => ({
    kind: "widget",
    name: "Notes",
    source: "new",
    providers: ["filesystem"],
    ...over,
  });
  test("several of a kind and none named: choose", () => {
    const plan = { pieces: [widget()] };
    expect(unpinnedChoices(plan.pieces[0], PROVIDERS)).toEqual(["filesystem"]);
    const items = buildChecklist(plan, new Set(["filesystem"]), PROVIDERS);
    expect(items).toEqual([
      {
        id: "choose:0:filesystem",
        kind: "choose",
        label: "Choose what Notes reads from",
        providerType: "filesystem",
        pieceIndex: 0,
      },
    ]);
    expect(buildButtonLabel(items, {}, new Set(["filesystem"]))).toBe(
      "Choose what Notes reads from & build",
    );
  });
  test("named, only one of the kind, or a change to a placed widget: nothing to choose", () => {
    expect(
      unpinnedChoices(
        widget({ provider: { filesystem: "Notes B" } }),
        PROVIDERS,
      ),
    ).toEqual([]);
    expect(
      unpinnedChoices(widget({ providers: ["google-calendar"] }), PROVIDERS),
    ).toEqual([]);
    expect(unpinnedChoices(widget({ source: "update" }), PROVIDERS)).toEqual(
      [],
    );
    // Without the providers (Create's old Plan step): as before.
    expect(
      buildChecklist({ pieces: [widget()] }, new Set(["filesystem"])),
    ).toEqual([]);
  });
});
