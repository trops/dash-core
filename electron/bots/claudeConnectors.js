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

// Reconnect waits longer: a connector coming back from sign-in is slow.
const RECONNECT_WAIT_MS = 45000;
// How long another Claude Code's version and account are remembered.
const OTHERS_TTL_MS = 10 * 60 * 1000;

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
      // Claude's own words when it couldn't connect it.
      error: s.error ? String(s.error) : null,
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
/** What a `claude auth status` says about the account, for the details. */
function accountOf(auth) {
  if (!auth || typeof auth !== "object") return null;
  return {
    loggedIn: !!auth.loggedIn,
    method: auth.authMethod || null,
    email: auth.email || null,
    plan: auth.subscriptionType || null,
  };
}

function createConnectorLister(deps) {
  const {
    loadQuery,
    resolveCli,
    readAuthStatus = async () => null,
    // The CLI's version ("2.1.305"), or null — for the details.
    readVersion = async () => null,
    // Every Claude Code on this computer: [path] — for the details.
    findClis = async () => [],
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

  /**
   * The other Claude Codes on this computer, each with its version and the
   * account it's signed in to — a different one may be the one with the
   * connectors.
   */
  // path → { at, value }: another Claude Code's version and account, read
  // at most every OTHERS_TTL_MS (each read runs that program twice).
  const othersSeen = new Map();
  async function otherOf(p) {
    const had = othersSeen.get(p);
    if (had && now() - had.at < OTHERS_TTL_MS) return had.value;
    const [version, account] = await Promise.all([
      Promise.resolve()
        .then(() => readVersion(p))
        .catch(() => null),
      Promise.resolve()
        .then(() => readAuthStatus(p))
        .then(accountOf)
        .catch(() => null),
    ]);
    const value = { path: p, version, account };
    othersSeen.set(p, { at: now(), value });
    return value;
  }
  async function othersThan(cliPath) {
    let paths = [];
    try {
      paths = (await findClis()) || [];
    } catch (_e) {
      paths = [];
    }
    return Promise.all(
      paths
        .filter((x) => x && x !== cliPath)
        .slice(0, 3)
        .map(otherOf),
    );
  }

  async function fetchList(opts = {}) {
    const started = now();
    let cliPath = null;
    try {
      cliPath = resolveCli();
    } catch (_e) {
      cliPath = null;
    }
    // What Dash checked (shown with the answer, and copied for help).
    const details = { cli: null, account: null, others: [], waitedMs: 0 };
    // The other Claude Codes only for the connector's own panel (a bot
    // run's listing never waits on them).
    const withDetails = async (state, extra = {}) => {
      details.others = opts.details ? await othersThan(cliPath) : [];
      details.waitedMs = Math.max(0, now() - started);
      return result(state, { ...extra, details });
    };
    if (!cliPath) {
      return withDetails("not-installed", {
        message: "Claude Code isn't installed on this computer.",
      });
    }
    let version = null;
    try {
      version = await readVersion(cliPath);
    } catch (_e) {
      version = null;
    }
    details.cli = { path: cliPath, version };
    // Signed in with a Claude account? (An API-key login has no connectors.)
    let auth = null;
    try {
      auth = await readAuthStatus(cliPath);
    } catch (_e) {
      auth = null;
    }
    details.account = accountOf(auth);
    if (auth && (!auth.loggedIn || auth.authMethod !== "claude.ai")) {
      return withDetails("not-signed-in", {
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
    const wait = opts.reconnect
      ? Math.max(opts.waitMs || 0, RECONNECT_WAIT_MS)
      : opts.waitMs || waitMs;
    const status = () => {
      let timer = null;
      return Promise.race([
        q.mcpServerStatus(),
        new Promise((_r, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Claude Code didn't answer. Try Reconnect.")),
            Math.max(0, wait + 5000),
          );
        }),
      ]).finally(() => clearTimeout(timer));
    };
    try {
      let list = await status();
      // Reconnect: Claude Code connects the account's connectors again —
      // the one asked for, or every one that isn't connected.
      if (opts.reconnect && typeof q.reconnectMcpServer === "function") {
        const asked =
          typeof opts.reconnect === "string" ? opts.reconnect : null;
        const again = list
          .filter(fromClaudeAi)
          .filter((x) => (asked ? x.name === asked : x.status !== "connected"));
        // Not listed yet: still try the one asked for.
        if (asked && !again.length) again.push({ name: asked });
        details.reconnected = [];
        for (const x of again) {
          try {
            let timer = null;
            await Promise.race([
              q.reconnectMcpServer(x.name),
              new Promise((_r, reject) => {
                timer = setTimeout(
                  () => reject(new Error("it didn't answer")),
                  RECONNECT_WAIT_MS,
                );
                if (timer && timer.unref) timer.unref();
              }),
            ]).finally(() => clearTimeout(timer));
            details.reconnected.push({ server: x.name, ok: true });
          } catch (err) {
            details.reconnected.push({
              server: x.name,
              ok: false,
              error: (err && err.message) || String(err),
            });
          }
        }
        list = await status();
      }
      // The account's connectors arrive a moment after the session starts,
      // then stay "pending" while they connect.
      const waiting = (l) =>
        l.some((s) => fromClaudeAi(s) && s.status === "pending") ||
        (!l.some(fromClaudeAi) && now() - started < APPEAR_MS);
      while (waiting(list) && now() - started < wait) {
        await new Promise((r) => setTimeout(r, pollMs));
        list = await status();
      }
      // Still connecting when the wait ran out: said, not taken as absent.
      details.stillConnecting = list
        .filter((x) => fromClaudeAi(x) && x.status === "pending")
        .map((x) => connectorDisplayName(x.name));
      return withDetails("ready", { connectors: connectorsFromStatus(list) });
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
   * @param {{ refresh?: boolean, maxAgeMs?: number, reconnect?: boolean|string,
   *   waitMs?: number }} [opts]  refresh: always ask again; maxAgeMs: reuse a
   *   cached list younger than this; reconnect: connect the account's
   *   connectors again (one by its server name, or every one not connected)
   *   and wait longer — never the cached answer.
   */
  async function list(opts = {}) {
    const fresh =
      cache &&
      !opts.refresh &&
      !opts.reconnect &&
      (opts.maxAgeMs == null ||
        now() - Date.parse(cache.checkedAt) <= opts.maxAgeMs);
    if (fresh) return cache;
    // A reconnect is its own check, after any one already running; a
    // plain listing joins the one running.
    if (inFlight && !opts.reconnect) return inFlight;
    const before = inFlight || Promise.resolve();
    const mine = before
      .catch(() => null)
      .then(() => fetchList(opts))
      .catch((err) =>
        result("error", {
          message:
            (err && err.message) || "Couldn't read your Claude connectors.",
        }),
      )
      .then((r) => {
        cache = r;
        if (inFlight === mine) inFlight = null;
        return r;
      });
    inFlight = mine;
    return mine;
  }

  return { list, cached: () => cache, forget: () => (cache = null) };
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
  RECONNECT_WAIT_MS,
};
