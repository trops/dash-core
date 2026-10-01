/**
 * toolSources.test.js — how a bot finds, starts, and uses the user's Dash MCP
 * providers.
 *
 * Regressions this pins:
 *  - The bot form only listed MCP servers that happened to be running, so
 *    the user's configured providers (Gmail, Slack, …) often didn't appear.
 *  - Bot runs only used already-running servers, so a scheduled bot whose
 *    providers weren't started by some dashboard ran silently without tools.
 *  - listConnectedServers returned the compound "<workspace>::<server>" key
 *    as `serverName`, so a bot's `mcpServers: ["gmail"]` never matched.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  connectedServersFromMap,
  listToolSources,
  ensureBotServers,
  resolveBotTools,
  effectiveAllowedTools,
  checkToolCall,
} = require("./toolSources");

const CONNECTED = "connected";

const gmailTools = [{ name: "search_emails" }, { name: "send_email" }];
const slackTools = [{ name: "list_channels" }];

// activeServers-shaped Map keyed by "<workspace>::<server>".
function activeMap() {
  return new Map([
    ["__no_workspace__::gmail", { status: CONNECTED, tools: gmailTools }],
    ["ws-1::slack", { status: CONNECTED, tools: slackTools }],
    ["__no_workspace__::github", { status: "error", tools: [] }],
  ]);
}

describe("connectedServersFromMap", () => {
  it("returns the real server name and workspace, not the compound key", () => {
    const list = connectedServersFromMap(activeMap(), CONNECTED);
    const names = list.map((s) => s.serverName).sort();
    assert.deepEqual(names, ["gmail", "slack"]);
    const gmail = list.find((s) => s.serverName === "gmail");
    assert.equal(gmail.workspaceId, null);
    assert.equal(gmail.tools.length, 2);
    const slack = list.find((s) => s.serverName === "slack");
    assert.equal(slack.workspaceId, "ws-1");
  });

  it("skips servers that are not connected", () => {
    const list = connectedServersFromMap(activeMap(), CONNECTED);
    assert.ok(!list.some((s) => s.serverName === "github"));
  });
});

const providers = [
  { name: "gmail", type: "gmail", providerClass: "mcp", mcpConfig: {} },
  { name: "slack", type: "slack", providerClass: "mcp", mcpConfig: {} },
  { name: "notion", type: "notion", providerClass: "mcp", mcpConfig: {} },
  { name: "algolia-keys", type: "algolia", providerClass: "credential" },
];

describe("listToolSources", () => {
  it("lists every configured MCP provider, running or not", () => {
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    const sources = listToolSources({ providers, connected });
    assert.deepEqual(
      sources.map((s) => s.name),
      ["gmail", "notion", "slack"],
    );
  });

  it("excludes credential-only (non-MCP) providers", () => {
    const sources = listToolSources({ providers, connected: [] });
    assert.ok(!sources.some((s) => s.name === "algolia-keys"));
  });

  it("marks running status + tool count from the bot's workspace bucket", () => {
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    const sources = listToolSources({ providers, connected });
    const gmail = sources.find((s) => s.name === "gmail");
    assert.equal(gmail.running, true);
    assert.equal(gmail.toolCount, 2);
    // slack is only running in ws-1 — not in the no-workspace bucket.
    const slack = sources.find((s) => s.name === "slack");
    assert.equal(slack.running, false);
    assert.equal(slack.toolCount, null);
  });

  it("returns [] for missing/invalid provider lists", () => {
    assert.deepEqual(listToolSources({ providers: null, connected: [] }), []);
    assert.deepEqual(listToolSources({}), []);
  });
});

describe("ensureBotServers", () => {
  function deps(overrides = {}) {
    const calls = [];
    return {
      calls,
      getProvider: async (name) =>
        providers.find((p) => p.name === name) || null,
      startServer: async (name, mcpConfig, credentials, workspaceId) => {
        calls.push({ name, workspaceId });
        return { success: true };
      },
      ...overrides,
    };
  }

  it("starts selected providers that aren't running, in the bot's bucket", async () => {
    const d = deps();
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    const res = await ensureBotServers({
      bot: { mcpServers: ["gmail", "notion"], workspaceId: null },
      connected,
      ...d,
    });
    // gmail already running in the no-workspace bucket → reused, not restarted.
    assert.deepEqual(d.calls, [{ name: "notion", workspaceId: null }]);
    assert.deepEqual(res.failed, []);
  });

  it("starts a provider that's only running in ANOTHER workspace (no cross-workspace borrowing)", async () => {
    const d = deps();
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    await ensureBotServers({
      bot: { mcpServers: ["slack"], workspaceId: null },
      connected,
      ...d,
    });
    assert.deepEqual(d.calls, [{ name: "slack", workspaceId: null }]);
  });

  it("reports a provider that no longer exists instead of failing silently", async () => {
    const d = deps();
    const res = await ensureBotServers({
      bot: { mcpServers: ["deleted-one"], workspaceId: null },
      connected: [],
      ...d,
    });
    assert.equal(d.calls.length, 0);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].serverName, "deleted-one");
    assert.match(res.failed[0].message, /not found/i);
  });

  it("reports a start error (thrown or {error}) per provider and keeps going", async () => {
    const d = deps({
      startServer: async (name) => {
        if (name === "gmail") throw new Error("token expired");
        if (name === "notion") return { error: true, message: "bad config" };
        return { success: true };
      },
    });
    const res = await ensureBotServers({
      bot: { mcpServers: ["gmail", "notion", "slack"], workspaceId: null },
      connected: [],
      ...d,
    });
    assert.deepEqual(
      res.failed.map((f) => [f.serverName, f.message]),
      [
        ["gmail", "token expired"],
        ["notion", "bad config"],
      ],
    );
  });

  it("accepts providerController.getProvider's real {provider} / {error} result shape", async () => {
    // Regression (found in the live app): getProvider returns { provider }
    // or { error, message } — not the bare provider — so a real MCP provider
    // was reported as "not found" and never started.
    const calls = [];
    const res = await ensureBotServers({
      bot: { mcpServers: ["gmail", "broken"], workspaceId: null },
      connected: [],
      getProvider: async (name) =>
        name === "gmail"
          ? { provider: providers.find((p) => p.name === "gmail") }
          : { error: true, message: "Provider not found: broken" },
      startServer: async (name, mcpConfig, credentials, workspaceId) => {
        calls.push({ name, workspaceId });
        return { success: true };
      },
    });
    assert.deepEqual(calls, [{ name: "gmail", workspaceId: null }]);
    assert.deepEqual(
      res.failed.map((f) => [f.serverName, f.message]),
      [["broken", "Provider not found: broken"]],
    );
  });

  it("does nothing for a bot with no providers", async () => {
    const d = deps();
    const res = await ensureBotServers({
      bot: { mcpServers: [] },
      connected: [],
      ...d,
    });
    assert.equal(d.calls.length, 0);
    assert.deepEqual(res.failed, []);
  });
});

describe("resolveBotTools", () => {
  it("uses only the bot's selected providers from its own workspace bucket", () => {
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    const { tools, toolServer } = resolveBotTools({
      bot: { mcpServers: ["gmail", "slack"], workspaceId: null },
      connected,
    });
    // gmail matches by plain name (the old compound-key bug made this empty);
    // slack is only in ws-1, so it is not used for a no-workspace bot.
    assert.deepEqual(
      tools.map((t) => t.name),
      ["search_emails", "send_email"],
    );
    assert.equal(toolServer.search_emails, "gmail");
    assert.equal(toolServer.list_channels, undefined);
  });

  it("gives a bot with no providers no MCP tools", () => {
    const connected = connectedServersFromMap(activeMap(), CONNECTED);
    const { tools } = resolveBotTools({
      bot: { mcpServers: [], workspaceId: null },
      connected,
    });
    assert.equal(tools.length, 0);
  });
});

// ---- Per-provider tool limits + per-bot narrowing -------------------------

describe("effectiveAllowedTools", () => {
  it("no provider limit + no selection → null (every tool)", () => {
    assert.equal(effectiveAllowedTools(null, undefined), null);
  });
  it("provider limit only → the provider's declared tools", () => {
    assert.deepEqual(effectiveAllowedTools(["a", "b"], undefined), ["a", "b"]);
  });
  it("selection narrows within the provider limit (intersection)", () => {
    assert.deepEqual(effectiveAllowedTools(["a", "b", "c"], ["b", "z"]), ["b"]);
  });
  it("selection with no provider limit → the selection", () => {
    assert.deepEqual(effectiveAllowedTools(null, ["x"]), ["x"]);
  });
  it("an explicitly empty selection allows nothing", () => {
    assert.deepEqual(effectiveAllowedTools(["a"], []), []);
  });
});

describe("tool limits — the provider's declared tools are the ceiling", () => {
  // The live case: the Filesystem server exposes 14 tools but the provider
  // (Settings → Providers) only allows 12. Bots used to get all 14.
  const fsExposed = [
    "read_file",
    "write_file",
    "edit_file",
    "move_file",
    "list_directory",
  ].map((name) => ({ name }));
  const fsAllowed = ["read_file", "list_directory", "edit_file"];
  const connected = [
    { serverName: "Filesystem", workspaceId: null, tools: fsExposed },
  ];
  const providerLimits = { Filesystem: fsAllowed };

  it("never offers a tool the provider excludes, even if the server exposes it", () => {
    const { tools, allowedFor } = resolveBotTools({
      bot: { mcpServers: ["Filesystem"], workspaceId: null },
      connected,
      providerLimits,
    });
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "edit_file",
      "list_directory",
      "read_file",
    ]);
    assert.deepEqual(allowedFor.Filesystem.sort(), [
      "edit_file",
      "list_directory",
      "read_file",
    ]);
  });

  it("narrows further with the bot's own selection", () => {
    const { tools, allowedFor } = resolveBotTools({
      bot: {
        mcpServers: ["Filesystem"],
        workspaceId: null,
        toolSelections: { Filesystem: ["read_file", "write_file"] },
      },
      connected,
      providerLimits,
    });
    // write_file is selected but NOT allowed by the provider → still excluded.
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read_file"],
    );
    assert.deepEqual(allowedFor.Filesystem, ["read_file"]);
  });

  it("fails closed: a running server that isn't a configured provider gets no tools", () => {
    // e.g. the provider was deleted, or provider info couldn't be read ({}).
    const { tools, allowedFor } = resolveBotTools({
      bot: { mcpServers: ["Filesystem"], workspaceId: null },
      connected,
      providerLimits: {},
    });
    assert.equal(tools.length, 0);
    assert.equal("Filesystem" in allowedFor, false);
  });

  it("a provider with no declared limit offers every exposed tool (allowedFor null)", () => {
    const { tools, allowedFor } = resolveBotTools({
      bot: { mcpServers: ["Filesystem"], workspaceId: null },
      connected,
      providerLimits: { Filesystem: null },
    });
    assert.equal(tools.length, fsExposed.length);
    assert.equal(allowedFor.Filesystem, null);
  });
});

describe("listToolSources — declared tool names for the form", () => {
  const provs = [
    {
      name: "Gmail 3",
      type: "gmail",
      providerClass: "mcp",
      mcpConfig: {},
      allowedTools: ["search_emails", "read_email"],
    },
    { name: "Gong", type: "gong", providerClass: "mcp", mcpConfig: {} },
  ];

  it("returns the provider's declared tools without needing it running", () => {
    const [gmail] = listToolSources({ providers: provs, connected: [] });
    assert.equal(gmail.name, "Gmail 3");
    assert.deepEqual(gmail.tools, ["search_emails", "read_email"]);
    assert.equal(gmail.declared, true);
  });

  it("undeclared + not running → tools null (all tools, list unknown)", () => {
    const gong = listToolSources({ providers: provs, connected: [] }).find(
      (s) => s.name === "Gong",
    );
    assert.equal(gong.declared, false);
    assert.equal(gong.tools, null);
  });

  it("undeclared + running → the live tool names", () => {
    const gong = listToolSources({
      providers: provs,
      connected: [
        {
          serverName: "Gong",
          workspaceId: null,
          tools: [{ name: "list_calls" }, { name: "get_transcript" }],
        },
      ],
    }).find((s) => s.name === "Gong");
    assert.deepEqual(gong.tools, ["list_calls", "get_transcript"]);
  });

  it("never exposes credentials", () => {
    const withCreds = [{ ...provs[0], credentials: { token: "secret" } }];
    const [s] = listToolSources({ providers: withCreds, connected: [] });
    assert.equal(JSON.stringify(s).includes("secret"), false);
  });
});

describe("checkToolCall — the last-line enforcement in botController._callTool", () => {
  const allowedMap = {
    Filesystem: ["read_text_file", "list_directory"],
    Gong: null, // no provider limit, no narrowing → every tool
  };

  it("allows a tool in the bot's whitelist and returns it for callTool", () => {
    assert.deepEqual(
      checkToolCall(allowedMap, "Filesystem", "read_text_file"),
      { ok: true, allowed: ["read_text_file", "list_directory"] },
    );
  });

  it("rejects a tool the provider/bot excluded (e.g. write_file)", () => {
    const r = checkToolCall(allowedMap, "Filesystem", "write_file");
    assert.equal(r.ok, false);
    assert.match(r.message, /not allowed/);
  });

  it("allows any tool on an unrestricted provider (allowed null)", () => {
    assert.deepEqual(checkToolCall(allowedMap, "Gong", "list_calls"), {
      ok: true,
      allowed: null,
    });
  });

  it("rejects a provider that isn't one of the bot's (fails closed)", () => {
    const r = checkToolCall(allowedMap, "Slack", "post_message");
    assert.equal(r.ok, false);
    assert.match(r.message, /isn't one of its providers/);
  });

  it("rejects everything when the bot's tools were never resolved", () => {
    assert.equal(
      checkToolCall(undefined, "Filesystem", "read_text_file").ok,
      false,
    );
  });
});
