/**
 * botSchema.js
 *
 * Bot Schema v1 — the portable, persisted shape of a bot definition (PRD
 * bot-factory.md → Architecture → Bot Schema). Pure: no Electron, no
 * electron-store, no fs. Provides id generation, default-filling, and
 * validation used by BotStore.
 *
 * A bot is keyed by a generated `id`; duplicate names are allowed (shown with
 * disambiguation in the UI). `provider: null` means "use the user's designated
 * default provider at run time".
 */
"use strict";

const SCHEMA_VERSION = 1;

// "ask": ask before tools that aren't read-only; "ask-every": ask before
// every tool; "allow": never ask.
const APPROVAL_POLICIES = new Set(["ask", "ask-every", "allow"]);
const WHILE_PAUSED = new Set(["queue", "drop"]);
// A trigger's "Then ask it to" note (TEAM-014).
const MAX_NOTE = 2000;

// A bot id is used as a filesystem path segment (its working directory), so it
// must be a single safe segment — no separators, no traversal.
const BOT_ID_RE = /^bot_[A-Za-z0-9_-]+$/;

let _counter = 0;

/**
 * Generate a unique bot id. Combines a timestamp, a monotonic counter, and
 * randomness so ids minted in the same millisecond don't collide.
 * @returns {string} e.g. "bot_lqf3k9_7f3a1b_0"
 */
function newBotId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = _counter++;
  return `bot_${ts}_${rand}_${seq}`;
}

/** @param {string} id */
function isValidBotId(id) {
  return typeof id === "string" && BOT_ID_RE.test(id);
}

/**
 * Fill a partial bot definition with schema defaults. Does not mutate the
 * input. Leaves `id`/timestamps to the caller (BotStore stamps those).
 * @param {object} def
 * @returns {object}
 */
function withDefaults(def = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "",
    instructions: "",
    // null → resolve the user's default provider at run time.
    provider: null,
    model: null,
    modelSelection: { mode: "recommended" },
    // null → derive the engine from the provider (tool-loop). A bot may pin a
    // specific engine id here (e.g. "claude-agent").
    engine: null,
    mcpServers: [],
    // Per-provider narrowing within each provider's declared tools:
    // { [providerName]: string[] }. No entry → every tool the provider allows.
    toolSelections: {},
    // Tools that skip the approval prompt (NOT the tools the bot may use).
    allowedTools: [],
    approvalPolicy: "ask",
    schedules: [],
    subscriptions: [],
    publishes: [],
    projects: [],
    whilePaused: "queue",
    workspaceId: null,
    session: null,
    ...def,
  };
}

/**
 * Validate a bot definition. Returns { valid, errors } — never throws — so the
 * store and (later) the IPC layer can surface field errors.
 * @param {object} def
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBotDefinition(def) {
  const errors = [];
  if (!def || typeof def !== "object") {
    return { valid: false, errors: ["definition must be an object"] };
  }
  if (typeof def.name !== "string" || !def.name.trim()) {
    errors.push("name is required");
  }
  if (typeof def.instructions !== "string" || !def.instructions.trim()) {
    errors.push("instructions are required");
  }
  // provider may be null (use default) or a non-empty string.
  if (def.provider !== null && def.provider !== undefined) {
    if (typeof def.provider !== "string" || !def.provider) {
      errors.push("provider must be null or a non-empty string");
    }
  }
  // engine may be null (derive from provider) or a non-empty string (an engine
  // id). The runner surfaces an unknown id at run time.
  if (def.engine !== null && def.engine !== undefined) {
    if (typeof def.engine !== "string" || !def.engine) {
      errors.push("engine must be null or a non-empty string");
    }
  }
  if (!APPROVAL_POLICIES.has(def.approvalPolicy)) {
    errors.push(
      `approvalPolicy must be one of ${[...APPROVAL_POLICIES].join(", ")}`,
    );
  }
  if (!WHILE_PAUSED.has(def.whilePaused)) {
    errors.push(`whilePaused must be one of ${[...WHILE_PAUSED].join(", ")}`);
  }
  for (const field of [
    "mcpServers",
    "allowedTools",
    "schedules",
    "subscriptions",
  ]) {
    if (def[field] !== undefined && !Array.isArray(def[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  // toolSelections: { [providerName]: string[] } — per-bot tool narrowing.
  if (def.toolSelections !== undefined) {
    const ts = def.toolSelections;
    const ok =
      ts &&
      typeof ts === "object" &&
      !Array.isArray(ts) &&
      Object.values(ts).every(
        (v) => Array.isArray(v) && v.every((t) => typeof t === "string"),
      );
    if (!ok) {
      errors.push(
        "toolSelections must map provider names to arrays of tool names",
      );
    }
  }
  // Each subscription must name an eventType (PRD FR-009).
  if (Array.isArray(def.subscriptions)) {
    for (const sub of def.subscriptions) {
      if (!sub || typeof sub.eventType !== "string" || !sub.eventType.trim()) {
        errors.push("each subscription must have a non-empty eventType");
        break;
      }
      // The owner's "Then ask it to" note (TEAM-014): optional, short text.
      if (
        sub.note != null &&
        (typeof sub.note !== "string" || sub.note.length > MAX_NOTE)
      ) {
        errors.push(
          `a subscription note must be text of at most ${MAX_NOTE} characters`,
        );
        break;
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION,
  newBotId,
  isValidBotId,
  withDefaults,
  validateBotDefinition,
};
