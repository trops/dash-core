/**
 * connectionErrorText — a failed connection test's reason in plain words.
 * Network errors come back as "connect ECONNREFUSED 127.0.0.1:8080"; the
 * user gets what went wrong and what to check. Anything not recognized
 * passes through unchanged.
 */
function hostOf(url, message) {
  try {
    if (url) return new URL(url).host;
  } catch (_) {
    // not a full URL — fall back to the address in the message
  }
  const m = /\b(?:ECONNREFUSED|ETIMEDOUT)\s+(\S+)/.exec(message || "");
  if (m) return m[1];
  const n = /\b(?:ENOTFOUND|EAI_AGAIN)\s+(\S+)/.exec(message || "");
  return n ? n[1] : null;
}

const CONNECTION_ERRORS = [
  [
    /ECONNREFUSED/,
    (host) =>
      `Nothing is listening at ${host || "that address"}. Is the server running?`,
  ],
  [
    /ENOTFOUND|EAI_AGAIN/,
    (host) => `Couldn't find ${host || "that server"}. Check the address.`,
  ],
  [
    /\bE(SOCKET)?TIMEDOUT\b|\btimed out\b/i,
    (host) => `${host || "The server"} didn't answer in time.`,
  ],
  [/ECONNRESET|socket hang up/i, () => "The server closed the connection."],
  [
    /Unexpected server response: (401|403)/,
    () => "The server refused the credentials.",
  ],
  [
    /Unexpected server response: 404/,
    () => "There's no WebSocket at that address. Check the path.",
  ],
  [
    /CERT_|self[- ]signed|UNABLE_TO_VERIFY/i,
    () => "The server's certificate isn't trusted.",
  ],
  [/Invalid URL/i, () => "That address isn't a valid URL."],
];

/**
 * @param {string} message  the raw error message
 * @param {string} [url]    the address that was tried
 * @returns {string}
 */
export function connectionErrorText(message, url) {
  const raw = String(message || "").trim();
  for (const [pattern, text] of CONNECTION_ERRORS) {
    if (pattern.test(raw)) return text(hostOf(url, raw));
  }
  return raw;
}
