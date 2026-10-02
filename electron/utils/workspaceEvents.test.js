/**
 * workspaceEvents.test.js — "dashboard deleted" hook (bot-teams TEAM-001:
 * a deleted dashboard's bots are unassigned + paused, never deleted).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  onWorkspaceDeleted,
  emitWorkspaceDeleted,
} = require("./workspaceEvents");

describe("workspaceEvents", () => {
  it("notifies listeners with the deleted dashboard id", () => {
    const seen = [];
    const off = onWorkspaceDeleted((id) => seen.push(id));
    emitWorkspaceDeleted(7);
    off();
    emitWorkspaceDeleted(8); // unsubscribed
    assert.deepEqual(seen, [7]);
  });

  it("a throwing listener doesn't stop the others or the delete", () => {
    const seen = [];
    const off1 = onWorkspaceDeleted(() => {
      throw new Error("boom");
    });
    const off2 = onWorkspaceDeleted((id) => seen.push(id));
    assert.doesNotThrow(() => emitWorkspaceDeleted("9"));
    off1();
    off2();
    assert.deepEqual(seen, ["9"]);
  });
});

describe("workspaceController wiring (static pin)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "workspaceController.js"),
    "utf8",
  );
  it("emits workspace-deleted only when a dashboard was actually removed", () => {
    assert.match(src, /require\("\.\.\/utils\/workspaceEvents"\)/);
    assert.match(
      src,
      /filtered\.length < workspacesArray\.length[\s\S]{0,80}emitWorkspaceDeleted\(workspaceId\)/,
    );
  });
});

describe("botController wiring (static pin)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  it("unassigns + pauses the deleted dashboard's team", () => {
    assert.match(src, /onWorkspaceDeleted\(/);
    assert.match(src, /unassignTeam\(/);
  });
});
