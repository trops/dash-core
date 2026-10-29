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
 *   status   draft | building | built | ready | problems | waiting |
 *            stopped | interrupted | removed (ready: built, waiting for you
 *            — a preview to look at) — and for a question (5e): asked |
 *            answered
 *   progress { done, total } of the build's steps
 *   tokens   the build's tokens so far
 *   waitingFor  provider names the build waits for
 *   widget      a Create › Widget plan (one widget on its own)
 *   widgetAdded its widget was added to the user's widgets (Looks good)
 *   built     a question's build (lead workspace, release 3b): its status,
 *             as above, or null
 */
// A build's status, in Recent's words.
const BUILD_STATUS = {
  waiting: "building",
  running: "building",
  done: "built",
  "waiting-for-you": "ready",
  "finished-with-problems": "problems",
  "waiting-for-providers": "waiting",
  stopped: "stopped",
  interrupted: "interrupted",
  removed: "removed",
};

/**
 * A question's build in Recent's words, with what the user left off in the
 * conversation (lead workspace, release 3b): a build whose only failures
 * were left off is built.
 */
function builtStatus(state, wp, buildId) {
  const word = BUILD_STATUS[state.status] || null;
  if (word !== "problems") return word;
  const mine = ((wp && wp.builds) || []).find(
    (b) => b && b.buildId === buildId,
  );
  const off = (mine && mine.leftOff) || [];
  if (!off.length) return word;
  const steps = Array.isArray(state.steps) ? state.steps : [];
  const key = (s) =>
    s.piece != null
      ? `piece:${s.piece}`
      : s.bot != null
        ? `bot:${s.bot}`
        : String(s.id || "");
  const open = steps.some(
    (s) => s.status === "failed" && !off.includes(key(s)),
  );
  if (open) return word;
  return steps.some((s) => s.status === "needs-provider") ? "waiting" : "built";
}

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
    widget: !!(entry.conversation && entry.conversation.widget),
    widgetAdded: !!(entry.conversation && entry.conversation.widgetAdded),
  };
  if (out.kind === "question") {
    const messages = (entry.conversation && entry.conversation.messages) || [];
    const last = messages[messages.length - 1];
    // Messages are { who: "you" | "planner" | "lead" | "role" | "note", text }.
    out.status =
      last &&
      (last.who === "planner" || last.who === "lead" || last.who === "role")
        ? "answered"
        : "asked";
    // Asked of a team lead (5e-2a) or a Dash team role: its name, for the row.
    const to = entry.conversation && entry.conversation.recipient;
    if (to && to.leadName) out.to = String(to.leadName);
    else if (to && to.roleName) out.to = String(to.roleName);
    // Who the conversation is with, for the lead workspace's Recents
    // (lead-workspace release 2): "lead:<botId>" or "role:<role>".
    out.with =
      to && to.botId && !to.role
        ? `lead:${to.botId}`
        : `role:${(to && to.role) || "planner"}`;
    // A conversation with a plan in it (release 3a): Recents tag it "Plan".
    const wp = entry.conversation && entry.conversation.workspacePlan;
    out.planned = !!(wp && wp.plan);
    // Built in the conversation (release 3b): Recents say how it went.
    out.built = state ? builtStatus(state, wp, entry.build.buildId) : null;
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
  out.status = BUILD_STATUS[state.status] || "draft";
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
    // Newest MAX_ENTRIES of each kind: questions are the Dash team's
    // conversations now (consolidation Phase 4a), so asking a lot never
    // pushes plans out, or the other way round.
    const sorted = Object.values(blob.entries).sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
    const kept = {};
    for (const e of sorted) {
      const kind = e.kind || "plan";
      kept[kind] = (kept[kind] || 0) + 1;
      if (kept[kind] > MAX_ENTRIES) delete blob.entries[e.id];
    }
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
