/**
 * issueText — the words the Issues screens use for an issue (issues PRD):
 * when it happened, how often, the call, what it was asked with, where it
 * is. Pure: no React.
 */

const KIND_LABEL = { widget: "Widget", bot: "Bot", provider: "Provider" };

export const kindLabel = (kind) => KIND_LABEL[kind] || "Issue";

const toDate = (at) => {
  if (at == null || at === "") return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const clock = (d) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "8:02 AM" today, "Yesterday", else "Nov 3". */
export function whenText(at, now = new Date()) {
  const d = toDate(at);
  if (!d) return "";
  if (sameDay(d, now)) return clock(d);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Today 8:02 AM", "Yesterday 7:00 AM", "Nov 3, 7:00 AM". */
export function whenLongText(at, now = new Date()) {
  const d = toDate(at);
  if (!d) return "";
  if (sameDay(d, now)) return `Today ${clock(d)}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${clock(d)}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${clock(d)}`;
}

/** "12 times since 7:30 AM", or "" for one. */
export function countText(issue, now = new Date()) {
  const n = (issue && issue.count) || 1;
  if (n < 2) return "";
  const since = whenText(issue.firstAt, now);
  return since ? `${n} times since ${since}` : `${n} times`;
}

/** "Notes MCP › search_notes" — or "". */
export function callText(call) {
  if (!call) return "";
  return [call.provider, call.tool].filter(Boolean).join(" › ");
}

/** What a call was asked with, compact: `{ "query": "x" }` — or "". */
export function argsText(args) {
  if (args == null || args === "") return "";
  let value = args;
  if (typeof args === "string") {
    try {
      value = JSON.parse(args);
    } catch (_e) {
      return args;
    }
  }
  if (value && typeof value === "object" && !Object.keys(value).length)
    return "";
  try {
    const s = JSON.stringify(value);
    return s
      .replace(/^\{/, "{ ")
      .replace(/\}$/, " }")
      .replace(/":/g, '": ')
      .replace(/,"/g, ', "');
  } catch (_e) {
    return String(args);
  }
}

/** The error line: the call's error, else the issue's message. */
export /**
 * An error as people read it. Providers often answer with JSON
 * (`{ "success": false, "error": { "message", "suggestion" } }`), maybe after
 * a short prefix ("Error: {...}"): its message and its own suggestion are
 * pulled out; `raw` keeps the whole thing, formatted, for "Show raw".
 * Plain text comes back as it is, with no raw.
 * @returns {{ message: string, suggestion: string, raw: string }}
 */
function readableError(error) {
  const text =
    typeof error === "string"
      ? error.trim()
      : error == null
        ? ""
        : JSON.stringify(error);
  const plain = { message: text, suggestion: "", raw: "" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start || start > 80) return plain;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    return plain;
  }
  if (!obj || typeof obj !== "object") return plain;
  const inner = obj.error && typeof obj.error === "object" ? obj.error : {};
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const found =
    str(inner.message) ||
    str(obj.error) ||
    str(obj.message) ||
    str(obj.detail) ||
    str(obj.error_description) ||
    str(inner.code) ||
    str(obj.code);
  const suggestions = Array.isArray(inner.suggestions)
    ? inner.suggestions
    : Array.isArray(obj.suggestions)
      ? obj.suggestions
      : [];
  const suggestion =
    str(inner.suggestion) || str(obj.suggestion) || str(suggestions[0]);
  const prefix = text.slice(0, start).replace(/[\s:]+$/, "");
  const message = found
    ? prefix && !/^error$/i.test(prefix)
      ? `${prefix}: ${found}`
      : found
    : text;
  const raw = `${prefix ? `${prefix}\n` : ""}${JSON.stringify(obj, null, 2)}`;
  return { message, suggestion, raw };
}

/** The error to show: readable (a JSON answer's message), never raw JSON. */
export function errorText(issue) {
  if (!issue) return "";
  return readableError((issue.call && issue.call.error) || issue.message || "")
    .message;
}

/** The error as it came back, formatted — "" when it's plain text. */
export function rawErrorText(issue) {
  if (!issue) return "";
  return readableError((issue.call && issue.call.error) || issue.message || "")
    .raw;
}

/** One line for a list row: "Notes MCP › search_notes: ECONNREFUSED…". */
export function whatText(issue) {
  if (!issue) return "";
  const call = callText(issue.call);
  const err = errorText(issue);
  if (call && err) return `${call}: ${err}`;
  return err || issue.title || "";
}

/** Its name, for the row's first line. */
export function assetName(issue) {
  const a = (issue && issue.asset) || {};
  return (
    a.name ||
    (a.component ? String(a.component).split(".").pop() : "") ||
    a.provider ||
    kindLabel(a.kind)
  );
}

/** Where: "Life HQ", "Widget on Life HQ", or what it's used by. */
export function whereText(issue, { long = false } = {}) {
  const a = (issue && issue.asset) || {};
  if (a.kind === "provider") return issue.shown || (long ? "Provider" : "");
  const dash = a.dashboardName || "";
  if (!long) return dash;
  const kind = kindLabel(a.kind);
  return dash ? `${kind} on ${dash}` : kind;
}

/** The detail's sub line: "Widget on Life HQ · 12 times since 7:30 AM · last today 8:02 AM". */
export function detailLine(issue, now = new Date()) {
  const last = whenLongText(issue && issue.lastAt, now);
  return [
    whereText(issue, { long: true }),
    countText(issue, now),
    last ? `last ${last.charAt(0).toLowerCase()}${last.slice(1)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A provider issue about its sign-in (not one that couldn't start): its
 * `cause` says so. Older issues (no cause) only by the title the main
 * process gives them ("X: sign-in expired") — never by guessing from the
 * error text.
 */
export function isSignInIssue(issue) {
  if (!issue) return false;
  if (issue.cause) return issue.cause === "sign-in";
  return /sign-in expired$/i.test(String(issue.title || "").trim());
}

/**
 * Error text as quoted data for an AI draft: one line, clipped, in quotes,
 * so it reads as what the error said, not as instructions.
 */
export function quotedError(text, max = 400) {
  const one = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim();
  if (!one) return "";
  const clipped =
    one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
  return `"${clipped}"`;
}

/**
 * On the Providers page, drop the error's own "Check its settings on the
 * Providers page." tip — you're already there.
 */
export function withoutProvidersPageTip(text) {
  return String(text || "")
    .replace(/\s*Check its settings on the Providers page\.?\s*$/i, "")
    .trim();
}

/** The first line of a long text, clipped — for a timeline entry. */
export function firstLineClipped(text, max = 80) {
  const line = String(text || "")
    .split(/\r?\n/)[0]
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What Fix with AI hands the Dash team about a widget's issue. */
export function fixErrorText(issue) {
  if (!issue) return "";
  const call = callText(issue.call);
  const err = errorText(issue);
  const n = issue.count || 1;
  const times = n > 1 ? ` (${n} times)` : "";
  const head = call
    ? `${call} failed: ${err || "it reported an error"}${times}`
    : `${issue.title}${err ? `: ${err}` : ""}${times}`;
  const asked = issue.call ? argsText(issue.call.args) : "";
  return [
    head,
    asked ? `Asked with: ${asked}` : "",
    issue.shown ? `The widget showed: "${issue.shown}"` : "",
    issue.hint ? `Likely cause: ${issue.hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "1 problem", "3 problems". */
export const problemsText = (n) => `${n} problem${n === 1 ? "" : "s"}`;

/** "Muted since today 9:04 AM" — or "Muted". */
export function mutedSinceText(issue, now = new Date()) {
  const at = whenLongText(issue && issue.mutedAt, now);
  return at
    ? `Muted since ${at.charAt(0).toLowerCase()}${at.slice(1)}`
    : "Muted";
}

/** "214 times since you muted it", or that it hasn't happened since. */
export function mutedCountText(issue) {
  const n = (issue && issue.mutedCount) || 0;
  if (!n) return "It hasn't happened since you muted it.";
  return `${n} time${n === 1 ? "" : "s"} since you muted it`;
}
