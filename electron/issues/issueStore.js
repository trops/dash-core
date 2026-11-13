/**
 * issueStore.js
 *
 * What went wrong in the user's widgets, bots and providers (issues PRD
 * ISS-001): one issue per asset and kind of failure, so a widget that
 * retries every few seconds counts up ("12 times since 7:30") instead of
 * filling the list. A failure that comes back after it was resolved opens
 * the issue again.
 *
 * Pure (NFR-006): the caller loads and saves the list (`initial`, `onChange`).
 */
"use strict";

const MAX_ISSUES = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT = 5;
const ARGS_LIMIT = 600;
const TEXT_LIMIT = 1000;

const KINDS = new Set(["widget", "bot", "provider"]);
const SEVERITIES = new Set(["problem", "warning"]);
const CAUSES = new Set([
  "sign-in",
  "start",
  "provider",
  "call",
  "crash",
  "run",
  "warning",
]);
const RAW_LIMIT = 4000;
const SECRET_KEY = /key|token|secret|password|passwd|credential|auth|cookie/i;

const clip = (s, n) => {
  const t = typeof s === "string" ? s : s == null ? "" : String(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A tool's arguments, secrets hidden, as short JSON — or null. */
function redactArgs(args) {
  if (args === undefined || args === null) return null;
  const seen = new WeakSet();
  const walk = (v, depth) => {
    if (v === null || typeof v !== "object") {
      return typeof v === "string" ? clip(v, 200) : v;
    }
    if (seen.has(v) || depth > 4) return "…";
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) {
      out[k] = SECRET_KEY.test(k) ? "(hidden)" : walk(x, depth + 1);
    }
    return out;
  };
  let json;
  try {
    json = JSON.stringify(walk(args, 0));
  } catch (_e) {
    return null;
  }
  return clip(json, ARGS_LIMIT);
}

/**
 * A widget copy's id, the same everywhere it's recorded or looked up: the
 * layout item's `uuid`, else its `id` — never a made-up one.
 */
function widgetItemId(item) {
  if (!item || typeof item !== "object") return null;
  if (item.uuid != null && item.uuid !== "") return String(item.uuid);
  if (item.id != null && item.id !== "") return String(item.id);
  return null;
}

/** Which asset: a stable id for grouping. */
function assetKey(asset) {
  if (!asset || !KINDS.has(asset.kind)) return null;
  if (asset.kind === "widget") {
    const where = asset.workspaceId != null ? String(asset.workspaceId) : "";
    const which = asset.itemId != null ? String(asset.itemId) : "";
    return asset.component
      ? `widget:${asset.component}@${where}#${which}`
      : null;
  }
  if (asset.kind === "bot") return asset.botId ? `bot:${asset.botId}` : null;
  return asset.provider ? `provider:${asset.provider}` : null;
}

/** The issue's group: the asset, and what failed (the call, else the title). */
function issueKey(input) {
  const a = assetKey(input && input.asset);
  if (!a) return null;
  const call = input.call || null;
  const what =
    call && (call.provider || call.tool)
      ? `${call.provider || ""}/${call.tool || ""}`
      : String(input.title || "");
  return `${a}|${what}`;
}

/** The input cleaned — or null when it isn't one. */
function cleanInput(input) {
  if (!input || typeof input !== "object") return null;
  const asset =
    input.asset && typeof input.asset === "object" ? input.asset : null;
  if (!asset || !KINDS.has(asset.kind)) return null;
  const title = clip(input.title, 200);
  if (!title) return null;
  const a = {
    kind: asset.kind,
    name: clip(asset.name || "", 120),
    ...(asset.component ? { component: clip(asset.component, 200) } : {}),
    ...(asset.itemId != null ? { itemId: String(asset.itemId) } : {}),
    ...(asset.workspaceId != null
      ? { workspaceId: String(asset.workspaceId) }
      : {}),
    ...(asset.dashboardName
      ? { dashboardName: clip(asset.dashboardName, 120) }
      : {}),
    ...(asset.botId ? { botId: String(asset.botId) } : {}),
    ...(asset.provider ? { provider: clip(asset.provider, 120) } : {}),
    // A widget's place, so Fix with AI and Open reach that very copy.
    ...(asset.id != null ? { id: String(asset.id) } : {}),
    ...(asset.gridItemId != null
      ? { gridItemId: String(asset.gridItemId) }
      : {}),
    ...(asset.cellNumber ? { cellNumber: clip(asset.cellNumber, 20) } : {}),
    ...(asset.pageId != null ? { pageId: String(asset.pageId) } : {}),
    ...(asset.scope ? { scope: clip(asset.scope, 20) } : {}),
    ...(asset.packageId ? { packageId: clip(asset.packageId, 200) } : {}),
  };
  const call =
    input.call && typeof input.call === "object"
      ? {
          provider: clip(input.call.provider || "", 120),
          tool: clip(input.call.tool || "", 120),
          args: redactArgs(input.call.args),
          // Room for a provider's JSON answer, so "Show raw" has all of it.
          error: clip(input.call.error || "", RAW_LIMIT),
        }
      : null;
  return {
    asset: a,
    severity: SEVERITIES.has(input.severity) ? input.severity : "problem",
    title,
    message: clip(input.message || (call && call.error) || "", TEXT_LIMIT),
    call,
    hint: clip(input.hint || "", 400),
    shown: clip(input.shown || "", 300),
    // What kind of failure, said by its source — never guessed from text:
    // "sign-in" | "start" | "provider" | "call" | "crash" | "run" | "warning".
    cause: CAUSES.has(input.cause) ? input.cause : "",
    // A provider behind it (a bot warning about a server): Reconnect it.
    related:
      input.related && input.related.provider
        ? { provider: clip(input.related.provider, 120) }
        : null,
  };
}

const byNewest = (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt);

/**
 * Which error it was, for muting: the message, ignoring case and spacing,
 * and ids and numbers that change every time (a process id, "after 30012ms",
 * a request id) — short numbers like a status code (400 vs 500) still count.
 * Muting matches this widget (or bot, or provider), this call, this error —
 * a different error from the same call still opens an issue. The first 300
 * characters decide.
 */
function errorSignature(issue) {
  const text =
    (issue && (issue.message || (issue.call && issue.call.error))) ||
    (issue && issue.title) ||
    "";
  return clip(
    String(text)
      .toLowerCase()
      .replace(/\b(?=[0-9a-f-]*\d)[0-9a-f]{8,}(?:-[0-9a-f]+)*\b/g, "#")
      .replace(/\d{4,}/g, "#")
      .replace(/\s+/g, " ")
      .trim(),
    300,
  );
}

/** A muted issue's key: its group and its error, so other errors don't join it. */
const mutedKey = (key, signature) => `${key}|muted:${signature}`;

/**
 * @param {{ initial?: object[], now?: () => number, onChange?: (list) => void,
 *   newId?: () => string }} deps
 */
function createIssueStore({
  initial = [],
  now = () => Date.now(),
  onChange = () => {},
  newId = () =>
    `iss_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
} = {}) {
  let issues = (Array.isArray(initial) ? initial : []).filter(
    (i) => i && i.id && i.key && i.asset,
  );

  const prune = () => {
    const cutoff = now() - MAX_AGE_MS;
    const kept = issues.filter(
      (i) => Date.parse(i.lastAt) >= cutoff || i.status === "open",
    );
    // Over the limit: open ones stay first (a busy muted one never pushes
    // them out).
    const open = kept.filter((i) => i.status === "open").sort(byNewest);
    const rest = kept.filter((i) => i.status !== "open").sort(byNewest);
    issues = [...open, ...rest].slice(0, MAX_ISSUES).sort(byNewest);
  };
  prune();
  const changed = () => onChange(issues.slice());

  /** Record a failure. @returns {{ issue, isNew }} or null when it isn't one. */
  function record(input) {
    const clean = cleanInput(input);
    if (!clean) return null;
    const key = issueKey(clean);
    if (!key) return null;
    const at = new Date(now()).toISOString();
    const entry = { at, message: clean.message };
    // Muted ("Mute errors like this"): counted quietly, never opened.
    const quiet = issues.find(
      (i) =>
        i.status === "muted" && i.key === mutedKey(key, errorSignature(clean)),
    );
    if (quiet) {
      Object.assign(quiet, {
        lastAt: at,
        count: (quiet.count || 1) + 1,
        mutedCount: (quiet.mutedCount || 0) + 1,
        recent: [entry, ...(quiet.recent || [])].slice(0, RECENT),
      });
      issues.sort(byNewest);
      changed();
      return { issue: { ...quiet }, isNew: false, muted: true };
    }
    const found = issues.find((i) => i.key === key);
    if (found) {
      const reopened = found.status === "resolved";
      Object.assign(found, {
        ...clean,
        asset: { ...found.asset, ...clean.asset },
        hint: clean.hint || found.hint,
        shown: clean.shown || found.shown,
        lastAt: at,
        count: reopened ? 1 : (found.count || 1) + 1,
        firstAt: reopened ? at : found.firstAt,
        status: "open",
        recent: [entry, ...(found.recent || [])].slice(0, RECENT),
      });
      issues.sort(byNewest);
      changed();
      return { issue: { ...found }, isNew: reopened };
    }
    const issue = {
      id: newId(),
      key,
      ...clean,
      firstAt: at,
      lastAt: at,
      count: 1,
      status: "open",
      recent: [entry],
    };
    issues.unshift(issue);
    prune();
    changed();
    return { issue: { ...issue }, isNew: true };
  }

  /** Issues, newest first: by status ("open" default), kind, dashboard, asset. */
  function list({
    status = "open",
    kind = null,
    workspaceId = null,
    asset = null,
  } = {}) {
    const want = asset ? assetKey(asset) : null;
    return issues
      .filter((i) => (status === "all" ? true : i.status === status))
      .filter((i) => !kind || i.asset.kind === kind)
      .filter(
        (i) =>
          workspaceId == null ||
          String(i.asset.workspaceId) === String(workspaceId),
      )
      .filter((i) => !want || assetKey(i.asset) === want)
      .map((i) => ({ ...i }));
  }

  /** Mark resolved (by id); it opens again if it happens again. */
  function resolve(id) {
    const i = issues.find((x) => x.id === id);
    if (!i || i.status === "resolved") return false;
    i.status = "resolved";
    i.resolvedAt = new Date(now()).toISOString();
    changed();
    return true;
  }

  /**
   * Resolve every open issue of an asset (it worked again) — or only those
   * of one severity (a completed run clears the failure, not its warnings).
   */
  function resolveAsset(asset, { severity = null } = {}) {
    const want = assetKey(asset);
    if (!want) return 0;
    let n = 0;
    for (const i of issues) {
      if (
        i.status === "open" &&
        assetKey(i.asset) === want &&
        (!severity || i.severity === severity)
      ) {
        i.status = "resolved";
        i.resolvedAt = new Date(now()).toISOString();
        n += 1;
      }
    }
    if (n) changed();
    return n;
  }

  /**
   * A provider worked again (a call to it succeeded, from any bot): every
   * open "couldn't sign in" issue about it is resolved.
   */
  function resolveSignIn(provider) {
    const want = String(provider || "");
    if (!want) return 0;
    let n = 0;
    for (const i of issues) {
      if (
        i.status === "open" &&
        i.cause === "sign-in" &&
        ((i.related && i.related.provider === want) ||
          (i.call && i.call.provider === want))
      ) {
        i.status = "resolved";
        i.resolvedAt = new Date(now()).toISOString();
        n += 1;
      }
    }
    if (n) changed();
    return n;
  }

  /**
   * The same call worked again: its open issue is resolved ("it worked
   * again") — the same asset and call as `input` would record.
   */
  function resolveWorked(input) {
    const clean = cleanInput({ title: "worked", ...input });
    const key = clean ? issueKey(clean) : null;
    if (!key) return 0;
    const i = issues.find((x) => x.key === key && x.status === "open");
    if (!i) return 0;
    i.status = "resolved";
    i.resolvedAt = new Date(now()).toISOString();
    i.resolvedBy = "worked";
    changed();
    return 1;
  }

  /**
   * Forget issues outright — the thing they're about is gone (a deleted
   * bot, provider, dashboard or widget). `match(issue)` → true to drop.
   */
  function removeWhere(match) {
    const before = issues.length;
    issues = issues.filter((i) => !match(i));
    if (issues.length !== before) changed();
    return before - issues.length;
  }

  /**
   * Mute an issue: the same error from the same asset and call is counted
   * but never shows as open. A muted issue quiet for 30 days drops off.
   */
  function mute(id) {
    const i = issues.find((x) => x.id === id);
    if (!i || i.status === "muted") return false;
    const base = issueKey(i);
    if (!base) return false;
    i.key = mutedKey(base, errorSignature(i));
    i.status = "muted";
    i.mutedAt = new Date(now()).toISOString();
    i.mutedCount = 0;
    delete i.resolvedAt;
    delete i.resolvedBy;
    changed();
    return true;
  }

  /**
   * Unmute: back in Open when it happened since it was muted, else resolved.
   * When another error from that call is open, that one stays and this goes.
   */
  function unmute(id) {
    const i = issues.find((x) => x.id === id);
    if (!i || i.status !== "muted") return false;
    const base = issueKey(i);
    if (!base || issues.some((x) => x !== i && x.key === base)) {
      issues = issues.filter((x) => x !== i);
      changed();
      return true;
    }
    const happened = (i.mutedCount || 0) > 0;
    i.key = base;
    i.status = happened ? "open" : "resolved";
    if (!happened) i.resolvedAt = new Date(now()).toISOString();
    delete i.mutedAt;
    delete i.mutedCount;
    changed();
    return true;
  }

  /** Remove resolved issues (Clear resolved). */
  function clearResolved() {
    const before = issues.length;
    issues = issues.filter((i) => i.status !== "resolved");
    if (issues.length !== before) changed();
    return before - issues.length;
  }

  /** Open issues per kind, for the left menu's count; and how many are muted. */
  function counts() {
    const out = { total: 0, widget: 0, bot: 0, provider: 0, muted: 0 };
    for (const i of issues) {
      if (i.status === "muted") out.muted += 1;
      if (i.status !== "open") continue;
      out.total += 1;
      out[i.asset.kind] += 1;
    }
    return out;
  }

  return {
    record,
    list,
    resolve,
    resolveAsset,
    resolveSignIn,
    resolveWorked,
    mute,
    unmute,
    removeWhere,
    clearResolved,
    counts,
    all: () => issues.slice(),
  };
}

module.exports = {
  MAX_ISSUES,
  MAX_AGE_MS,
  redactArgs,
  widgetItemId,
  assetKey,
  issueKey,
  cleanInput,
  errorSignature,
  createIssueStore,
};
