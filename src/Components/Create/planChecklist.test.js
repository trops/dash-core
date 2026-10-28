import {
  choosePlanProvider,
  createdFor,
  providerChoices,
  normalizeType,
  providerTypesOf,
  buildChecklist,
  isDone,
  buildButtonLabel,
  nextOpen,
  countsLine,
  swapPiece,
  removePiece,
  editNote,
  botSummary,
  botDetails,
  scheduleLabel,
  isSkipped,
  providerLabel,
} from "./planChecklist";

const plan = {
  summary: "Morning brief",
  pieces: [
    {
      kind: "widget",
      name: "Calendar",
      source: "registry",
      package: "@trops/google-calendar",
      providers: ["Google Calendar"],
    },
    {
      kind: "widget",
      name: "Gmail Inbox",
      source: "registry",
      package: "@trops/gmail › trops.gmail.GmailInbox",
      providers: ["gmail"],
    },
    {
      kind: "widget",
      name: "Slack channels",
      source: "ai-built",
      package: "@ai-built/slack-pack",
      providers: ["slack"],
    },
    { kind: "layout", name: "Morning Brief", source: "new" },
  ],
  beforeBuilding: [
    { kind: "connect", what: "Connect Gmail" },
    { kind: "approve", what: "Pick which Slack channels to show" },
  ],
};

describe("planChecklist (phase 4b)", () => {
  test("provider names map to Dash type ids", () => {
    expect(normalizeType("Google Calendar")).toBe("google-calendar");
    expect(normalizeType("gcal")).toBe("google-calendar");
    expect(normalizeType("Slack")).toBe("slack");
    expect([...providerTypesOf({ a: { type: "Slack" } })]).toEqual(["slack"]);
  });

  test("installs per registry package, connects per missing type, other steps", () => {
    const items = buildChecklist(plan, new Set(["slack"]));
    expect(items.map((i) => i.id)).toEqual([
      "install:@trops/google-calendar",
      "install:@trops/gmail",
      "connect:google-calendar",
      "connect:gmail",
      "approve:Pick which Slack channels to show",
    ]);
    expect(items[2].label).toBe("Connect Google Calendar");
  });

  test("the Build button names what's open, and walks in order", () => {
    const have = new Set(["slack"]);
    const items = buildChecklist(plan, have);
    expect(buildButtonLabel(items, {}, have)).toBe(
      "Connect 2 accounts, approve 2 installs, confirm 1 step & build",
    );
    const state = {
      "install:@trops/google-calendar": "approved",
      "install:@trops/gmail": "approved",
      "approve:Pick which Slack channels to show": "done",
    };
    const withGcal = new Set(["slack", "google-calendar"]);
    expect(buildButtonLabel(items, state, withGcal)).toBe(
      "Connect Gmail & build",
    );
    expect(nextOpen(items, state, withGcal).id).toBe("connect:gmail");
    const all = new Set(["slack", "google-calendar", "gmail"]);
    expect(buildButtonLabel(items, state, all)).toBe("Build");
    expect(nextOpen(items, state, all)).toBeNull();
    expect(isDone(items[0], state, all)).toBe(true);
  });

  test("the counts line", () => {
    expect(countsLine(plan)).toBe(
      "3 widgets: 2 from the registry, 1 AI-built · 1 new layout",
    );
  });

  test("a layout with no source is a new one, not 'undefined' (QA 2026-10-22)", () => {
    expect(
      countsLine({ pieces: [{ kind: "layout", name: "Morning Brief" }] }),
    ).toBe("1 new layout");
    expect(
      countsLine({
        pieces: [
          { kind: "layout", name: "A" },
          { kind: "layout", name: "B", source: "new" },
        ],
      }),
    ).toBe("2 layouts: 2 new");
  });

  test("swap, remove and the note for the Planner", () => {
    const swapped = swapPiece(plan, 1, {
      source: "AI-built",
      name: "Inbox count",
      package: "@ai-built/inboxcount",
      why: "a count",
    });
    expect(swapped.pieces[1]).toMatchObject({
      name: "Inbox count",
      source: "ai-built",
      package: "@ai-built/inboxcount",
      providers: ["gmail"],
    });
    expect(
      swapPiece(plan, 0, { source: "New", name: "Calendar" }).pieces[0].source,
    ).toBe("new");
    expect(removePiece(plan, 3).pieces.length).toBe(3);
    expect(editNote(["removed Calendar"])).toBe(
      "(I changed the plan: removed Calendar. Keep these changes.)",
    );
    expect(editNote([])).toBe("");
  });
});

