import {
  classOf,
  missingFields,
  providerStatus,
  providerUsage,
  groupProviders,
  providerDeleteMessage,
  providerRenameMessage,
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

describe("missingFields — 'one of these' credential options", () => {
  // Slack: any ONE of bot token, user token, or browser token + cookie.
  const realSlack = (credentials) => ({
    type: "slack",
    providerClass: "mcp",
    mcpConfig: {
      transport: "stdio",
      command: "npx",
      envMapping: {
        SLACK_MCP_XOXB_TOKEN: "xoxbToken",
        SLACK_MCP_XOXP_TOKEN: "xoxpToken",
        SLACK_MCP_XOXC_TOKEN: "xoxcToken",
        SLACK_MCP_XOXD_TOKEN: "xoxdToken",
      },
    },
    credentials,
  });
  const schema = {
    xoxbToken: { displayName: "Bot Token (xoxb-)" },
    xoxpToken: { displayName: "User OAuth Token (xoxp-)" },
    xoxcToken: { displayName: "Browser Session Token (xoxc-)" },
    xoxdToken: { displayName: "Browser Session Cookie (xoxd-)" },
  };
  const options = [["xoxbToken"], ["xoxpToken"], ["xoxcToken", "xoxdToken"]];

  it("any one complete option is enough", () => {
    expect(
      missingFields(realSlack({ xoxbToken: "xoxb-1" }), schema, options),
    ).toEqual([]);
    expect(
      missingFields(realSlack({ xoxpToken: "xoxp-1" }), schema, options),
    ).toEqual([]);
    expect(
      missingFields(
        realSlack({ xoxcToken: "xoxc-1", xoxdToken: "xoxd-1" }),
        schema,
        options,
      ),
    ).toEqual([]);
  });

  it("nothing filled → one plain 'One of' line", () => {
    expect(missingFields(realSlack({}), schema, options)).toEqual([
      "One of: Bot Token (xoxb-), User OAuth Token (xoxp-), or Browser Session Token (xoxc-) + Browser Session Cookie (xoxd-)",
    ]);
  });

  it("half an option (token without its cookie) doesn't count", () => {
    expect(
      missingFields(realSlack({ xoxcToken: "xoxc-1" }), schema, options),
    ).toHaveLength(1);
  });

  it("fields outside the options are still checked as before", () => {
    const p = realSlack({ xoxbToken: "xoxb-1" });
    p.mcpConfig.envMapping.SLACK_TEAM = "teamId";
    expect(
      missingFields(p, { ...schema, teamId: { displayName: "Team" } }, options),
    ).toEqual(["Team"]);
  });

  it("providerStatus passes the options through", () => {
    expect(
      providerStatus(realSlack({ xoxbToken: "xoxb-1" }), {
        credentialSchema: schema,
        credentialOptions: options,
      }).key,
    ).toBe("ready");
  });
});

describe("missingFields — fields the server works without", () => {
  // Algolia's hosted MCP endpoint: the URL is needed; the API key only when
  // the endpoint asks for one (the header template still references it).
  const algolia = (credentials) => ({
    type: "algolia",
    providerClass: "mcp",
    mcpConfig: {
      transport: "streamable_http",
      url: "{{url}}",
      headerTemplate: { Authorization: "Bearer {{apiKey}}" },
    },
    credentials,
  });
  const schema = {
    url: { displayName: "MCP Server URL" },
    apiKey: { displayName: "API Key", worksWithout: true },
  };

  it("an empty worksWithout field isn't missing", () => {
    expect(missingFields(algolia({ url: "https://mcp" }), schema)).toEqual([]);
    expect(
      providerStatus(algolia({ url: "https://mcp" }), {
        credentialSchema: schema,
      }).key,
    ).toBe("ready");
  });

  it("the other referenced fields are still needed", () => {
    expect(missingFields(algolia({}), schema)).toEqual(["MCP Server URL"]);
  });

  it("without the flag the key is still counted (unchanged)", () => {
    expect(
      missingFields(algolia({ url: "https://mcp" }), {
        ...schema,
        apiKey: { displayName: "API Key" },
      }),
    ).toEqual(["API Key"]);
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
      ["Tools (MCP)", ["GitHub", "Slack"]],
      ["API keys", ["Algolia", "OpenAI Key"]],
      ["Live data", ["Echo"]],
    ]);
  });

  it("filters by class, search (name or type) and needs setup", () => {
    expect(names(groupProviders(providers, { statusOf, cls: "mcp" }))).toEqual([
      ["Tools (MCP)", ["GitHub", "Slack"]],
    ]);
    expect(
      names(groupProviders(providers, { statusOf, query: "ALGO" })),
    ).toEqual([["API keys", ["Algolia"]]]);
    expect(
      names(groupProviders(providers, { statusOf, needsSetupOnly: true })),
    ).toEqual([
      ["Tools (MCP)", ["Slack"]],
      ["API keys", ["OpenAI Key"]],
    ]);
  });
});

