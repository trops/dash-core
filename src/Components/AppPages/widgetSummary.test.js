// usageOf reuses useInstalledWidgets' layout walker; keep ComponentManager
// (and the layout UI it imports) out of this pure test.
jest.mock("../../ComponentManager", () => ({ ComponentManager: {} }));

import {
  widgetTitle,
  BUILT_IN,
  AI_BUILT,
  LOCAL,
  widgetOrgs,
  filterOrgs,
  packageLabel,
  packageWidgets,
  searchResults,
  widgetTotals,
  uninstallCopy,
} from "./widgetSummary";

const W = (over) => ({
  name: over.name,
  displayName: over.displayName || over.name,
  description: over.description || null,
  source: over.source || "installed",
  kind: over.kind || "installed",
  draftId: over.draftId || null,
  version: over.version || null,
  package: over.package || null,
  packageId: over.packageId,
  providers: over.providers || [],
  componentNames: over.componentNames || [over.name],
  ...over,
});

const widgets = [
  W({
    name: "trops.slack.Channels",
    displayName: "Slack Channels",
    packageId: "@trops/slack",
    version: "1.2.0",
    providers: [{ type: "slack", required: true }],
  }),
  W({
    name: "trops.slack.Messages",
    displayName: "Channel Messages",
    description: "Recent messages",
    packageId: "@trops/slack",
    version: "1.2.0",
    providers: [{ type: "slack" }, { type: "gmail" }],
  }),
  W({
    name: "acme.chart.Bar",
    displayName: "Bar Chart",
    packageId: "@acme/charts",
    version: "0.3.1",
  }),
  W({
    name: "ai-built.notes.Notes",
    displayName: "Notes",
    packageId: "@ai-built/notes",
    version: "0.0.1",
  }),
  W({
    name: "ai-built.draft-x.Thing",
    displayName: "Thing",
    packageId: "@ai-built/draft-x",
    kind: "draft",
    draftId: "x",
  }),
  W({ name: "localpkg.Clock", displayName: "Clock", packageId: "localpkg" }),
  W({
    name: "Notepad",
    displayName: "Notepad",
    source: "builtin",
    package: "Dash Samples",
    packageId: undefined,
  }),
];

const workspaces = [
  {
    id: 1,
    name: "Kitchen Sink",
    layout: [{ component: "trops.slack.Messages" }, { component: "Notepad" }],
  },
  { id: 2, name: "Mail", layout: [{ component: "trops.slack.Messages" }] },
  // Multi-page dashboards keep each page's layout under pages[].
  {
    id: 3,
    name: "Clocks",
    layout: [],
    pages: [
      { id: "p1", layout: [] },
      { id: "p2", layout: [{ component: "localpkg.Clock" }] },
    ],
  },
];

const updates = new Map([["trops.slack.Channels", { latestVersion: "1.3.0" }]]);

describe("widgetOrgs (app-navigation NAV-008 AC1)", () => {
  const orgs = widgetOrgs(widgets, { workspaces, updates });

  it("groups org → package → widgets: scopes A-Z, then AI-built, Local, Built-in", () => {
    expect(orgs.map((o) => o.name)).toEqual([
      "@acme",
      "@trops",
      AI_BUILT,
      LOCAL,
      BUILT_IN,
    ]);
    const trops = orgs[1];
    expect(trops.packages).toHaveLength(1);
    expect(trops.packages[0].id).toBe("@trops/slack");
    expect(trops.packages[0].widgets.map((w) => w.name)).toEqual([
      "trops.slack.Channels",
      "trops.slack.Messages",
    ]);
    expect(orgs[2].packages.map((p) => p.id)).toEqual([
      "@ai-built/draft-x",
      "@ai-built/notes",
    ]);
  });

  it("describes each package: version, source, update, providers, usage", () => {
    const slack = orgs[1].packages[0];
    expect(slack.version).toBe("1.2.0");
    expect(slack.source).toBe("Installed");
    expect(slack.update).toEqual({ latestVersion: "1.3.0" });
    expect(slack.providers).toEqual(["slack", "gmail"]);
    expect(slack.usedOn.map((u) => u.workspaceName)).toEqual([
      "Kitchen Sink",
      "Mail",
    ]);
    expect(slack.widgetUsage["trops.slack.Channels"]).toEqual([]);
    expect(
      slack.widgetUsage["trops.slack.Messages"].map((u) => u.workspaceId),
    ).toEqual([1, 2]);
  });

  it("counts usage on every page of a dashboard", () => {
    expect(orgs[3].packages[0].usedOn).toEqual([
      { workspaceId: 3, workspaceName: "Clocks", count: 1 },
    ]);
  });

  it("the user's own packages: their scope, AI-built and drafts — not others'", () => {
    // Every user publishes only under their own username as the scope.
    const mineAs = (username) =>
      widgetOrgs(widgets, { workspaces, updates, username })
        .flatMap((o) => o.packages)
        .filter((p) => p.mine)
        .map((p) => p.id);
    expect(mineAs("trops")).toEqual([
      "@trops/slack",
      "@ai-built/draft-x",
      "@ai-built/notes",
    ]);
    expect(mineAs("acme")).toEqual([
      "@acme/charts",
      "@ai-built/draft-x",
      "@ai-built/notes",
    ]);
    // Signed out: only the local AI-built packages.
    expect(mineAs(null)).toEqual(["@ai-built/draft-x", "@ai-built/notes"]);
    // Never by substring / prefix.
    expect(mineAs("trop")).toEqual(["@ai-built/draft-x", "@ai-built/notes"]);
  });

  it("marks drafts and AI-built packages as the user's; built-ins have no package id", () => {
    const [draft, notes] = orgs[2].packages;
    expect(draft.isDraft).toBe(true);
    expect(draft.source).toBe("Draft");
    expect(draft.mine).toBe(true);
    expect(notes.source).toBe("AI-built");
    expect(notes.mine).toBe(true);
    expect(orgs[1].packages[0].mine).toBe(false);
    const builtin = orgs[4].packages[0];
    expect(builtin.id).toBe("builtin:Dash Samples");
    expect(builtin.source).toBe("Built-in");
    expect(builtin.isBuiltIn).toBe(true);
  });

  it("labels packages without their scope; drafts by their widget", () => {
    expect(packageLabel(orgs[1].packages[0])).toBe("slack");
    expect(packageLabel(orgs[2].packages[0])).toBe("Thing (draft)");
    expect(packageLabel(orgs[3].packages[0])).toBe("localpkg");
    expect(packageLabel(orgs[4].packages[0])).toBe("Dash Samples");
  });
});

