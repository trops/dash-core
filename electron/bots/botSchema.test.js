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

  it("accepts every approval policy: ask, ask-every, allow", () => {
    for (const approvalPolicy of ["ask", "ask-every", "allow"]) {
      assert.equal(
        validateBotDefinition({ ...good(), approvalPolicy }).valid,
        true,
        approvalPolicy,
      );
    }
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

  it("accepts picker subscriptions (eventType + structured source + label)", () => {
    const r = validateBotDefinition({
      ...good(),
      subscriptions: [
        {
          eventType: "trops.samples.EventSender[3].buttonClicked",
          label: "Kitchen Sink › Event Sender › buttonClicked",
          source: {
            kind: "widget",
            ref: "trops.samples.EventSender",
            instanceId: "3",
            event: "buttonClicked",
            workspaceId: "7",
          },
        },
      ],
    });
    assert.equal(r.valid, true);
  });

  it("accepts a trigger note (TEAM-014) and rejects a bad one", () => {
    const ok = validateBotDefinition({
      ...good(),
      subscriptions: [{ eventType: "e", note: "Check the images." }],
    });
    assert.equal(ok.valid, true);
    const notText = validateBotDefinition({
      ...good(),
      subscriptions: [{ eventType: "e", note: 42 }],
    });
    assert.equal(notText.valid, false);
    assert.ok(notText.errors.some((e) => /note/.test(e)));
    const tooLong = validateBotDefinition({
      ...good(),
      subscriptions: [{ eventType: "e", note: "x".repeat(2001) }],
    });
    assert.equal(tooLong.valid, false);
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

describe("botSchema.validateBotDefinition — publishes (TD-001)", () => {
  const base = { ...withDefaults({ name: "a", instructions: "b" }) };
  const check = (publishes) =>
    validateBotDefinition({ ...base, publishes }).errors;

  it("defaults to no results and accepts declared ones", () => {
    assert.deepEqual(base.publishes, []);
    assert.deepEqual(
      check([
        { name: "importantEmails", label: "Important emails" },
        { name: "digest_2", description: "Daily digest" },
      ]),
      [],
    );
  });

  it("rejects a non-array", () => {
    assert.deepEqual(check({}), ["publishes must be an array"]);
  });

  it("rejects names that aren't short identifiers", () => {
    for (const name of ["", "2x", "a.b", "a b", "x".repeat(41), null]) {
      assert.equal(check([{ name }]).length, 1, String(name));
    }
  });

  it("rejects duplicate names", () => {
    assert.match(check([{ name: "a" }, { name: "a" }])[0], /declared twice/);
  });

  it("rejects long or non-text labels", () => {
    assert.equal(check([{ name: "a", label: "x".repeat(201) }]).length, 1);
    assert.equal(check([{ name: "a", description: 3 }]).length, 1);
  });

  it("caps the number of results", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `r${i}` }));
    assert.match(check(many)[0], /at most 20 results/);
  });
});
