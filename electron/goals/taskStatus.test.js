/**
 * taskStatus — where a task on the goals ledger may move (goals-ledger PRD).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  afterDone,
  afterUser,
  goalStatus,
  clampRounds,
} = require("./taskStatus");

const task = (status, round = 1, maxRounds = 3) => ({
  status,
  round,
  maxRounds,
});

describe("afterDone", () => {
  it("a passed record moves the task one step on", () => {
    assert.deepEqual(afterDone(task("claimed"), "passed"), { status: "built" });
    assert.deepEqual(afterDone(task("built"), "passed"), { status: "checked" });
    assert.deepEqual(afterDone(task("checked"), "passed"), { status: "ready" });
  });
  it("only the user takes a ready task to done", () => {
    assert.match(afterDone(task("ready"), "passed").error, /only the user/);
  });
  it("a task nobody claimed can't be passed", () => {
    assert.match(afterDone(task("new"), "passed").error, /claim it first/);
  });
  it("a fail sends it back for the next round", () => {
    assert.deepEqual(afterDone(task("built", 1), "failed"), {
      status: "new",
      round: 2,
    });
  });
  it("a fail on the last round stops it for the user", () => {
    assert.deepEqual(afterDone(task("built", 3, 3), "failed"), {
      status: "needs-you",
      stopped: true,
    });
  });
  it("needs-you stops it for the user", () => {
    assert.deepEqual(afterDone(task("claimed"), "needs-you"), {
      status: "needs-you",
    });
  });
  it("a finished task takes no more records", () => {
    assert.ok(afterDone(task("done"), "passed").error);
    assert.ok(afterDone(task("closed"), "failed").error);
  });
  it("refuses an unknown status", () => {
    assert.ok(afterDone(task("claimed"), "great").error);
  });
});

describe("afterUser", () => {
  it("marks a ready task done, and nothing else", () => {
    assert.deepEqual(afterUser(task("ready"), "done"), { status: "done" });
    assert.ok(afterUser(task("built"), "done").error);
  });
  it("one more round restarts a stopped task with room for it", () => {
    assert.deepEqual(afterUser(task("needs-you", 3, 3), "one-more-round"), {
      status: "new",
      round: 4,
      maxRounds: 4,
    });
    assert.ok(afterUser(task("built"), "one-more-round").error);
  });
  it("close works from any open status", () => {
    assert.deepEqual(afterUser(task("claimed"), "close"), {
      status: "closed",
    });
    assert.ok(afterUser(task("done"), "close").error);
  });
});

describe("goalStatus", () => {
  it("follows its tasks", () => {
    assert.equal(goalStatus({}, []), "open");
    assert.equal(goalStatus({}, [task("built"), task("new")]), "working");
    assert.equal(goalStatus({}, [task("ready"), task("done")]), "ready");
    assert.equal(goalStatus({}, [task("done"), task("closed")]), "done");
    assert.equal(goalStatus({}, [task("closed")]), "closed");
    assert.equal(
      goalStatus({}, [task("ready"), task("needs-you")]),
      "needs-you",
    );
    assert.equal(goalStatus({ closed: true }, [task("new")]), "closed");
  });
});

describe("clampRounds", () => {
  it("defaults to 3 and keeps within 1–10", () => {
    assert.equal(clampRounds(undefined), 3);
    assert.equal(clampRounds(0), 3);
    assert.equal(clampRounds(5), 5);
    assert.equal(clampRounds(99), 10);
  });
});
