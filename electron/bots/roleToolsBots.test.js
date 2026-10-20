/**
 * roleToolsBots.test.js — search_library finds bots too (consolidation
 * Phase 2c-1): the user's own bots on every dashboard (and Unassigned), and
 * the bots inside registry dashboard packages. Widgets stay the default.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { handleRoleTool, rankBots, registryBotsOf } = require("./roleTools");

// Source checks: botController needs Electron.
const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);

const yours = [
  {
    id: "bot_1",
    name: "Inbox Digest",
    instructions: "Summarize my unread Gmail every morning at 9:00.",
    dashboard: "Work",
    providers: ["Work Gmail"],
  },
  {
    id: "bot_2",
    name: "Standup Notes",
    instructions: "Collect yesterday's GitHub activity.",
    dashboard: null,
    providers: ["GitHub"],
  },
];
const registry = [
  {
    name: "Inbox Triager",
    package: "@trops/inbox-triage",
    packageName: "Inbox Triage",
    description: "Sorts and summarizes new mail.",
    providers: ["gmail"],
  },
];

function deps(over = {}) {
  return {
    installedWidgets: () => [],
    searchRegistry: async () => {
      throw new Error("a bot search searched widgets");
    },
    listBots: () => yours,
    registryBots: async () => registry,
    ...over,
  };
}
const scout = { botId: "b_scout", role: "scout" };

describe("search_library — bots", () => {
  it("ranks your bots and registry bots; yours first on a tie", () => {
    const found = rankBots("summarize unread mail", yours, registry);
    assert.deepEqual(
      found.map((c) => [c.source, c.name]),
      [
        ["Yours", "Inbox Digest"],
        ["Registry", "Inbox Triager"],
      ],
    );
    assert.ok(found.every((c) => c.kind === "bot"));
  });

  it("says each bot's id or package and where it is", async () => {
    const res = await handleRoleTool(deps(), scout, "search_library", {
      query: "summarize unread email",
      what: "bots",
    });
    assert.equal(res.isError, false);
    assert.match(
      res.text,
      /\[Yours · bot\] Inbox Digest \(id bot_1 · on Work\) · uses Work Gmail — Summarize my unread Gmail/,
    );
    assert.match(
      res.text,
      /\[Registry · bot\] Inbox Triager \(@trops\/inbox-triage · in the Inbox Triage dashboard package\) · needs gmail — Sorts and summarizes/,
    );
  });

  it("an Unassigned bot says so", async () => {
    const res = await handleRoleTool(deps(), scout, "search_library", {
      query: "github activity",
      what: "bots",
    });
    assert.match(res.text, /Standup Notes \(id bot_2 · Unassigned\)/);
  });

  it("still finds your bots when the registry is down", async () => {
    const res = await handleRoleTool(
      deps({
        registryBots: async () => {
          throw new Error("offline");
        },
      }),
      scout,
      "search_library",
      { query: "unread gmail", what: "bots" },
    );
    assert.match(res.text, /Inbox Digest/);
    assert.match(res.text, /registry couldn't be searched: offline/);
  });

  it("says when no bot matches", async () => {
    const res = await handleRoleTool(deps(), scout, "search_library", {
      query: "weather radar",
      what: "bots",
    });
    assert.match(res.text, /No bot matches "weather radar"/);
  });

  it("widgets stay the default", async () => {
    const res = await handleRoleTool(
      deps({ searchRegistry: async () => [] }),
      scout,
      "search_library",
      { query: "unread gmail" },
    );
    assert.doesNotMatch(res.text, /Inbox Digest/);
  });
});

describe("registryBotsOf — the registry index's bots", () => {
  it("each bot in a public dashboard package, with its package", () => {
    const index = {
      packages: [
        {
          type: "dashboard",
          scope: "trops",
          name: "inbox-triage",
          displayName: "Inbox Triage",
          description: "Triage new mail.",
          providerTypes: ["gmail"],
          team: { members: [{ name: "Inbox Triager", role: "triager" }] },
        },
        {
          type: "dashboard",
          scope: "x",
          name: "secret",
          visibility: "private",
          team: { members: [{ name: "Hidden" }] },
        },
        { type: "widget", scope: "x", name: "clock" },
      ],
    };
    assert.deepEqual(registryBotsOf(index), [
      {
        name: "Inbox Triager",
        package: "@trops/inbox-triage",
        packageName: "Inbox Triage",
        description: "Triage new mail.",
        providers: ["gmail"],
      },
    ]);
  });
});

describe("botController — the Scout's bot lists", () => {
  it("your bots leave out the Dash team and leads", () => {
    assert.match(
      ctrl,
      /listBots: \(\) => \{[\s\S]{0,300}\.filter\(\(b\) => !isDashTeam\(b\) && !isLead\(b\)\)/,
    );
  });
  it("registry bots come from the registry index", () => {
    assert.match(
      ctrl,
      /registryBots: async \(\) => \{[\s\S]{0,160}registryBotsOf\(await fetchRegistryIndex\(\)\)/,
    );
  });
});