describe("planned bots (4d-2)", () => {
  const bot = {
    kind: "bot",
    name: "Greeter",
    source: "new",
    instructions: "Greet.",
    tools: [{ provider: "gmail", tools: ["search_emails"] }],
    schedule: { cron: "0 8 * * 1-5" },
    results: [{ name: "greeting", label: "Greeting" }],
    on: [{ widget: "Ask button", event: "askClicked" }],
    showResults: true,
  };
  test("says what starts it, what it can use and what it sends", () => {
    expect(botSummary(bot)).toEqual({
      starts:
        "Starts when Ask button sends askClicked or every weekday at 8:00 AM",
      uses: "Can use gmail: search_emails",
      shows: "Sends Greeting to a Bot results widget",
    });
    expect(botSummary({ name: "Bare" })).toEqual({
      starts: "Starts when you run it",
      uses: "Uses no providers",
      shows: "",
    });
  });
  test("botDetails: Runs / Uses / Sends rows for the plan card", () => {
    expect(botDetails(bot)).toEqual([
      {
        label: "Runs",
        value: "When Ask button sends askClicked or every weekday at 8:00 AM",
      },
      { label: "Uses", value: "gmail: search_emails" },
      { label: "Sends", value: "Greeting → a Bot results widget" },
    ]);
    expect(botDetails({ name: "Bare" })).toEqual([
      { label: "Runs", value: "When you run it" },
      { label: "Uses", value: "No providers" },
    ]);
  });
  test("schedules in words", () => {
    expect(scheduleLabel("30 9 * * *")).toBe("every day at 9:30 AM");
    expect(scheduleLabel("0 * * * *")).toBe("every hour");
    expect(scheduleLabel("0 7 * * 1")).toBe("every Monday at 7:00 AM");
    expect(scheduleLabel("*/5 * * * *")).toBe("on the schedule */5 * * * *");
  });
  test("removing a piece drops the wiring that named it", () => {
    const widget = {
      kind: "widget",
      name: "Ask button",
      source: "new",
      listens: [{ bot: "Greeter", result: "greeting", handler: "show" }],
    };
    const plan = { summary: "x", pieces: [widget, bot] };
    expect(removePiece(plan, 0).pieces[0].on).toEqual([]);
    expect(removePiece(plan, 1).pieces[0].listens).toEqual([]);
  });
});

describe("skipping a sign-in (4d-3, CRE-004 AC5)", () => {
  const items = [
    {
      id: "connect:gmail",
      kind: "connect",
      label: "Connect Gmail",
      providerType: "gmail",
    },
  ];
  test("a skipped sign-in lets Build go ahead, and Build names it", () => {
    const state = { "connect:gmail": "skipped" };
    expect(isDone(items[0], state)).toBe(true);
    expect(isSkipped(items[0], state)).toBe(true);
    expect(nextOpen(items, state)).toBeNull();
    expect(buildButtonLabel(items, state)).toBe("Build without Gmail");
    expect(
      buildButtonLabel(
        [...items, { ...items[0], id: "connect:slack", providerType: "slack" }],
        { "connect:gmail": "skipped", "connect:slack": "skipped" },
      ),
    ).toBe("Build without 2 accounts");
  });
  test("connected later, it's no longer skipped", () => {
    const state = { "connect:gmail": "skipped" };
    const have = new Set(["gmail"]);
    expect(isSkipped(items[0], state, have)).toBe(false);
    expect(buildButtonLabel(items, state, have)).toBe("Build");
  });
  test("providerLabel", () => {
    expect(providerLabel("gmail")).toBe("Gmail");
    expect(providerLabel("Google Calendar")).toBe("Google Calendar");
  });
});

