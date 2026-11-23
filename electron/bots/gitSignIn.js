/**
 * gitSignIn.js — a bot's git and gh sign-in comes from its GitHub provider
 * (DASH-55, Code Factory G4).
 *
 * The computer Dash runs on may have no git login at all. A bot that has a
 * GitHub provider (Settings → Providers, the token pasted once) gets that
 * token for its run only:
 *
 *   - git, through a credential helper set in the run's environment (never a
 *     file): for https://github.com only, ahead of any helper the computer
 *     already has (a keychain login for another account doesn't win), and
 *     nothing is ever stored;
 *   - github.com SSH addresses (git@github.com:owner/repo) go over https, so
 *     they use it too, with no SSH key needed;
 *   - gh, as GH_TOKEN.
 *
 * The token is in the run's environment, so the bot's commands can use it;
 * it's taken out of everything the run shows or keeps (redact).
 */
"use strict";

const GITHUB_TYPE = "github";
const TOKEN_VAR = "DASH_GIT_TOKEN";

// Prints the token only when git asks for it (get), never on store/erase.
const HELPER = `!f() { if [ "$1" = get ]; then echo username=x-access-token; echo "password=$${TOKEN_VAR}"; fi; }; f`;

/**
 * The token of the bot's GitHub provider, or null. Looks at the bot's own
 * providers only (bot.mcpServers), the first GitHub one with a token.
 * @param {{ bot: object, getProvider: (name: string) => Promise<object> }} args
 */
async function gitTokenFor({ bot, getProvider }) {
  const names = Array.isArray(bot && bot.mcpServers) ? bot.mcpServers : [];
  for (const name of names) {
    let result;
    try {
      result = await getProvider(name);
    } catch (_e) {
      continue;
    }
    const p = result && result.provider ? result.provider : result;
    if (!p || p.error || p.type !== GITHUB_TYPE) continue;
    const token = p.credentials && p.credentials.token;
    if (typeof token === "string" && token.trim()) return token.trim();
  }
  return null;
}

/**
 * Environment additions that sign git and gh in with `token`. `env` is the
 * environment they're added to (its own GIT_CONFIG_* entries are kept).
 * @returns {object} the variables to add
 */
function gitSignInEnv(token, env = {}) {
  if (typeof token !== "string" || !token) return {};
  const start = Math.max(0, Math.floor(Number(env.GIT_CONFIG_COUNT)) || 0);
  const entries = [
    // An empty helper first clears the computer's own for github.com.
    ["credential.https://github.com.helper", ""],
    ["credential.https://github.com.helper", HELPER],
    ["url.https://github.com/.insteadOf", "git@github.com:"],
    ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
  ];
  const out = {
    [TOKEN_VAR]: token,
    GH_TOKEN: token,
    // No password prompt nobody can answer: a bad token fails at once.
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(start + entries.length),
  };
  entries.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${start + i}`] = key;
    out[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return out;
}

/** `value` with every copy of the token replaced, deeply (strings, arrays, objects). */
function redact(value, token) {
  if (typeof token !== "string" || token.length < 8) return value;
  const hide = (v) => {
    if (typeof v === "string")
      return v.includes(token) ? v.split(token).join("[GitHub token]") : v;
    if (Array.isArray(v)) return v.map(hide);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = hide(x);
      return o;
    }
    return v;
  };
  return hide(value);
}

// What git and gh say when the sign-in is refused.
const SIGN_IN_FAILED = [
  /Authentication failed for 'https:\/\/github\.com/i,
  /could not read Username for 'https:\/\/github\.com'/i,
  /remote: Invalid username or (password|token)/i,
  /HTTP 401: Bad credentials/i,
  /Permission to [^\s]+ denied to /i,
  /remote: Repository not found\./i,
];

/** A plain message when `text` (a command's output) is a refused GitHub sign-in, else null. */
function signInProblem(text, { hasToken }) {
  const s = String(text || "");
  if (!SIGN_IN_FAILED.some((re) => re.test(s))) return null;
  return hasToken
    ? "GitHub refused the sign-in: check the token in this bot's GitHub provider (Settings → Providers). It may have expired, or not cover this repository."
    : "GitHub needs a sign-in: give this bot a GitHub provider with a token (Settings → Providers), then run again.";
}

module.exports = {
  GITHUB_TYPE,
  gitTokenFor,
  gitSignInEnv,
  redact,
  signInProblem,
};
