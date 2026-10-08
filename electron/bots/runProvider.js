/**
 * runProvider.js
 *
 * Which AI provider a bot runs on. A bot's own provider wins; a bot without
 * one (`provider: null`) runs on Claude Code (CLI) — the default, which needs
 * no API key. An API-key provider (Anthropic, OpenAI, xAI) is used only when
 * the bot picks it: marking one "default" in Settings › Providers chooses
 * among keys of that type, it doesn't move bots onto it.
 *
 * Pure (NFR-006): decisions only; botController applies them.
 */
"use strict";

const AI_PROVIDER_TYPES = ["anthropic", "openai", "xai"];

/** What a bot with no AI model of its own runs on. */
const DEFAULT_BOT_PROVIDER = "claude-code";

/** The type of the AI provider marked default, else null. */
function defaultAiProviderType(providers) {
  const pick = (Array.isArray(providers) ? providers : []).find(
    (p) => p && AI_PROVIDER_TYPES.includes(p.type) && p.isDefaultForType,
  );
  return pick ? pick.type : null;
}

/** The provider id a bot runs on: its own, else Claude Code (CLI). */
function resolveBotProviderId(bot, _providers) {
  return (bot && bot.provider) || DEFAULT_BOT_PROVIDER;
}

module.exports = {
  AI_PROVIDER_TYPES,
  DEFAULT_BOT_PROVIDER,
  defaultAiProviderType,
  resolveBotProviderId,
};
