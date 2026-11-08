/**
 * toolSources.js — how a bot finds, starts, and uses the user's Dash MCP
 * providers (the integrations configured under Settings → Providers).
 *
 * Portable (no electron import — NFR-006): the MCP controller, provider store
 * and server map are injected by botController.
 *
 * Server reuse goes through the same `mcpController.startServer` factory the
 * dashboards use: a server already connected — or already starting — for a
 * given (workspace, server) bucket is reused, never spawned twice. Buckets are
 * per-workspace on purpose (each workspace's processes carry that workspace's
 * grants), so a bot uses its OWN bucket (its workspaceId, or the no-workspace
 * bucket) and never borrows a dashboard workspace's process.
 */
"use strict";

const { parseServerKey } = require("../utils/mcpServerKey");
const { connectorToolPrefix } = require("./claudeConnectors");

const NO_WORKSPACE = "__no_workspace__";

// A connector from the user's Claude account (claudeConnectors.js): nothing
// for Dash to start — the bot's Claude Code run reaches it.
const CONNECTOR_CLASS = "connector";

/** A Claude connector provider's account server ("claude.ai Gmail"). */
const connectorServerOf = (p) =>
  (p && p.mcpConfig && p.mcpConfig.server) || null;

/**
 * A Claude connector provider in the bot form's list. `connectors` is the
 * last listing of the account (null when not read yet): it gives the status
 * and the tool names.
 */
function connectorSource(p, connectors) {
  const server = connectorServerOf(p);
  const found = Array.isArray(connectors)
    ? connectors.find((c) => c.server === server)
    : null;
  const declared = Array.isArray(p.allowedTools);
  return {
    name: p.name,
    type: p.type || null,
    connector: true,
    server,
    status: found ? found.status : null,
    running: !!found && found.status === "connected",
    toolCount: found ? found.tools.length : null,
    declared,
    tools: declared
      ? [...p.allowedTools]
      : found
        ? found.tools.map((t) => t.name)
        : null,
  };
}

const normalizeWorkspace = (wid) =>
  typeof wid === "string" && wid && wid !== NO_WORKSPACE ? wid : null;

/**
 * Summarize mcpController's `activeServers` Map (keyed "<workspace>::<server>")
 * into connected servers with their REAL server name + workspace.
 */
function connectedServersFromMap(activeServers, connectedStatus) {
  const out = [];
  if (!activeServers || typeof activeServers.entries !== "function") return out;
  for (const [key, server] of activeServers.entries()) {
    if (!server || server.status !== connectedStatus) continue;
    let serverName = key;
    let workspaceId = null;
    try {
      const parsed = parseServerKey(key);
      serverName = parsed.serverName;
      workspaceId = normalizeWorkspace(parsed.workspaceId);
    } catch (_) {
      // Legacy un-prefixed key: treat as the no-workspace bucket.
    }
    out.push({
      serverName,
      workspaceId,
      tools: server.tools || [],
      resources: server.resources || [],
      status: server.status,
    });
  }
  return out;
}

const inBucket = (server, workspaceId) =>
  normalizeWorkspace(server.workspaceId) === normalizeWorkspace(workspaceId);

/**
 * The bot form's provider list: every configured MCP provider (credential-only
 * providers give a bot nothing to call, so they're excluded), with whether it's
 * running in the bot's bucket and its tool count when known.
 *
 * `tools` is what the form offers for per-bot narrowing: the provider's
 * declared `allowedTools` (set in Settings → Providers — known without starting
 * the server); for a provider with no declared limit, the live tool names if
 * it's running, else null (every tool, list not known yet). Never credentials.
 */
