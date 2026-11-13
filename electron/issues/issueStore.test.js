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
      muted: 0,
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

describe("resolveSignIn — a provider that works again", () => {
  it("resolves every open sign-in issue about it, from any bot", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const signIn = (botId) => ({
      asset: { kind: "bot", botId, name: botId },
      severity: "problem",
      cause: "sign-in",
      title: "Google Calendar couldn't sign in",
      call: { provider: "Google Calendar", tool: "list_events", error: "401" },
      related: { provider: "Google Calendar" },
    });
    store.record(signIn("a"));
    store.record(signIn("b"));
    store.record({ ...signIn("c"), cause: "run", title: "other" });
    assert.equal(store.resolveSignIn("Google Calendar"), 2);
    assert.equal(store.resolveSignIn("Gmail"), 0);
    assert.equal(store.list().filter((i) => i.status === "open").length, 1);
  });
});

describe("muting an error (Mute errors like this)", () => {
  const badRequest = "API error: 400 - 400: Bad Request";

  it("the same error from the same widget and call is counted quietly, never opened", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const { issue } = store.record(failedCall(badRequest));
    assert.equal(store.mute(issue.id), true);
    assert.equal(store.list().length, 0);
    assert.equal(store.counts().total, 0);
    c.tick(60000);
    const res = store.record(failedCall(badRequest));
    assert.equal(res.muted, true);
    assert.equal(res.isNew, false);
    const [m] = store.list({ status: "muted" });
    assert.equal(m.count, 2);
    assert.equal(m.mutedCount, 1);
    assert.equal(m.lastAt, new Date(c.now()).toISOString());
    assert.equal(store.list().length, 0);
  });

  it("a different error from that widget and call still opens an issue", () => {
    const store = createIssueStore({ now: clock().now });
    const { issue } = store.record(failedCall(badRequest));
    store.mute(issue.id);
    const res = store.record(
      failedCall("Entity media_player.bedroom_speaker not found"),
    );
    assert.equal(res.isNew, true);
    assert.ok(!res.muted);
    assert.equal(store.list().length, 1);
    assert.equal(store.list({ status: "muted" }).length, 1);
  });

  it("matches the error loosely: case and spacing don't matter", () => {
    const store = createIssueStore({ now: clock().now });
    const { issue } = store.record(failedCall(badRequest));
    store.mute(issue.id);
    const res = store.record(
      failedCall("  api ERROR: 400 -  400: bad request "),
    );
    assert.equal(res.muted, true);
  });

  it("another copy of the widget isn't muted", () => {
    const store = createIssueStore({ now: clock().now });
    const { issue } = store.record(failedCall(badRequest));
    store.mute(issue.id);
    const other = {
      ...failedCall(badRequest),
      asset: { ...widget, itemId: "12" },
    };
    assert.ok(!store.record(other).muted);
  });

  it("a successful call or a completed run doesn't touch a muted issue", () => {
    const store = createIssueStore({ now: clock().now });
    const { issue } = store.record(failedCall(badRequest));
    store.mute(issue.id);
    assert.equal(store.resolveWorked(failedCall()), 0);
    assert.equal(store.resolveAsset(widget), 0);
    assert.equal(store.list({ status: "muted" }).length, 1);
  });

  it("unmute: back in Open if it happened since muting, else resolved", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const a = store.record(failedCall(badRequest)).issue;
    store.mute(a.id);
    store.record(failedCall(badRequest));
    assert.equal(store.unmute(a.id), true);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].muted, undefined);
    // Happens again → the same open issue counts up.
    store.record(failedCall(badRequest));
    assert.equal(store.list()[0].count, 3);

    const quiet = createIssueStore({ now: c.now });
    const b = quiet.record(failedCall(badRequest)).issue;
    quiet.mute(b.id);
    quiet.unmute(b.id);
    assert.equal(quiet.list({ status: "resolved" }).length, 1);
  });

  it("unmute when a different error from that call is open: the open one stays", () => {
    const store = createIssueStore({ now: clock().now });
    const a = store.record(failedCall(badRequest)).issue;
    store.mute(a.id);
    store.record(failedCall("Entity not found"));
    assert.equal(store.unmute(a.id), true);
    assert.equal(store.list({ status: "all" }).length, 1);
    assert.equal(store.list()[0].message, "Entity not found");
  });

  it("a muted error quiet for 30 days drops off; one still happening stays", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const a = store.record(failedCall(badRequest)).issue;
    store.mute(a.id);
    c.tick(31 * 24 * 60 * 60 * 1000);
    const later = createIssueStore({ now: c.now, initial: store.all() });
    assert.equal(later.list({ status: "muted" }).length, 0);

    const busy = createIssueStore({ now: c.now });
    const b = busy.record(failedCall(badRequest)).issue;
    busy.mute(b.id);
    c.tick(29 * 24 * 60 * 60 * 1000);
    busy.record(failedCall(badRequest));
    c.tick(5 * 24 * 60 * 60 * 1000);
    const again = createIssueStore({ now: c.now, initial: busy.all() });
    assert.equal(again.list({ status: "muted" }).length, 1);
  });

  it("counts say how many are muted; the open total leaves them out", () => {
    const store = createIssueStore({ now: clock().now });
    const a = store.record(failedCall(badRequest)).issue;
    store.mute(a.id);
    assert.deepEqual(store.counts(), {
      total: 0,
      widget: 0,
      bot: 0,
      provider: 0,
      muted: 1,
    });
    assert.equal(store.mute("nope"), false);
    assert.equal(store.unmute(a.id + "x"), false);
  });

  it("clear resolved keeps muted ones", () => {
    const store = createIssueStore({ now: clock().now });
    const a = store.record(failedCall(badRequest)).issue;
    store.mute(a.id);
    store.clearResolved();
    assert.equal(store.list({ status: "muted" }).length, 1);
  });
});

