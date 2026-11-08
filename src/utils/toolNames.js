/**
 * toolNames — a bot tool's name as the user reads it. The Claude Code
 * engine names tools "mcp__<server>__<tool>": Dash's bridged providers
 * ("mcp__bot-mcp__search") and the user's Claude connectors
 * ("mcp__claude_ai_Google_Calendar__list_events"). Mirrors
 * electron/bots/claudeConnectors.js.
 */

/** "mcp__claude_ai_Gmail__search_threads" → "search_threads". */
export function shortToolName(name) {
  return String(name || "")
    .replace(/^mcp__claude_ai_[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*?__/, "")
    .replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
}

/** A Claude connector's tool as the engine names it. */
export function connectorToolName(server, tool) {
  return `mcp__${String(server || "").replace(/[^A-Za-z0-9_-]/g, "_")}__${tool}`;
}
