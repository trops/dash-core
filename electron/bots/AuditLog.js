/**
 * AuditLog.js
 *
 * The bots' saved audit log (bot-factory US-003 AC5, US-014 AC9, US-019 AC6):
 * approvals, tools that ran without asking, access changes, pause and stop,
 * budget changes, and bots created or deleted. Read in Manage › Bots › Log.
 *
 * Append-only, one JSON entry per line. When the file passes `maxBytes` it
 * becomes `<file>.1` (replacing the older one), so about 2 × maxBytes of
 * history is kept. Entries hold names only — never a tool's input, a prompt
 * or an answer.
 *
 * Portable (NFR-006): the file path, fs and clock are injected; no Electron.
 */
"use strict";

const path = require("path");

const DEFAULT_MAX_BYTES = 2.5 * 1024 * 1024;

// Entry type → kind (the Log's Kind filter).
const KIND_BY_TYPE = {
  "approval-asked": "approvals",
  "approval-allowed": "approvals",
  "approval-denied": "approvals",
  "ran-granted": "auto",
  "ran-policy": "auto",
  "ran-preapproved": "auto",
  "ran-read-only": "auto",
  "refused-unconfigured": "auto",
  "refused-paused": "auto",
  "grant-saved": "access",
  "grant-revoked": "access",
  "pause-bot": "pause",
  "resume-bot": "pause",
  "pause-all": "pause",
  "resume-all": "pause",
  "run-stopped": "pause",
  "runs-interrupted": "pause",
  "budget-set": "budgets",
  "budget-override": "budgets",
  "bot-created": "bots",
  "bot-deleted": "bots",
};

const KINDS = ["approvals", "auto", "access", "pause", "budgets", "bots"];

const kindOf = (type) => KIND_BY_TYPE[type] || null;

// The permission gate's outcomes that ran or refused a tool without asking.
// Approvals are logged where they're created (every engine's, built-in tools
// too); the bot's own internal tools aren't logged.
const GATE_TYPES = {
  granted: "ran-granted",
  "policy-allow": "ran-policy",
  "auto-allowed": "ran-preapproved",
  "read-only": "ran-read-only",
  "denied-unconfigured": "refused-unconfigured",
  paused: "refused-paused",
};

/**
 * A permission-gate decision as a log entry, or null when it isn't logged.
 * @param {object} e  the gate's audit entry
 */
function fromGateEntry(e) {
  const type = e && GATE_TYPES[e.outcome];
  if (!type) return null;
  return {
    type,
    botId: e.botId,
    tool: e.toolName || null,
    provider: e.serverName || null,
    ...(e.runStartedAt ? { runStartedAt: e.runStartedAt } : {}),
  };
}

/**
 * @param {{
 *   file: string,
 *   fs?: object,
 *   now?: () => string,
 *   maxBytes?: number,
 *   onError?: (err: Error) => void
 * }} opts
 */
function createAuditLog({
  file,
  fs = require("fs"),
  now = () => new Date().toISOString(),
  maxBytes = DEFAULT_MAX_BYTES,
  onError = (err) => console.error("[AuditLog]", err),
} = {}) {
  if (!file) throw new Error("AuditLog: file is required");
  const older = `${file}.1`;
  let seq = 0;
  let checkedEnd = false;

  const endsMidLine = () => {
    const n = size(file);
    if (!n) return false;
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, n - 1);
      return buf[0] !== 0x0a;
    } finally {
      fs.closeSync(fd);
    }
  };

  const size = (p) => {
    try {
      return fs.statSync(p).size;
    } catch (_e) {
      return 0;
    }
  };

  const linesOf = (p) => {
    let text = "";
    try {
      text = fs.readFileSync(p, "utf8");
    } catch (_e) {
      return [];
    }
    const out = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (_e) {
        // a torn last line (Dash quit mid-write) is skipped
      }
    }
    return out;
  };

  /**
   * Add an entry. Unknown types are ignored.
   * @returns {object|null} the saved entry
   */
  function append(entry) {
    if (!entry || !kindOf(entry.type)) return null;
    const at = now();
    seq += 1;
    const saved = {
      id: `${at}-${String(seq).padStart(6, "0")}`,
      at,
      kind: kindOf(entry.type),
      ...entry,
    };
    let line = `${JSON.stringify(saved)}\n`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // A torn last line (Dash quit mid-write) mustn't swallow this entry.
      if (!checkedEnd) {
        checkedEnd = true;
        if (endsMidLine()) line = `\n${line}`;
      }
      if (size(file) + line.length > maxBytes && size(file) > 0) {
        fs.renameSync(file, older);
      }
      fs.appendFileSync(file, line, "utf8");
      return saved;
    } catch (err) {
      onError(err);
      return null;
    }
  }

  /**
   * Newest first, filtered, one page at a time.
   * @param {{ botIds?: string[], kinds?: string[], before?: string,
   *   limit?: number }} [q]  before — the id of the last entry already shown
   * @returns {{ entries: object[], more: boolean }}
   */
  function read({ botIds = [], kinds = [], before = null, limit = 50 } = {}) {
    let all = [...linesOf(older), ...linesOf(file)].reverse();
    if (before) {
      const i = all.findIndex((e) => e.id === before);
      all = i === -1 ? [] : all.slice(i + 1);
    }
    const bots = new Set(botIds || []);
    const ks = new Set(kinds || []);
    const matches = all.filter(
      (e) => (!bots.size || bots.has(e.botId)) && (!ks.size || ks.has(e.kind)),
    );
    const n = Math.max(1, Math.min(Number(limit) || 50, 500));
    return { entries: matches.slice(0, n), more: matches.length > n };
  }

  return { append, read };
}

module.exports = { createAuditLog, fromGateEntry, kindOf, KINDS };