describe("muting — what counts as the same error", () => {
  const { errorSignature } = require("./issueStore");

  it("ids and long numbers that change each time don't matter; a status code does", () => {
    assert.equal(
      errorSignature({ message: "Server exited (pid 4812) after 30012ms" }),
      errorSignature({ message: "Server exited (pid 4907) after 29988ms" }),
    );
    assert.equal(
      errorSignature({ message: "request 9f8e7d6c-1a2b-3c4d failed" }),
      errorSignature({ message: "request 0a1b2c3d-4e5f-6a7b failed" }),
    );
    assert.notEqual(
      errorSignature({ message: "API error: 400 Bad Request" }),
      errorSignature({ message: "API error: 500 Server Error" }),
    );
    // No message: the call's error, then the title.
    assert.equal(
      errorSignature({ message: "", call: { error: "Boom" }, title: "t" }),
      "boom",
    );
    assert.equal(errorSignature({ message: "", call: null, title: "T" }), "t");
  });

  it("a muted bot issue (no call) stays muted when its pid changes", () => {
    const store = createIssueStore({ now: clock().now });
    const bot = { kind: "bot", botId: "b1", name: "Digest" };
    const a = store.record({
      asset: bot,
      title: "Digest: Notes wasn't available",
      message: "Notes couldn't start (pid 4812)",
    }).issue;
    store.mute(a.id);
    const res = store.record({
      asset: bot,
      title: "Digest: Notes wasn't available",
      message: "Notes couldn't start (pid 5120)",
    });
    assert.equal(res.muted, true);
    assert.equal(store.counts().total, 0);
  });

  it("over the limit, open issues stay — a busy muted one doesn't push them out", () => {
    const c = clock();
    const store = createIssueStore({ now: c.now });
    const first = store.record(failedCall("API error: 400")).issue;
    for (let n = 0; n < MAX_ISSUES - 1; n += 1) {
      c.tick(1);
      store.record({
        asset: { ...widget, itemId: `x${n}` },
        title: "t",
        call: { provider: "P", tool: "t", error: "e" },
      });
    }
    // One more: the oldest (first) would be dropped if it weren't open.
    store.mute(store.list()[0].id);
    c.tick(1);
    store.record({ asset: { ...widget, itemId: "y" }, title: "t2" });
    assert.ok(store.list().some((i) => i.id === first.id));
    assert.equal(store.list({ status: "all" }).length, MAX_ISSUES);
  });
});
