/**
 * profileKeys.test.js — a profile's keys and passwords, locked with the
 * user's phrase (dash-profiles, "Include keys and passwords").
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  lockKeys,
  unlockKeys,
  isLockedKeys,
  checkKeysPhrase,
} = require("./profileKeys");

const bundle = {
  providers: {
    "Algolia John G Demos": { appId: "APP1", apiKey: "sk-real-secret-123" },
  },
  widgetSecrets: [
    { dashboardId: 7, item: "layout/3", field: "apiKey", value: "w-secret-9" },
  ],
};

describe("profileKeys", () => {
  it("locks so the blob says nothing; the phrase opens it", async () => {
    const locked = await lockKeys(bundle, "copper kettle river");
    const text = JSON.stringify(locked);
    assert.doesNotMatch(text, /sk-real-secret|w-secret|APP1|Algolia/);
    assert.deepEqual(locked.counts, { providers: 1, widgetSecrets: 1 });
    assert.ok(isLockedKeys(locked));
    const open = await unlockKeys(locked, "copper kettle river");
    assert.equal(open.ok, true);
    assert.deepEqual(open.bundle, bundle);
  });

  it("a wrong phrase, or a changed blob, never opens — never garbled", async () => {
    const locked = await lockKeys(bundle, "copper kettle river");
    assert.deepEqual(await unlockKeys(locked, "copper kettle rivers"), {
      ok: false,
      error: "That phrase doesn't open these keys.",
    });
    const data = Buffer.from(locked.data, "base64");
    data[0] ^= 1;
    assert.equal(
      (
        await unlockKeys(
          { ...locked, data: data.toString("base64") },
          "copper kettle river",
        )
      ).ok,
      false,
    );
  });

  it("each lock is different (fresh salt and IV)", async () => {
    const a = await lockKeys(bundle, "copper kettle river");
    const b = await lockKeys(bundle, "copper kettle river");
    assert.notEqual(a.data, b.data);
    assert.notEqual(a.salt, b.salt);
  });

  it("the phrase: 12 characters at least, short under 16, refused over 200", async () => {
    assert.equal(checkKeysPhrase("short").ok, false);
    assert.equal(checkKeysPhrase("elevenchars").ok, false);
    assert.deepEqual(checkKeysPhrase("twelve chars"), {
      ok: true,
      short: true,
    });
    assert.deepEqual(checkKeysPhrase("copper kettle river"), {
      ok: true,
      short: false,
    });
    assert.equal(checkKeysPhrase("x".repeat(201)).ok, false);
    await assert.rejects(() => lockKeys(bundle, "short"));
  });

  it("a crafted blob opened with its maker's phrase still can't plant odd things", async () => {
    const evil = await lockKeys(
      {
        providers: {
          __proto__: { polluted: "yes" },
          Good: { apiKey: "k", nested: { a: 1 }, fn: "x" },
        },
        widgetSecrets: [
          { dashboardId: 1, item: "layout/1", field: "__proto__", value: "x" },
          {
            dashboardId: 1,
            item: "layout/1",
            field: "apiKey",
            value: { a: 1 },
          },
          { dashboardId: 1, item: "layout/1", field: "token", value: "ok" },
        ],
      },
      "maker's own phrase",
    );
    const open = await unlockKeys(evil, "maker's own phrase");
    assert.equal(open.ok, true);
    assert.deepEqual(Object.keys(open.bundle.providers), ["Good"]);
    assert.deepEqual(open.bundle.providers.Good, { apiKey: "k", fn: "x" });
    assert.deepEqual(open.bundle.widgetSecrets, [
      { dashboardId: 1, item: "layout/1", field: "token", value: "ok" },
    ]);
    assert.equal({}.polluted, undefined);
  });

  it("not one of ours: can't be read", async () => {
    assert.equal(isLockedKeys({ v: 2 }), false);
    assert.equal((await unlockKeys(null, "copper kettle river")).ok, false);
  });

  it("a cut-short tag is refused", async () => {
    const locked = await lockKeys(bundle, "copper kettle river");
    const tag = Buffer.from(locked.tag, "base64")
      .subarray(0, 4)
      .toString("base64");
    assert.equal(
      (await unlockKeys({ ...locked, tag }, "copper kettle river")).ok,
      false,
    );
  });
});
