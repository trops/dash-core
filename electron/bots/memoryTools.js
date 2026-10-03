/**
 * memoryTools.js
 *
 * Exposes BotMemory to bots as in-process tools (PRD FR-010): memory_get /
 * memory_set / memory_list / memory_delete. These are served under a virtual
 * "bot-memory" server that the bot PermissionGate auto-allows (it's the bot's
 * own sandbox, not an external action), so no consent prompt is required.
 *
 * Portable (NFR-006): no Electron. botController wires a BotMemory instance and
 * the calling bot's scope, and routes MEMORY_SERVER tool calls here. The result
 * shape matches the tool-loop engine's executeTool contract: { text, isError }.
 */
"use strict";

const MEMORY_SERVER = "bot-memory";

const SCOPE_PROP = {
  type: "string",
  enum: ["workspace", "global"],
  description:
    "Which memory scope to use: 'workspace' (default — your team's shared memory, or private to you if you're not on a dashboard's team) or 'global' (shared across all your bots).",
};

const MEMORY_TOOLS = [
  {
    name: "memory_set",
    description:
      "Store a value in your durable memory under a key. Persists across runs so you can recall it later.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to store the value under." },
        value: { description: "The value to store (any JSON)." },
        scope: SCOPE_PROP,
      },
      required: ["key", "value"],
    },
  },
  {
    name: "memory_get",
    description:
      "Retrieve a value previously stored with memory_set. Returns the value, or a note if nothing is stored.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to look up." },
        scope: SCOPE_PROP,
      },
      required: ["key"],
    },
  },
  {
    name: "memory_list",
    description:
      "List the keys currently in your memory, optionally filtered by a key prefix.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Only list keys with this prefix.",
        },
        scope: SCOPE_PROP,
      },
    },
  },
  {
    name: "memory_delete",
    description: "Delete a key from your memory.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to delete." },
        scope: SCOPE_PROP,
      },
      required: ["key"],
    },
  },
];

function ok(text) {
  return { text, isError: false };
}
function fail(text) {
  return { text, isError: true };
}

/**
 * Execute a memory_* tool call in-process.
 * @param {import("./BotMemory").BotMemory} memory
 * @param {{ workspaceId?: string|number, botId?: string }} ctx  the calling bot
 * @param {string} toolName
 * @param {object} args
 * @returns {{ text: string, isError: boolean }}
 */
function handleMemoryTool(memory, ctx, toolName, args = {}) {
  // "workspace" is the team's shared memory; a bot with no dashboard gets its
  // own private bucket instead of sharing one with every other such bot.
  const ws = ctx && ctx.workspaceId;
  const onTeam = ws !== null && ws !== undefined && ws !== "";
  let scope;
  let id;
  if (args && args.scope === "global") {
    scope = "global";
    id = null;
  } else if (onTeam) {
    scope = "workspace";
    id = String(ws);
  } else {
    scope = "bot";
    id = ctx && ctx.botId;
  }
  const label = scope === "bot" ? "private" : scope;
  try {
    switch (toolName) {
      case "memory_set": {
        if (!args || !args.key) return fail("memory_set requires a 'key'.");
        const entry = memory.set(scope, id, args.key, args.value);
        return ok(`Stored '${args.key}' (${label}, v${entry.version}).`);
      }
      case "memory_get": {
        if (!args || !args.key) return fail("memory_get requires a 'key'.");
        const value = memory.get(scope, id, args.key);
        if (value === undefined)
          return ok(`No value stored for '${args.key}' (${label}).`);
        return ok(typeof value === "string" ? value : JSON.stringify(value));
      }
      case "memory_list": {
        const entries = memory.list(scope, id, args && args.prefix);
        if (!entries.length) return ok(`No memory keys stored (${label}).`);
        return ok(entries.map((e) => `${e.key} (v${e.version})`).join("\n"));
      }
      case "memory_delete": {
        if (!args || !args.key) return fail("memory_delete requires a 'key'.");
        const removed = memory.delete(scope, id, args.key);
        return ok(
          removed
            ? `Deleted '${args.key}' (${label}).`
            : `No value to delete for '${args.key}' (${label}).`,
        );
      }
      default:
        return fail(`Unknown memory tool '${toolName}'.`);
    }
  } catch (e) {
    return fail(`Memory tool error: ${(e && e.message) || e}`);
  }
}

module.exports = { MEMORY_SERVER, MEMORY_TOOLS, handleMemoryTool };