describe("delete / rename confirm messages", () => {
  const dash = (n) => ({ workspaceId: n, workspaceName: `D${n}`, widgets: 1 });
  const bot = (n) => ({ id: `b${n}`, name: `Bot${n}` });

  it("says nothing uses an unused provider", () => {
    const usage = { dashboards: [], bots: [], count: 0 };
    expect(providerDeleteMessage("Slack", usage)).toBe(
      "Nothing uses Slack. This can't be undone.",
    );
    expect(providerRenameMessage("Slack", "Slack 2", usage)).toBeNull();
  });

  it("names the dashboards and bots using it, singular and plural", () => {
    expect(
      providerDeleteMessage("Slack", {
        dashboards: [dash(1)],
        bots: [bot(1), bot(2)],
        count: 3,
      }),
    ).toBe(
      "Slack is used by 1 dashboard (D1) and 2 bots (Bot1, Bot2). Once it's deleted, they need another provider picked before they work again. This can't be undone.",
    );
    expect(
      providerDeleteMessage("Slack", {
        dashboards: [],
        bots: [bot(1)],
        count: 1,
      }),
    ).toBe(
      "Slack is used by 1 bot (Bot1). Once it's deleted, that bot needs another provider picked before it works again. This can't be undone.",
    );
  });

  it("shortens a long list", () => {
    const usage = {
      dashboards: [dash(1), dash(2), dash(3), dash(4), dash(5)],
      bots: [],
      count: 5,
    };
    expect(providerDeleteMessage("Slack", usage)).toContain(
      "5 dashboards (D1, D2, D3 and 2 more)",
    );
  });

  it("doesn't claim nothing uses it when usage isn't known", () => {
    expect(providerDeleteMessage("Slack", null)).toBe(
      "Widgets and bots that use Slack will need another provider picked before they work again. This can't be undone.",
    );
    expect(providerRenameMessage("Slack", "Slack 2", null)).toMatch(
      /^Widgets and bots find Slack by name/,
    );
  });

  it("warns that a rename leaves them without it", () => {
    expect(
      providerRenameMessage("Slack", "Slack Work", {
        dashboards: [dash(1)],
        bots: [],
        count: 1,
      }),
    ).toBe(
      "Slack is used by 1 dashboard (D1). That dashboard's widgets find providers by name, so after the rename to Slack Work they won't work until you pick Slack Work for them.",
    );
    expect(
      providerRenameMessage("Slack", "Slack Work", {
        dashboards: [],
        bots: [bot(1)],
        count: 1,
      }),
    ).toBe(
      "Slack is used by 1 bot (Bot1). That bot finds providers by name, so after the rename to Slack Work it won't work until you pick Slack Work for it.",
    );
    expect(
      providerRenameMessage("Slack", "Slack Work", {
        dashboards: [dash(1)],
        bots: [bot(1)],
        count: 2,
      }),
    ).toBe(
      "Slack is used by 1 dashboard (D1) and 1 bot (Bot1). They find providers by name, so after the rename to Slack Work they won't work until you pick Slack Work for them.",
    );
  });
});
