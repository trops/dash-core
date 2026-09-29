/**
 * PauseController.test.js — global + per-bot pause state.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const PauseController = require("./PauseController");

describe("PauseController", () => {
  it("pauseAll pauses every bot; resumeAll clears it", () => {
    const p = new PauseController();
    assert.equal(p.isPaused("b1"), false);
    p.pauseAll();
    assert.equal(p.isGloballyPaused(), true);
    assert.equal(p.isPaused("b1"), true);
    assert.equal(p.isPaused("anything"), true);
    p.resumeAll();
    assert.equal(p.isGloballyPaused(), false);
    assert.equal(p.isPaused("b1"), false);
  });

  it("pauseBot pauses only that bot", () => {
    const p = new PauseController();
    p.pauseBot("b1");
    assert.equal(p.isPaused("b1"), true);
    assert.equal(p.isPaused("b2"), false);
    p.resumeBot("b1");
    assert.equal(p.isPaused("b1"), false);
  });

  it("global pause overrides per-bot state", () => {
    const p = new PauseController();
    p.pauseAll();
    assert.equal(p.isPaused("never-paused-individually"), true);
    p.resumeAll();
    p.pauseBot("b1");
    assert.equal(p.isPaused("b1"), true);
    assert.equal(p.isPaused("b2"), false);
  });

  it("list reflects state and audit fires", () => {
    const audits = [];
    const p = new PauseController({ audit: (e) => audits.push(e) });
    p.pauseAll();
    p.pauseBot("b1");
    assert.deepEqual(p.list(), { global: true, bots: ["b1"] });
    assert.ok(audits.some((a) => a.type === "pause-all"));
    assert.ok(audits.some((a) => a.type === "pause-bot" && a.botId === "b1"));
  });
});
