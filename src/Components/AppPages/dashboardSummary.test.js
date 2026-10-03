import { dashboardSummary, packageOf, pageGrid } from "./dashboardSummary";

const grid = (rows, cols, extra = {}) => ({
  component: "LayoutGridContainer",
  id: 99,
  dashboardId: 7,
  grid: { rows, cols, ...extra },
  items: [],
});

const ws = {
  id: 7,
  name: "Kitchen Sink",
  themeKey: "aurora",
  menuId: 3,
  pages: [
    {
      id: "p1",
      name: "Overview",
      layout: [
        {
          ...grid(2, 2, {
            1.1: { span: { col: 2 } },
            1.2: { hide: true },
            2.1: {},
            2.2: {},
          }),
          items: [
            {
              id: 1,
              uuidString: "w1",
              component: "trops.slack.ChannelMessages",
              dashboardId: 7,
              userPrefs: { title: "#eng" },
            },
            {
              id: 2,
              uuidString: "w2",
              component: "trops.gmail.Inbox",
              dashboardId: 7,
            },
          ],
        },
      ],
    },
    {
      id: "p2",
      name: "Data",
      layout: [
        { id: 3, uuidString: "w3", component: "Notepad", dashboardId: 7 },
      ],
    },
  ],
};

const requirements = {
  "trops.slack.ChannelMessages": [{ type: "slack", required: true }],
  "trops.gmail.Inbox": [{ type: "gmail", required: true }],
};

const ctx = {
  getWidgetConfig: (c) => (c === "Notepad" ? { displayName: "Notepad" } : null),
  getWidgetRequirements: (c) => requirements[c] || [],
  appProviders: { "Slack Work": { type: "slack", isDefaultForType: true } },
};

describe("packageOf", () => {
  it("derives @scope/package from a scoped widget id", () => {
    expect(packageOf("trops.slack.ChannelMessages")).toBe("@trops/slack");
    expect(packageOf("Notepad")).toBeNull();
    expect(packageOf(null)).toBeNull();
  });
});

describe("pageGrid", () => {
  it("lists the visible cells of the page's grid with spans", () => {
    expect(pageGrid(ws.pages[0].layout)).toEqual({
      rows: 2,
      cols: 2,
      cells: [
        { row: 1, col: 1, colSpan: 2, rowSpan: null },
        { row: 2, col: 1, colSpan: null, rowSpan: null },
        { row: 2, col: 2, colSpan: null, rowSpan: null },
      ],
    });
  });

  it("is null without a grid", () => {
    expect(pageGrid(ws.pages[1].layout)).toBeNull();
    expect(pageGrid(undefined)).toBeNull();
  });
});

describe("dashboardSummary (app-navigation NAV-005)", () => {
  const s = dashboardSummary(ws, ctx);

  it("lists pages with their grids", () => {
    expect(s.pages.map((p) => p.name)).toEqual(["Overview", "Data"]);
    expect(s.pages[0].grid.rows).toBe(2);
    expect(s.pages[1].grid).toBeNull();
  });

  it("lists every widget once, with its name and package", () => {
    expect(s.widgets).toEqual([
      {
        id: "w1",
        name: "#eng",
        component: "trops.slack.ChannelMessages",
        package: "@trops/slack",
      },
      {
        id: "w2",
        name: "Inbox",
        component: "trops.gmail.Inbox",
        package: "@trops/gmail",
      },
      { id: "w3", name: "Notepad", component: "Notepad", package: null },
    ]);
  });

  it("names the providers used and counts the unresolved ones", () => {
    expect(s.providers).toEqual(["Slack Work"]);
    expect(s.unresolvedProviders).toBe(1); // gmail has no provider
  });

  it("treats a workspace without pages as one page", () => {
    const flat = dashboardSummary(
      {
        id: 8,
        name: "Flat",
        layout: [
          { id: 1, uuidString: "x", component: "Notepad", dashboardId: 8 },
        ],
      },
      ctx,
    );
    expect(flat.pages).toEqual([{ id: "main", name: "Main", grid: null }]);
    expect(flat.widgets.map((w) => w.id)).toEqual(["x"]);
  });

  it("copes with missing lookups", () => {
    const bare = dashboardSummary(ws, {});
    expect(bare.widgets).toHaveLength(3);
    expect(bare.providers).toEqual([]);
    expect(bare.unresolvedProviders).toBe(0);
  });
});
