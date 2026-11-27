/**
 * aiLogin.js — is the AI a bot runs on signed in? (DASH-114)
 *
 * One cheap check per provider, for the setup check (preflight.js):
 *   claude-code  `claude auth status`: logged in, and the login's time limit
 *                (loginExpiresAt) not passed. No tokens spent.
 *   anthropic    GET /v1/models?limit=1 with the API key (free).
 *   openai, xai  GET /models with the API key (free).
 *
 * A login that's expired, refused or missing is a problem, with its fix.
 * What can't be told (an older CLI, a network hiccup, a 5xx) isn't: the
 * job then fails at its first bot as before, never held up by a guess.
 *
 * Pure apart from its deps, so the app and the tests run the same code.
 */
"use strict";

const LABELS = {
  "claude-code": "Claude Code",
  anthropic: "the Anthropic API",
  openai: "OpenAI",
  xai: "xAI",
};

const API_URLS = {
  anthropic: "https://api.anthropic.com/v1/models?limit=1",
  openai: "https://api.openai.com/v1/models",
  xai: "https://api.x.ai/v1/models",
};

const CLAUDE_FIX = "run `claude auth login` in a terminal, then try again";

function aiLabel(providerId) {
  return LABELS[providerId] || String(providerId || "the AI");
}

async function claudeCodeLogin({ resolveCli, readAuthStatus, now }) {
  let cli = null;
  try {
    cli = resolveCli ? resolveCli() : null;
  } catch (_e) {
    cli = null;
  }
  if (!cli) {
    return {
      ok: false,
      missing: true,
      problem: "isn't installed (Dash can't find the `claude` command)",
      fix: "install Claude Code, then run `claude auth login`",
    };
  }
  let status = null;
  try {
    status = readAuthStatus ? await readAuthStatus(cli) : null;
  } catch (_e) {
    status = null;
  }
  // An older CLI without `auth status`: can't tell.
  if (!status || typeof status !== "object") return { ok: true, unknown: true };
  if (!status.loggedIn) {
    return { ok: false, problem: "isn't logged in", fix: CLAUDE_FIX };
  }
  const ends = Date.parse(status.loginExpiresAt || "");
  if (!Number.isNaN(ends) && ends <= now()) {
    return {
      ok: false,
      expired: true,
      problem: `has a login that reached its time limit (${new Date(ends).toISOString()}) and can't be renewed`,
      fix: CLAUDE_FIX,
    };
  }
  return { ok: true };
}

async function apiKeyLogin(providerId, { apiKey, fetch, baseURL }) {
  if (!apiKey) {
    return {
      ok: false,
      missing: true,
      problem: "has no API key saved",
      fix:
        providerId === "anthropic"
          ? "add one in Settings › AI, or switch back to your Claude subscription"
          : "add one on the Providers page",
    };
  }
  if (typeof fetch !== "function") return { ok: true, unknown: true };
  const url =
    providerId !== "anthropic" && baseURL
      ? `${String(baseURL).replace(/\/+$/, "")}/models`
      : API_URLS[providerId];
  const headers =
    providerId === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${apiKey}` };
  let code = 0;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(10000)
        : undefined;
    const res = await fetch(url, { headers, ...(signal ? { signal } : {}) });
    code = res && res.status;
  } catch (_e) {
    // Can't reach it: can't tell.
    return { ok: true, unknown: true };
  }
  if (code === 401 || code === 403) {
    return {
      ok: false,
      problem: `refused its API key (HTTP ${code})`,
      fix:
        providerId === "anthropic"
          ? "replace the key in Settings › AI"
          : "replace the key on the Providers page",
    };
  }
  return { ok: true };
}

/**
 * Check one AI provider's login.
 * @param {string} providerId  claude-code | anthropic | openai | xai
 * @param {{ resolveCli?: () => string|null,
 *           readAuthStatus?: (cli) => Promise<object|null>,
 *           apiKey?: string|null, baseURL?: string|null,
 *           fetch?: Function, now?: () => number }} deps
 * @returns {Promise<{ ok: boolean, problem?: string, fix?: string,
 *                     missing?: boolean, expired?: boolean, unknown?: boolean }>}
 */
async function checkAiLogin(providerId, deps = {}) {
  const now = deps.now || Date.now;
  if (providerId === "claude-code") return claudeCodeLogin({ ...deps, now });
  if (API_URLS[providerId]) return apiKeyLogin(providerId, deps);
  return { ok: true, unknown: true };
}

module.exports = { checkAiLogin, aiLabel };
