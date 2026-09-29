/**
 * eventMatcher.test.js — subscription matching (P1: FR-009).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { matchSubscribedBots } = require("./eventMatcher");

const bot = (id, subs, extra = {}) => ({
  id,
  subscriptions: subs,
  ...extra,
});

describe("matchSubscribedBots", () => {
  it("matches bots subscribed to the event type", () => {
    const bots = [
      bot("a", [{ eventType: "pr.opened" }]),
      bot("b", [{ eventType: "deploy.done" }]),
      bot("c", [{ eventType: "pr.opened" }, { eventType: "x" }]),
    ];
    const ids = matchSubscribedBots(bots, { eventType: "pr.opened" }).map(
      (b) => b.id,
    );
    assert.deepEqual(ids, ["a", "c"]);
  });

  it("excludes the origin bot (loop guard)", () => {
    const bots = [
      bot("a", [{ eventType: "e" }]),
      bot("b", [{ eventType: "e" }]),
    ];
    const ids = matchSubscribedBots(
      bots,
      { eventType: "e" },
      { excludeBotId: "a" },
    ).map((b) => b.id);
    assert.deepEqual(ids, ["b"]);
  });

  it("honors workspace scope when the event carries a workspaceId", () => {
    const bots = [
      bot("scoped", [{ eventType: "e" }], { workspaceId: "w1" }),
      bot("other", [{ eventType: "e" }], { workspaceId: "w2" }),
      bot("global", [{ eventType: "e" }]), // unscoped → listens everywhere
    ];
    const ids = matchSubscribedBots(bots, {
      eventType: "e",
      workspaceId: "w1",
    }).map((b) => b.id);
    assert.deepEqual(ids, ["scoped", "global"]);
  });

  it("ignores workspace scope when the event is unstamped (today's behavior)", () => {
    const bots = [
      bot("a", [{ eventType: "e" }], { workspaceId: "w1" }),
      bot("b", [{ eventType: "e" }], { workspaceId: "w2" }),
    ];
    const ids = matchSubscribedBots(bots, { eventType: "e" }).map((b) => b.id);
    assert.deepEqual(ids, ["a", "b"]);
  });

  it("returns [] for bad input or no subscribers", () => {
    assert.deepEqual(matchSubscribedBots(null, { eventType: "e" }), []);
    assert.deepEqual(matchSubscribedBots([], { eventType: "e" }), []);
    assert.deepEqual(matchSubscribedBots([bot("a", [])], {}), []);
    assert.deepEqual(
      matchSubscribedBots([bot("a", null)], { eventType: "e" }),
      [],
    );
  });
});
