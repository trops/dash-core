/**
 * mcpServerKey.js
 *
 * Slice 3a: per-workspace MCP server process isolation.
 *
 * `mcpController.activeServers` was historically keyed by `serverName`
 * alone, so two workspaces using the same MCP server type (e.g. both
 * using `filesystem`) shared one process. Slice 3a keys by the
 * compound `(workspaceId, serverName)` so each workspace gets its
 * own process. Slice 3b will configure each process with the union
 * of grants from widgets on that workspace; for now, processes are
 * simply isolated.
 *
 * Format: `<workspaceId>::<serverName>`. The `::` separator is
 * unlikely to appear in a UUID-shaped workspace id; serverName is
 * everything after the first `::` so server names containing `::`
 * round-trip cleanly.
 *
 * Callers without a workspace context (legacy IPC, dash MCP server
 * tools, AI Builder previews) supply `null`/`undefined` and land on
 * the `NO_WORKSPACE` sentinel bucket — that's the pre-Slice-3 bucket.
 *
 * NOTE: workspaceId is renderer-supplied. Slice 3a uses it only as a
 * process-isolation key, NOT as a trust boundary. Slice 3b will tie
 * server scope (e.g. filesystem `--allowed` paths) to it; that's when
 * the trust boundary appears.
 */
"use strict";

const NO_WORKSPACE = "__no_workspace__";
const SEP = "::";

function serverKey(workspaceId, serverName) {
  if (typeof serverName !== "string" || !serverName) {
    throw new Error("serverKey: serverName is required");
  }
  const wid =
    typeof workspaceId === "string" && workspaceId ? workspaceId : NO_WORKSPACE;
  return wid + SEP + serverName;
}

function parseServerKey(key) {
  if (typeof key !== "string") {
    throw new Error("parseServerKey: key must be a string");
  }
  const idx = key.indexOf(SEP);
  if (idx < 0) {
    throw new Error(
      "parseServerKey: malformed key (no '::' separator): " + key,
    );
  }
  return {
    workspaceId: key.slice(0, idx),
    serverName: key.slice(idx + SEP.length),
  };
}

module.exports = {
  serverKey,
  parseServerKey,
  NO_WORKSPACE,
  SEP,
};
