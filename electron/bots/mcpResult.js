/**
 * mcpResult.js
 *
 * Normalizes an mcpController.callTool(...) return value into the
 * { text, isError } shape the tool-loop engine's executeTool contract expects.
 * Mirrors the extraction in electron/controller/llmController.js so bot tool
 * results read the same as the AI Assistant's. Pure — no Electron.
 *
 * callTool returns either:
 *   { error: true, message }                          → { text: message, isError: true }
 *   { success: true, result: { content: [{type,text}] } } → joined text blocks
 *   { success: true, result: <string|other> }         → string or JSON fallback
 */
"use strict";

/**
 * @param {object} mcpResult
 * @returns {{ text: string, isError: boolean }}
 */
function normalizeMcpResult(mcpResult) {
  if (!mcpResult) return { text: "No result returned.", isError: true };
  if (mcpResult.error) {
    return { text: mcpResult.message || "Tool call failed.", isError: true };
  }

  const result = mcpResult.result;
  if (result === undefined || result === null) {
    return { text: "No result returned.", isError: false };
  }

  // MCP standard: { content: [{ type: "text", text }] }
  if (result.content && Array.isArray(result.content)) {
    const text = result.content
      .filter((c) => c && c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text, isError: !!result.isError };
  }

  if (typeof result === "string") return { text: result, isError: false };

  return { text: JSON.stringify(result), isError: false };
}

module.exports = { normalizeMcpResult };
