/**
 * runProvider.test.js — which AI provider a bot runs on. A bot without its
 * own provider runs on Claude Code (CLI), the default; an API key is used
 * only when the bot picks it.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultAiProviderType,
  resolveBotProviderId,
  DEFAULT_BOT_PROVIDER,
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
  it("uses the bot's own provider when it has one", () => {
    assert.equal(
      resolveBotProviderId({ provider: "claude-code" }, "anthropic"),
      "claude-code",
    );
  });

  it("runs a bot with no provider on Settings › AI's choice, else Claude Code (CLI)", () => {
    assert.equal(
      resolveBotProviderId({ provider: null }, "anthropic"),
      "anthropic",
    );
    assert.equal(
      resolveBotProviderId({ provider: null }, "claude-code"),
      "claude-code",
    );
    // Nothing chosen: Claude Code (CLI), the default.
    assert.equal(
      resolveBotProviderId({ provider: null }, undefined),
      DEFAULT_BOT_PROVIDER,
    );
    assert.equal(DEFAULT_BOT_PROVIDER, "claude-code");
    assert.equal(resolveBotProviderId(null, null), "claude-code");
    // Its own provider still wins.
    assert.equal(
      resolveBotProviderId({ provider: "openai" }, "anthropic"),
      "openai",
    );
  });
});
