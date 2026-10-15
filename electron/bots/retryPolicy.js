/**
 * retryPolicy.js — which failed runs are worth trying again, and when
 * (bot-factory US-023 AC1/AC2).
 *
 * Temporary trouble — rate limits, an overloaded or erroring provider,
 * timeouts, a dropped connection — is retried with a growing, jittered wait
 * (honoring the provider's retry-after). Anything else — a bad key, an
 * invalid request, no credit — fails at once: trying again can't fix it.
 *
 * Pure (NFR-006): the random source is injected for tests.
 */
"use strict";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;
const MAX_RETRY_AFTER_MS = 60000;

// Problems another try can't fix. Checked first, so "quota exceeded" isn't
// mistaken for a rate limit.
const PERMANENT =
  /\b40[0134]\b|invalid[_ ]request|authentication|unauthori[sz]ed|forbidden|api[ -]?key|x-api-key|credit balance|insufficient[_ ]quota|exceeded your current quota|billing|model.{0,20}not found|not_found_error|no ai model chosen/i;
const PERMANENT_CODES = new Set([
  "CLAUDE_CLI_NOT_FOUND",
  "MODEL_NO_IMAGES",
  "RUNNER_ERROR",
]);

// Trouble that passes: [label, pattern].
const TRANSIENT = [
  ["Overloaded", /\b529\b|overloaded/i],
  ["Rate limited", /\b429\b|rate[ _-]?limit|too many requests/i],
  [
    "Timed out",
    /\b408\b|timed? ?out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT|deadline exceeded/i,
  ],
  [
    "Connection dropped",
    /ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error|connection (error|closed|reset|lost)|premature close|stream (ended|closed|terminated|interrupted)|terminated unexpectedly/i,
  ],
  [
    "Server error",
    /\b50[0-4]\b|internal server error|bad gateway|service unavailable|gateway timeout|api_error/i,
  ],
];

const STATUS_LABEL = (status) =>
  status === 529
    ? "Overloaded"
    : status === 429
      ? "Rate limited"
      : status === 408
        ? "Timed out"
        : "Server error";

/**
 * Is this failure temporary — worth another try?
 * @param {{ message?: string, code?: string, status?: number }} err
 * @returns {{ transient: boolean, label: string|null }}
 */
function classifyError(err) {
  const e = err || {};
  const text = `${e.message || ""} ${e.code || ""}`;
  if (PERMANENT_CODES.has(e.code)) return { transient: false, label: null };
  const status = typeof e.status === "number" ? e.status : null;
  if (status !== null) {
    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      return { transient: true, label: STATUS_LABEL(status) };
    }
    if (status >= 400) return { transient: false, label: null };
  }
  if (PERMANENT.test(text)) return { transient: false, label: null };
  for (const [label, re] of TRANSIENT) {
    if (re.test(text)) return { transient: true, label };
  }
  return { transient: false, label: null };
}

/**
 * How long to wait before the next attempt: ~2s after the first failure,
 * ~8s after the second (±25% jitter), capped — or the provider's
 * retry-after when it gave one.
 * @param {number} failedAttempt  1 for the first failure
 * @param {number|null} [retryAfterMs]
 * @param {() => number} [random]
 * @returns {number} ms
 */
function retryDelay(failedAttempt, retryAfterMs = null, random = Math.random) {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(Math.round(retryAfterMs), MAX_RETRY_AFTER_MS);
  }
  const base = BASE_DELAY_MS * Math.pow(4, Math.max(0, failedAttempt - 1));
  const jittered = base * (0.75 + random() * 0.5);
  return Math.min(Math.round(jittered), MAX_DELAY_MS);
}

/**
 * The status and retry-after (ms) carried by a provider SDK error, for an
 * engine's error event.
 * @param {any} err
 * @returns {{ status?: number, retryAfterMs?: number }}
 */
function errorDetails(err) {
  const out = {};
  if (!err || typeof err !== "object") return out;
  if (typeof err.status === "number") out.status = err.status;
  const h = err.headers;
  let raw = null;
  if (h && typeof h.get === "function") raw = h.get("retry-after");
  else if (h && typeof h === "object") raw = h["retry-after"];
  if (raw !== null && raw !== undefined && raw !== "") {
    const secs = Number(raw);
    if (Number.isFinite(secs)) out.retryAfterMs = secs * 1000;
    else {
      const at = Date.parse(String(raw));
      if (!Number.isNaN(at)) out.retryAfterMs = Math.max(0, at - Date.now());
    }
  }
  return out;
}

module.exports = {
  MAX_ATTEMPTS,
  classifyError,
  retryDelay,
  errorDetails,
};
