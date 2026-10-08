import {
  providerUseModel,
  planProviderUse,
  applyProviderUse,
} from "./providerUsePlan";

// Widgets that take a "slack" provider, on a paged dashboard (one widget
// per page + one in the sidebar) and a plain one.
const requirements = {
  SlackFeed: [{ type: "slack", providerClass: "mcp" }],
  SlackComposer: [{ type: "slack", providerClass: "mcp" }],
  Clock: [],
  Gmail: [{ type: "gmail", providerClass: "mcp" }],
};
const getWidgetRequirements = (c) => requirements[c] || [];

const daily = {
  id: 1,
  name: "Daily Brief",
  pages: [
    {
      id: "p1",
      layout: [
        {
          id: 11,
          uuidString: "w-feed",
          dashboardId: 1,
          component: "SlackFeed",
          selectedProviders: { slack: "Slack" },
        },
        { id: 12, uuidString: "w-clock", dashboardId: 1, component: "Clock" },
      ],
    },
    {
      id: "p2",
      layout: [
        { id: 13, uuidString: "w-mail", dashboardId: 1, component: "Gmail" },
      ],
    },
  ],
  sidebarLayout: [
    {
      id: 14,
      uuidString: "w-compose",
      dashboardId: 1,
      component: "SlackComposer",
    },
  ],
  // Layer 2 binding for the sidebar composer.
  selectedProviders: { "w-compose": { slack: "Slack Dash Comms" } },
};
const kitchen = {
  id: 2,
  name: "Kitchen Sink",
  layout: [
    { id: 21, uuidString: "w-k", dashboardId: 2, component: "SlackFeed" },
  ],
};

const providers = {
  Slack: { type: "slack", providerClass: "mcp" },
  "Slack Dash Comms": { type: "slack", providerClass: "mcp" },
  Gmail: { type: "gmail", providerClass: "mcp" },
};
const statusOf = (name) => ({
  key: name === "Slack" ? "needsSetup" : "ready",
});

const bots = [
  {
    id: "b1",
    name: "Digest",
    workspaceId: 1,
    mcpServers: ["Slack"],
    allowedTools: ["mcp__Slack__channels_list"],
  },
  {
    id: "b2",
    name: "Poster",
    workspaceId: 2,
    mcpServers: ["Slack Dash Comms", "Gmail"],
    allowedTools: ["mcp__Slack Dash Comms__send"],
  },
  { id: "lead", name: "Lead", role: "lead", workspaceId: 1, mcpServers: [] },
];

const model = (name = "Slack Dash Comms", extra = {}) =>
  providerUseModel({
    providerName: name,
    providers: extra.providers || providers,
    workspaces: [daily, kitchen],
    bots,
    getWidgetRequirements,
    statusOf,
  });

describe("providerUseModel (NAV-015)", () => {
  it("lists only widgets of the provider's type, grouped by dashboard, including every page and the sidebar", () => {
    const m = model();
    expect(m.dashboards.map((d) => d.workspaceName)).toEqual([
      "Daily Brief",
      "Kitchen Sink",
    ]);
    expect(m.dashboards[0].rows.map((r) => r.widgetId)).toEqual([
      "w-feed",
      "w-compose",
    ]);
    expect(m.dashboards[1].rows.map((r) => r.widgetId)).toEqual(["w-k"]);
  });

  it("says what each widget uses now, and whether it already uses this one", () => {
    const [feed, compose] = model().dashboards[0].rows;
    expect(feed.current).toEqual({
      kind: "explicit",
      name: "Slack",
      needsSetup: true,
    });
    expect(feed.usesThis).toBe(false);
    expect(compose.current).toEqual({
      kind: "explicit",
      name: "Slack Dash Comms",
      needsSetup: false,
    });
    expect(compose.usesThis).toBe(true);
    const [k] = model().dashboards[1].rows;
    expect(k.current).toEqual({ kind: "none", name: null, needsSetup: false });
  });

  it("knows the type's default, and a widget using this provider only as the default can't be unticked", () => {
    const withDefault = {
      ...providers,
      "Slack Dash Comms": {
        ...providers["Slack Dash Comms"],
        isDefaultForType: true,
      },
    };
    const m = model("Slack Dash Comms", { providers: withDefault });
    expect(m.defaultName).toBe("Slack Dash Comms");
    const [k] = m.dashboards[1].rows;
    expect(k.current.kind).toBe("default");
    expect(k.usesThis).toBe(true);
    expect(k.locked).toBe(true);
    expect(model().defaultName).toBe(null);
  });

  it("lists non-lead bots for MCP providers, with what they use of this type", () => {
    const m = model();
    expect(m.bots.map((b) => [b.botId, b.usesThis, b.others])).toEqual([
      ["b1", false, ["Slack"]],
      ["b2", true, []],
    ]);
  });

  it("has no bot rows for credential / websocket providers", () => {
    const m = providerUseModel({
      providerName: "Algolia",
      providers: { Algolia: { type: "algolia", providerClass: "credential" } },
      workspaces: [daily],
      bots,
      getWidgetRequirements,
      statusOf,
    });
    expect(m.bots).toEqual([]);
  });
});

