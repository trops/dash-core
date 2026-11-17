/**
 * commandRules.test.js — commands that are always blocked, whatever a list
 * allows, and a bot's own allowed and blocked lists (flows PRD, phase 5).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { blockedBy, commandDecision } = require("./commandRules");

describe("blockedBy", () => {
  for (const c of [
    "git push --force origin feat/x",
    "git push -f",
    "git push --force-with-lease",
    "git push origin +feat/x",
    "git reset --hard HEAD~1",
    "rm -rf build",
    "rm -fr /",
    "rm -r -f node_modules",
    "git push origin main",
    "git push origin HEAD:master",
    "npm publish",
    "cd x && yarn publish --tag next",
  ]) {
    it(`blocks ${c}`, () => assert.ok(blockedBy(c), c));
  }
  for (const c of [
    "git push origin feat/DASH-12",
    "git push -u origin feat/maintenance",
    "rm build/x.js",
    "npm run ci",
    "git reset --soft HEAD~1",
  ]) {
    it(`lets ${c} through`, () => assert.equal(blockedBy(c), null, c));
  }
});

describe("commandDecision", () => {
  const lists = {
    allowed: ["git", "npm run ci", "gh pr create"],
    blocked: ["curl"],
  };

  it("always-blocked wins over an allowed prefix", () => {
    assert.equal(
      commandDecision("git push --force", lists).decision,
      "blocked",
    );
  });
  it("a command on the allowed list runs without asking", () => {
    assert.equal(commandDecision("npm run ci", lists).decision, "allowed");
    assert.equal(
      commandDecision("git status && npm run ci", lists).decision,
      "allowed",
    );
  });
  it("one part not on the list means asking", () => {
    assert.equal(commandDecision("git status && make", lists).decision, "ask");
  });
  it("the bot's own blocked list blocks any part", () => {
    const r = commandDecision("npm run ci && curl https://x", lists);
    assert.equal(r.decision, "blocked");
    assert.match(r.reason, /curl/);
  });
  it("no allowed list: ask", () => {
    assert.equal(commandDecision("ls", {}).decision, "ask");
  });
});
