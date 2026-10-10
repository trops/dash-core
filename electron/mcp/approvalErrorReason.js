/**
 * approvalErrorReason — the deny reason when a permission prompt
 * (jitConsent.requestApproval) doesn't produce an answer.
 *
 * The mcp, fs and network gates all return this text to the widget, which
 * shows it to the user. A timeout used to read "JIT consent JIT consent
 * timed out for <id> (mcp/callTool) after 60000ms".
 */
"use strict";

/** 300000 → "5 minutes", 45000 → "45 seconds". */
function formatWait(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * @param {Error} e  what requestApproval rejected with
 * @param {string} subject  what was asked for, e.g. "'search' on 'Google Drive'"
 */
function approvalErrorReason(e, subject) {
  if (e && e.code === "JIT_TIMEOUT") {
    return (
      `Permission request for ${subject} expired — ` +
      `no answer within ${formatWait(e.timeoutMs)}. Try again.`
    );
  }
  return (
    "Permission request failed: " +
    (e && e.message ? e.message : "unknown error")
  );
}

module.exports = { approvalErrorReason, formatWait };
