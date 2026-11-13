/**
 * issues.js — what a widget tells the main process (issues PRD).
 */
import {
  widgetItemId,
  widgetFacts,
  noteWidgetCallFailed,
  noteWidgetCallWorked,
  _resetOpenCalls,
  setWidgetNamer,
  noteIssueOpenAgain,
} from "./issues";

const flush = () => new Promise((r) => setTimeout(r, 0));

function mockApi(open = []) {
  const api = {
    record: jest.fn(() => Promise.resolve()),
    resolveWorked: jest.fn(() => Promise.resolve()),
    list: jest.fn(() => Promise.resolve(open)),
  };
  window.mainApi = { issues: api };
  return api;
}

const facts = {
  component: "ai-built.notes.NotesView",
  itemId: "u1",
  workspaceId: 7,
};
const call = { provider: "Notes MCP", tool: "list_notes" };

describe("widgetItemId", () => {
  it("is the item's uuid, else its id — never a made-up one", () => {
    expect(widgetItemId({ uuid: "u1", uuidString: "u1", id: 3 })).toBe("u1");
    expect(widgetItemId({ uuidString: "d-1234", id: 3 })).toBe("3");
    expect(widgetItemId({ uuidString: "d-1234" })).toBe(null);
    expect(widgetItemId(null)).toBe(null);
  });
});

describe("widgetFacts", () => {
  it("carries the widget's place, so Fix with AI reaches this copy", () => {
    const f = widgetFacts(
      {
        component: "NotesView",
        uuid: "u1",
        id: 4,
        parent: 2,
        scope: "main",
        packageId: "@ai-built/notes",
        dashboardId: 7,
      },
      null,
    );
    expect(f).toMatchObject({
      itemId: "u1",
      id: 4,
      gridItemId: 2,
      scope: "main",
      packageId: "@ai-built/notes",
      workspaceId: 7,
    });
  });
});

describe("a call that works", () => {
  beforeEach(() => _resetOpenCalls());
  afterEach(() => {
    delete window.mainApi;
  });

  it("tells the main process nothing when nothing was wrong", async () => {
    const api = mockApi([]);
    noteWidgetCallWorked(facts, call);
    await flush();
    noteWidgetCallWorked(facts, call);
    expect(api.resolveWorked).not.toHaveBeenCalled();
  });

  it("resolves once after it failed", async () => {
    const api = mockApi([]);
    noteWidgetCallFailed(facts, { ...call, args: null, error: "x" });
    noteWidgetCallWorked(facts, call);
    noteWidgetCallWorked(facts, call);
    expect(api.record).toHaveBeenCalledTimes(1);
    expect(api.resolveWorked).toHaveBeenCalledTimes(1);
  });

  it("resolves an issue left open from before the reload", async () => {
    const api = mockApi([
      {
        asset: {
          component: facts.component,
          itemId: "u1",
          workspaceId: "7",
        },
        call,
      },
    ]);
    noteWidgetCallWorked(facts, call); // loads the open list
    await flush();
    noteWidgetCallWorked(facts, call);
    expect(api.resolveWorked).toHaveBeenCalledTimes(1);
  });
});

describe("an issue unmuted (open again)", () => {
  beforeEach(() => _resetOpenCalls());
  afterEach(() => {
    delete window.mainApi;
  });
  it("its call working next resolves it, though it wasn't open at start", async () => {
    const api = mockApi([]);
    noteWidgetCallWorked(facts, call); // loads the (empty) open list
    await flush();
    noteIssueOpenAgain({
      asset: {
        kind: "widget",
        component: facts.component,
        itemId: "u1",
        workspaceId: "7",
      },
      call,
    });
    noteWidgetCallWorked(facts, call);
    expect(api.resolveWorked).toHaveBeenCalledTimes(1);
  });
});

describe("a widget's name", () => {
  afterEach(() => setWidgetNamer(null));
  it("is the user's title, else the name the factory gives it — not its code name", () => {
    setWidgetNamer((item) =>
      item.component === "x.y.PlayerHaMcp" ? "Music Player" : "",
    );
    expect(widgetFacts({ component: "x.y.PlayerHaMcp" }).widgetName).toBe(
      "Music Player",
    );
    expect(
      widgetFacts({
        component: "x.y.PlayerHaMcp",
        userPrefs: { title: "Bedroom" },
      }).widgetName,
    ).toBe("Bedroom");
    setWidgetNamer(() => {
      throw new Error("no config");
    });
    expect(widgetFacts({ component: "x.y.PlayerHaMcp" }).widgetName).toBe("");
  });
});
