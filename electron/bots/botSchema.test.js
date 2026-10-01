/**
 * botSchema.test.js
 *
 * Pins Bot Schema v1: id shape + uniqueness, default-filling, and validation.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  SCHEMA_VERSION,
  newBotId,
  isValidBotId,
  withDefaults,
  validateBotDefinition,
} = require("./botSchema");

describe("botSchema.newBotId / isValidBotId", () => {
  it("mints ids that pass the safe-segment validator", () => {
    const id = newBotId();
    assert.ok(id.startsWith("bot_"));
    assert.equal(isValidBotId(id), true);
  });

  it("mints unique ids even in a tight loop", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newBotId());
    assert.equal(ids.size, 1000);
  });

  it("rejects ids that could escape a path segment", () => {
    assert.equal(isValidBotId("bot_../etc"), false);
    assert.equal(isValidBotId("bot_a/b"), false);
    assert.equal(isValidBotId("../bot_x"), false);
    assert.equal(isValidBotId(""), false);
    assert.equal(isValidBotId(null), false);
  });
});

describe("botSchema.withDefaults", () => {
  it("fills schema defaults without mutating input", () => {
    const input = { name: "PR Digest" };
    const out = withDefaults(input);
    assert.equal(out.schemaVersion, SCHEMA_VERSION);
    assert.equal(out.approvalPolicy, "ask");
    assert.equal(out.whilePaused, "queue");
    assert.equal(out.provider, null);
    assert.deepEqual(out.mcpServers, []);
    // input untouched
    assert.deepEqual(input, { name: "PR Digest" });
  });

  it("lets caller values override defaults", () => {
    const out = withDefaults({
      approvalPolicy: "allow",
      provider: "anthropic",
    });
    assert.equal(out.approvalPolicy, "allow");
    assert.equal(out.provider, "anthropic");
  });
});

describe("botSchema.validateBotDefinition", () => {
  const good = () =>
    withDefaults({ name: "Bot", instructions: "Do the thing." });

  it("accepts a well-formed definition", () => {
    assert.deepEqual(validateBotDefinition(good()), {
      valid: true,
      errors: [],
    });
  });

  it("requires name and instructions", () => {
    const r = validateBotDefinition(withDefaults({}));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /name/.test(e)));
    assert.ok(r.errors.some((e) => /instructions/.test(e)));
  });

  it("rejects a bad approvalPolicy and whilePaused", () => {
    const r = validateBotDefinition({
      ...good(),
      approvalPolicy: "yolo",
      whilePaused: "maybe",
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /approvalPolicy/.test(e)));
    assert.ok(r.errors.some((e) => /whilePaused/.test(e)));
  });

  it("allows provider null (use default) but rejects empty string", () => {
    assert.equal(
      validateBotDefinition({ ...good(), provider: null }).valid,
      true,
    );
    assert.equal(
      validateBotDefinition({ ...good(), provider: "" }).valid,
      false,
    );
  });

  it("never throws on garbage input", () => {
    assert.equal(validateBotDefinition(null).valid, false);
    assert.equal(validateBotDefinition(42).valid, false);
  });

  it("accepts well-formed subscriptions", () => {
    const r = validateBotDefinition({
      ...good(),
      subscriptions: [{ eventType: "pr.opened" }],
    });
    assert.equal(r.valid, true);
  });

  it("rejects subscriptions without an eventType", () => {
    const r = validateBotDefinition({
      ...good(),
      subscriptions: [{ channel: "x" }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /eventType/.test(e)));
  });

  it("rejects a non-array subscriptions field", () => {
    const r = validateBotDefinition({ ...good(), subscriptions: "nope" });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /subscriptions must be an array/.test(e)));
  });

  // Per-bot tool narrowing within each provider's declared tools.
  it("accepts toolSelections mapping provider → tool names", () => {
    const r = validateBotDefinition({
      ...good(),
      toolSelections: { "Gmail 3": ["search_emails", "read_email"] },
    });
    assert.deepEqual(r, { valid: true, errors: [] });
  });

  it("rejects toolSelections that aren't provider → string[]", () => {
    for (const bad of [
      "nope",
      ["x"],
      { gmail: "search_emails" },
      { gmail: [1, 2] },
    ]) {
      const r = validateBotDefinition({ ...good(), toolSelections: bad });
      assert.equal(r.valid, false, JSON.stringify(bad));
      assert.ok(r.errors.some((e) => /toolSelections/.test(e)));
    }
  });
});

describe("botSchema.withDefaults — toolSelections", () => {
  it("defaults toolSelections to {} (all tools each provider allows)", () => {
    assert.deepEqual(withDefaults({ name: "a" }).toolSelections, {});
  });
});
