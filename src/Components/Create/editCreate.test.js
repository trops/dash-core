import {
  editStepIndex,
  resolveEditComponent,
  widgetFacts,
  widgetUsage,
  usageText,
  researchRequest,
  editPlanRequest,
  forEdit,
  lineDiff,
} from "./editCreate";

const installed = [
  // As widgets.list() gives them: components by their bare names.
  { name: "@jg/inbox", componentNames: ["Inbox", "Sent"] },
  {
    name: "@ai-built/inbox",
    packageId: "@ai-built/inbox",
    componentNames: ["Inbox"],
  },
];
const target = {
  package: "inbox",
  component: "jg.inbox.Inbox",
  componentName: "Inbox",
  displayName: "Inbox",
};

describe("editStepIndex", () => {
  test("Describe → Plan → Build → Preview → Done", () => {
    expect(editStepIndex({})).toBe(0);
    expect(editStepIndex({ plan: true })).toBe(1);
    expect(editStepIndex({ plan: true, buildStatus: "running" })).toBe(2);
    expect(editStepIndex({ plan: true, buildStatus: "waiting-for-you" })).toBe(
      3,
    );
    expect(editStepIndex({ plan: true, buildStatus: "done" })).toBe(4);
    expect(editStepIndex({ done: true })).toBe(4);
  });
});

describe("resolveEditComponent", () => {
  test("a full id stays as it is", () => {
    expect(resolveEditComponent("jg.inbox.Sent", null, installed)).toBe(
      "jg.inbox.Sent",
    );
  });
  test("a bare name is found, the door's package first", () => {
    expect(resolveEditComponent("Inbox", "@ai-built/inbox", installed)).toBe(
      "ai-built.inbox.Inbox",
    );
    expect(resolveEditComponent("Inbox", "@jg/inbox", installed)).toBe(
      "jg.inbox.Inbox",
    );
  });
  test("not installed: null", () => {
    expect(resolveEditComponent("Gone", null, installed)).toBeNull();
    expect(resolveEditComponent("", null, installed)).toBeNull();
  });
});

describe("widgetFacts", () => {
  const config = {
    userConfig: {
      maxMessages: { displayName: "Max messages", defaultValue: 20 },
      snippets: { displayName: "Show snippets", defaultValue: true },
      label: { defaultValue: "INBOX" },
    },
    providers: [{ type: "gmail", providerClass: "mcp" }],
    events: ["messageSelected"],
  };
  test("its settings with values, its connection here, what it sends", () => {
    expect(
      widgetFacts(config, {
        settings: { maxMessages: 10 },
        providers: { gmail: "Work Gmail" },
      }),
    ).toEqual({
      settings: ["Max messages (10)", "Show snippets (on)", "label (INBOX)"],
      uses: ["gmail — here: Work Gmail"],
      sends: ["messageSelected"],
    });
  });
  test("no config: nothing to say", () => {
    expect(widgetFacts(null)).toEqual({ settings: [], uses: [], sends: [] });
  });
});

describe("widgetUsage", () => {
  const workspaces = [
    { id: 1, name: "Morning Brief", layout: [{ component: "jg.inbox.Inbox" }] },
    {
      id: 2,
      name: "Sales",
      layout: [{ component: "x" }],
      pages: [{ layout: [{ component: "jg.inbox.Inbox" }] }],
    },
    { id: 3, name: "Other", layout: [{ component: "jg.inbox.Sent" }] },
    { id: 4, name: "Side", sidebarLayout: [{ component: "jg.inbox.Inbox" }] },
  ];
  test("pages, layouts and sidebars, once each", () => {
    expect(widgetUsage(workspaces, "jg.inbox.Inbox")).toEqual([
      "Morning Brief",
      "Sales",
      "Side",
    ]);
  });
  test("said in words", () => {
    expect(usageText(["A"])).toBe("A");
    expect(usageText(["A", "B"])).toBe("A and B");
    expect(usageText(["A", "B", "C"])).toBe("A, B and C");
    expect(usageText(["A", "B", "C", "D"])).toBe("4 dashboards");
    expect(usageText([])).toBe("");
  });
});

describe("the team's requests", () => {
  test("the Scout reads that widget and doesn't search", () => {
    const text = researchRequest(target);
    expect(text).toMatch(/read_widget \(name "inbox", component "Inbox"\)/);
    expect(text).toMatch(/Don't search the library/);
  });
  test("the Planner is told the widget, where the change goes and the error", () => {
    const text = editPlanRequest("Add a date filter", target, "update", {
      usedOn: ["Morning Brief", "Sales"],
      error: "TypeError: events.map\n is not a function",
    });
    expect(text.split("\n")[0]).toBe("Add a date filter");
    expect(text).toMatch(/on Morning Brief and Sales/);
    expect(text).toMatch(/source "update" with package "inbox"/);
    expect(text).toMatch(
      /quoted from the app: "TypeError: events.map is not a function"/,
    );
    expect(editPlanRequest("x", target, "new")).toMatch(
      /saved as a new widget — Inbox stays as it is/,
    );
  });
});

describe("forEdit", () => {
  const plan = {
    dashboard: { id: "7", name: "Morning Brief" },
    pieces: [
      { kind: "widget", name: "Inbox", source: "new", package: "@other/x" },
      { kind: "widget", name: "Second", source: "new" },
    ],
  };
  test("in place: the first widget is that package as an update", () => {
    const out = forEdit(plan, target, "update");
    expect(out.pieces[0]).toMatchObject({ source: "update", package: "inbox" });
    expect(out.pieces[1]).toEqual(plan.pieces[1]);
    // A change names no dashboard (the Planner sometimes sets one).
    expect("dashboard" in out).toBe(false);
  });
  test("as new: a new widget with no package", () => {
    const out = forEdit(plan, target, "new");
    expect(out.pieces[0].source).toBe("new");
    expect("package" in out.pieces[0]).toBe(false);
  });
});

describe("lineDiff", () => {
  test("added and removed lines, with context and gaps", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "X", "f", "g", "h"].join("\n");
    expect(lineDiff(before, after, 1)).toEqual([
      { type: "gap", text: "…" },
      { type: "same", text: "d" },
      { type: "del", text: "e" },
      { type: "add", text: "X" },
      { type: "same", text: "f" },
      { type: "gap", text: "…" },
    ]);
  });
  test("nothing changed: one gap", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([{ type: "gap", text: "…" }]);
  });
  test("a new file is all added", () => {
    expect(lineDiff("", "x")).toEqual([
      { type: "del", text: "" },
      { type: "add", text: "x" },
    ]);
  });
});
