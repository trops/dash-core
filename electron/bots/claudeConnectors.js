/**
 * claudeConnectors.js — the connectors in the user's own Claude account
 * (claude.ai › Settings › Connectors: Gmail, Google Calendar, Slack, …), as
 * the user's signed-in Claude Code CLI reports them.
 *
 * A bot granted one ("Claude connector" provider) uses it inside its Claude
 * Code run — the CLI holds the sign-in; Dash never sees it. Only runs on the
 * Claude subscription get them: with an API key the CLI loads none.
 *
 * Listing asks the Agent SDK for its MCP server status with a session that
 * never sends a message: no model call, no cost.
 *
 * Portable (NFR-006): the SDK's query, the CLI lookup and the auth check are
 * injected; nothing here imports Electron.
 */
"use strict";

// The SDK's scope/source for servers that come from the claude.ai account.
const CLAUDE_AI_SCOPE = "claudeai";

// How long the listing waits for connectors still connecting.
const LIST_WAIT_MS = 15000;
const POLL_MS = 500;
// How long an account with no connectors yet is given for them to show up.
const APPEAR_MS = 5000;

// How long a run waits for its connectors to connect before it starts.
const CONNECT_WAIT_MS = 15000;
const CONNECT_POLL_MS = 250;

/**
 * Wait until a run's granted connectors have connected (or settled another
 * way: failed, needs-auth) before its task is sent. Claude Code loads the
 * account's connectors in the background, a second or so after it starts;
 * a task sent at once meets a model that has none of their tools (seen
 * live: "I have no Gmail tool"). Never throws; gives up after `timeoutMs`.
 *
 * @param {object} q  the SDK query (its mcpServerStatus)
 * @param {string[]} servers  the granted connectors ("claude.ai Gmail")
 * @returns {Promise<{ ready: boolean, statuses: {[server]: string} }>}
 */
