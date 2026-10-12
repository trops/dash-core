/**
 * createRecent.js — Create's Recent (create-entry PRD CRE-007 AC2, CRE-003
 * AC4, CRE-004 AC3; phase 4e-1): every plan conversation, kept as it goes,
 * with its build's latest state, so Close, Back and a restart lose nothing.
 *
 * An entry:
 *   { id, kind: "plan", title, prompt, createdAt, updatedAt,
 *     conversation: { messages, plan, checks, planningTokens },
 *     build: { buildId, plan, state } | null }
 *
 * Its build memory (what was asked, decided, built and fixed) lives in
 * BotMemory's "plan" scope under the same id — see planMemory.js.
 *
 * Pure (NFR-006): persistence is injected ({ read, write }).
 */
"use strict";

const MAX_ENTRIES = 20;
const MAX_MESSAGES = 50;
const MAX_TITLE = 80;

const BUSY = new Set(["waiting", "running"]);

function newId() {
  return `plan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** "Morning Brief" from the plan's layout, else the prompt's first line. */
function titleFor(entry) {
  const plan = entry.conversation && entry.conversation.plan;
  const layout =
    plan && Array.isArray(plan.pieces)
      ? plan.pieces.find((p) => p && p.kind === "layout" && p.name)
      : null;
  const raw = layout
    ? layout.name
    : String(entry.prompt || "Untitled plan").split("\n")[0];
  const t = raw.trim() || "Untitled plan";
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
}

/**
 * What Recent shows for an entry (the renderer turns it into words):
 *   status   draft | building | built | problems | waiting | stopped |
 *            interrupted | removed — and for a question (5e): asked |
 *            answered
 *   progress { done, total } of the build's steps
 *   tokens   the build's tokens so far
 *   waitingFor  provider names the build waits for
 */
function summarize(entry) {
  const state = entry.build && entry.build.state;
  const out = {
    id: entry.id,
    kind: entry.kind || "plan",
    title: entry.title || titleFor(entry),
    updatedAt: entry.updatedAt,
    status: "draft",
    progress: null,
    tokens: 0,
    waitingFor: [],
    buildId: (entry.build && entry.build.buildId) || null,
  };
  if (out.kind === "question") {
    const messages = (entry.conversation && entry.conversation.messages) || [];
    const last = messages[messages.length - 1];
    // Messages are { who: "you" | "planner" | "note", text }.
    out.status = last && last.who === "planner" ? "answered" : "asked";
    return out;
  }
  if (!state) return out;
  const steps = Array.isArray(state.steps) ? state.steps : [];
  out.progress = {
    done: steps.filter((s) => s.status === "done").length,
    total: steps.length,
  };
  out.tokens = (state.totals && state.totals.tokens) || 0;
  out.waitingFor = [
    ...new Set(
      steps
        .filter((s) => s.status === "needs-provider")
        .flatMap((s) => s.waitingFor || []),
    ),
  ];
  out.status =
    {
      waiting: "building",
      running: "building",
      done: "built",
      "finished-with-problems": "problems",
      "waiting-for-providers": "waiting",
      stopped: "stopped",
      interrupted: "interrupted",
      removed: "removed",
    }[state.status] || "draft";
  return out;
}

const KINDS = new Set(["plan", "question"]);

class CreateRecent {
  /**
   * @param {{ persistence: { read, write }, now?: () => string,
   *   newId?: () => string }} deps
   */
  constructor({ persistence, now, newId: makeId } = {}) {
    if (!persistence) throw new Error("CreateRecent: persistence is required");
    this._persistence = persistence;
    this._now = now || (() => new Date().toISOString());
    this._newId = makeId || newId;
    this._listeners = new Set();
  }

  _read() {
    const blob = this._persistence.read() || {};
    return blob.entries && typeof blob.entries === "object"
      ? blob
      : { entries: {} };
  }

  _write(blob) {
    // Newest MAX_ENTRIES only.
    const ids = Object.values(blob.entries)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((e) => e.id);
    for (const id of ids.slice(MAX_ENTRIES)) delete blob.entries[id];
    this._persistence.write(blob);
    for (const fn of this._listeners) {
      try {
        fn();
      } catch (_e) {
        // a listener's failure isn't the store's
      }
    }
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Summaries, newest first. */
  list() {
    return Object.values(this._read().entries)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(summarize);
  }

  get(id) {
    return (id && this._read().entries[id]) || null;
  }

  /**
   * Save a conversation: a new one (no id) gets an id. Only the fields given
   * change; messages keep the newest MAX_MESSAGES.
   * @returns the saved entry
   */
  save({ id = null, kind, prompt, conversation } = {}) {
    const blob = this._read();
    const now = this._now();
    const prev = (id && blob.entries[id]) || null;
    const entry = prev
      ? { ...prev }
      : {
          id: id || this._newId(),
          // A plan conversation, or a question (5e). Set once, when made.
          kind: KINDS.has(kind) ? kind : "plan",
          prompt: "",
          createdAt: now,
          conversation: {},
          build: null,
        };
    if (typeof prompt === "string") entry.prompt = prompt;
    if (conversation && typeof conversation === "object") {
      const next = { ...entry.conversation, ...conversation };
      if (Array.isArray(next.messages)) {
        next.messages = next.messages.slice(-MAX_MESSAGES);
      }
      entry.conversation = next;
    }
    entry.title = titleFor(entry);
    entry.updatedAt = now;
    blob.entries[entry.id] = entry;
    this._write(blob);
    return entry;
  }

  /** A build's latest state on its conversation. */
  saveBuild(id, { buildId, plan, state }) {
    const blob = this._read();
    const entry = id && blob.entries[id];
    if (!entry) return null;
    entry.build = { buildId, plan, state };
    entry.updatedAt = this._now();
    this._write(blob);
    return entry;
  }

  /** The entry a build belongs to, or null. */
  findByBuild(buildId) {
    if (!buildId) return null;
    return (
      Object.values(this._read().entries).find(
        (e) => e.build && e.build.buildId === buildId,
      ) || null
    );
  }

  remove(id) {
    const blob = this._read();
    if (!blob.entries[id]) return false;
    delete blob.entries[id];
    this._write(blob);
    return true;
  }

  /**
   * At startup: a build that was running when the app closed is
   * "interrupted" — its finished steps are kept, the rest can continue.
   * @returns the ids marked
   */
  markInterrupted() {
    const blob = this._read();
    const marked = [];
    for (const e of Object.values(blob.entries)) {
      const st = e.build && e.build.state;
      if (!st || !BUSY.has(st.status)) continue;
      e.build.state = {
        ...st,
        status: "interrupted",
        steps: (st.steps || []).map((s) =>
          s.status === "running" ? { ...s, status: "waiting" } : s,
        ),
      };
      marked.push(e.id);
    }
    if (marked.length) this._write(blob);
    return marked;
  }
}

module.exports = {
  CreateRecent,
  summarize,
  titleFor,
  MAX_ENTRIES,
  MAX_MESSAGES,
};
