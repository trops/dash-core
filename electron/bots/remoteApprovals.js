/**
 * remoteApprovals.js — tool approvals answered from outside Dash (DASH-32).
 *
 * A bot in a job started over MCP that waits on a tool approval shows up in
 * get_task_status as status "needs", with one plain line per approval; an
 * app connected over MCP may answer it with answer_approval (Allow once or
 * Deny, with the user's task passphrase). Dash names no channel: whatever
 * relays the question (a chat listener, a phone app) is the caller's.
 *
 * Only remote when all of: the tool is a provider's (never a built-in tool
 * like Bash or Write), and its job is a task given over MCP (give_task).
 * Approvals in conversations started in Dash, or in a question asked with
 * ask_team_lead, stay in Dash.
 *
 * get_task_status needs no passphrase, so `what` only ever shows what is
 * safe for anyone connected to see: a path's basename, a URL's host, a
 * name that reads as words — and nothing that looks like a secret.
 *
 * Pure: approvals, jobs and the clock are passed in.
 */
"use strict";

// Built-in tools: never answered from outside Dash, whatever they're called.
const BUILTIN_TOOLS = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
]);

// "Wait for approvals up to" (team setting), in hours.
const WAIT_HOURS = [1, 4, 12, 24];
const DEFAULT_WAIT_HOURS = 4;
const HOUR_MS = 60 * 60 * 1000;

// Arguments that name what a tool works on — never its contents. Checked
// in this order; the first that's safe to show wins.
const TARGET_KEYS = [
  "path",
  "file",
  "filepath",
  "file_path",
  "filename",
  "directory",
  "uri",
  "url",
  "name",
  "title",
  "id",
];
const PATH_KEYS = new Set([
  "path",
  "file",
  "filepath",
  "file_path",
  "filename",
  "directory",
]);
const URL_KEYS = new Set(["uri", "url"]);
const MAX_WHAT = 80;
// A name or title longer than this, with no space, isn't ordinary words.
const MAX_WORD = 40;

// What keys, tokens and credentials tend to start with.
const SECRET_PREFIX =
  /^(sk|pk|rk)[-_]|^xox[a-z]?-|^gh[pousr]_|^glpat-|^AKIA|^ASIA|^eyJ|^bearer\b|^basic\b|^token\b/i;

// How many answered approvals are remembered, so a late answer can say who
// got there first.
const ANSWERS_KEPT = 200;

/** A saved setting as one of the choices (4 h when unset or unknown). */
function waitHoursOf(value) {
  const n = Number(value);
  return WAIT_HOURS.includes(n) ? n : DEFAULT_WAIT_HOURS;
}

