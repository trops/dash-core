/**
 * modelProviders.js
 *
 * Provider-pluggable registry for discovering and validating LLM models.
 *
 * Each provider knows how to:
 *   - list its currently-available models (live, when credentials allow)
 *   - fall back to a curated list (offline / no key / no live API)
 *   - migrate retired model IDs to a current replacement
 *   - name its default model
 *
 * Today only `anthropic` is implemented. Adding a vendor (OpenAI, Google, …)
 * is a single new entry in PROVIDERS — the dispatchers below, the
 * LLM_LIST_MODELS IPC, and the Settings UI need no changes.
 *
 * NOTE: the renderer mirrors the retired map + default for the auto-migrate
 * notice (src/utils/modelMigration.js). Keep the two in sync.
 */
const Anthropic = require("@anthropic-ai/sdk");

// Advisor metadata (Bot Factory). `tier` maps a model to a provider-neutral
// capability class (fast | balanced | deep) so the model advisor can recommend
// by tier across providers. `reasoning` describes the normalized reasoning
// control an engine translates into the provider's native setting (Anthropic:
// output_config.effort; levels normalized to low/medium/high). `pricing` is USD
// per million tokens, used for per-run cost estimates. Values verified against
// the Claude API model reference.
const EFFORT_REASONING = {
  control: "effort",
  levels: ["low", "medium", "high"],
};

const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    // Bot Factory engine routing: the tool-loop engine drives this provider
    // through the "anthropic" adapter (Anthropic SDK streaming + tool use).
    engine: "tool-loop",
    adapter: "anthropic",
    defaultModel: "claude-opus-4-8",
    // Curated fallback — current, non-deprecated IDs. Used for the Claude
    // Code CLI backend (which has no Models API) and whenever a live fetch
    // can't run (no API key, offline, error). Each entry also carries advisor
    // metadata (tier/reasoning/pricing).
    curatedModels: [
      {
        value: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 5, output: 25 },
      },
      {
        value: "claude-opus-4-7",
        label: "Claude Opus 4.7",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 5, output: 25 },
      },
      {
        value: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        tier: "balanced",
        reasoning: EFFORT_REASONING,
        pricing: { input: 3, output: 15 },
      },
      {
        value: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        tier: "fast",
        // Haiku does not accept the effort parameter.
        reasoning: null,
        pricing: { input: 1, output: 5 },
      },
      {
        value: "claude-fable-5",
        label: "Claude Fable 5",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 10, output: 50 },
      },
    ],
    // Retired/deprecated IDs → current replacement. Lets a stale saved
    // selection self-heal instead of 404-ing at call time.
    retiredMap: {
      "claude-sonnet-4-20250514": "claude-sonnet-4-6",
      "claude-opus-4-20250514": "claude-opus-4-8",
      "claude-opus-4-1-20250805": "claude-opus-4-8",
      "claude-3-7-sonnet-20250219": "claude-sonnet-4-6",
      "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
      "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
      "claude-3-5-haiku-20241022": "claude-haiku-4-5",
      "claude-3-opus-20240229": "claude-opus-4-8",
    },
    async listModels({ apiKey } = {}) {
      const client = new Anthropic({ apiKey });
      const res = await client.models.list();
      return (res.data || []).map((m) => ({
        value: m.id,
        label: m.display_name || m.id,
      }));
    },
  },

  // OpenAI and xAI both speak the OpenAI-compatible API, so one adapter serves
  // both — xAI only differs by baseURL. Concrete model IDs move quickly and are
  // not hardcoded here: the live Models API is the source of truth (populated
  // once provider credentials exist), and the curated fallback is intentionally
  // empty until a verified default is chosen in the provider-config UI slice.
  openai: {
    id: "openai",
    label: "OpenAI",
    engine: "tool-loop",
    adapter: "openai-compatible",
    defaultModel: null,
    curatedModels: [],
    retiredMap: {},
    async listModels({ apiKey } = {}) {
      const OpenAI = require("openai");
      const client = new OpenAI({ apiKey, baseURL: this.baseURL });
      const res = await client.models.list();
      return (res.data || []).map((m) => ({ value: m.id, label: m.id }));
    },
  },

  xai: {
    id: "xai",
    label: "xAI (Grok)",
    engine: "tool-loop",
    adapter: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    defaultModel: null,
    curatedModels: [],
    retiredMap: {},
    async listModels({ apiKey } = {}) {
      const OpenAI = require("openai");
      const client = new OpenAI({ apiKey, baseURL: this.baseURL });
      const res = await client.models.list();
      return (res.data || []).map((m) => ({ value: m.id, label: m.id }));
    },
  },
};

const DEFAULT_PROVIDER = "anthropic";

function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
}

function getCuratedModels(providerId) {
  return getProvider(providerId).curatedModels.slice();
}

function getDefaultModel(providerId) {
  return getProvider(providerId).defaultModel;
}

/**
 * Map a retired/deprecated model id to its current replacement. Returns the
 * provider default for a falsy id, and passes through anything not in the
 * retired map (live/curated ids are returned unchanged).
 */
function migrateModelId(providerId, id) {
  if (!id) return getDefaultModel(providerId);
  const map = getProvider(providerId).retiredMap || {};
  return map[id] || id;
}

function isKnownRetired(providerId, id) {
  const map = getProvider(providerId).retiredMap || {};
  return !!map[id];
}

/**
 * List models for a provider. Attempts a live fetch when the provider
 * supports it and credentials are present; otherwise returns the curated
 * fallback. Never throws — always resolves to a usable list.
 *
 * @returns {Promise<{ models: Array<{value,label}>, source: "live"|"curated" }>}
 */
async function listModels(providerId, creds = {}) {
  const provider = getProvider(providerId);
  if (provider.listModels && creds && creds.apiKey) {
    try {
      const models = await provider.listModels(creds);
      if (Array.isArray(models) && models.length > 0) {
        return { models, source: "live" };
      }
    } catch (e) {
      console.warn(
        `[modelProviders] live model fetch failed for ${provider.id}: ${e.message}`,
      );
    }
  }
  return { models: provider.curatedModels.slice(), source: "curated" };
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  getProvider,
  getCuratedModels,
  getDefaultModel,
  migrateModelId,
  isKnownRetired,
  listModels,
};
