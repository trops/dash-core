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
 * The renderer asks for models over IPC (LLM_LIST_MODELS); this is the only
 * copy of the list. modelList.js keeps it fresh without an app update.
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
    defaultModel: "claude-opus-5-5",
    // Curated fallback — current, non-deprecated IDs. Used for the Claude
    // Code CLI backend (which has no Models API) and whenever a live fetch
    // can't run (no API key, offline, error). Each entry also carries advisor
    // metadata (tier/reasoning/pricing).
    curatedModels: [
      {
        value: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        family: "opus",
        status: "current",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 4, output: 20 },
      },
      {
        value: "claude-sonnet-5-5",
        label: "Claude Sonnet 5.5",
        family: "sonnet",
        status: "current",
        tier: "balanced",
        reasoning: EFFORT_REASONING,
        pricing: { input: 2, output: 10 },
      },
      {
        value: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        family: "haiku",
        status: "current",
        tier: "fast",
        reasoning: EFFORT_REASONING,
        // Up to 100K-token prompts ($0.50 / $2.50 beyond).
        pricing: { input: 0.1, output: 0.5 },
      },
      {
        value: "claude-fable-5-2",
        label: "Claude Fable 5.2",
        family: "fable",
        status: "current",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 10, output: 50 },
      },
      {
        value: "claude-fable-5-1",
        label: "Claude Fable 5.1",
        family: "fable",
        status: "older",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 10, output: 50 },
      },
      // Older models, still served.
      {
        value: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        family: "opus",
        status: "older",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 5, output: 25 },
      },
      {
        value: "claude-opus-4-7",
        label: "Claude Opus 4.7",
        family: "opus",
        status: "older",
        tier: "deep",
        reasoning: EFFORT_REASONING,
        pricing: { input: 5, output: 25 },
      },
      {
        value: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        family: "sonnet",
        status: "older",
        tier: "balanced",
        reasoning: EFFORT_REASONING,
        pricing: { input: 3, output: 15 },
      },
      {
        value: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        family: "haiku",
        status: "older",
        tier: "fast",
        // Haiku does not accept the effort parameter.
        reasoning: null,
        pricing: { input: 1, output: 5 },
      },
    ],
    // Retired/deprecated IDs → what replaces them: the newest of the same
    // family, so a stale saved selection self-heals onto a current model
    // instead of 404-ing at call time.
    retiredMap: {
      "claude-sonnet-4-20250514": "latest:sonnet",
      "claude-opus-4-20250514": "latest:opus",
      "claude-opus-4-1-20250805": "latest:opus",
      "claude-3-7-sonnet-20250219": "latest:sonnet",
      "claude-3-5-sonnet-20241022": "latest:sonnet",
      "claude-3-5-sonnet-20240620": "latest:sonnet",
      "claude-3-5-haiku-20241022": "latest:haiku",
      "claude-3-opus-20240229": "latest:opus",
      // Superseded by Fable 5.1, then 5.2, at the same price.
      "claude-fable-5": "latest:fable",
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

// Claude Code (CLI): authenticate via the user's logged-in Claude Code CLI
// session — no API key. Routed to the claude-agent engine, which the SDK runs
// through the CLI. Same Claude models as Anthropic; the CLI has no Models API,
// so the curated list is the source (listModels omitted → dispatcher falls back
// to curated). Defined after the literal so it can reuse Anthropic's models.
PROVIDERS["claude-code"] = {
  id: "claude-code",
  label: "Claude Code (CLI)",
  engine: "claude-agent",
  adapter: null,
  defaultModel: PROVIDERS.anthropic.defaultModel,
  curatedModels: PROVIDERS.anthropic.curatedModels,
  retiredMap: PROVIDERS.anthropic.retiredMap,
  // The fresh list of Anthropic's models covers this provider too.
  listKey: "anthropic",
};

const DEFAULT_PROVIDER = "anthropic";

// A saved model that follows the newest of a family: "latest:opus".
const LATEST_PREFIX = "latest:";

// The fresh list (modelList.js) by list key: { models, retiredMap }. Empty
// until one is fetched or loaded from its saved copy.
const freshLists = {};

function getProvider(providerId) {
  return PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
}

function listKeyOf(provider) {
  return provider.listKey || provider.id;
}

/** The provider's models: the fresh list when there is one, else built-in. */
function modelsOf(provider) {
  const fresh = freshLists[listKeyOf(provider)];
  return fresh ? fresh.models : provider.curatedModels;
}

function retiredMapOf(provider) {
  const fresh = freshLists[listKeyOf(provider)];
  return {
    ...(provider.retiredMap || {}),
    ...((fresh && fresh.retiredMap) || {}),
  };
}

/**
 * Use a fresh list for a provider's models; null (or an empty list) goes
 * back to the built-in one. `list` is { models, retiredMap }, already
 * checked by modelList.js.
 */
function setFreshList(listKey, list) {
  if (list && Array.isArray(list.models) && list.models.length) {
    freshLists[listKey] = {
      models: list.models.slice(),
      retiredMap: { ...(list.retiredMap || {}) },
    };
  } else {
    delete freshLists[listKey];
  }
}

function getCuratedModels(providerId) {
  return modelsOf(getProvider(providerId)).slice();
}

function getDefaultModel(providerId) {
  return getProvider(providerId).defaultModel;
}

function isLatestAlias(id) {
  return typeof id === "string" && id.startsWith(LATEST_PREFIX);
}

/** The saved id that follows the newest of a family ("latest:opus"). */
function latestAlias(family) {
  return `${LATEST_PREFIX}${family}`;
}

function aliasFamily(id) {
  return isLatestAlias(id) ? id.slice(LATEST_PREFIX.length) : null;
}

/** The newest model of a family that still runs, or null. */
function newestOfFamily(providerId, family) {
  const hit = modelsOf(getProvider(providerId)).find(
    (m) => m.family === family && m.status !== "retired",
  );
  return hit ? hit.value : null;
}

/**
 * The model a saved id runs on: "latest:<family>" → the newest of that
 * family; a retired id → its replacement, followed until one that runs; a
 * falsy id → the provider default; anything else unchanged.
 */
function migrateModelId(providerId, id) {
  if (!id) return getDefaultModel(providerId);
  const provider = getProvider(providerId);
  const map = retiredMapOf(provider);
  const models = modelsOf(provider);
  const seen = new Set();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const family = aliasFamily(current);
    if (family) {
      return newestOfFamily(providerId, family) || getDefaultModel(providerId);
    }
    if (map[current]) {
      current = map[current];
      continue;
    }
    const listed = models.find((m) => m.value === current);
    if (listed && listed.status === "retired" && listed.replacedBy) {
      current = listed.replacedBy;
      continue;
    }
    return current;
  }
  return current;
}