describe("filterOrgs (NAV-008 AC2)", () => {
  const orgs = widgetOrgs(widgets, { workspaces, updates });
  const ids = (out) => out.flatMap((o) => o.packages.map((p) => p.id));

  it("search on a package name keeps all its widgets", () => {
    const out = filterOrgs(orgs, { query: "slack" });
    expect(ids(out)).toEqual(["@trops/slack"]);
    expect(out[0].packages[0].matched).toHaveLength(2);
  });

  it("search on a widget name or description keeps just the matching widgets", () => {
    let out = filterOrgs(orgs, { query: "bar chart" });
    expect(ids(out)).toEqual(["@acme/charts"]);
    out = filterOrgs(orgs, { query: "recent messages" });
    expect(out[0].packages[0].matched.map((w) => w.name)).toEqual([
      "trops.slack.Messages",
    ]);
    expect(out[0].packages[0].queryMatchedWidgets).toBe(true);
  });

  it("filters by org and by in use / not used / mine", () => {
    expect(ids(filterOrgs(orgs, { orgs: ["@acme", LOCAL] }))).toEqual([
      "@acme/charts",
      "localpkg",
    ]);
    expect(ids(filterOrgs(orgs, { chip: "inUse" }))).toEqual([
      "@trops/slack",
      "localpkg",
      "builtin:Dash Samples",
    ]);
    expect(ids(filterOrgs(orgs, { chip: "notUsed" }))).toEqual([
      "@acme/charts",
      "@ai-built/draft-x",
      "@ai-built/notes",
    ]);
    expect(ids(filterOrgs(orgs, { chip: "mine" }))).toEqual([
      "@ai-built/draft-x",
      "@ai-built/notes",
    ]);
  });

  it("drops empty orgs", () => {
    const out = filterOrgs(orgs, { query: "zzz" });
    expect(out).toEqual([]);
  });
});

describe('widgetTitle (design audit: no "My Workspace" rows)', () => {
  it("uses the display name", () => {
    expect(widgetTitle({ displayName: "Slack Channels", name: "x.Y" })).toBe(
      "Slack Channels",
    );
  });
  it("skips the config model's default name and reads the component", () => {
    expect(
      widgetTitle({
        displayName: "My Workspace",
        name: "trops.slack.ChannelMessages",
      }),
    ).toBe("Channel Messages");
    expect(widgetTitle({ name: "My Workspace" })).toBe("Widget");
    expect(widgetTitle({ name: "HTMLViewer" })).toBe("HTML Viewer");
  });
});

// Consolidation Phase 1a-2: a package carries who built it and its checks.
describe("widgetOrgs — build and checks", () => {
  it("takes them from the package's widgets", () => {
    const checks = { ok: false, problems: ["Hi: nope"] };
    const orgs = widgetOrgs([
      {
        name: "a.b.Hi",
        packageId: "@a/b",
        source: "installed",
        kind: "installed",
        build: "developer",
        checks,
        providers: [],
        componentNames: [],
      },
    ]);
    const pkg = orgs[0].packages[0];
    expect(pkg.build).toBe("developer");
    expect(pkg.checks).toEqual(checks);
  });
  it("useInstalledWidgets passes them through from the registry", () => {
    const src = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        "hooks",
        "useInstalledWidgets.js",
      ),
      "utf8",
    );
    expect(src).toMatch(
      /build: reg\.build \|\| null,\s*checks: reg\.checks \|\| null,/,
    );
    expect(src).toMatch(
      /build: w\.build \|\| null,\s*checks: w\.checks \|\| null,/,
    );
  });
});

