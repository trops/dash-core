/**
 * rememberGrant.js — turn an "Always allow" bot approval into a durable grant,
 * and revoke it.
 *
 * Bot grants live in the shared grant store (electron/mcp/grantedPermissions)
 * keyed by botId, shape `{ servers: { [provider]: { tools, readPaths,
 * writePaths } } }`, and are enforced by the bot permission gate
 * (gateBotToolCall). A remembered approval is scoped to this bot + this
 * provider + this tool, plus — when the tool call carries a path argument —
 * the folder of that path (write folder for write tools, read folder
 * otherwise). Nothing broader.
 *
 * Pure (NFR-006): the gate's path rules (isWriteTool, path arg keys) and
 * `dirname` are injected so this matches the real gate exactly.
 */
"use strict";

const LISTING_TOOL = /(list|director|tree|search)/i;

/**
 * The folder to remember for a path argument: a `directory` arg, or a
 * directory-listing tool, names the folder itself; any other path is a file,
 * so its parent folder is remembered.
 */
function folderForPathArg(key, value, toolName, dirname) {
  if (key === "directory" || LISTING_TOOL.test(String(toolName || ""))) {
    return value;
  }
  return dirname(value);
}

const clone = (perms) =>
  perms && typeof perms === "object" ? JSON.parse(JSON.stringify(perms)) : {};

const addUnique = (list, value) =>
  list.includes(value) ? list : [...list, value];

/**
 * @param {object|null} perms  the bot's current grant (or null)
 * @param {{ serverName: string, toolName: string, args?: object }} call
 * @param {{ isWriteTool: Function, pathArgKeys: string[], dirname: Function }} helpers
 * @returns {object} the new grant (input is not mutated)
 */
function rememberToolGrant(perms, call, helpers) {
  const { serverName, toolName, args } = call;
  const next = clone(perms);
  next.grantOrigin = next.grantOrigin || "manual";
  next.servers = next.servers || {};
  const server = next.servers[serverName] || {
    tools: [],
    readPaths: [],
    writePaths: [],
  };
  server.tools = addUnique(server.tools || [], toolName);
  server.readPaths = server.readPaths || [];
  server.writePaths = server.writePaths || [];

  if (args && typeof args === "object") {
    const isWrite = helpers.isWriteTool(toolName);
    for (const key of helpers.pathArgKeys) {
      const v = args[key];
      if (typeof v !== "string" || !v) continue;
      const folder = folderForPathArg(key, v, toolName, helpers.dirname);
      if (isWrite) server.writePaths = addUnique(server.writePaths, folder);
      else server.readPaths = addUnique(server.readPaths, folder);
    }
  }

  next.servers[serverName] = server;
  return next;
}

/**
 * Revoke one remembered tool. When it was the provider's last remembered
 * tool, the provider entry (and its folders) is removed entirely.
 */
function forgetToolGrant(perms, serverName, toolName) {
  const server = perms && perms.servers && perms.servers[serverName];
  if (!server || !(server.tools || []).includes(toolName)) return perms;
  const next = clone(perms);
  const tools = next.servers[serverName].tools.filter((t) => t !== toolName);
  if (tools.length) next.servers[serverName].tools = tools;
  else delete next.servers[serverName];
  return next;
}

/** Remembered tools + folders per provider, for display in the bot form. */
function summarizeGrants(perms) {
  const out = {};
  const servers = (perms && perms.servers) || {};
  for (const [name, s] of Object.entries(servers)) {
    out[name] = {
      tools: [...(s.tools || [])],
      folders: [...(s.readPaths || []), ...(s.writePaths || [])],
    };
  }
  return out;
}

// Built-in tools "Always allow" can cover. Shell commands, file changes and
// web search always ask.
const WEB_FETCH = "WebFetch";

/**
 * The site and page a web fetch asks for, or null for a bad address. The
 * site is its origin — scheme, host and port — so allowing
 * https://example.com never covers http:// or another port.
 */