function isKnownRetired(providerId, id) {
  const provider = getProvider(providerId);
  if (retiredMapOf(provider)[id]) return true;
  const listed = modelsOf(provider).find((m) => m.value === id);
  return !!(listed && listed.status === "retired");
}

/**
 * A saved choice in words: "Latest Haiku, now Haiku 5.5" for a family,
 * "Haiku 5.5" for one model, else the id itself.
 */
function modelText(providerId, id) {
  const short = (m) => String(m.label || m.value).replace(/^Claude /, "");
  const family = aliasFamily(id);
  if (family) {
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    const newest = modelsOf(getProvider(providerId)).find(
      (m) => m.value === newestOfFamily(providerId, family),
    );
    return newest ? `Latest ${name}, now ${short(newest)}` : `Latest ${name}`;
  }
  const m = modelsOf(getProvider(providerId)).find((x) => x.value === id);
  return m ? short(m) : String(id || "");
}

/**
 * Whether a saved id is one this provider can run: a family it has, a model
 * in its list, or a retired one it knows the replacement of.
 */
function isKnownModel(providerId, id) {
  if (!id) return false;
  const family = aliasFamily(id);
  if (family) return !!newestOfFamily(providerId, family);
  if (modelsOf(getProvider(providerId)).some((m) => m.value === id)) {
    return true;
  }
  return migrateModelId(providerId, id) !== id;
}

/**
 * Narrow a list to what the provider's own Models API offers: a listed
 * model it doesn't offer is left out. One it offers that the list doesn't
 * know is added at the end as "older" (its place in its family unknown, so
 * never "Latest" or new) — unless it's a retired one. When the two share
 * nothing, the list is kept as it is.
 */
function mergeLive(listed, live, retiredMap = {}) {
  const liveIds = new Set((live || []).map((m) => m && m.value));
  const kept = listed.filter((m) => liveIds.has(m.value));
  if (!kept.length) return listed.slice();
  const known = new Set(listed.map((m) => m.value));
  const added = (live || [])
    .filter((m) => m && m.value && !known.has(m.value) && !retiredMap[m.value])
    .map((m) => {
      const fam = /^claude-([a-z]+)(?:-|$)/.exec(m.value);
      return {
        value: m.value,
        label: m.label || m.value,
        family: fam ? fam[1] : null,
        status: "older",
      };
    });
  return [...kept, ...added];
}

/**
 * List models for a provider: the fresh list (else the built-in one), each
 * with its family and status. With an API key the provider's Models API
 * narrows it to what that key can use. Never throws — always resolves to a
 * usable list.
 *
 * @returns {Promise<{ models: Array<{value,label,family,status}>, source: "live"|"curated" }>}
 */
async function listModels(providerId, creds = {}) {
  const provider = getProvider(providerId);
  const listed = modelsOf(provider).slice();
  if (provider.listModels && creds && creds.apiKey) {
    try {
      const live = await provider.listModels(creds);
      if (Array.isArray(live) && live.length > 0) {
        return {
          models: listed.length
            ? mergeLive(listed, live, retiredMapOf(provider))
            : live,
          source: "live",
        };
      }
    } catch (e) {
      console.warn(
        `[modelProviders] live model fetch failed for ${provider.id}: ${e.message}`,
      );
    }
  }
  return { models: listed, source: "curated" };
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  LATEST_PREFIX,
  getProvider,
  getCuratedModels,
  getDefaultModel,
  migrateModelId,
  isKnownRetired,
  isKnownModel,
  isLatestAlias,
  latestAlias,
  aliasFamily,
  newestOfFamily,
  modelText,
  setFreshList,
  mergeLive,
  listModels,
};
