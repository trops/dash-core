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

module.exports = {
  rememberToolGrant,
  forgetToolGrant,
  summarizeGrants,
  folderForPathArg,
};
