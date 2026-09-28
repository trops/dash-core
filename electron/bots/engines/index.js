/**
 * engines/index.js
 *
 * Builds the Bot Factory engine registry. Requiring this module registers the
 * built-in engines; consumers resolve them via getEngine(id).
 *
 * At launch only the provider-neutral tool-loop engine is registered (covers
 * Anthropic + OpenAI + xAI via adapters). The Claude Agent SDK engine is a
 * later addition and will register here too.
 */
"use strict";

const { registerEngine, getEngine, listEngines } = require("./BotEngine");
const toolLoopEngine = require("./toolLoopEngine");

registerEngine(toolLoopEngine);

module.exports = { getEngine, listEngines, registerEngine };
