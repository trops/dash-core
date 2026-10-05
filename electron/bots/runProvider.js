/**
 * runProvider.js
 *
 * Which AI provider a bot runs on. A bot's own provider wins; a bot without
 * one (`provider: null`) uses the AI provider the user marked default for its
 * type. With no default marked, the run fails with NO_AI_MODEL_MESSAGE —
 * never a silent fallback to some other provider.
 *
 * Pure (NFR-006): decisions only; botController applies them.
 */
"use strict";

const AI_PROVIDER_TYPES = ["anthropic", "openai", "xai"];

const NO_AI_MODEL_MESSAGE =
  "No AI model chosen for this bot. Choose one in its Settings tab, or mark an AI provider as the default in Settings › Providers.";

/** The type of the AI provider marked default, else null. */
function defaultAiProviderType(providers) {
  const pick = (Array.isArray(providers) ? providers : []).find(
    (p) => p && AI_PROVIDER_TYPES.includes(p.type) && p.isDefaultForType,
  );
  return pick ? pick.type : null;
}

/** The provider id a bot runs on; throws NO_AI_MODEL_MESSAGE when there's none. */
function resolveBotProviderId(bot, providers) {
  const id = (bot && bot.provider) || defaultAiProviderType(providers);
  if (!id) throw new Error(NO_AI_MODEL_MESSAGE);
  return id;
}

module.exports = {
  AI_PROVIDER_TYPES,
  NO_AI_MODEL_MESSAGE,
  defaultAiProviderType,
  resolveBotProviderId,
};