function webFetchTarget(input) {
  try {
    const u = new URL(String((input && input.url) || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return { host: u.hostname, site: u.origin, url: u.toString() };
  } catch (e) {
    return null;
  }
}

/** Can "Always allow" be offered for this ask? */
function canRemember(request) {
  if (!request || !request.botId || !request.toolName) return false;
  if (request.serverName) return true;
  return (
    request.toolName === WEB_FETCH && webFetchTarget(request.input) !== null
  );
}

/**
 * Remember a built-in web fetch: the whole site ("site", the default) or
 * only this page ("page"). Returns null when the ask can't be remembered.
 */
function rememberBuiltinGrant(perms, { toolName, input, scope }) {
  if (toolName !== WEB_FETCH) return null;
  const target = webFetchTarget(input);
  if (!target) return null;
  const next = clone(perms);
  next.grantOrigin = next.grantOrigin || "manual";
  next.domains = next.domains || {};
  const web = next.domains.webFetch || { hosts: [], urls: [] };
  if (scope === "page") web.urls = addUnique(web.urls || [], target.url);
  else web.hosts = addUnique(web.hosts || [], target.site);
  web.hosts = web.hosts || [];
  web.urls = web.urls || [];
  next.domains.webFetch = web;
  return next;
}

/** Does a remembered grant let this built-in call run without asking? */
function builtinAllowed(perms, toolName, input) {
  if (toolName !== WEB_FETCH) return false;
  const web = perms && perms.domains && perms.domains.webFetch;
  const target = webFetchTarget(input);
  if (!web || !target) return false;
  return (
    (web.hosts || []).includes(target.site) ||
    (web.urls || []).includes(target.url)
  );
}

/**
 * Take back folders an Always allow added to a provider (Undo), leaving
 * its tools and any other folders.
 */
function forgetFolders(perms, serverName, folders = []) {
  const server = perms && perms.servers && perms.servers[serverName];
  if (!server || !folders.length) return perms;
  const next = clone(perms);
  const s = next.servers[serverName];
  s.readPaths = (s.readPaths || []).filter((p) => !folders.includes(p));
  s.writePaths = (s.writePaths || []).filter((p) => !folders.includes(p));
  return next;
}

/** Revoke one remembered site (its origin) or page. */
function forgetBuiltinGrant(perms, toolName, { site, page }) {
  const web = perms && perms.domains && perms.domains.webFetch;
  if (toolName !== WEB_FETCH || !web) return perms;
  const next = clone(perms);
  const w = next.domains.webFetch;
  w.hosts = (w.hosts || []).filter((h) => h !== site);
  w.urls = (w.urls || []).filter((u) => u !== page);
  if (!w.hosts.length && !w.urls.length) delete next.domains.webFetch;
  return next;
}

/**
 * Everything a bot may do without asking, one row each, for its
 * Permissions: provider tools and remembered built-ins.
 */
function alwaysAllowedRows(perms) {
  const rows = [];
  const servers = (perms && perms.servers) || {};
  for (const [provider, s] of Object.entries(servers)) {
    const folders = [...(s.readPaths || []), ...(s.writePaths || [])];
    for (const tool of s.tools || []) {
      rows.push({ kind: "tool", provider, tool, folders });
    }
  }
  const web = perms && perms.domains && perms.domains.webFetch;
  if (web) {
    for (const site of web.hosts || []) {
      rows.push({ kind: "builtin", tool: WEB_FETCH, site });
    }
    for (const page of web.urls || []) {
      rows.push({ kind: "builtin", tool: WEB_FETCH, page });
    }
  }
  return rows;
}

module.exports = {
  rememberToolGrant,
  forgetToolGrant,
  summarizeGrants,
  folderForPathArg,
  WEB_FETCH,
  webFetchTarget,
  canRemember,
  rememberBuiltinGrant,
  builtinAllowed,
  forgetBuiltinGrant,
  forgetFolders,
  alwaysAllowedRows,
};
