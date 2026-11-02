/**
 * mcpTasks.js — tasks given to a team via Dash's MCP server (bot-teams
 * TEAM-016): an agent such as the user's own bridge gives a team a task, and
 * the team starts only once the user's task passphrase checks out.
 *
 *   waiting  → given, waiting for the passphrase (expires after 10 minutes)
 *   running  → confirmed; the team's lead is doing it
 *   done / failed / expired
 *
 * The passphrase is any word or phrase the user sets in Settings › MCP
 * Server. It's compared loosely, because it's usually spoken and voice-to-text
 * never writes it the same way twice: case, punctuation and extra spaces don't
 * count. 5 wrong tries lock tasks for 15 minutes. The passphrase never goes in
 * a reply, a task or a log.
 *
 * Pure: the store (load/save of tasks, the passphrase and the lock) and the
 * clock are injected; botController keeps them in dash-bots.json, sealed.
 */
"use strict";

const crypto = require("crypto");

const TASK_EXPIRES_MS = 10 * 60 * 1000;
const MAX_WRONG = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TASKS = 50;
const MIN_LETTERS = 4;
const SHORT_LETTERS = 8;
const MAX_TASK_CHARS = 4000;
const MAX_PASSPHRASE_CHARS = 200;

/** "Purple, Otter." → "purple otter" */
function normalizePassphrase(text) {
  return String(text == null ? "" : text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Can this be the passphrase? { ok, error?, short? } — short is advice
 * ("Short and easy to guess"), not a refusal.
 */
function checkPassphrase(text) {
  if (String(text == null ? "" : text).length > MAX_PASSPHRASE_CHARS) {
    return {
      ok: false,
      error: `Keep it under ${MAX_PASSPHRASE_CHARS} characters.`,
    };
  }
  const letters = normalizePassphrase(text).replace(/ /g, "");
  if (letters.length < MIN_LETTERS) {
    return {
      ok: false,
      error: `Use at least ${MIN_LETTERS} letters.`,
    };
  }
  return { ok: true, short: letters.length < SHORT_LETTERS };
}

const same = (a, b) => {
  // Hash both so the compare takes the same time whatever the lengths.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** An agent's name for itself, kept short and plain ("voice-assistant"). */
function cleanFrom(from) {
  const s = String(from == null ? "" : from)
    .replace(/[^\p{L}\p{N} ._-]+/gu, "")
    .trim()
    .slice(0, 40);
  return s || null;
}

/**
 * @param {object} deps
 * @param {{ loadTasks: () => object[]|null, saveTasks: (t: object[]) => void,
 *           getPassphrase: () => string|null,
 *           getLock: () => object|null, saveLock: (l: object) => void }} deps.store
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.newId]
 */
function createMcpTasks({
  store,
  now = () => Date.now(),
  newId = () => `task_${crypto.randomBytes(6).toString("hex")}`,
}) {
  const iso = (t) => new Date(t).toISOString();

  const load = () => {
    const list = store.loadTasks();
    return Array.isArray(list) ? list : [];
  };
  // Over the limit, the oldest finished tasks go first — never one that's
  // still waiting or running.
  const save = (list) => {
    let out = list;
    while (out.length > MAX_TASKS) {
      const i = out.findIndex(
        (t) => t.status !== "waiting" && t.status !== "running",
      );
      if (i < 0) break;
      out = [...out.slice(0, i), ...out.slice(i + 1)];
    }
    store.saveTasks(out);
  };

  // A waiting task past its time is expired, on every read.
  const withExpiry = (list) => {
    const t = now();
    let changed = false;
    const out = list.map((task) => {
      if (task.status === "waiting" && Date.parse(task.expiresAt) <= t) {
        changed = true;
        return { ...task, status: "expired", endedAt: task.expiresAt };
      }
      return task;
    });
    if (changed) save(out);
    return out;
  };

  const update = (id, patch) => {
    const list = withExpiry(load());
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    save(list);
    return list[i];
  };

  const lockState = () => {
    const l = store.getLock() || {};
    return {
      wrong: Number(l.wrong) || 0,
      until: l.until || null,
    };
  };

  return {
    /**
     * A new task, waiting. `needsPassphrase`: the team asks for the
     * passphrase first (its setting); one that doesn't starts it right away.
     */
    create({
      task,
      team,
      from = null,
      routedBy = null,
      needsPassphrase = true,
    }) {
      const t = now();
      const record = {
        id: newId(),
        task: String(task || "").slice(0, MAX_TASK_CHARS),
        teamId: String(team.id),
        teamName: team.name || "Untitled",
        leadId: team.leadId || null,
        from: cleanFrom(from),
        routedBy: routedBy || null,
        needsPassphrase: needsPassphrase !== false,
        status: "waiting",
        createdAt: iso(t),
        expiresAt: iso(t + TASK_EXPIRES_MS),
      };
      save([...withExpiry(load()), record]);
      return record;
    },

    get(id) {
      return withExpiry(load()).find((t) => t.id === String(id)) || null;
    },

    /** Newest first. */
    list({ teamId = null, limit = 20 } = {}) {
      return withExpiry(load())
        .filter((t) => teamId === null || t.teamId === String(teamId))
        .reverse()
        .slice(0, limit);
    },

    /** Is a passphrase set? (Never the phrase.) */
    passphraseSet() {
      return !!store.getPassphrase();
    },

    /** Locked until (ISO), or null. */
    lockedUntil() {
      const { until } = lockState();
      return until && Date.parse(until) > now() ? until : null;
    },

    /**
     * Does this text say the passphrase (as whole words, loosely)? A task
     * that does is refused, so the phrase is never kept in a task, the
     * routing log or the lead's prompt.
     */
    mentionsPassphrase(text) {
      const set = normalizePassphrase(store.getPassphrase());
      if (!set) return false;
      return ` ${normalizePassphrase(text)} `.includes(` ${set} `);
    },

    /** Unlock early (Settings › MCP Server: "Unlock now"). */
    unlock() {
      store.saveLock({ wrong: 0, until: null });
    },

    /**
     * Check a passphrase.
     * @returns {{ ok: true } | { notSet: true } | { locked: string }
     *           | { wrong: true, triesLeft: number, locked?: string }}
     */
    verify(passphrase) {
      const locked = this.lockedUntil();
      if (locked) return { locked };
      const set = store.getPassphrase();
      if (!set) return { notSet: true };
      const given = normalizePassphrase(passphrase);
      if (given && same(given, normalizePassphrase(set))) {
        store.saveLock({ wrong: 0, until: null });
        return { ok: true };
      }
      const { until } = lockState();
      // A lock that ran out starts the count again.
      const wrong =
        (until && Date.parse(until) <= now() ? 0 : lockState().wrong) + 1;
      if (wrong >= MAX_WRONG) {
        const lockUntil = iso(now() + LOCK_MS);
        store.saveLock({ wrong, until: lockUntil });
        return { wrong: true, triesLeft: 0, locked: lockUntil };
      }
      store.saveLock({ wrong, until: null });
      return { wrong: true, triesLeft: MAX_WRONG - wrong };
    },

    running(id) {
      return update(id, { status: "running", confirmedAt: iso(now()) });
    },

    /**
     * Finished. `needsYou`: what's left for the user in Dash (a bot that
     * was paused, so it never ran) — done, but not all of it.
     */
    done(id, { summary = "", runAt = null, needsYou = null } = {}) {
      return update(id, {
        status: "done",
        summary: String(summary || "").slice(0, MAX_TASK_CHARS),
        endedAt: iso(now()),
        ...(runAt ? { runAt } : {}),
        ...(needsYou ? { needsYou: String(needsYou).slice(0, 500) } : {}),
      });
    },

    /** It didn't finish. `runAt`: the start of the lead's run, if one ran. */
    failed(id, error, { runAt = null } = {}) {
      return update(id, {
        status: "failed",
        error: String(error || "Something went wrong."),
        endedAt: iso(now()),
        ...(runAt ? { runAt } : {}),
      });
    },

    /** Dash restarted: a task that was running didn't finish. */
    recover() {
      const list = load();
      let changed = false;
      const out = list.map((t) => {
        if (t.status !== "running") return t;
        changed = true;
        return {
          ...t,
          status: "failed",
          error: "Dash closed before the team finished.",
          endedAt: iso(now()),
        };
      });
      if (changed) save(out);
    },
  };
}

/**
 * A bot the lead asked during a task via MCP didn't run: what the user can
 * do about it, or null when it isn't theirs to fix (busy for a moment, or
 * the lead's own limits).
 */
function taskNoteFor(name, reason) {
  const r = String(reason || "");
  if (/^you|in progress/.test(r)) return null;
  const then = "then ask for the rest again.";
  if (r === "this bot is paused") {
    return `${name} is paused. Turn it on in this team's Bots view, ${then}`;
  }
  if (r === "all bots are paused") {
    return `All bots are paused, so ${name} didn't run. Resume them, ${then}`;
  }
  if (/budget/.test(r)) {
    return `${name} is over its budget. Raise it in Settings › Bots, ${then}`;
  }
  if (/profile/.test(r)) {
    return `${name} isn't in the profile Dash has open. Switch profiles, ${then}`;
  }
  return `${name} didn't run (${r || "skipped"}).`;
}

module.exports = {
  createMcpTasks,
  taskNoteFor,
  normalizePassphrase,
  checkPassphrase,
  cleanFrom,
  TASK_EXPIRES_MS,
  MAX_WRONG,
  LOCK_MS,
  MIN_LETTERS,
};