describe("a plan for a dashboard you have (5e-2b)", () => {
  const clock = {
    kind: "widget",
    name: "Clock",
    source: "yours",
    package: "@trops/clock",
  };
  const bot = {
    kind: "bot",
    name: "Pinger",
    source: "new",
    instructions: "Ping.",
  };
  const theme = { kind: "theme", name: "Nordic Frost", source: "yours" };
  const target = { id: "17", name: "Slack Pack" };

  test("the counts line says what it adds where", () => {
    expect(countsLine({ dashboard: target, pieces: [clock, bot] })).toBe(
      "Adds 1 widget and 1 bot to Slack Pack",
    );
    expect(countsLine({ dashboard: target, pieces: [theme] })).toBe(
      "Applies the Nordic Frost theme to Slack Pack",
    );
    expect(
      countsLine({ dashboard: target, pieces: [clock, clock, theme] }),
    ).toBe("Adds 2 widgets to Slack Pack and applies the Nordic Frost theme");
    // A new dashboard names its theme too.
    expect(countsLine({ pieces: [clock, theme] })).toBe(
      "1 widget: 1 yours · the Nordic Frost theme",
    );
  });

  test("Build says Make these changes", () => {
    const opts = { targeted: true };
    expect(buildButtonLabel([], {}, new Set(), opts)).toBe(
      "Make these changes",
    );
    const connect = [
      {
        id: "connect:gmail",
        kind: "connect",
        label: "Connect Gmail",
        providerType: "gmail",
      },
    ];
    expect(buildButtonLabel(connect, {}, new Set(), opts)).toBe(
      "Connect Gmail & make these changes",
    );
    expect(buildButtonLabel(connect, {}, new Set())).toBe(
      "Connect Gmail & build",
    );
  });
});

describe("using a provider you have", () => {
  const providers = {
    a: { name: "Zed CRM", type: "crm", providerClass: "credential" },
    b: { name: "My Mail", type: "custom", providerClass: "mcp" },
    c: { name: "Gmail", type: "gmail", providerClass: "mcp" },
  };
  test("closest first: the same type, then MCP servers, then the rest", () => {
    expect(providerChoices(providers, "Gmail").map((p) => p.name)).toEqual([
      "Gmail",
      "My Mail",
      "Zed CRM",
    ]);
  });
  test("the plan names it: widgets by its type, bots by its name", () => {
    const plan = {
      pieces: [
        { kind: "widget", name: "Inbox", providers: ["Gmail", "slack"] },
        {
          kind: "bot",
          name: "Brief",
          tools: [
            { provider: "gmail", tools: ["search"] },
            { provider: "Slack" },
          ],
        },
      ],
    };
    const next = choosePlanProvider(plan, "gmail", providers.b);
    expect(next.pieces[0].providers).toEqual(["custom", "slack"]);
    // That exact provider is pinned — "custom" alone could be any of them.
    expect(next.pieces[0].provider).toEqual({ custom: "My Mail" });
    expect(next.pieces[1].tools[0]).toEqual({
      provider: "My Mail",
      tools: ["search"],
    });
    expect(next.pieces[1].tools[1]).toEqual({ provider: "Slack" });
    // The checklist no longer asks for Gmail.
    const have = new Set(["slack", "custom"]);
    expect(
      buildChecklist(next, have).filter((i) => i.kind === "connect"),
    ).toEqual([]);
  });

  test("what the user has counts by name too — a plan that names it isn't asking again", () => {
    const have = providerTypesOf(providers);
    expect(have.has("my-mail")).toBe(true);
    const plan = {
      pieces: [{ kind: "widget", name: "Inbox", providers: ["My Mail"] }],
    };
    expect(
      buildChecklist(plan, have).filter((i) => i.kind === "connect"),
    ).toEqual([]);
  });
  test("made in the Connect window: the one of that type, else the only one, else none", () => {
    const gmail = { name: "Mail", type: "gmail" };
    const slack = { name: "Slack", type: "slack" };
    const custom = { name: "HA", type: "custom" };
    expect(createdFor([slack, gmail], "gmail")).toBe(gmail);
    expect(createdFor([custom], "home-assistant")).toBe(custom);
    // Added Slack too while there: never replaces what the plan needs.
    expect(createdFor([slack, custom], "home-assistant")).toBe(null);
    expect(createdFor([], "gmail")).toBe(null);
  });
});
