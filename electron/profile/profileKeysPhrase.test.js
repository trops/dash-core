/**
 * profileKeysPhrase.test.js — the phrase that locks a profile's keys, on
 * this Mac: for the next save only, or remembered sealed (dash-profiles).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const phrases = require("./profileKeysPhrase");
const { lockKeys } = require("./profileKeys");

function deps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-keys-phrase-"));
  return {
    file: path.join(dir, "profile-keys.json"),
    d: {
      filePath: () => path.join(dir, "profile-keys.json"),
      // Stands in for the keychain: reversible, not the phrase as typed.
      seal: (t) => Buffer.from(`sealed:${t}`).toString("base64"),
      open: (s) =>
        Buffer.from(s, "base64")
          .toString()
          .replace(/^sealed:/, ""),
    },
  };
}

describe("profileKeysPhrase", () => {
  it("not remembered: the next save only, and never on disk", async () => {
    const { d, file } = deps();
    const res = phrases.setPhrase("app", "p1", "purple otter river", {}, d);
    assert.equal(res.success, true);
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /purple otter/);
    assert.equal(phrases.takePhrase("app", "p1", d), "purple otter river");
    assert.equal(phrases.takePhrase("app", "p1", d), null);
    assert.deepEqual(phrases.status("app", "p1", d), {
      remembered: false,
      lockedBefore: false,
    });
  });

  it("remembered: sealed on disk, used by every save (auto-save too)", async () => {
    const { d, file } = deps();
    phrases.setPhrase("app", "p1", "purple otter river", { remember: true }, d);
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /purple otter/);
    assert.equal(phrases.takePhrase("app", "p1", d), "purple otter river");
    assert.equal(phrases.takePhrase("app", "p1", d), "purple otter river");
    assert.equal(phrases.status("app", "p1", d).remembered, true);
    // Kept as it is when left empty; forgotten when not remembered.
    assert.equal(
      phrases.setPhrase("app", "p1", "", { remember: true }, d).success,
      true,
    );
    phrases.takePhrase("app", "p1", d);
    phrases.setPhrase("app", "p1", "another phrase here", {}, d);
    phrases.takePhrase("app", "p1", d);
    assert.equal(phrases.takePhrase("app", "p1", d), null);
  });

  it("too short: refused", async () => {
    const { d } = deps();
    const res = phrases.setPhrase("app", "p1", "short", {}, d);
    assert.equal(res.success, false);
    assert.equal(phrases.takePhrase("app", "p1", d), null);
  });

  it("the keys as last locked, per profile; forget clears it all", async () => {
    const { d } = deps();
    const locked = await lockKeys(
      { providers: { a: { k: "v" } } },
      "purple otter river",
    );
    phrases.setLastLocked("app", "p1", locked, d);
    assert.deepEqual(phrases.lastLocked("app", "p1", d), locked);
    assert.equal(phrases.lastLocked("app", "p2", d), null);
    assert.equal(phrases.status("app", "p1", d).lockedBefore, true);
    phrases.forget("app", "p1", d);
    assert.equal(phrases.lastLocked("app", "p1", d), null);
  });

  it("a file's phrase is its own: never the account's, never remembered", async () => {
    const { d } = deps();
    phrases.setPhrase(
      "app",
      "p1",
      "account phrase here",
      { remember: true },
      d,
    );
    phrases.setPhrase(
      "app",
      "p1",
      "file phrase only here",
      { remember: true, target: "file" },
      d,
    );
    assert.equal(
      phrases.takePhrase("app", "p1", d, "file"),
      "file phrase only here",
    );
    assert.equal(phrases.takePhrase("app", "p1", d, "file"), null);
    assert.equal(phrases.takePhrase("app", "p1", d), "account phrase here");
    const locked = await lockKeys({ providers: {} }, "file phrase only here");
    phrases.setLastLocked("app", "p1", locked, d, "file");
    assert.equal(phrases.lastLocked("app", "p1", d), null);
    phrases.forgetTarget("app", "p1", d, "file");
    assert.equal(phrases.status("app", "p1", d).remembered, true);
  });
});
