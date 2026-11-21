/**
 * riskyTools.js — which provider tools delete or send (DASH-29). A run a
 * team lead started still asks before these, even for a bot set to "allow":
 * the lead passes on text from email, Slack and other bots, which can carry
 * instructions the user didn't write.
 *
 * Read-only tools (MCP readOnlyHint) never count. Otherwise a tool counts
 * when its provider's marks say it may destroy or reach outside (MCP
 * annotations: destructiveHint, which the spec takes as true unless set
 * false, or openWorldHint), or when its name says so (delete_model,
 * sendMessage, mcp__claude_ai_Gmail__send_message, sendmail). Most
 * providers mark nothing, so the name usually decides. When unsure, it
 * asks. Pure.
 */
"use strict";

const RISKY_WORDS = [
  "delete",
  "remove",
  "destroy",
  "drop",
  "trash",
  "purge",
  "erase",
  "wipe",
  "overwrite",
  "send",
  "post",
  "publish",
  "forward",
  "reply",
  "respond",
  "comment",
  "share",
  "invite",
  "schedule",
  "notify",
  "submit",
  "upload",
  "transfer",
  "pay",
  "merge",
  "push",
  "deploy",
  "execute",
  "exec",
  "run",
];

// "sendmail" and "deleteall" are one word that starts with one. Plurals and
// past forms ("posts", "shared") stay out: those name what a tool reads.
const ENDINGS = new Set(["", "all", "mail", "now"]);

/** The words in a tool's own name: "mcp__x__sendMessage" → ["send", "message"]. */
function nameWords(toolName) {
  const base = String(toolName || "")
    .split("__")
    .pop();
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function riskyWord(word) {
  return RISKY_WORDS.some(
    (r) => word.startsWith(r) && ENDINGS.has(word.slice(r.length)),
  );
}

/**
 * @param {string} toolName
 * @param {Map<string, object>} [toolsByName]  the run's tools, for annotations
 * @returns {boolean}
 */
function deletesOrSends(toolName, toolsByName) {
  const tool = toolsByName && toolsByName.get(toolName);
  const a = tool && tool.annotations;
  if (a && typeof a === "object") {
    if (a.readOnlyHint === true) return false;
    if (a.destructiveHint !== false || a.openWorldHint === true) return true;
  }
  return nameWords(toolName).some(riskyWord);
}

module.exports = { deletesOrSends, nameWords };
