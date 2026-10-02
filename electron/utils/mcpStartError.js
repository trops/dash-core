/**
 * mcpStartError.js — explain why an MCP server failed to start.
 *
 * A stdio server that exits during startup (a missing token, a bad path)
 * surfaces from the MCP SDK as "MCP error -32000: Connection closed". The
 * real reason is on the server's stderr, e.g. Slack's
 *   {"level":"fatal","message":"Authentication required: …"}
 * This turns that into "Slack couldn't start: Authentication required: ….
 * Check its settings in Settings › Providers." — one trimmed line, with
 * anything that looks like a secret redacted.
 */
"use strict";

const NEXT_STEP = "Check its settings in Settings › Providers.";
const MAX_REASON = 300;

// SDK messages that say nothing about the cause.
const UNINFORMATIVE = /connection closed|-32000|process exited|terminated/i;
// A line worth showing.
const ERRORISH =
  /error|required|fatal|denied|not found|invalid|missing|unauthori[sz]ed|forbidden|failed/i;
// Noise around a crash: stack frames, Node banners, the npx wrapper.
const NOISE = [
  /^at\s/,
  /^node:/,
  /^Node\.js v/,
  /^throw\s/,
  /^\^+$/,
  /Command failed:/,
];

const SECRETS = [
  [/\bxox[a-z]-[A-Za-z0-9-]+/g, "[redacted]"], // Slack
  [/\bsk-[A-Za-z0-9_-]{10,}/g, "[redacted]"], // OpenAI / Anthropic style
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"], // GitHub
  [/\bBearer\s+\S+/gi, "Bearer [redacted]"],
  // Long random-looking strings (letters and digits mixed).
  [
    /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
    "[redacted]",
  ],
];

function redact(text) {
  return SECRETS.reduce((t, [re, sub]) => t.replace(re, sub), text);
}

function jsonReason(line) {
  if (!line.startsWith("{")) return null;
  try {
    const obj = JSON.parse(line);
    const level = String(obj.level || obj.severity || "").toLowerCase();
    const msg = obj.message || obj.msg || obj.error;
    if (typeof msg !== "string" || !msg.trim()) return null;
    if (level && !/fatal|error|crit|panic/.test(level)) return null;
    return msg.trim();
  } catch (_e) {
    return null;
  }
}

/** The most useful line of a failed server's stderr, or null. */
function reasonFromStderr(stderr) {
  const lines = String(stderr || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // A structured fatal/error log line is the most precise.
  for (let i = lines.length - 1; i >= 0; i--) {
    const r = jsonReason(lines[i]);
    if (r) return r;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (NOISE.some((re) => re.test(line))) continue;
    if (!ERRORISH.test(line)) continue;
    return line.replace(/^(Error|Fatal|FATAL|ERROR):\s*/, "");
  }
  return null;
}

/**
 * @param {{ serverName: string, message: string, stderr?: string|null }} args
 * @returns {string} the message to show
 */
function describeStartFailure({ serverName, message, stderr }) {
  if (message && !UNINFORMATIVE.test(message)) return message;
  const name = serverName || "The MCP server";
  const raw = reasonFromStderr(stderr);
  if (!raw)
    return `${name} couldn't start (it closed the connection). ${NEXT_STEP}`;
  let reason = redact(raw).replace(/[.\s]+$/, "");
  if (reason.length > MAX_REASON)
    reason = reason.slice(0, MAX_REASON).trimEnd() + "…";
  return `${name} couldn't start: ${reason}. ${NEXT_STEP}`;
}

/**
 * The last `limit` characters of a stream (a failed server's stderr), so a
 * chatty server can't grow memory without bound.
 */
class StderrTail {
  constructor(limit = 4096) {
    this._limit = limit;
    this._text = "";
  }

  push(chunk) {
    this._text += Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    if (this._text.length > this._limit) {
      this._text = this._text.slice(-this._limit);
    }
  }

  text() {
    return this._text;
  }
}

module.exports = { describeStartFailure, StderrTail };
