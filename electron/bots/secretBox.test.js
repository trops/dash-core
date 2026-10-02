/**
 * secretBox.test.js — field-level encryption for sensitive bot data (run
 * answers), backed by the OS keychain via an injected safeStorage-shaped
 * object. Pure: the crypto is passed in.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createSecretBox, PREFIX } = require("./secretBox");

// A reversible fake with safeStorage's shape.
function fakeSafeStorage({ available = true, backend = "keychain" } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from("X" + s, "utf8"),
    decryptString: (buf) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("X")) throw new Error("bad key");
      return s.slice(1);
    },
  };
}

describe("secretBox", () => {
  it("seals to an enc:v1 value and opens it back", () => {
    const box = createSecretBox(fakeSafeStorage());
    const sealed = box.seal("3 important emails");
    assert.ok(sealed.startsWith(PREFIX));
    assert.ok(!sealed.includes("important"));
    assert.equal(box.open(sealed), "3 important emails");
  });

  it("leaves empty values alone", () => {
    const box = createSecretBox(fakeSafeStorage());
    assert.equal(box.seal(""), "");
    assert.equal(box.seal(null), null);
    assert.equal(box.open(undefined), undefined);
  });

  it("opens plain (pre-encryption) values unchanged", () => {
    const box = createSecretBox(fakeSafeStorage());
    assert.equal(box.open("an old plain answer"), "an old plain answer");
  });

  it("returns null (not a crash) when a value can't be decrypted", () => {
    const box = createSecretBox(fakeSafeStorage());
    const foreign = PREFIX + Buffer.from("not ours").toString("base64");
    assert.equal(box.open(foreign), null);
  });

  it("falls back to plain text when the keychain isn't available", () => {
    const box = createSecretBox(fakeSafeStorage({ available: false }));
    assert.equal(box.seal("hello"), "hello");
    assert.deepEqual(box.status(), { encrypted: false, reason: "unavailable" });
  });

  it("treats Linux's basic_text backend as not really encrypted", () => {
    const box = createSecretBox(fakeSafeStorage({ backend: "basic_text" }));
    assert.equal(box.seal("hello"), "hello");
    assert.deepEqual(box.status(), {
      encrypted: false,
      reason: "weak-backend",
    });
  });

  it("works with no crypto at all (plain-Node host)", () => {
    const box = createSecretBox(null);
    assert.equal(box.seal("hello"), "hello");
    assert.equal(box.open("hello"), "hello");
    assert.equal(box.status().encrypted, false);
  });

  it("reports encrypted when the keychain is available", () => {
    assert.deepEqual(createSecretBox(fakeSafeStorage()).status(), {
      encrypted: true,
    });
  });
});
