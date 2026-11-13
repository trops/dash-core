/**
 * issueSources.js
 *
 * Each place something goes wrong, turned into an issue the store records
 * (issues PRD ISS-001): a widget's provider call, a widget that crashed or
 * was stopped, a bot run that failed or warned, a provider that couldn't
 * start or whose sign-in expired. Each says, in plain words, the likely
 * cause when the error text shows one.
 *
 * Pure (NFR-006).
 */
"use strict";

/** "PageReader" → "Page Reader": a widget's name when it has no title. */
function displayName(component) {
  const bare =
    String(component || "")
      .split(".")
      .pop() || "";
  return bare
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/**
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

/** "Home Assistant MCP suggests: …" from a JSON answer — or "". */
function suggestionHint(error, provider) {
  const { suggestion } = readableError(error);
  return suggestion
    ? `${provider || "The provider"} suggests: ${suggestion}`
    : "";
}

/** The provider itself is down (not the call's input): Reconnect may fix it. */
function providerDown(error) {
  return /ECONNREFUSED|not connected|couldn't start|isn't running|Cannot find module|spawn .*ENOENT|Connection closed/i.test(
    String(error || ""),
  );
}

/**
 * A path the provider's folders don't include (the permission gate's
 * "path argument 'path' rejected … Requested: <path> (resolved …"):
 * → { input, path } or null.
 */
function pathOutside(error) {
  const e = String(error || "");
  if (!/not within any allowed root|path argument/i.test(e)) return null;
  const input = (e.match(/path argument '([^']+)'/) || [])[1] || "path";
  const requested = (e.match(
    /Requested: ([\s\S]+?)(?: \(resolved|\. Allowed|$)/,
  ) || [])[1];
  return { input, path: requested ? requested.trim() : "" };
}

/** The likely cause of an error, in plain words — or "". */
function likelyCause(error, { provider = "its provider" } = {}) {
  const e = String(error || "");
  const outside = pathOutside(e);
  if (outside) {
    return `The ${outside.input} it was given isn't inside a folder ${provider} can use — check the widget's settings (a value like "From …" means text got into the path), or add the folder to ${provider}.`;
  }
  if (/Cannot find module|ENOENT|command not found|spawn .* ENOENT/i.test(e)) {
    return `The program ${provider} starts can't be found — check the command in its settings, then Reconnect.`;
  }
  if (/ECONNREFUSED|connection refused|ECONNRESET|socket hang up/i.test(e)) {
    return `${provider}'s server isn't answering — it may not be running. Reconnect starts it again.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e)) {
    return "An address can't be found — check the URL it was given, or your network.";
  }
  if (/timed? ?out|ETIMEDOUT/i.test(e)) {
    return `${provider} took too long to answer. Try again; if it keeps happening, check that its server is running.`;
  }
  if (
    /\b401\b|unauthori[sz]ed|sign[- ]?in|expired|invalid[_ ]grant|token/i.test(
      e,
    )
  ) {
    return `${provider}'s sign-in has expired or was refused — sign in again.`;
  }
  if (/permission gate|not allowed|isn't allowed/i.test(e)) {
    return `The widget isn't allowed to use that tool — check the provider's allowed tools.`;
  }
  if (/\b403\b|forbidden|permission/i.test(e)) {
    return `${provider} refused it — the account may not have access.`;
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(e)) {
    return `${provider} is limiting requests — wait a minute and try again.`;
  }
  if (/not connected|isn't connected|no server/i.test(e)) {
    return `${provider} isn't connected yet — Reconnect starts it.`;
  }
  return "";
}

/** The text of an MCP tool error result ({ isError, content: [{text}] }). */
function toolErrorText(result) {
  if (!result || typeof result !== "object") return "";
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || "The tool reported an error.";
}

/** A widget copy's asset: which one, and where it is on its dashboard. */
function widgetAsset(facts, name) {
  return {
    kind: "widget",
    name,
    component: facts.component,
    itemId: facts.itemId ?? null,
    workspaceId: facts.workspaceId ?? null,
    dashboardName: facts.dashboardName || "",
    id: facts.id ?? null,
    gridItemId: facts.gridItemId ?? null,
    cellNumber: facts.cellNumber || "",
    pageId: facts.pageId ?? null,
    scope: facts.scope || "",
    packageId: facts.packageId || "",
  };
}

/**
 * A widget's provider call that failed: an error from Dash (couldn't start,
 * not connected, not allowed), or the tool's own error result.
 */
function widgetCallIssue(facts) {
  const { component, widgetName = "", provider, tool, args, error } = facts;
  const name = widgetName || displayName(component) || "A widget";
  const outside = pathOutside(error);
  return {
    asset: widgetAsset(facts, name),
    severity: "problem",
    // "provider": the provider is down (Reconnect); "call": what it was given.
    cause: tool === "connect" || providerDown(error) ? "provider" : "call",
    // Its provider couldn't connect, so the widget never got to call.
    title:
      tool === "connect"
        ? `${name} couldn't connect to ${provider}`
        : `${name}: ${provider} › ${tool} failed`,
    call: { provider, tool, args, error },
    // Readable: a JSON answer's message, not the JSON (raw stays on call);
    // a path outside the provider's folders, in plain words.
    message: outside
      ? `The ${outside.input} "${outside.path}" isn't inside a folder ${provider} can use.`
      : readableError(error).message,
    // The provider's own suggestion first — it knows best — then ours.
    hint: suggestionHint(error, provider) || likelyCause(error, { provider }),
  };
}

/** A widget that crashed while showing, or was stopped for failing again and again. */
function widgetCrashIssue(facts) {
  const { component, widgetName = "", message, stopped = false } = facts;
  const name = widgetName || displayName(component) || "A widget";
  return {
    asset: widgetAsset(facts, name),
    severity: "problem",
    cause: "crash",
    title: stopped
      ? `${name} was stopped — it kept failing`
      : `${name} couldn't show`,
    message: String(message || "It hit an error."),
    hint: "Fix with AI hands the error to the Dash team.",
  };
}

/** A run's warnings: an array, or the sealed JSON string the store opens. */
function warningsOf(run) {
  const w = run && run.warnings;
  if (Array.isArray(w)) return w;
  if (typeof w === "string" && w) {
    try {
      const list = JSON.parse(w);
      return Array.isArray(list) ? list : [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

/** A finished bot run → its issues: the failure, and each warning. */
function botRunIssues({ bot, run }) {
  if (!bot || !run) return [];
  const asset = {
    kind: "bot",
    name: bot.name || bot.id,
    botId: bot.id,
    workspaceId: bot.workspaceId == null ? null : String(bot.workspaceId),
  };
  const out = [];
  if (run.status === "failed") {
    const badCall = (run.toolCalls || []).find((c) => c && c.ok === false);
    out.push({
      asset,
      severity: "problem",
      cause: "run",
      title: `${asset.name}'s run failed`,
      message: String(run.error || "The run failed."),
      call: badCall
        ? {
            provider: badCall.provider || "",
            tool: badCall.tool || "",
            args: badCall.args,
            error: badCall.error || "",
          }
        : null,
      hint: likelyCause(run.error || (badCall && badCall.error), {
        provider: (badCall && badCall.provider) || "its provider",
      }),
    });
  }
  for (const w of warningsOf(run)) {
    const message = typeof w === "string" ? w : w && w.message;
    if (!message) continue;
    const provider = w && typeof w === "object" ? w.provider : null;
    out.push({
      asset,
      severity: "warning",
      cause: "warning",
      // Grouped by the provider behind it (one issue per server or
      // connector), never by cutting the text at its first dot.
      title: provider
        ? `${asset.name}: ${provider} wasn't available`
        : `${asset.name}: ${message}`.slice(0, 160),
      message: (w && w.detail) || message,
      ...(provider ? { related: { provider } } : {}),
      ...(provider
        ? { hint: likelyCause((w && w.detail) || message, { provider }) }
        : {}),
    });
  }
  return out;
}

/** A provider that couldn't start, or whose sign-in expired. */
function providerIssue({ provider, error, signIn = false, usedBy = "" }) {
  return {
    asset: { kind: "provider", name: provider, provider },
    severity: "problem",
    cause: signIn ? "sign-in" : "start",
    title: signIn
      ? `${provider}: sign-in expired`
      : `${provider} couldn't start`,
    message: String(error || ""),
    hint: signIn
      ? `Reconnect ${provider} — it asks you to sign in again.`
      : likelyCause(error, { provider }) ||
        `Check ${provider}'s settings, then Reconnect.`,
    ...(usedBy ? { shown: usedBy } : {}),
  };
}

module.exports = {
  readableError,
  providerDown,
  warningsOf,
  displayName,
  likelyCause,
  toolErrorText,
  widgetCallIssue,
  widgetCrashIssue,
  botRunIssues,
  providerIssue,
};