function listToolSources({
  providers,
  connected = [],
  workspaceId = null,
  connectors = null,
} = {}) {
  if (!Array.isArray(providers)) return [];
  return providers
    .filter(
      (p) =>
        p &&
        p.name &&
        (p.providerClass === "mcp" || p.providerClass === CONNECTOR_CLASS),
    )
    .map((p) => {
      if (p.providerClass === CONNECTOR_CLASS) {
        return connectorSource(p, connectors);
      }
      const live = (connected || []).find(
        (s) => s.serverName === p.name && inBucket(s, workspaceId),
      );
      const declared = Array.isArray(p.allowedTools);
      const liveNames = live
        ? (live.tools || []).map((t) => t && t.name).filter(Boolean)
        : null;
      return {
        name: p.name,
        type: p.type || null,
        running: !!live,
        toolCount: live ? (live.tools || []).length : null,
        declared,
        tools: declared ? [...p.allowedTools] : liveNames,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The tools a bot may use on one provider: the provider's declared limit
 * (Settings → Providers) is the ceiling; the bot's own selection narrows within
 * it. null = no restriction (every tool the server exposes).
 *
 * @param {string[]|null|undefined} providerLimit  provider.allowedTools
 * @param {string[]|null|undefined} selection      bot.toolSelections[provider]
 * @returns {string[]|null}
 */
function effectiveAllowedTools(providerLimit, selection) {
  const limit = Array.isArray(providerLimit) ? providerLimit : null;
  const sel = Array.isArray(selection) ? selection : null;
  if (limit && sel) return sel.filter((t) => limit.includes(t));
  if (limit) return [...limit];
  if (sel) return [...sel];
  return null;
}

/**
 * Before a run: start each of the bot's selected providers that isn't already
 * connected in the bot's bucket, via the shared startServer factory (which
 * itself dedupes concurrent starts). Never throws — returns per-provider
 * failures so the run can surface them instead of silently running without
 * those tools.
 */
async function ensureBotServers({
  bot,
  connected = [],
  getProvider,
  startServer,
}) {
  const failed = [];
  const wanted = Array.isArray(bot && bot.mcpServers) ? bot.mcpServers : [];
  const workspaceId = normalizeWorkspace(bot && bot.workspaceId);
  for (const serverName of wanted) {
    const running = (connected || []).some(
      (s) => s.serverName === serverName && inBucket(s, workspaceId),
    );
    if (running) continue;
    try {
      // providerController.getProvider returns { provider } or
      // { error, message }; accept a bare provider too.
      const result = await getProvider(serverName);
      if (result && result.error) {
        failed.push({
          serverName,
          message:
            result.message ||
            `Provider "${serverName}" was not found on the Providers page`,
        });
        continue;
      }
      const provider = result && result.provider ? result.provider : result;
      // A Claude connector has nothing to start: the run reaches it.
      if (provider && provider.providerClass === CONNECTOR_CLASS) continue;
      if (
        !provider ||
        provider.providerClass !== "mcp" ||
        !provider.mcpConfig
      ) {
        failed.push({
          serverName,
          message: `Provider "${serverName}" was not found on the Providers page`,
        });
        continue;
      }
      const res = await startServer(
        serverName,
        provider.mcpConfig,
        provider.credentials || {},
        workspaceId,
      );
      if (res && res.error) {
        failed.push({
          serverName,
          message: res.message || `Provider "${serverName}" failed to start`,
        });
      }
    } catch (err) {
      failed.push({
        serverName,
        message: (err && err.message) || String(err),
      });
    }
  }
  return { failed };
}

/**
 * The bot's MCP tools: only its selected providers, only from its own bucket,
 * and only the tools each provider allows (narrowed by the bot's own
 * selection). Also returns `allowedFor` — the per-provider whitelist the
 * caller passes to mcpController.callTool so a disallowed call is rejected
 * there too (same double enforcement widgets get).
 *
 * When `providerLimits` is given it is authoritative and fails closed: a
 * server with no entry (provider deleted, or provider info unreadable) gets no
 * tools. Omit it only where no provider info exists at all (unit callers).
 *
 * @param {{ bot, connected, providerLimits?: Record<string, string[]|null> }} args
 */
function resolveBotTools({ bot, connected = [], providerLimits }) {
  const wanted = new Set(
    Array.isArray(bot && bot.mcpServers) ? bot.mcpServers : [],
  );
  const selections = (bot && bot.toolSelections) || {};
  const workspaceId = bot && bot.workspaceId;
  const tools = [];
  const toolServer = Object.create(null);
  const allowedFor = Object.create(null);
  for (const server of connected || []) {
    const name = server.serverName;
    if (!wanted.has(name) || !inBucket(server, workspaceId)) continue;
    if (providerLimits && !(name in providerLimits)) continue; // fail closed
    const allowed = effectiveAllowedTools(
      providerLimits ? providerLimits[name] : undefined,
      selections[name],
    );
    allowedFor[name] = allowed;
    for (const tool of server.tools || []) {
      if (allowed && !allowed.includes(tool.name)) continue;
      tools.push(tool);
      toolServer[tool.name] = name;
    }
  }
  return { tools, toolServer, allowedFor };
}

/**
 * The Claude connectors a bot may use this run: its granted connector
 * providers, each with the tools it may call (the provider's limit narrowed
 * by the bot's selection). Tools are named as the CLI names them
 * ("mcp__claude_ai_Gmail__search_threads"), so they never clash with the
 * bot's other tools.
 *
 * @param {{ bot, providers, connectors }} args  providers: the provider
 *   list; connectors: the account listing (status + tools), or null.
 * @returns {{ connectors: {provider, server, allowed}[], toolServer,
 *   readOnly: string[], allowedFor, missing: string[] }}
 */
function resolveBotConnectors({ bot, providers, connectors }) {
  const wanted = new Set(
    Array.isArray(bot && bot.mcpServers) ? bot.mcpServers : [],
  );
  const selections = (bot && bot.toolSelections) || {};
  const out = [];
  const toolServer = Object.create(null);
  const allowedFor = Object.create(null);
  const readOnly = [];
  const missing = [];
  for (const p of providers || []) {
    if (!p || p.providerClass !== CONNECTOR_CLASS || !wanted.has(p.name)) {
      continue;
    }
    const server = connectorServerOf(p);
    if (!server) continue;
    const allowed = effectiveAllowedTools(p.allowedTools, selections[p.name]);
    allowedFor[p.name] = allowed;
    out.push({ provider: p.name, server, allowed });
    const found = Array.isArray(connectors)
      ? connectors.find((c) => c.server === server)
      : null;
    if (!found || found.status !== "connected") missing.push(p.name);
    const prefix = connectorToolPrefix(server);
    for (const t of (found && found.tools) || []) {
      if (allowed && !allowed.includes(t.name)) continue;
      toolServer[prefix + t.name] = p.name;
      if (t.readOnly) readOnly.push(prefix + t.name);
    }
  }
  return { connectors: out, toolServer, readOnly, allowedFor, missing };
}

/**
 * Last-line enforcement for a bot tool call. `allowedMap` is the
 * `allowedFor` from this bot's resolveBotTools. Fails closed: unknown bot,
 * unknown provider, or a tool outside the whitelist → rejected.
 *
 * @returns {{ ok: true, allowed: string[]|null } | { ok: false, message: string }}
 */
function checkToolCall(allowedMap, serverName, toolName) {
  if (
    !allowedMap ||
    !Object.prototype.hasOwnProperty.call(allowedMap, serverName)
  ) {
    return {
      ok: false,
      message: `Tool "${toolName}" is not available to this bot (provider "${serverName}" isn't one of its providers).`,
    };
  }
  const allowed = allowedMap[serverName];
  if (Array.isArray(allowed) && !allowed.includes(toolName)) {
    return {
      ok: false,
      message: `Tool "${toolName}" is not allowed for this bot on "${serverName}".`,
    };
  }
  return { ok: true, allowed: Array.isArray(allowed) ? allowed : null };
}

module.exports = {
  CONNECTOR_CLASS,
  resolveBotConnectors,
  checkToolCall,
  connectedServersFromMap,
  listToolSources,
  ensureBotServers,
  resolveBotTools,
  effectiveAllowedTools,
};
