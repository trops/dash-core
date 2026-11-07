/**
 * runProvider.js
 *
 * Which AI provider a bot runs on. A bot's own provider wins; a bot without
 * one (`provider: null`) runs on what Settings › AI says — Claude Code (CLI),
 * the default, or the Anthropic API key (aiDefaults.backendProvider). Marking
 * an API key "default" in Settings › Providers only chooses among keys of
 * that type.
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

/**
 * The provider id a bot runs on: its own, else Settings › AI's, else Claude
 * Code (CLI). `backend` is aiDefaults.backendProvider(ai).
 */
function resolveBotProviderId(bot, backend) {
  return (bot && bot.provider) || backend || DEFAULT_BOT_PROVIDER;
}

module.exports = {
  AI_PROVIDER_TYPES,
  DEFAULT_BOT_PROVIDER,
  defaultAiProviderType,
  resolveBotProviderId,
};