/** "search_emails" / "getFileInfo" / "mcp__fs__undo" → "Search emails" / "Get file info" / "Undo". */
function toolTitle(name) {
  const raw = String(name || "")
    .split("__")
    .pop();
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(" ");
  if (!words) return "a tool";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const oneLine = (s) =>
  String(s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A path's last part ("/a/b/notes.md" → "notes.md"), without a query. */
function baseName(value) {
  const s = String(value)
    .split(/[?#]/)[0]
    .replace(/[\\/]+$/, "");
  const last = s.split(/[\\/]/).pop();
  return last || s;
}

/**
 * Could this be a key, token or credential? When in doubt, yes: a known
 * prefix, user:password@, a long run of letters and digits with no space
 * (base64, hex, ids), or one word that mixes letters and digits.
 */
function looksSecret(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (SECRET_PREFIX.test(s)) return true;
  if (/[^\s/@]+:[^\s/@]*@/.test(s)) return true;
  if (/[A-Za-z0-9+/=]{20,}/.test(s)) return true;
  // One piece of 12+ characters with both letters and digits, or 16+ of
  // hex: token-like. (Pieces split on spaces, dots, - and _, so
  // "quarterly-report-v2.docx" still reads as a name.)
  for (const word of s.split(/[\s._-]+/)) {
    if (word.length >= 12 && /[A-Za-z]/.test(word) && /\d/.test(word)) {
      return true;
    }
    if (word.length >= 16 && /^[0-9a-f]+$/i.test(word)) return true;
  }
  return false;
}

/** A path argument: its basename, unless that could be a token. */
function pathTarget(v) {
  const name = oneLine(baseName(v));
  return name && !looksSecret(name) ? name : "";
}

/**
 * A URL argument: only its host — never who's signed in, the path, the
 * query or the fragment (webhook URLs carry their secret in the path). A
 * file: URL is a path. Not a URL: read as a path.
 */
function urlTarget(v) {
  const s = String(v).trim();
  let u = null;
  try {
    u = new URL(s);
  } catch (_e) {
    u = null;
  }
  if (!u) {
    // Something like a URL that didn't parse: nothing from it is safe.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
    return pathTarget(s);
  }
  if (u.protocol === "file:") return pathTarget(decodeURIComponent(u.pathname));
  const host = u.hostname;
  return host && !looksSecret(host) ? host : "";
}

/** A name, title or id: shown only when it reads as ordinary words. */
function nameTarget(v) {
  const text = oneLine(v);
  if (!text) return "";
  if (!/\s/.test(text) && text.length > MAX_WORD) return "";
  return looksSecret(text) ? "" : text;
}

/**
 * What the tool works on, from a name-, path- or URL-like argument only:
 * a path's basename, a URL's host, a name that reads as words. Never file
 * contents, a secret or the whole input — when in doubt, "" (just the
 * tool's title is shown).
 */
function targetOf(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of TARGET_KEYS) {
    const v = input[key];
    if (typeof v !== "string" && typeof v !== "number") continue;
    // Long or multi-line text isn't a name: it's content.
    if (/[\r\n]/.test(String(v)) || String(v).length > 500) continue;
    const text = PATH_KEYS.has(key)
      ? pathTarget(v)
      : URL_KEYS.has(key)
        ? urlTarget(v)
        : nameTarget(v);
    if (text) return text;
  }
  return "";
}

/** One plain line: the tool and what it works on ("Write file: notes.md"). */
function approvalWhat(request) {
  const req = request || {};
  const title = toolTitle(req.toolName);
  const target = targetOf(req.input);
  return clip(target ? `${title}: ${target}` : title, MAX_WHAT);
}

/**
 * Was this job a task given over MCP (give_task)? Only those: a question
 * asked with ask_team_lead (kind "mcp") never shows its approvals in
 * get_task_status, so it stays like Dash's own work (24 h, not remote).
 */
function startedOverMcp(job) {
  const kind = job && job.startedBy && job.startedBy.kind;
  return kind === "task";
}

/** A provider's tool (not a built-in one) in a task given over MCP. */
function isRemoteApproval(request, job) {
  const req = request || {};
  if (!req.serverName || BUILTIN_TOOLS.has(req.toolName)) return false;
  return startedOverMcp(job);
}

/** The job a bot's approval belongs to: the open one it has a running step in. */
function jobForBot(jobs, botId) {
  return (
    (jobs || []).find(
      (j) =>
        j &&
        j.status !== "done" &&
        j.status !== "failed" &&
        j.status !== "stopped" &&
        (j.steps || []).some(
          (s) => s.botId === botId && s.status === "running",
        ),
    ) || null
  );
}

/** An approval as get_task_status shows it. */
function approvalEntry(approval, { job, botName } = {}) {
  const req = (approval && approval.request) || {};
  return {
    approvalId: approval.id,
    bot: botName || "A bot",
    botId: req.botId || null,
    provider: req.serverName || null,
    tool: req.toolName || null,
    toolTitle: toolTitle(req.toolName),
    what: approvalWhat(req),
    askedAt: approval.createdAt
      ? new Date(approval.createdAt).toISOString()
      : null,
    remote: isRemoteApproval(req, job),
  };
}

/** A job's paused bots that a hand-on waits on. */
function pausedEntries(job) {
  return ((job && job.steps) || [])
    .filter((s) => s.status === "needs-you" && s.waiting === "paused")
    .map((s) => ({
      kind: "paused-bot",
      bot: s.botName || "A bot",
      botId: s.botId || null,
      remote: false,
    }));
}

/** One line for each thing the job waits on. */
function needsLine(entries) {
  return (entries || [])
    .map((e) =>
      e.kind === "paused-bot"
        ? `${e.bot} is paused; the user can turn it on in Dash.`
        : `${e.bot} is waiting for approval to use ${e.toolTitle}${
            e.provider ? ` on ${e.provider}` : ""
          }.`,
    )
    .join(" ");
}

/** The error a run stops with when its approval wasn't answered in time. */
function timeoutMessage({ toolName, provider, hours }) {
  return `Approval for ${toolTitle(toolName)}${
    provider ? ` on ${provider}` : ""
  } wasn't answered within ${hours} h`;
}

/** How an approval was settled, from the registry's decision. */
function answerOf(decision, at) {
  const d = decision || {};
  let via = d.via === "mcp" ? "mcp" : "dash";
  if (d.timedOut) via = "timeout";
  else if (!d.via && (d.reason === "run stopped" || d.reason === "Dash quit")) {
    via = "stopped";
  }
  return {
    via,
    answeredBy: via === "mcp" ? d.answeredBy || null : null,
    allow: !!d.allow,
    at: new Date(at).toISOString(),
  };
}

/** Recently answered approvals, newest kept: id → answerOf(…). */
function createAnswerLog({ limit = ANSWERS_KEPT } = {}) {
  const map = new Map();
  return {
    record(id, answer) {
      if (!id || map.has(id)) return;
      map.set(id, answer);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    get: (id) => map.get(id) || null,
    get size() {
      return map.size;
    },
  };
}

/** "It was already allowed once over MCP (by x) at …" — who and how. */
function alreadyAnsweredText(answer) {
  const a = answer || {};
  const when = a.at ? ` at ${a.at}` : "";
  if (a.via === "timeout") return `It already timed out${when}.`;
  if (a.via === "stopped") {
    return `The bot's run was stopped${when}, so it no longer waits.`;
  }
  const how = a.allow ? "allowed" : "denied";
  const where =
    a.via === "mcp"
      ? `over MCP${a.answeredBy ? ` by ${a.answeredBy}` : ""}`
      : "in Dash";
  return `It was already ${how} ${where}${when}.`;
}

module.exports = {
  BUILTIN_TOOLS,
  WAIT_HOURS,
  DEFAULT_WAIT_HOURS,
  HOUR_MS,
  ANSWERS_KEPT,
  waitHoursOf,
  toolTitle,
  targetOf,
  looksSecret,
  approvalWhat,
  startedOverMcp,
  isRemoteApproval,
  jobForBot,
  approvalEntry,
  pausedEntries,
  needsLine,
  timeoutMessage,
  answerOf,
  createAnswerLog,
  alreadyAnsweredText,
};
