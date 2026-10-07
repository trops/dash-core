/**
 * builtinServers/index.js
 *
 * Providers that run inside Dash instead of as a separate program
 * (`mcpConfig: { transport: "in_process", builtin: "<id>" }`). The server is
 * linked to Dash's MCP client in memory, so everything downstream of
 * mcpController.startServer — tool allow-lists, bot grants and approvals,
 * widgets, the Assistant, Settings' Test connection — works unchanged, and
 * nothing has to be installed on the user's machine.
 */
"use strict";

const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createWebFetchServer } = require("./webFetch");

/** id → (credentials, { serverName }) => McpServer */
const BUILTIN_SERVERS = {
  "web-fetch": createWebFetchServer,
};

function isBuiltinTransport(mcpConfig) {
  return !!mcpConfig && mcpConfig.transport === "in_process";
}

/**
 * Start a built-in server and return the client side of its in-memory link.
 * @param {object} mcpConfig    { transport: "in_process", builtin }
 * @param {object} credentials  this provider copy's saved settings
 * @param {{ serverName?: string }} opts
 */
async function createBuiltinTransport(mcpConfig, credentials, opts = {}) {
  const create = BUILTIN_SERVERS[mcpConfig && mcpConfig.builtin];
  if (!create) {
    throw new Error(
      `Unknown built-in provider: ${mcpConfig && mcpConfig.builtin}`,
    );
  }
  const server = create(credentials || {}, opts);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return clientSide;
}

module.exports = {
  BUILTIN_SERVERS,
  isBuiltinTransport,
  createBuiltinTransport,
};