async function waitForConnectors(
  q,
  servers,
  {
    timeoutMs = CONNECT_WAIT_MS,
    pollMs = CONNECT_POLL_MS,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const want = (Array.isArray(servers) ? servers : []).filter(Boolean);
  if (!want.length || !q || typeof q.mcpServerStatus !== "function") {
    return { ready: true, statuses: {} };
  }
  const started = now();
  let statuses = {};
  for (;;) {
    let list = null;
    try {
      let timer = null;
      list = await Promise.race([
        q.mcpServerStatus(),
        new Promise((resolve) => {
          timer = setTimeout(
            () => resolve(null),
            Math.max(0, timeoutMs - (now() - started)) + pollMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    } catch (_e) {
      list = null;
    }
    if (!Array.isArray(list)) break;
    statuses = {};
    for (const s of list) {
      if (s && want.includes(s.name)) statuses[s.name] = s.status;
    }
    if (want.every((n) => statuses[n] && statuses[n] !== "pending")) {
      return {
        ready: want.every((n) => statuses[n] === "connected"),
        statuses,
      };
    }
    if (now() - started >= timeoutMs) break;
    await sleep(pollMs);
  }
  return { ready: false, statuses };
}

/** The CLI's server key for a connector: "claude.ai Gmail" → "claude_ai_Gmail". */
function connectorServerKey(server) {
  return String(server || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

/** What the CLI calls a connector's tools start with. */
function connectorToolPrefix(server) {
  return `mcp__${connectorServerKey(server)}__`;
}

/** "claude.ai Google Calendar" → "Google Calendar". */
function connectorDisplayName(server) {
  return String(server || "").replace(/^claude\.ai\s+/i, "");
}

const fromClaudeAi = (s) =>
  s && (s.source === CLAUDE_AI_SCOPE || s.scope === CLAUDE_AI_SCOPE);

/**
 * The SDK's server status list → the user's connectors.
 * @returns {{ server, name, status, tools: {name, description, readOnly, destructive}[] }[]}
 */
function connectorsFromStatus(list) {
  return (Array.isArray(list) ? list : [])
    .filter(fromClaudeAi)
    .map((s) => ({
      server: s.name,
      name: connectorDisplayName(s.name),
      status: s.status,
      tools: (s.tools || [])
        .filter((t) => t && t.name)
        .map((t) => ({
          name: t.name,
          description: t.description || "",
          readOnly: !!(t.annotations && t.annotations.readOnly),
          destructive: !!(t.annotations && t.annotations.destructive),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The connectors a run must hide: every one in the account the bot isn't
 * granted, as whole-server rules ("mcp__claude_ai_Slack").
 */
function connectorDisallowList(allServers, grantedServers) {
  const granted = new Set(grantedServers || []);
  return (allServers || [])
    .filter((s) => s && !granted.has(s))
    .map((s) => `mcp__${connectorServerKey(s)}`);
}

/** The granted connector a CLI tool name belongs to, with the bare tool name. */
function connectorForTool(connectors, toolName) {
  if (typeof toolName !== "string") return null;
  for (const c of connectors || []) {
    const prefix = connectorToolPrefix(c.server);
    if (toolName.startsWith(prefix)) {
      return { connector: c, tool: toolName.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Whether a run profile (botController._resolveRunProfile) runs on the
 * user's Claude login — the only kind that has the account's connectors.
 */
function runsOnClaudeLogin(profile) {
  return (
    !!profile &&
    profile.engineId === "claude-agent" &&
    profile.providerId === "claude-code" &&
    !(profile.credentials && profile.credentials.apiKey)
  );
}

/** Why a run with Claude connectors can't go ahead off the subscription. */
function connectorNeedsSubscriptionMessage(connectors) {
  const names = (connectors || []).map((c) =>
    c.server ? connectorDisplayName(c.server) : c.provider,
  );
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : names[0] || "This provider";
  const one = names.length <= 1;
  return `${list} ${one ? "is a Claude connector" : "are Claude connectors"}, so ${one ? "it only works" : "they only work"} when this bot runs on your Claude subscription. Change Model source on this bot, or switch Settings › AI back to your subscription.`;
}

/**
 * A lister with a cache. `list()` resolves to
 *   { state: "ready", connectors, checkedAt }
 *   { state: "not-installed" | "not-signed-in" | "error", connectors: [], message, checkedAt }
 *
 * @param {{
 *   loadQuery: () => Promise<Function>,
 *   resolveCli: () => (string|null),
 *   readAuthStatus?: (cliPath: string) => Promise<object|null>,
 *   env?: object,
 *   waitMs?: number,
 *   pollMs?: number,
 *   now?: () => number,
 * }} deps
 */
function createConnectorLister(deps) {
  const {
    loadQuery,
    resolveCli,
    readAuthStatus = async () => null,
    waitMs = LIST_WAIT_MS,
    pollMs = POLL_MS,
    now = () => Date.now(),
  } = deps || {};
  let cache = null;
  let inFlight = null;

  const result = (state, extra = {}) => ({
    state,
    connectors: [],
    checkedAt: new Date(now()).toISOString(),
    ...extra,
  });

  async function fetchList() {
    let cliPath = null;
    try {
      cliPath = resolveCli();
    } catch (_e) {
      cliPath = null;
    }
    if (!cliPath) {
      return result("not-installed", {
        message: "Claude Code isn't installed on this computer.",
      });
    }
    // Signed in with a Claude account? (An API-key login has no connectors.)
    let auth = null;
    try {
      auth = await readAuthStatus(cliPath);
    } catch (_e) {
      auth = null;
    }
    if (auth && (!auth.loggedIn || auth.authMethod !== "claude.ai")) {
      return result("not-signed-in", {
        message: "Claude Code isn't signed in with a Claude account.",
      });
    }

    const query = await loadQuery();
    const env = { ...(deps.env || process.env) };
    env.ENABLE_CLAUDEAI_MCP_SERVERS = "true";
    // The subscription's connectors only: a key in the environment would
    // replace the Claude login.
    delete env.ANTHROPIC_API_KEY;

    // A session that never sends a message — status only, no model call.
    let release = () => {};
    const idle = (async function* () {
      await new Promise((r) => {
        release = r;
      });
    })();
    const options = { settingSources: [], tools: [], env };
    // The SDK spawns the path directly: a Windows .cmd shim won't start, so
    // there it uses its own CLI (same sign-in).
    if (process.platform !== "win32" || /\.exe$/i.test(cliPath)) {
      options.pathToClaudeCodeExecutable = cliPath;
    }
    const q = query({ prompt: idle, options });
    // A CLI that never answers (a first-run prompt, no network) is an
    // error, not a wait that holds every later listing.
    const status = () => {
      let timer = null;
      return Promise.race([
        q.mcpServerStatus(),
        new Promise((_r, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Claude Code didn't answer. Try Check again.")),
            Math.max(0, waitMs + 5000),
          );
        }),
      ]).finally(() => clearTimeout(timer));
    };
    try {
      const started = now();
      let list = await status();
      // The account's connectors arrive a moment after the session starts,
      // then stay "pending" while they connect.
      const waiting = (l) =>
        l.some((s) => fromClaudeAi(s) && s.status === "pending") ||
        (!l.some(fromClaudeAi) && now() - started < APPEAR_MS);
      while (waiting(list) && now() - started < waitMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        list = await status();
      }
      return result("ready", { connectors: connectorsFromStatus(list) });
    } finally {
      release();
      try {
        if (typeof q.close === "function") q.close();
        else if (typeof q.interrupt === "function") await q.interrupt();
      } catch (_e) {
        // Already ended.
      }
    }
  }

  /**
   * @param {{ refresh?: boolean, maxAgeMs?: number }} [opts]  refresh: always
   *   ask again; maxAgeMs: reuse a cached list younger than this.
   */
  async function list(opts = {}) {
    const fresh =
      cache &&
      !opts.refresh &&
      (opts.maxAgeMs == null ||
        now() - Date.parse(cache.checkedAt) <= opts.maxAgeMs);
    if (fresh) return cache;
    if (!inFlight) {
      inFlight = fetchList()
        .catch((err) =>
          result("error", {
            message:
              (err && err.message) || "Couldn't read your Claude connectors.",
          }),
        )
        .then((r) => {
          cache = r;
          inFlight = null;
          return r;
        });
    }
    return inFlight;
  }

  return { list, cached: () => cache };
}

/**
 * `claude auth status` → { loggedIn, authMethod, … }, or null when it can't
 * be read (an older CLI): the listing then just asks for the connectors.
 */
function readClaudeAuthStatus(cliPath) {
  return new Promise((resolve) => {
    let execFile;
    try {
      ({ execFile } = require("child_process"));
    } catch (_e) {
      resolve(null);
      return;
    }
    execFile(
      cliPath,
      ["auth", "status"],
      { timeout: 15000, shell: process.platform === "win32" },
      (err, stdout) => {
        try {
          const parsed = JSON.parse(String(stdout || "").trim());
          resolve(parsed && typeof parsed === "object" ? parsed : null);
        } catch (_e) {
          // Not JSON (an older CLI, or an error): unknown.
          resolve(null);
        }
      },
    );
  });
}

module.exports = {
  runsOnClaudeLogin,
  connectorNeedsSubscriptionMessage,
  readClaudeAuthStatus,
  CLAUDE_AI_SCOPE,
  connectorServerKey,
  connectorToolPrefix,
  connectorDisplayName,
  connectorsFromStatus,
  connectorDisallowList,
  connectorForTool,
  createConnectorLister,
  waitForConnectors,
  CONNECT_WAIT_MS,
};
