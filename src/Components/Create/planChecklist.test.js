import {
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
