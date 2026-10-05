/**
 * runProvider.test.js — which AI provider a bot runs on. A bot without its
 * own provider uses the AI provider the user marked default; with no default
 * marked the run fails with a clear message — never a silent second choice.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultAiProviderType,
  resolveBotProviderId,
  NO_AI_MODEL_MESSAGE,
} = require("./runProvider");

describe("defaultAiProviderType", () => {
  it("is the AI provider marked default for its type", () => {
    assert.equal(
      defaultAiProviderType([
        { type: "openai" },
        { type: "anthropic", isDefaultForType: true },
        { type: "gmail", isDefaultForType: true },
      ]),
      "anthropic",
    );
  });

  it("is null when no AI provider is marked default — no first-found pick", () => {
    assert.equal(defaultAiProviderType([{ type: "xai" }]), null);
    assert.equal(
      defaultAiProviderType([{ type: "gmail", isDefaultForType: true }]),
      null,
    );
    assert.equal(defaultAiProviderType(null), null);
  });
});

describe("resolveBotProviderId", () => {
  const providers = [
    { type: "openai" },
    { type: "xai", isDefaultForType: true },
  ];

  it("uses the bot's own provider when it has one", () => {
    assert.equal(
      resolveBotProviderId({ provider: "claude-code" }, providers),
      "claude-code",
    );
  });

  it("uses the default-marked AI provider when the bot has none", () => {
    assert.equal(resolveBotProviderId({ provider: null }, providers), "xai");
  });

  it("throws a readable error when there is neither", () => {
    assert.throws(
      () => resolveBotProviderId({ provider: null }, [{ type: "openai" }]),
      (e) => e.message === NO_AI_MODEL_MESSAGE,
    );
    assert.match(NO_AI_MODEL_MESSAGE, /No AI model chosen for this bot/);
  });
});
