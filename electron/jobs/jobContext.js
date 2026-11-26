/**
 * jobContext.js — what a job is about and where its files are (DASH-100).
 *
 *   item:      { id, title?, url?, source? }  the one thing the job is about:
 *              a Jira key, an Obsidian note's path, a GitHub issue… `id` is
 *              all that's needed; `source` is a free label ("jira").
 *   workspace: { dir, branch? }  the folder the job's work is in.
 *
 * A job gets them from its task, or from the first answer whose last
 * ```json block names them ("item": {...}, "workspace": {...}). Once a job
 * has an item its id never changes; a later answer may only fill in a title
 * or url it lacked. Dash fills {item.id}, {workspace.dir}… into bots' text,
 * and gives checks DASH_ITEM_ID, DASH_WORKSPACE… and the workspace as their
 * folder, so no bot has to copy them forward.
 *
 * Pure.
 */
"use strict";

const path = require("path");
const { lastJsonObject } = require("../bots/answerJson");

const MAX_ID = 200;
const MAX_TITLE = 200;
const MAX_URL = 500;
const MAX_SOURCE = 40;
const MAX_DIR = 1000;
const MAX_BRANCH = 200;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const oneLine = (v, n) => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  const t = String(v)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) : t;
};

/** A work item, cleaned: { id, title?, url?, source? }, or null. */
function cleanItem(v) {
  // A bare id ("DASH-93") is an item too.
  const raw = typeof v === "string" || typeof v === "number" ? { id: v } : v;
  if (!isObj(raw)) return null;
  const id = oneLine(raw.id, MAX_ID);
  if (!id) return null;
  const out = { id };
  const title = oneLine(raw.title, MAX_TITLE);
  if (title) out.title = title;
  const url = oneLine(raw.url, MAX_URL);
  if (url && /^https?:\/\/\S+$/i.test(url)) out.url = url;
  const source = oneLine(raw.source, MAX_SOURCE).toLowerCase();
  if (source && /^[a-z0-9][a-z0-9._-]*$/.test(source)) out.source = source;
  return out;
}

/** A workspace, cleaned: { dir, branch? }, or null. `home` expands "~". */
function cleanWorkspace(v, { home = null } = {}) {
  const raw = typeof v === "string" ? { dir: v } : v;
  if (!isObj(raw)) return null;
  let dir = oneLine(raw.dir, MAX_DIR);
  if (!dir) return null;
  if (home && (dir === "~" || dir.startsWith("~/"))) {
    dir = path.join(home, dir.slice(1));
  }
  if (!path.isAbsolute(dir)) return null;
  const out = { dir: path.normalize(dir) };
  const branch = oneLine(raw.branch, MAX_BRANCH);
  if (branch && !/\s/.test(branch)) out.branch = branch;
  return out;
}

/** The last ```json block of a text (or the whole text, when it's JSON). */
function lastJson(text) {
  return lastJsonObject(text);
}

/** The item and workspace an answer names: { item?, workspace? }. */
function contextFrom(text, opts = {}) {
  const j = lastJson(text);
  if (!j) return {};
  const out = {};
  const item = cleanItem(j.item);
  if (item) out.item = item;
  const workspace = cleanWorkspace(j.workspace, opts);
  if (workspace) out.workspace = workspace;
  return out;
}

/**
 * A job's item after an answer names one. The id never changes: a
 * different one is refused (`refused` says which), the job's stays. Fields
 * the job's item lacks are filled in.
 * @returns {{ item: object|null, changed: boolean, refused?: string }}
 */
function mergeItem(current, next) {
  const cur = cleanItem(current);
  const nxt = cleanItem(next);
  if (!nxt) return { item: cur, changed: false };
  if (!cur) return { item: nxt, changed: true };
  if (nxt.id !== cur.id) {
    return { item: cur, changed: false, refused: nxt.id };
  }
  const merged = { ...nxt, ...cur };
  const changed = Object.keys(merged).length !== Object.keys(cur).length;
  return { item: merged, changed };
}

/** Is `dir` inside one of `folders` (or one of them)? */
function insideFolders(dir, folders) {
  const d = path.normalize(String(dir || ""));
  if (!d || !path.isAbsolute(d)) return false;
  return (folders || []).some((f) => {
    if (typeof f !== "string" || !path.isAbsolute(f)) return false;
    const root = path.normalize(f);
    const rel = path.relative(root, d);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/** {item.id}, {workspace.dir}… for filling a bot's text. */
function contextText({ item = null, workspace = null } = {}) {
  const out = {};
  const it = cleanItem(item);
  if (it) {
    out["item.id"] = it.id;
    out["item.title"] = it.title || "";
    out["item.url"] = it.url || "";
    out["item.source"] = it.source || "";
  }
  const ws = isObj(workspace) && workspace.dir ? workspace : null;
  if (ws) {
    out["workspace.dir"] = String(ws.dir);
    out["workspace.branch"] = ws.branch ? String(ws.branch) : "";
  }
  return out;
}

/** What a check's command gets in its environment. */
function contextEnv({ item = null, workspace = null } = {}) {
  const t = contextText({ item, workspace });
  const env = {};
  if (t["item.id"] !== undefined) {
    env.DASH_ITEM_ID = t["item.id"];
    env.DASH_ITEM_TITLE = t["item.title"];
    env.DASH_ITEM_URL = t["item.url"];
    env.DASH_ITEM_SOURCE = t["item.source"];
  }
  if (t["workspace.dir"] !== undefined) {
    env.DASH_WORKSPACE = t["workspace.dir"];
    env.DASH_BRANCH = t["workspace.branch"];
  }
  return env;
}

/**
 * A bot's completed or failed event, saying its job, work item and
 * workspace (DASH-100). `ctx` is the job's { item, workspace }. Other
 * events, and events with no job, are left alone.
 */
function withEventContext(msg, ctx) {
  if (!msg || !msg.jobId || !isObj(msg.content)) return msg;
  if (!/\.(completed|failed)$/.test(String(msg.eventType || ""))) return msg;
  msg.content.jobId = msg.jobId;
  const item = cleanItem(ctx && ctx.item);
  if (item) msg.content.item = item;
  if (ctx && isObj(ctx.workspace) && ctx.workspace.dir) {
    msg.content.workspace = { ...ctx.workspace };
  }
  return msg;
}

/** The names a bot's text can use: item.* and workspace.*. */
const CONTEXT_NAMES = ["item", "workspace"];

module.exports = {
  cleanItem,
  cleanWorkspace,
  lastJson,
  contextFrom,
  mergeItem,
  insideFolders,
  contextText,
  contextEnv,
  withEventContext,
  CONTEXT_NAMES,
};
