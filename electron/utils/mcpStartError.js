/**
 * mcpStartError.js — explain why an MCP server failed to start.
 *
 * A stdio server that exits during startup (a missing token, a bad path)
 * surfaces from the MCP SDK as "MCP error -32000: Connection closed". The
 * real reason is on the server's stderr, e.g. Slack's
 *   {"level":"fatal","message":"Authentication required: …"}
 * This turns that into "Slack couldn't start: Authentication required: ….
 * Check its settings on the Providers page." — one trimmed line, with
 * anything that looks like a secret redacted.
 */
"use strict";

const NEXT_STEP = "Check its settings on the Providers page.";
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

// ---- a remote (http) server that couldn't be reached ----------------------

// Addresses on the local network (macOS asks before an app reaches them).
function isLocalNetworkHost(host) {
  const h = String(host || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (/\.local$/.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  // IPv6: link-local (fe80::/10), unique local (fc00::/7), or an IPv4
  // address written as IPv6 (::ffff:10.0.0.1, which URL shows as
  // ::ffff:a00:1). Only for real IPv6 addresses — never "fdic.gov".
  if (!h.includes(":")) return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isLocalNetworkHost([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (dotted) return isLocalNetworkHost(dotted[1]);
  return /^(fe[89ab]|fc|fd)/.test(h);
}

/**
 * The error and everything under it — fetch hides the reason in `cause`,
 * and trying an address's IPv4 and IPv6 at once fails with an
 * AggregateError whose `errors` hold each one.
 */
function causeChain(error) {
  const out = [];
  const queue = [error];
  while (queue.length && out.length < 12) {
    const e = queue.shift();
    if (!e || typeof e !== "object" || out.includes(e)) continue;
    out.push(e);
    if (e.cause) queue.push(e.cause);
    if (Array.isArray(e.errors)) queue.push(...e.errors);
  }
  return out;
}

/**
 * Why a remote MCP server couldn't be reached, in plain words — Node's
 * fetch says only "fetch failed" and keeps the reason in `cause`. Returns
 * null when it isn't a network error (the caller keeps its own message).
 *
 * @param {Error} error
 * @param {string} url  the server's address
 * @param {string} [platform]  process.platform
 * @returns {{message: string, fix?: "local-network"}|null}
 */
function describeNetworkFailure(error, url, platform = process.platform) {
  // The server answered (an HTTP error carries its status as a number):
  // not a network failure — its own words say more.
  if (error && typeof error.code === "number") return null;
  const chain = causeChain(error);
  const codes = chain.map((e) => (typeof e.code === "string" ? e.code : ""));
  // Message text only where the failure is the connection itself (fetch
  // failed, or a system error code) — never words from a server's reply.
  const transport =
    codes.some(Boolean) ||
    chain.some((e) => /^fetch failed$/i.test(String(e.message || "")));
  if (!transport) return null;
  const text = chain.map((e) => String(e.message || "")).join(" | ");
  const has = (re) => codes.some((c) => re.test(c)) || re.test(text);
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch (_e) {
    host = null;
  }
  let where = "that address";
  try {
    where = new URL(url).host;
  } catch (_e) {
    // keep "that address"
  }
  if (has(/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN/)) {
    // macOS blocking Dash and a device that's off look the same here.
    if (platform === "darwin" && isLocalNetworkHost(host)) {
      return {
        message: `Dash couldn't reach ${where} on your local network. If macOS is blocking Dash, allow it in System Settings › Privacy & Security › Local Network; otherwise check that the device is on.`,
        fix: "local-network",
      };
    }
    return {
      message: `Couldn't reach ${where} — check that it's on and on the same network.`,
    };
  }
  if (has(/ECONNREFUSED/)) {
    return {
      message: `Nothing is answering at ${where} — is the server running, and is the port right?`,
    };
  }
  if (has(/ENOTFOUND|EAI_AGAIN/)) {
    return { message: `Couldn't find ${where} — check the address.` };
  }
  if (has(/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/)) {
    return {
      message: `${where} didn't answer in time — check that it's on and reachable.`,
    };
  }
  if (has(/ECONNRESET|UND_ERR_SOCKET|socket hang up/)) {
    return {
      message: `${where} closed the connection — check the address and that the server is healthy.`,
    };
  }
  if (has(/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/)) {
    return {
      message: `${where}'s certificate isn't trusted. If the server only speaks http, use an http:// address.`,
    };
  }
  if (has(/ERR_INVALID_URL/) || /Invalid URL/i.test(text)) {
    return {
      message:
        "That address isn't a complete URL — it should look like http://192.168.1.20:8123/mcp.",
    };
  }
  if (/fetch failed/i.test(text)) {
    return { message: `Couldn't connect to ${where}.` };
  }
  return null;
}

module.exports = {
  describeStartFailure,
  describeNetworkFailure,
  isLocalNetworkHost,
  StderrTail,
};
