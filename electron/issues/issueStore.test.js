/**
 * issueStore — what went wrong in widgets, bots and providers (issues PRD).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ISSUES,
  redactArgs,
  assetKey,
  issueKey,
  cleanInput,
  createIssueStore,
} = require("./issueStore");

const widget = {
  kind: "widget",
  name: "Shopping List",
  component: "ai-built.shoppinglist.ShoppingList",
  itemId: "11",
  workspaceId: "7301",
  dashboardName: "Life HQ",
};
const failedCall = (error = "connect ECONNREFUSED 127.0.0.1:3845") => ({
  asset: widget,
  title: "Shopping List couldn't get your notes",
  call: {
    provider: "Notes MCP",
    tool: "search_notes",
    args: { query: "shopping list", limit: 20 },
    error,
  },
});

function clock(start = Date.parse("2026-11-11T07:30:00Z")) {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
}

describe("redactArgs", () => {
  it("hides secrets and clips long values", () => {
    const out = JSON.parse(
      redactArgs({
        query: "x",
        apiKey: "sk-123",
        nested: { password: "p", ok: 1 },
      }),
    );
    assert.deepEqual(out, {
      query: "x",
      apiKey: "(hidden)",
      nested: { password: "(hidden)", ok: 1 },
    });
    assert.ok(redactArgs({ text: "a".repeat(5000) }).length <= 600);
    assert.equal(redactArgs(undefined), null);
  });
  it("copes with cycles", () => {
    const a = { b: 1 };
    a.self = a;
    assert.match(redactArgs(a), /"self":"…"/);
  });
});

describe("assetKey / issueKey / cleanInput", () => {
  it("names the asset, and the issue by what failed", () => {
    assert.equal(
      assetKey(widget),
      "widget:ai-built.shoppinglist.ShoppingList@7301#11",
    );
    assert.equal(assetKey({ kind: "bot", botId: "bot_a" }), "bot:bot_a");
    assert.equal(
      assetKey({ kind: "provider", provider: "Notes MCP" }),
      "provider:Notes MCP",
    );
    assert.equal(assetKey({ kind: "thing" }), null);
    assert.equal(
      issueKey(cleanInput(failedCall())),
      "widget:ai-built.shoppinglist.ShoppingList@7301#11|Notes MCP/search_notes",
    );
  });
  it("needs an asset and a title", () => {
    assert.equal(cleanInput(null), null);
    assert.equal(cleanInput({ asset: widget }), null);
    assert.equal(cleanInput({ asset: { kind: "?" }, title: "x" }), null);
  });
  it("uses the call's error as the message when none is given", () => {
    assert.match(cleanInput(failedCall()).message, /ECONNREFUSED/);
  });
});

describe("createIssueStore", () => {
  it("groups repeats: one issue, counted, newest message", () => {
    const c = clock();
    const saved = [];
    const store = createIssueStore({
      now: c.now,
      onChange: (l) => saved.push(l),
    });
    const first = store.record(failedCall());
    assert.equal(first.isNew, true);
    for (let i = 0; i < 11; i++) {
      c.tick(60_000);
      store.record(failedCall(i === 10 ? "timed out" : undefined));
    }
    const [issue] = store.list();
    assert.equal(issue.count, 12);
    assert.equal(issue.firstAt, "2026-11-11T07:30:00.000Z");
    assert.equal(issue.lastAt, "2026-11-11T07:41:00.000Z");
    assert.equal(issue.message, "timed out");
    assert.equal(issue.recent.length, 5);
    assert.equal(saved.length, 12);
    assert.equal(store.list().length, 1);
  });

  it("a different call on the same widget is its own issue", () => {
    const store = createIssueStore(clock());
    store.record(failedCall());
    store.record({
      ...failedCall(),
      call: { ...failedCall().call, tool: "get_note" },
    });
    assert.equal(store.list().length, 2);
  });

  it("resolve, then it opens again if it happens again", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const { issue } = store.record(failedCall());
    assert.equal(store.resolve(issue.id), true);
    assert.equal(store.list().length, 0);
    assert.equal(store.list({ status: "resolved" }).length, 1);
    c.tick(1000);
    const again = store.record(failedCall());
    assert.equal(again.isNew, true);
    assert.equal(again.issue.count, 1);
    assert.equal(store.list().length, 1);
  });

  it("the same call working again resolves its issue — only that one", () => {
    const store = createIssueStore(clock());
    store.record(failedCall());
    store.record({
      ...failedCall(),
      call: { ...failedCall().call, tool: "get_note" },
    });
    const worked = {
      asset: widget,
      call: { provider: "Notes MCP", tool: "search_notes" },
    };
    assert.equal(store.resolveWorked(worked), 1);
    assert.equal(store.resolveWorked(worked), 0);
    assert.deepEqual(
      store.list().map((i) => i.call.tool),
      ["get_note"],
    );
    assert.equal(store.list({ status: "resolved" })[0].resolvedBy, "worked");
  });

  it("filters by kind, dashboard and asset; counts open ones", () => {
    const store = createIssueStore(clock());
    store.record(failedCall());
    store.record({
      asset: {
        kind: "bot",
        botId: "bot_m",
        name: "Morning Email Summary",
        workspaceId: "7301",
      },
      severity: "warning",
      title: "Gmail wasn't connected when the run started",
    });
    store.record({
      asset: {
        kind: "provider",
        provider: "Home Assistant MCP",
        name: "Home Assistant MCP",
      },
      title: "Sign-in expired",
    });
    assert.equal(store.list({ kind: "bot" }).length, 1);
    assert.equal(store.list({ workspaceId: "7301" }).length, 2);
    assert.equal(store.list({ asset: widget }).length, 1);
    assert.deepEqual(store.counts(), {
      total: 3,
      widget: 1,
      bot: 1,
      provider: 1,
    });
    assert.equal(store.resolveAsset(widget), 1);
    assert.equal(store.counts().widget, 0);
    assert.equal(store.clearResolved(), 1);
    assert.equal(store.list({ status: "all" }).length, 2);
  });

  it("keeps at most MAX_ISSUES, newest first, and drops old resolved ones on load", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    for (let i = 0; i < MAX_ISSUES + 5; i++) {
      c.tick(1000);
      store.record({ asset: { ...widget, itemId: String(i) }, title: "x" });
    }
    assert.equal(store.list().length, MAX_ISSUES);
    const old = {
      id: "old",
      key: "k",
      asset: widget,
      status: "resolved",
      lastAt: "2026-01-01T00:00:00.000Z",
    };
    const reloaded = createIssueStore({ now: c.now, initial: [old] });
    assert.equal(reloaded.list({ status: "all" }).length, 0);
  });
});
