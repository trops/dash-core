/**
 * engines/index.js
 *
 * Builds the Bot Factory engine registry. Requiring this module registers the
 * built-in engines; consumers resolve them via getEngine(id).
 *
 * The provider-neutral tool-loop engine (covers Anthropic + OpenAI + xAI via
 * adapters) is the default. The Claude Agent SDK engine adds native file/shell
 * tools + SDK sessions for bots that opt in via their `engine` field.
 */
"use strict";

const { registerEngine, getEngine, listEngines } = require("./BotEngine");
const toolLoopEngine = require("./toolLoopEngine");
const claudeAgentEngine = require("./claudeAgentEngine");

registerEngine(toolLoopEngine);
registerEngine(claudeAgentEngine);

module.exports = { getEngine, listEngines, registerEngine };
