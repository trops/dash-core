import {
  classOf,
  missingFields,
  providerStatus,
  providerUsage,
  groupProviders,
} from "./providerSummary";

const slack = {
  type: "slack",
  providerClass: "mcp",
  mcpConfig: {
    transport: "stdio",
    command: "npx",
    envMapping: { SLACK_BOT_TOKEN: "xoxbToken", SLACK_TEAM_ID: "teamId" },
  },
  credentials: { xoxbToken: "", teamId: "T1" },
};
const github = {
  type: "github",
  providerClass: "mcp",
  mcpConfig: { transport: "stdio", envMapping: { GH_TOKEN: "token" } },
  credentials: { token: "ghp_x" },
};
const hosted = {
  type: "algolia",
  providerClass: "mcp",
  mcpConfig: {
    transport: "streamable_http",
    url: "https://x/{{appId}}",
    headerTemplate: { Authorization: "Bearer {{apiKey}}" },
  },
  credentials: { appId: "A", apiKey: "" },
};
const noFields = {
  type: "filesystem",
  providerClass: "mcp",
  mcpConfig: { transport: "stdio", command: "npx", args: ["fs"] },
  credentials: {},
};
const algolia = { type: "algolia", credentials: { appId: "A", apiKey: "k" } };
const emptyCreds = { type: "openai", credentials: { apiKey: "" } };
const ws = {
  type: "websocket",
  providerClass: "websocket",
  wsConfig: { url: "wss://echo" },
};
const wsNoUrl = { type: "websocket", providerClass: "websocket", wsConfig: {} };

describe("classOf", () => {
  it("defaults to credentials", () => {
    expect(classOf(algolia)).toBe("credential");
    expect(classOf(slack)).toBe("mcp");
    expect(classOf(ws)).toBe("websocket");
  });
});

describe("missingFields (app-navigation NAV-007)", () => {
  it("MCP: fields the server config uses that are empty", () => {
    expect(missingFields(slack)).toEqual(["Xoxb Token"]);
    expect(missingFields(github)).toEqual([]);
    expect(missingFields(hosted)).toEqual(["API Key"]);
    expect(missingFields(noFields)).toEqual([]);
  });

  it("MCP: also catalog fields marked required (with their display names)", () => {
    const schema = {
      xoxbToken: { displayName: "Bot Token (xoxb-)", required: true },
      extra: { displayName: "Optional thing" },
      region: { displayName: "Region", required: true },
    };
    expect(missingFields(slack, schema)).toEqual([
      "Bot Token (xoxb-)",
      "Region",
    ]);
  });

  it("credentials: nothing saved", () => {
    expect(missingFields(algolia)).toEqual([]);
    expect(missingFields(emptyCreds)).toEqual(["Credentials"]);
    expect(missingFields({ type: "x" })).toEqual(["Credentials"]);
  });

  it("WebSocket: no URL", () => {
    expect(missingFields(ws)).toEqual([]);
    expect(missingFields(wsNoUrl)).toEqual(["URL"]);
  });
});

describe("providerStatus", () => {
  it("needs setup > connected > ready", () => {
    expect(providerStatus(slack, { running: true })).toEqual({
      key: "needsSetup",
      label: "Needs setup",
      missing: ["Xoxb Token"],
    });
    expect(providerStatus(github, { running: true }).key).toBe("connected");
    expect(providerStatus(github, { running: false })).toEqual({
      key: "ready",
      label: "Starts when used",
      missing: [],
    });
    expect(providerStatus(algolia).label).toBe("Saved");
    expect(providerStatus(ws).label).toBe("Ready");
  });
});

describe("providerUsage", () => {
  const workspaces = [
    {
      id: 1,
      name: "Kitchen Sink",
      layout: [
        { id: 1, component: "SlackWidget", selectedProviders: {} },
        { id: 2, component: "SlackWidget2", selectedProviders: {} },
      ],
    },
    { id: 2, name: "Mail", layout: [{ id: 3, component: "Other" }] },
  ];
  const bindingsFor = jest.fn((ws) =>
    ws.id === 1
      ? [
          { resolvedProviderName: "Slack" },
          { resolvedProviderName: "Slack" },
          { resolvedProviderName: "GitHub" },
        ]
      : [{ resolvedProviderName: null }],
  );
  const bots = [
    { id: "b1", name: "Digest", workspaceId: 1, mcpServers: ["Slack"] },
    { id: "b2", name: "Other", mcpServers: ["GitHub"] },
    { id: "lead", name: "Lead", role: "lead", mcpServers: ["Slack"] },
  ];

  it("lists the dashboards whose widgets use it, and the bots granted it", () => {
    const usage = providerUsage("Slack", { workspaces, bots, bindingsFor });
    expect(usage.dashboards).toEqual([
      { workspaceId: 1, workspaceName: "Kitchen Sink", widgets: 2 },
    ]);
    expect(usage.bots.map((b) => b.id)).toEqual(["b1"]);
    expect(usage.count).toBe(2);
  });

  it("is empty when nothing uses it", () => {
    expect(providerUsage("Nope", { workspaces, bots, bindingsFor })).toEqual({
      dashboards: [],
      bots: [],
      count: 0,
    });
  });
});

describe("groupProviders", () => {
  const providers = {
    Slack: slack,
    GitHub: github,
    Algolia: algolia,
    Echo: ws,
    "OpenAI Key": emptyCreds,
  };
  const statusOf = (name) =>
    ["Slack", "OpenAI Key"].includes(name) ? "needsSetup" : "ready";
  const names = (groups) =>
    groups.map((g) => [g.label, g.items.map((i) => i.name)]);

  it("groups by class (MCP, Credentials, WebSocket), A-Z", () => {
    expect(names(groupProviders(providers, { statusOf }))).toEqual([
      ["MCP servers", ["GitHub", "Slack"]],
      ["API credentials", ["Algolia", "OpenAI Key"]],
      ["WebSocket", ["Echo"]],
    ]);
  });

  it("filters by class, search (name or type) and needs setup", () => {
    expect(names(groupProviders(providers, { statusOf, cls: "mcp" }))).toEqual([
      ["MCP servers", ["GitHub", "Slack"]],
    ]);
    expect(
      names(groupProviders(providers, { statusOf, query: "ALGO" })),
    ).toEqual([["API credentials", ["Algolia"]]]);
    expect(
      names(groupProviders(providers, { statusOf, needsSetupOnly: true })),
    ).toEqual([
      ["MCP servers", ["Slack"]],
      ["API credentials", ["OpenAI Key"]],
    ]);
  });
});
