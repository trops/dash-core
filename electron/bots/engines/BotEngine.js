/**
 * BotEngine.js
 *
 * The provider-neutral engine contract for Bot Factory, plus a tiny registry.
 *
 * The bot runner never calls a vendor SDK directly — it resolves an engine by
 * id and drives it through this interface. Everything vendor-specific lives
 * behind an engine (and, for the tool-loop engine, behind per-provider
 * adapters). This is what lets a bot run on Anthropic, OpenAI, or xAI with the
 * same grants, approval flow, and UI.
 *
 * The types below are documentation (JSDoc) — this is CommonJS, not TypeScript.
 *
 * @typedef {Object} EngineCapabilities
 * @property {boolean} builtInTools   Engine ships its own file/shell tools.
 * @property {boolean} skills         Engine supports Claude-style skills.
 * @property {boolean} nativeSessions Engine resumes via a provider session id
 *                                    (vs. Bot-Factory-managed message history).
 *
 * @typedef {Object} RunContext
 * Built by the BotRunner and identical in shape for every engine.
 * @property {string}   [prompt]        The task prompt for this run.
 * @property {string}   model           Provider model id (already migrated).
 * @property {Object}   [credentials]   Decrypted provider credentials, e.g. { apiKey }.
 * @property {string}   [systemPrompt]  Optional system prompt.
 * @property {Array}    [tools]         MCP tool definitions the bot may call.
 * @property {Object}   [session]       Engine-owned resume state (e.g. { messages }).
 * @property {number}   [maxTurns]      Max tool-use rounds before giving up.
 * @property {AbortSignal} [signal]     Cooperative cancellation.
 * @property {(toolName: string, input: any) => Promise<{allow: boolean, reason?: string}>} requestPermission
 *           Gate every tool call routes through before executing.
 * @property {(toolName: string, input: any) => Promise<{text: string, isError?: boolean}>} executeTool
 *           Execute an approved tool call (wraps mcpController in production).
 *
 * BotEvent — the normalized stream every engine yields:
 *   { type: "text", text }
 *   { type: "tool_call", id, name, input }
 *   { type: "tool_result", id, name, output, isError }
 *   { type: "session", session }         // persisted for resume
 *   { type: "done", stopReason, usage }
 *   { type: "error", message, code }
 *
 * @typedef {Object} BotEngine
 * @property {string} id                 e.g. "tool-loop", "claude-agent"
 * @property {EngineCapabilities} capabilities
 * @property {(ctx: RunContext) => AsyncIterable<any>} run
 */
"use strict";

/** @type {Map<string, BotEngine>} */
const _engines = new Map();

/**
 * Register an engine. Throws on a malformed engine so a bad registration fails
 * loudly at startup rather than at first run.
 * @param {BotEngine} engine
 */
function registerEngine(engine) {
  if (!engine || typeof engine.id !== "string" || !engine.id) {
    throw new Error("registerEngine: engine.id (non-empty string) is required");
  }
  if (typeof engine.run !== "function") {
    throw new Error(`registerEngine: engine "${engine.id}" must have a run()`);
  }
  _engines.set(engine.id, engine);
  return engine;
}

/**
 * @param {string} id
 * @returns {BotEngine|null}
 */
function getEngine(id) {
  return _engines.get(id) || null;
}

/** @returns {string[]} registered engine ids */
function listEngines() {
  return [..._engines.keys()];
}

/** Test-only: clear the registry between cases. */
function _reset() {
  _engines.clear();
}

module.exports = { registerEngine, getEngine, listEngines, _reset };
