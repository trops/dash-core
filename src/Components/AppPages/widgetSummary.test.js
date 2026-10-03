// usageOf reuses useInstalledWidgets' layout walker; keep ComponentManager
// (and the layout UI it imports) out of this pure test.
jest.mock("../../ComponentManager", () => ({ ComponentManager: {} }));

import {
  BUILT_IN,
  AI_BUILT,
  LOCAL,
  widgetOrgs,
  filterOrgs,
  packageLabel,
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
