/**
 * mcpResult.js
 *
 * Normalizes an mcpController.callTool(...) return value into the
 * { text, images?, isError } shape the engines' executeTool contract expects
 * (`images` only when the tool returned some — see toolImages.js).
 * Mirrors the extraction in electron/controller/llmController.js so bot tool
 * results read the same as the AI Assistant's. Pure — no Electron.
 *
 * callTool returns either:
 *   { error: true, message }                          → { text: message, isError: true }
 *   { success: true, result: { content: [{type,text}] } } → joined text blocks
 *   { success: true, result: <string|other> }         → string or JSON fallback
 */
"use strict";

const { collectImages } = require("./toolImages");

/**
 * @param {object} mcpResult
 * @returns {{ text: string, images?: Array<{data: string, mimeType: string}>, isError: boolean }}
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

  // MCP standard: { content: [{ type: "text", text } | { type: "image", data, mimeType }] }
  if (result.content && Array.isArray(result.content)) {
    const textParts = result.content
      .filter((c) => c && c.type === "text")
      .map((c) => c.text);
    // Images go to the model (CAP-001); ones it can't take leave a note.
    const { images, notes } = collectImages(result.content);
    const text = [...textParts, ...notes].join("\n");
    return images.length
      ? { text, images, isError: !!result.isError }
      : { text, isError: !!result.isError };
  }

  if (typeof result === "string") return { text: result, isError: false };

  return { text: JSON.stringify(result), isError: false };
}

module.exports = { normalizeMcpResult };
