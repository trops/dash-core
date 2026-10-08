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

  it("runs a bot with no provider on Claude Code (CLI) — the default", () => {
    // An API key marked default for its type doesn't take bots over.
    assert.equal(
      resolveBotProviderId({ provider: null }, providers),
      DEFAULT_BOT_PROVIDER,
    );
    assert.equal(DEFAULT_BOT_PROVIDER, "claude-code");
    assert.equal(
      resolveBotProviderId({ provider: null }, [{ type: "openai" }]),
      "claude-code",
    );
    assert.equal(resolveBotProviderId(null, null), "claude-code");
  });
});
