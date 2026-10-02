/**
 * teams.test.js — a dashboard's team = bots whose workspaceId is that
 * dashboard (bot-teams PRD TEAM-001).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWorkspaceId,
  isOnTeam,
  teamOf,
  unassignTeam,
} = require("./teams");

const bots = [
  { id: "a", workspaceId: "7" },
  { id: "b", workspaceId: 7 }, // numeric id from older saves
  { id: "c", workspaceId: "9" },
  { id: "d", workspaceId: null },
  { id: "e" },
];

describe("team membership", () => {
  it("normalizes dashboard ids to strings (null when unassigned)", () => {
    assert.equal(normalizeWorkspaceId(7), "7");
    assert.equal(normalizeWorkspaceId("7"), "7");
    assert.equal(normalizeWorkspaceId(null), null);
    assert.equal(normalizeWorkspaceId(undefined), null);
    assert.equal(normalizeWorkspaceId(""), null);
  });

  it("isOnTeam compares ids as strings", () => {
    assert.equal(isOnTeam(bots[1], "7"), true);
    assert.equal(isOnTeam(bots[0], 7), true);
    assert.equal(isOnTeam(bots[2], "7"), false);
    assert.equal(isOnTeam(bots[3], "7"), false);
  });

  it("teamOf lists a dashboard's bots; null lists the unassigned", () => {
    assert.deepEqual(
      teamOf(bots, "7").map((b) => b.id),
      ["a", "b"],
    );
    assert.deepEqual(
      teamOf(bots, null).map((b) => b.id),
      ["d", "e"],
    );
    assert.deepEqual(teamOf(null, "7"), []);
  });
});

describe("unassignTeam (dashboard deleted)", () => {
  function fakes() {
    const store = {
      _bots: bots.map((b) => ({ ...b })),
      list() {
        return this._bots;
      },
      update(id, patch) {
        const b = this._bots.find((x) => x.id === id);
        Object.assign(b, patch);
        return b;
      },
    };
    const paused = [];
    const pause = { pauseBot: (id) => paused.push(id) };
    return { store, pause, paused };
  }

  it("unassigns AND pauses every bot on the deleted dashboard's team", () => {
    const { store, pause, paused } = fakes();
    const ids = unassignTeam({ store, pause }, 7);
    assert.deepEqual(ids, ["a", "b"]);
    assert.deepEqual(paused, ["a", "b"]);
    assert.equal(store._bots[0].workspaceId, null);
    assert.equal(store._bots[1].workspaceId, null);
    // Other teams and unassigned bots are untouched.
    assert.equal(store._bots[2].workspaceId, "9");
  });

  it("never deletes bots, and is a no-op for an unknown or empty id", () => {
    const { store, pause, paused } = fakes();
    assert.deepEqual(unassignTeam({ store, pause }, "404"), []);
    assert.deepEqual(unassignTeam({ store, pause }, null), []);
    assert.equal(store._bots.length, 5);
    assert.deepEqual(paused, []);
  });

  it("keeps going if one bot fails to update", () => {
    const { store, pause, paused } = fakes();
    const real = store.update.bind(store);
    store.update = (id, patch) => {
      if (id === "a") throw new Error("disk full");
      return real(id, patch);
    };
    assert.deepEqual(unassignTeam({ store, pause }, "7"), ["b"]);
    assert.deepEqual(paused, ["b"]);
  });
});
