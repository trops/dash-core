/**
 * roleTools.test.js — the Dash team's role tools (create-entry CRE-011, 3a).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLE_TOOL_NAMES,
  roleToolsFor,
  handleRoleTool,
  rankLibrary,
  classifyTool,
  describeProvider,
  HandoffCap,
  MAX_HANDOFFS,
} = require("./roleTools");

const installed = [
  {
    name: "@trops/algolia",
    displayName: "Algolia",
    description: "Search an Algolia index",
    widgets: [
      {
        name: "AlgoliaSearchWidget",
        displayName: "Algolia Search",
        description: "Search box and hits",
        providers: [{ type: "algolia" }],
      },
    ],
  },
  {
    name: "@ai-built/inboxcount",
    widgets: [
      {
        name: "InboxCount",
        displayName: "Inbox count",
        description: "Unread Gmail count",
        providers: [{ type: "gmail" }],
      },
    ],
  },
];
const registry = [
  {
    name: "trops.algolia.AlgoliaSearchWidget",
    displayName: "Algolia Search",
    description: "Search box and hits",
    package: "algolia",
    scope: "trops",
    installed: true,
    providers: [{ type: "algolia" }],
  },
  {
    name: "acme.gmail.GmailUnread",
    displayName: "Gmail unread",
    description: "Unread email count for Gmail",
    package: "gmail",
    scope: "acme",
    installed: false,
    providers: [{ type: "gmail" }],
  },
];

function deps(over = {}) {
  return {
    installedWidgets: () => installed,
    searchRegistry: async () => registry,
    readWidget: async ({ name }) =>
      name === "@ai-built/inboxcount"
        ? {
            success: true,
            componentName: "InboxCount",
            componentCode: "export default function InboxCount() {}",
            configCode: "export default { type: 'widget' };",
          }
        : { success: false, error: `Widget not found: ${name}` },
    providerTools: () => [
      {
        name: "Gmail",
        type: "gmail",
        running: true,
        tools: [
          { name: "search_emails", annotations: { readOnlyHint: true } },
          "send_email",
        ],
      },
      { name: "Slack", type: "slack", running: false, tools: null },
    ],
    askRole: async ({ role, request }) => ({
      text: `${role} says: done (${request})`,
      isError: false,
    }),
    ...over,
  };
}
const as = (role) => ({ botId: `b_${role}`, role });

describe("roleToolsFor", () => {
  it("gives each role only its tools", () => {
    assert.deepEqual(
      roleToolsFor("planner").map((t) => t.name),
      [
        "search_library",
        "read_widget",
        "list_providers",
        "list_dashboards",
        "list_themes",
        "ask_role",
        "bot_results",
        "bot_runs",
      ],
    );
    assert.deepEqual(
      roleToolsFor("scout").map((t) => t.name),
      ["search_library", "read_widget", "list_providers"],
    );
    assert.ok(!roleToolsFor("builder").some((t) => t.name === "ask_role"));
    assert.deepEqual(roleToolsFor("lead"), []);
    for (const role of Object.keys(ROLE_TOOL_NAMES)) {
      for (const t of roleToolsFor(role)) assert.ok(t.inputSchema, t.name);
    }
  });
});

describe("search_library", () => {
  it("puts the user's widgets first, tags each, and shows an installed registry widget once", () => {
    const found = rankLibrary("algolia search", installed, registry);
    assert.equal(found.length, 1);
    assert.equal(found[0].source, "Yours");
    const gmail = rankLibrary("gmail unread count", installed, registry);
    assert.deepEqual(
      gmail.map((c) => c.source),
      ["AI-built", "Registry"],
    );
  });

  it("says where each result is from", async () => {
    const res = await handleRoleTool(deps(), as("scout"), "search_library", {
      query: "gmail unread",
    });
    assert.equal(res.isError, false);
    assert.match(res.text, /\[AI-built\] Inbox count \(@ai-built\/inboxcount/);
    assert.match(
      res.text,
      /\[Registry · install needed\] Gmail unread \(@acme\/gmail/,
    );
    assert.match(res.text, /<dash_data>/);
  });

  it("still searches the user's widgets when the registry is down", async () => {
    const res = await handleRoleTool(
      deps({
        searchRegistry: async () => {
          throw new Error("offline");
        },
      }),
      as("scout"),
      "search_library",
      { query: "inbox count" },
    );
    assert.match(res.text, /Inbox count/);
    assert.match(res.text, /registry couldn't be searched: offline/);
  });

  it("says when nothing matches", async () => {
    const res = await handleRoleTool(deps(), as("scout"), "search_library", {
      query: "weather radar",
    });
    assert.match(res.text, /Nothing matches "weather radar"/);
  });
});

describe("read_widget", () => {
  it("returns the config and component source", async () => {
    const res = await handleRoleTool(deps(), as("builder"), "read_widget", {
      name: "@ai-built/inboxcount",
    });
    assert.equal(res.isError, false);
    assert.match(res.text, /--- InboxCount\.dash\.js ---/);
    assert.match(res.text, /export default function InboxCount/);
  });

  it("reports a missing widget as an error", async () => {
    const res = await handleRoleTool(deps(), as("checker"), "read_widget", {
      name: "@nope/x",
    });
    assert.equal(res.isError, true);
    assert.match(res.text, /not found/);
  });
});

describe("list_providers — can / can't (G9)", () => {
  it("classifies by the read-only flag first, then the first verb", () => {
    assert.equal(
      classifyTool({ name: "send_x", annotations: { readOnlyHint: true } }),
      "read",
    );
    assert.equal(classifyTool("get_open_issues"), "read");
    assert.equal(classifyTool("slack_post_message"), "change");
    assert.equal(classifyTool("createIssue"), "change");
    assert.equal(classifyTool("conversations_history"), "read");
    assert.equal(classifyTool("frobnicate"), "unknown");
  });

  it("lists each provider's tools by what they can do", async () => {
    const res = await handleRoleTool(deps(), as("planner"), "list_providers");
    assert.match(
      res.text,
      /Gmail \(gmail\)\n {2}can read: search_emails\n {2}can change: send_email/,
    );
    assert.match(
      res.text,
      /Slack \(slack\) — not running\n {2}tools: not known until it runs/,
    );
  });

  it("describes a provider with no tools allowed", () => {
    assert.match(
      describeProvider({ name: "X", running: true, tools: [] }),
      /none allowed/,
    );
  });
});

describe("ask_role", () => {
  it("only the Planner can hand off", async () => {
    const res = await handleRoleTool(deps(), as("scout"), "ask_role", {
      role: "builder",
      request: "build it",
    });
    assert.equal(res.isError, true);
    assert.match(res.text, /scout role can't use "ask_role"/);
  });

  it("passes the request and fences the answer", async () => {
    let seen = null;
    const res = await handleRoleTool(
      deps({
        askRole: async (req) => {
          seen = req;
          return { text: "Scout: found Inbox count", isError: false };
        },
      }),
      as("planner"),
      "ask_role",
      { role: "Scout", request: "gmail widgets?" },
    );
    assert.deepEqual(seen, {
      callerId: "b_planner",
      role: "scout",
      request: "gmail widgets?",
    });
    assert.match(res.text, /<dash_data>\nScout: found Inbox count/);
  });

  it("refuses unknown roles and empty requests; passes errors through", async () => {
    let r = await handleRoleTool(deps(), as("planner"), "ask_role", {
      role: "planner",
      request: "x",
    });
    assert.equal(r.isError, true);
    r = await handleRoleTool(deps(), as("planner"), "ask_role", {
      role: "scout",
      request: " ",
    });
    assert.equal(r.isError, true);
    r = await handleRoleTool(
      deps({ askRole: async () => ({ text: "busy", isError: true }) }),
      as("planner"),
      "ask_role",
      { role: "scout", request: "x" },
    );
    assert.deepEqual(r, { text: "busy", isError: true });
  });
});

describe("HandoffCap", () => {
  it(`allows ${MAX_HANDOFFS} per run, then refuses; a new run starts over`, () => {
    const cap = new HandoffCap();
    for (let i = 0; i < MAX_HANDOFFS; i++) {
      assert.equal(cap.take("p", "run1"), true);
    }
    assert.equal(cap.take("p", "run1"), false);
    assert.equal(cap.take("p", "run2"), true);
    assert.equal(cap.take("other", "run1"), true);
  });
});

describe("search_library — found live (3a)", () => {
  it("searches the registry word by word, since it matches whole phrases", async () => {
    const asked = [];
    const res = await handleRoleTool(
      deps({
        installedWidgets: () => [],
        // Like the real registry: the whole query must appear as one phrase.
        searchRegistry: async (q) => {
          asked.push(q);
          return registry.filter((w) =>
            JSON.stringify(w).toLowerCase().includes(q.toLowerCase()),
          );
        },
      }),
      as("scout"),
      "search_library",
      { query: "Algolia search widget" },
    );
    assert.deepEqual(asked, ["algolia", "search"]);
    assert.match(res.text, /Algolia Search/);
  });

  it("a registry widget matching every word beats the user's one-word match", () => {
    const mine = [
      {
        name: "@ai-built/slacksearch",
        widgets: [{ name: "SlackSearch", description: "Search Slack" }],
      },
    ];
    const reg = [{ ...registry[0], installed: false }];
    const found = rankLibrary("algolia search", mine, reg);
    assert.equal(found[0].source, "Registry");
    assert.equal(found[1].source, "AI-built");
  });

  it("credential providers are listed with no tools", () => {
    assert.equal(
      describeProvider({ name: "Algolia", type: "algolia", credentials: true }),
      "Algolia (algolia) — credentials widgets can use (no tools)",
    );
  });
});

describe("bot_results / bot_runs (phase 5e)", () => {
  const H = 3600 * 1000;
  const recent = new Date(Date.now() - 2 * H).toISOString();
  const old = new Date(Date.now() - 48 * H).toISOString();
  const more = {
    botResults: () => [
      {
        botName: "Morning Briefer",
        dashboard: "Morning Brief",
        name: "brief",
        label: "Brief",
        summary: "3 meetings",
        items: [{ title: "Design review", time: "9:30" }],
        sentAt: recent,
      },
    ],
    botRuns: () => [
      {
        botName: "Morning Briefer",
        dashboard: "Morning Brief",
        run: { endedAt: recent, status: "done", output: "Brief sent." },
      },
      {
        botName: "Inbox Triager",
        dashboard: null,
        run: { endedAt: old, status: "error", error: "Gmail not connected" },
      },
    ],
  };

  it("the Planner reads results, fenced as data", async () => {
    const r = await handleRoleTool(deps(more), as("planner"), "bot_results");
    assert.equal(r.isError, false);
    assert.match(r.text, /<dash_data>/);
    assert.match(r.text, /Morning Briefer · Brief \(dashboard Morning Brief\)/);
    assert.match(r.text, /Design review — time: 9:30/);
  });

  it("bot_runs filters by bot and by hours", async () => {
    let r = await handleRoleTool(deps(more), as("planner"), "bot_runs", {
      since_hours: 24,
    });
    assert.match(r.text, /Brief sent\./);
    assert.doesNotMatch(r.text, /Inbox Triager/);
    r = await handleRoleTool(deps(more), as("planner"), "bot_runs", {
      bot: "inbox",
    });
    assert.match(r.text, /Error: Gmail not connected/);
    assert.doesNotMatch(r.text, /Morning Briefer/);
  });

  it("only the Planner gets them", async () => {
    const r = await handleRoleTool(deps(more), as("scout"), "bot_results");
    assert.equal(r.isError, true);
  });
});