describe("the drill-in list (consolidation Phase 4b)", () => {
  const orgs = () => widgetOrgs(widgets, { workspaces });
  const slack = () =>
    orgs()
      .flatMap((o) => o.packages)
      .find((p) => p.id === "@trops/slack");

  test("packageWidgets: In use / Not used filter a package's widgets; Mine keeps them", () => {
    const names = (chip) => packageWidgets(slack(), chip).map((w) => w.name);
    expect(names("all")).toEqual([
      "trops.slack.Channels",
      "trops.slack.Messages",
    ]);
    expect(names("inUse")).toEqual(["trops.slack.Messages"]);
    expect(names("notUsed")).toEqual(["trops.slack.Channels"]);
    expect(names("mine")).toHaveLength(2);
  });

  test("searchResults: packages by name, widgets wherever they live, flat", () => {
    const r = searchResults(orgs(), { query: "messages" });
    expect(r.packages).toEqual([]);
    expect(r.widgets.map((x) => [x.pkg.id, x.widget.name])).toEqual([
      ["@trops/slack", "trops.slack.Messages"],
    ]);
    const s = searchResults(orgs(), { query: "slack" });
    expect(s.packages.map((p) => p.id)).toEqual(["@trops/slack"]);
    expect(s.widgets.map((x) => x.widget.name)).toEqual([
      "trops.slack.Channels",
      "trops.slack.Messages",
    ]);
    expect(searchResults(orgs(), { query: "  " })).toEqual({
      packages: [],
      widgets: [],
    });
    // The Org filter and chips apply.
    expect(
      searchResults(orgs(), { query: "slack", orgs: ["@acme"] }).widgets,
    ).toEqual([]);
    expect(
      searchResults(orgs(), { query: "slack", chip: "notUsed" }).widgets.map(
        (x) => x.widget.name,
      ),
    ).toEqual([]);
  });

  test("widgetTotals: packages, widgets, in use and updates", () => {
    expect(widgetTotals(orgs())).toEqual({
      packages: 6,
      widgets: 7,
      inUse: 3,
      dashboards: 3,
      updates: 0,
    });
  });

  test("uninstallCopy: from a widget, the others that go with it and where", () => {
    const pkg = slack();
    const c = uninstallCopy(pkg, pkg.widgets[0]);
    expect(c.title).toBe("Uninstall slack?");
    expect(c.intro).toBe(
      "Slack Channels comes with 1 other widget in the slack package. Uninstalling removes all 2:",
    );
    expect(c.items).toEqual([
      "Slack Channels",
      "Channel Messages · on Kitchen Sink, Mail",
    ]);
    expect(c.note).toBe(
      'On those 2 dashboards, the cells will show "Widget Not Found" until you reinstall it from the registry.',
    );
    expect(uninstallCopy(pkg).intro).toBe("This removes its 2 widgets:");
  });

  test("uninstallCopy: one widget, not in the registry, not used", () => {
    const notes = orgs()
      .flatMap((o) => o.packages)
      .find((p) => p.id === "@ai-built/notes");
    expect(uninstallCopy(notes, notes.widgets[0])).toEqual({
      title: "Uninstall notes?",
      intro: "It isn't on any dashboard.",
      items: [],
      note: "This can't be undone: it isn't in the registry.",
    });
  });

  test("uninstallCopy: loaded from the user's folder, the folder stays (QA 2026-10-22)", () => {
    const [pkg] = widgetOrgs([
      {
        name: "tictactoe.TicTacToe",
        packageId: "tictactoe",
        source: "installed",
        kind: "installed",
        loadedInPlace: true,
        componentNames: ["tictactoe.TicTacToe"],
      },
    ]).flatMap((o) => o.packages);
    expect(pkg.loadedInPlace).toBe(true);
    expect(uninstallCopy(pkg).note).toBe(
      "Dash will forget it. Your folder stays where it is.",
    );
  });
});

test("widgetTitle: a display name that's just its component id reads as words", () => {
  expect(
    widgetTitle({
      name: "ai-built.statusboard.StatusBoard",
      displayName: "ai-built.statusboard.StatusBoard",
    }),
  ).toBe("Status Board");
  // A real name with a dot in it stays.
  expect(widgetTitle({ name: "x.y.Z", displayName: "Sales v2.1" })).toBe(
    "Sales v2.1",
  );
  expect(widgetTitle({ name: "x.node.Node", displayName: "Node.js" })).toBe(
    "Node.js",
  );
});

// QA 2026-10-22: a package loaded from a folder while signed out is @local.
describe("widgetOrgs — @local packages", () => {
  it("are listed under Local, as the user's own", () => {
    const orgs = widgetOrgs([
      {
        name: "local.clock.Clock",
        packageId: "@local/clock",
        source: "installed",
        kind: "installed",
        providers: [],
        componentNames: [],
      },
    ]);
    expect(orgs.map((o) => o.name)).toEqual([LOCAL]);
    expect(orgs[0].packages[0].mine).toBe(true);
  });
});
