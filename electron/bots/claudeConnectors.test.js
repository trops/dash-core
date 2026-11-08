/**
 * claudeConnectors.test.js — the user's Claude account connectors: reading
 * them from the SDK's server status (no model call), naming their tools,
 * hiding the ones a bot isn't granted, and refusing runs off the Claude
 * login.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  connectorServerKey,
  connectorToolPrefix,
  connectorDisplayName,
  connectorsFromStatus,
  connectorDisallowList,
  connectorForTool,
  runsOnClaudeLogin,
  connectorNeedsSubscriptionMessage,
  createConnectorLister,
} = require("./claudeConnectors");

const STATUS = [
  {
    name: "claude.ai Google Calendar",
    status: "connected",
    scope: "claudeai",
    source: "claudeai",
    tools: [
      { name: "list_events", annotations: { readOnly: true } },
      { name: "delete_event", annotations: { destructive: true } },
    ],
  },
  {
    name: "claude.ai Google Drive",
    status: "needs-auth",
    scope: "claudeai",
    source: "claudeai",
  },
  { name: "dash", status: "connected", scope: "user", source: "user" },
];

describe("names", () => {
  it("names a connector's tools the way the CLI does", () => {
    assert.equal(
      connectorServerKey("claude.ai Google Calendar"),
      "claude_ai_Google_Calendar",
    );
    assert.equal(
      connectorToolPrefix("claude.ai Gmail"),
      "mcp__claude_ai_Gmail__",
    );
    assert.equal(
      connectorDisplayName("claude.ai Google Drive"),
      "Google Drive",
    );
  });
});

describe("connectorsFromStatus", () => {
  it("keeps only the Claude account's servers, with tool kinds", () => {
    const list = connectorsFromStatus(STATUS);
    assert.deepEqual(
      list.map((c) => [c.name, c.status]),
      [
        ["Google Calendar", "connected"],
        ["Google Drive", "needs-auth"],
      ],
    );
    assert.deepEqual(list[0].tools, [
      {
        name: "list_events",
        description: "",
        readOnly: true,
        destructive: false,
      },
      {
        name: "delete_event",
        description: "",
        readOnly: false,
        destructive: true,
      },
    ]);
    assert.deepEqual(list[1].tools, []);
  });
});

describe("connectorDisallowList", () => {
  it("hides every connector the bot isn't granted, whole", () => {
    assert.deepEqual(
      connectorDisallowList(
        ["claude.ai Gmail", "claude.ai Slack", "claude.ai Google Calendar"],
        ["claude.ai Google Calendar"],
      ),
      ["mcp__claude_ai_Gmail", "mcp__claude_ai_Slack"],
    );
    assert.deepEqual(connectorDisallowList(null, []), []);
  });
});

describe("connectorForTool", () => {
  const granted = [
    {
      provider: "Calendar",
      server: "claude.ai Google Calendar",
      allowed: null,
    },
  ];
  it("finds the granted connector and the bare tool", () => {
    const hit = connectorForTool(
      granted,
      "mcp__claude_ai_Google_Calendar__list_events",
    );
    assert.equal(hit.connector.provider, "Calendar");
    assert.equal(hit.tool, "list_events");
  });
  it("ignores other connectors and Dash's own tools", () => {
    assert.equal(connectorForTool(granted, "mcp__claude_ai_Slack__post"), null);
    assert.equal(connectorForTool(granted, "mcp__bot-mcp__list_events"), null);
    assert.equal(connectorForTool(null, "x"), null);
  });
});

describe("runsOnClaudeLogin", () => {
  it("only Claude Code on its own login", () => {
    const cli = {
      engineId: "claude-agent",
      providerId: "claude-code",
      credentials: {},
    };
    assert.equal(runsOnClaudeLogin(cli), true);
    assert.equal(
      runsOnClaudeLogin({ ...cli, credentials: { apiKey: "k" } }),
      false,
    );
    assert.equal(
      runsOnClaudeLogin({ engineId: "claude-agent", providerId: "anthropic" }),
      false,
    );
    assert.equal(
      runsOnClaudeLogin({ engineId: "tool-loop", providerId: "claude-code" }),
      false,
    );
    assert.equal(runsOnClaudeLogin(null), false);
  });
  it("says which connectors and what to change", () => {
    assert.match(
      connectorNeedsSubscriptionMessage([{ provider: "Google Calendar" }]),
      /^Google Calendar is a Claude connector, so it only works when this bot runs on your Claude subscription\./,
    );
    assert.match(
      connectorNeedsSubscriptionMessage([
        { provider: "Gmail" },
        { provider: "Slack" },
      ]),
      /^Gmail and Slack are Claude connectors, so they only work/,
    );
    // Named apart from another provider: still by the connector's name.
    assert.match(
      connectorNeedsSubscriptionMessage([
        {
          provider: "Google Calendar (Claude connector)",
          server: "claude.ai Google Calendar",
        },
      ]),
      /^Google Calendar is a Claude connector, so/,
    );
  });
});

describe("createConnectorLister", () => {
  // A fake SDK query: status "pending" for the first ask, then connected.
  function fakeQuery(statuses, seen) {
    return (args) => {
      seen.push(args);
      let n = 0;
      return {
        mcpServerStatus: async () =>
          statuses[Math.min(n++, statuses.length - 1)],
        close: () => {
          seen.closed = true;
        },
      };
    };
  }

  it("waits for connectors still connecting, with no model call", async () => {
    const seen = [];
    const pending = STATUS.map((s) =>
      s.scope === "claudeai" ? { ...s, status: "pending", tools: [] } : s,
    );
    const lister = createConnectorLister({
      loadQuery: async () => fakeQuery([pending, STATUS], seen),
      resolveCli: () => "/bin/claude",
      readAuthStatus: async () => ({ loggedIn: true, authMethod: "claude.ai" }),
      env: { ANTHROPIC_API_KEY: "sk-ant-x", PATH: "/bin" },
      pollMs: 1,
    });
    const r = await lister.list();
    assert.equal(r.state, "ready");
    assert.equal(r.connectors.length, 2);
    assert.equal(r.connectors[0].status, "connected");
    const opts = seen[0].options;
    assert.equal(opts.env.ENABLE_CLAUDEAI_MCP_SERVERS, "true");
    assert.equal("ANTHROPIC_API_KEY" in opts.env, false);
    assert.deepEqual(opts.settingSources, []);
    assert.equal(typeof seen[0].prompt[Symbol.asyncIterator], "function");
    assert.equal(seen.closed, true);
  });

  it("waits for the account's connectors to show up at all", async () => {
    const seen = [];
    const lister = createConnectorLister({
      loadQuery: async () => fakeQuery([[STATUS[2]], STATUS], seen),
      resolveCli: () => "/bin/claude",
      pollMs: 1,
    });
    const r = await lister.list();
    assert.equal(r.connectors.length, 2);
  });

  it("reuses the cached list unless asked to refresh", async () => {
    const seen = [];
    const lister = createConnectorLister({
      loadQuery: async () => fakeQuery([STATUS], seen),
      resolveCli: () => "/bin/claude",
    });
    await lister.list();
    await lister.list();
    assert.equal(seen.length, 1);
    await lister.list({ refresh: true });
    assert.equal(seen.length, 2);
    assert.equal(lister.cached().state, "ready");
  });

  it("no CLI, or not signed in with a Claude account", async () => {
    const none = createConnectorLister({
      loadQuery: async () => {
        throw new Error("should not load");
      },
      resolveCli: () => null,
    });
    assert.equal((await none.list()).state, "not-installed");
    const keyLogin = createConnectorLister({
      loadQuery: async () => {
        throw new Error("should not load");
      },
      resolveCli: () => "/bin/claude",
      readAuthStatus: async () => ({ loggedIn: true, authMethod: "api_key" }),
    });
    assert.equal((await keyLogin.list()).state, "not-signed-in");
  });

  it("a CLI that never answers is an error, and the next list asks again", async () => {
    let calls = 0;
    const lister = createConnectorLister({
      loadQuery: async () => () => ({
        mcpServerStatus: () => {
          calls++;
          return new Promise(() => {});
        },
        close: () => {},
      }),
      resolveCli: () => "/bin/claude",
      waitMs: -4990,
    });
    const r = await lister.list();
    assert.equal(r.state, "error");
    assert.match(r.message, /didn't answer/);
    await lister.list({ refresh: true });
    assert.equal(calls, 2);
  });

  it("an SDK failure is an error state, not a throw", async () => {
    const lister = createConnectorLister({
      loadQuery: async () => () => ({
        mcpServerStatus: async () => {
          throw new Error("boom");
        },
        close: () => {},
      }),
      resolveCli: () => "/bin/claude",
    });
    const r = await lister.list();
    assert.equal(r.state, "error");
    assert.equal(r.message, "boom");
  });
});
