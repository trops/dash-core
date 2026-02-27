/**
 * clientFactories.js
 *
 * Registers built-in provider type factories with clientCache.
 * SDK packages are lazy-required so they're only loaded when first needed.
 *
 * Auto-imported by electron/index.js — factories are registered the moment
 * any consuming app does require("@trops/dash-core/electron").
 */

const clientCache = require("./clientCache");

// --- Algolia ---
clientCache.registerFactory("algolia", (credentials) => {
  const algoliasearch = require("algoliasearch");
  return algoliasearch(
    credentials.appId,
    credentials.apiKey || credentials.key,
  );
});

// --- OpenAI ---
clientCache.registerFactory("openai", (credentials) => {
  const OpenAI = require("openai");
  return new OpenAI({ apiKey: credentials.apiKey });
});