describe("planProviderUse", () => {
  const picksFrom = (m, overrides) => {
    const picks = {};
    for (const d of m.dashboards)
      for (const r of d.rows) picks[r.key] = r.usesThis;
    for (const b of m.bots) picks[b.key] = b.usesThis;
    return { ...picks, ...overrides };
  };

  it("only changed rows: tick → this provider, untick → cleared; bots add / remove the grant", () => {
    const m = model();
    const [feed, compose] = m.dashboards[0].rows;
    const [b1, b2] = m.bots;
    const plan = planProviderUse(
      m,
      picksFrom(m, {
        [feed.key]: true,
        [compose.key]: false,
        [b1.key]: true,
        [b2.key]: false,
      }),
    );
    expect(plan.workspaces).toEqual([
      {
        workspaceId: 1,
        changes: [
          {
            widgetId: "w-feed",
            providerType: "slack",
            providerName: "Slack Dash Comms",
          },
          { widgetId: "w-compose", providerType: "slack", providerName: null },
        ],
      },
    ]);
    expect(plan.bots).toEqual([
      { botId: "b1", add: true },
      { botId: "b2", add: false },
    ]);
    expect(plan.count).toBe(4);
  });

  it("nothing changed → empty plan", () => {
    const m = model();
    expect(planProviderUse(m, picksFrom(m, {}))).toEqual({
      workspaces: [],
      bots: [],
      count: 0,
      providerName: "Slack Dash Comms",
    });
  });
});

describe("applyProviderUse", () => {
  const plan = {
    workspaces: [
      {
        workspaceId: 1,
        changes: [
          {
            widgetId: "w-feed",
            providerType: "slack",
            providerName: "Slack Dash Comms",
          },
        ],
      },
      {
        workspaceId: 2,
        changes: [
          {
            widgetId: "w-k",
            providerType: "slack",
            providerName: "Slack Dash Comms",
          },
        ],
      },
    ],
    bots: [{ botId: "b1", add: true }],
    count: 3,
    providerName: "Slack Dash Comms",
  };

  it("saves each changed dashboard (both binding layers) and bot once, keeping the bot's tools", async () => {
    const saved = [];
    const dashApi = {
      saveWorkspace: (appId, ws, ok) => {
        saved.push({ appId, ws });
        ok({}, { success: true });
      },
    };
    const botSaves = [];
    const botsApi = {
      save: async (d) => {
        botSaves.push(d);
        return d;
      },
    };
    const result = await applyProviderUse({
      plan,
      workspaces: [daily, kitchen],
      bots,
      dashApi,
      appId: "app",
      botsApi,
    });
    expect(result.failed).toEqual([]);
    expect(saved.map((s) => s.ws.id)).toEqual([1, 2]);
    const feed = saved[0].ws.pages[0].layout[0];
    expect(feed.selectedProviders.slack).toBe("Slack Dash Comms");
    expect(saved[0].ws.selectedProviders["w-feed"].slack).toBe(
      "Slack Dash Comms",
    );
    expect(botSaves).toHaveLength(1);
    expect(botSaves[0].mcpServers).toEqual(["Slack", "Slack Dash Comms"]);
    expect(botSaves[0].allowedTools).toEqual(["mcp__Slack__channels_list"]);
    expect(result.widgets).toBe(2);
    expect(result.dashboards).toBe(2);
    expect(result.bots).toBe(1);
  });

  it("names what failed and still saves the rest", async () => {
    const dashApi = {
      saveWorkspace: (appId, ws, ok, fail) =>
        ws.id === 1 ? fail({}, { message: "disk full" }) : ok({}, {}),
    };
    const botsApi = {
      save: async () => {
        throw new Error("nope");
      },
    };
    const result = await applyProviderUse({
      plan,
      workspaces: [daily, kitchen],
      bots,
      dashApi,
      appId: "app",
      botsApi,
    });
    expect(result.failed).toEqual([
      { kind: "dashboard", name: "Daily Brief", error: "disk full" },
      { kind: "bot", name: "Digest", error: "nope" },
    ]);
    expect(result.dashboards).toBe(1);
    expect(result.bots).toBe(0);
  });
});
