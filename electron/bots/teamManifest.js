/**
 * teamManifest.js
 *
 * A dashboard's team as a portable `.team.json` (bot-teams TEAM-006/007,
 * slice 1: local export/import). Members are embedded and named by **role**;
 * providers are carried by **type** (e.g. "gmail") with the member's tool
 * choices; wiring is between roles. A manifest never carries bot or
 * dashboard ids, provider names, grants, sessions, memory or credentials.
 *
 * Pure (NFR-006): decisions only; botController reads/writes files and saves
 * the bots.
 */
"use strict";

const SCHEMA_VERSION = 1;
const TEAM_TYPE = "bot-team";
const AI_TYPES = ["anthropic", "openai", "xai"];
const APPROVAL_POLICIES = ["ask", "ask-every", "allow"];
// What imported bots ask before (decided 2026-10-05): a shared file can't
// switch prompts off.
const IMPORT_APPROVAL_POLICY = "ask";

const LIMITS = {
  members: 20,
  wiring: 100,
  schedules: 10,
  providers: 20,
  tools: 200,
  name: 120,
  description: 2000,
  instructions: 50000,
  prompt: 5000,
  short: 200,
};

const ROLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EVENT_RE = /^(completed|failed|tool\.[A-Za-z0-9_.:-]{1,200})$/;

function slugify(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return s || "bot";
}

function eventLabel(event) {
  if (event === "completed") return "Completed";
  if (event === "failed") return "Failed";
  return event;
}

// ─── Export ──────────────────────────────────────────────────────────

/**
 * Build a manifest from a dashboard's bots (the lead is left out — every
 * dashboard makes its own).
 *
 * @param {{ name: string, description?: string, bots: object[], providers: object[] }} input
 * @returns {{ manifest: object, notIncluded: string[] }}
 */
function buildTeamManifest({ name, description = "", bots, providers }) {
  const members = (Array.isArray(bots) ? bots : []).filter(
    (b) => b && b.role !== "lead",
  );
  const typeOf = new Map(
    (Array.isArray(providers) ? providers : [])
      .filter((p) => p && p.name)
      .map((p) => [p.name, p.type || null]),
  );
  const notIncluded = [];

  // Unique roles from member names.
  const roleOf = new Map();
  const used = new Set();
  for (const bot of members) {
    const base = slugify(bot.name);
    let role = base;
    for (let n = 2; used.has(role); n++) role = `${base}-${n}`;
    used.add(role);
    roleOf.set(bot.id, role);
  }

  const manifestMembers = members.map((bot) => {
    const selections = bot.toolSelections || {};
    const providersOut = [];
    for (const providerName of bot.mcpServers || []) {
      const type = typeOf.get(providerName);
      if (!type) {
        notIncluded.push(
          `${bot.name}: the provider "${providerName}" (unknown type)`,
        );
        continue;
      }
      const sel = selections[providerName];
      providersOut.push({ type, tools: Array.isArray(sel) ? [...sel] : null });
    }
    return {
      role: roleOf.get(bot.id),
      embedded: {
        type: "bot",
        name: bot.name || "",
        instructions: bot.instructions || "",
        modelSource: bot.provider || null,
        model: bot.model || null,
        engine: bot.engine || null,
        approvalPolicy: bot.approvalPolicy || "ask",
        schedules: (bot.schedules || [])
          .filter((s) => s && typeof s.cron === "string")
          .map((s) => ({ cron: s.cron, prompt: s.prompt || "" })),
        providers: providersOut,
      },
    };
  });

  const wiring = [];
  for (const bot of members) {
    for (const sub of bot.subscriptions || []) {
      const src = (sub && sub.source) || {};
      const label = (sub && (sub.label || sub.eventType)) || "a trigger";
      if (src.kind === "bot" && roleOf.has(src.instanceId)) {
        wiring.push({
          role: roleOf.get(bot.id),
          on: { role: roleOf.get(src.instanceId), event: src.event },
        });
      } else if (src.kind === "bot") {
        notIncluded.push(
          `${bot.name}: the trigger "${label}" (a bot outside this team)`,
        );
      } else {
        notIncluded.push(
          `${bot.name}: the trigger "${label}" (a widget on this dashboard)`,
        );
      }
    }
  }

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      type: TEAM_TYPE,
      name: String(name || "Team"),
      description: String(description || ""),
      version: "1.0.0",
      members: manifestMembers,
      wiring,
    },
    notIncluded,
  };
}

// ─── Validate ────────────────────────────────────────────────────────

function str(v, max) {
  return typeof v === "string" && v.length <= max;
}

/**
 * Check a manifest from a file and return a clean copy holding only the
 * fields this version understands — anything else (ids, grants, …) is
 * dropped, never passed through.
 *
 * @returns {{ valid: boolean, errors: string[], manifest: object|null }}
 */
function validateTeamManifest(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["not a team file"], manifest: null };
  }
  if (input.type !== TEAM_TYPE) errors.push('type must be "bot-team"');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!str(input.name, LIMITS.name) || !input.name.trim()) {
    errors.push("name is required");
  }
  if (
    input.description != null &&
    !str(input.description, LIMITS.description)
  ) {
    errors.push("description is too long");
  }
  if (input.version != null && !str(input.version, LIMITS.short)) {
    errors.push("version must be text");
  }

  const members = [];
  const roles = new Set();
  if (
    !Array.isArray(input.members) ||
    input.members.length === 0 ||
    input.members.length > LIMITS.members
  ) {
    errors.push(`members must list 1–${LIMITS.members} bots`);
  } else {
    input.members.forEach((m, i) => {
      const where = `member ${i + 1}`;
      const e = m && m.embedded;
      if (!m || typeof m.role !== "string" || !ROLE_RE.test(m.role)) {
        errors.push(
          `${where}: role must be lowercase letters, digits or dashes`,
        );
        return;
      }
      if (roles.has(m.role))
        errors.push(`${where}: duplicate role "${m.role}"`);
      roles.add(m.role);
      if (!e || typeof e !== "object") {
        errors.push(`${where}: embedded bot is required`);
        return;
      }
      if (!str(e.name, LIMITS.name) || !e.name.trim()) {
        errors.push(`${where}: name is required`);
      }
      if (!str(e.instructions, LIMITS.instructions) || !e.instructions.trim()) {
        errors.push(
          `${where}: instructions are required (and under 50,000 characters)`,
        );
      }
      for (const k of ["modelSource", "model", "engine"]) {
        if (e[k] != null && !str(e[k], LIMITS.short)) {
          errors.push(`${where}: ${k} must be text`);
        }
      }
      if (
        e.approvalPolicy != null &&
        !APPROVAL_POLICIES.includes(e.approvalPolicy)
      ) {
        errors.push(`${where}: unknown approvalPolicy`);
      }
      const schedules = Array.isArray(e.schedules) ? e.schedules : [];
      if (
        schedules.length > LIMITS.schedules ||
        !schedules.every(
          (s) =>
            s &&
            str(s.cron, LIMITS.short) &&
            (s.prompt == null || str(s.prompt, LIMITS.prompt)),
        )
      ) {
        errors.push(`${where}: schedules are malformed`);
      }
      const provs = Array.isArray(e.providers) ? e.providers : [];
      if (
        provs.length > LIMITS.providers ||
        !provs.every(
          (p) =>
            p &&
            str(p.type, LIMITS.short) &&
            p.type &&
            (p.tools == null ||
              (Array.isArray(p.tools) &&
                p.tools.length <= LIMITS.tools &&
                p.tools.every((t) => str(t, LIMITS.short)))),
        )
      ) {
        errors.push(`${where}: providers are malformed`);
      }
      members.push({
        role: m.role,
        embedded: {
          type: "bot",
          name: typeof e.name === "string" ? e.name : "",
          instructions:
            typeof e.instructions === "string" ? e.instructions : "",
          modelSource: e.modelSource || null,
          model: e.model || null,
          engine: e.engine || null,
          approvalPolicy: e.approvalPolicy || "ask",
          schedules: schedules.map((s) => ({
            cron: s && s.cron,
            prompt: (s && s.prompt) || "",
          })),
          providers: provs.map((p) => ({
            type: p && p.type,
            tools: p && Array.isArray(p.tools) ? [...p.tools] : null,
          })),
        },
      });
    });
  }

  const wiring = [];
  const rawWiring = input.wiring == null ? [] : input.wiring;
  if (!Array.isArray(rawWiring) || rawWiring.length > LIMITS.wiring) {
    errors.push("wiring must be a list");
  } else {
    rawWiring.forEach((w, i) => {
      const where = `wiring ${i + 1}`;
      const on = w && w.on;
      if (!w || !roles.has(w.role) || !on || !roles.has(on.role)) {
        errors.push(`${where}: must connect two of the team's roles`);
        return;
      }
      if (w.role === on.role) {
        errors.push(`${where}: a bot can't trigger itself`);
        return;
      }
      if (typeof on.event !== "string" || !EVENT_RE.test(on.event)) {
        errors.push(`${where}: unknown event`);
        return;
      }
      wiring.push({ role: w.role, on: { role: on.role, event: on.event } });
    });
  }

  if (errors.length) return { valid: false, errors, manifest: null };
  return {
    valid: true,
    errors: [],
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      type: TEAM_TYPE,
      name: input.name,
      description: input.description || "",
      version: input.version || "1.0.0",
      members,
      wiring,
    },
  };
}

// ─── Install ─────────────────────────────────────────────────────────

/**
 * Plan installing a (validated) manifest into a dashboard: one new bot
 * definition per role (no id — the store assigns one), providers matched by
 * type, and the wiring to resolve once the bots exist (wireTeam).
 *
 * @param {object} manifest  from validateTeamManifest
 * @param {{ workspaceId: string, providers: object[],
 *           choices?: { [role]: { [type]: string } } }} opts
 */
// Team bots often hand results to each other through team memory.
const MEMORY_HINT = /team memory|memory_(get|set)/i;

function planTeamInstall(
  manifest,
  { workspaceId, providers, choices = {}, roles = null },
) {
  // Which bots to install (TEAM-007 slice 3b): every one unless picked out.
  const picked = new Set(
    Array.isArray(roles) ? roles : manifest.members.map((m) => m.role),
  );
  const isPartial = manifest.members.some((m) => !picked.has(m.role));
  const list = Array.isArray(providers) ? providers : [];
  const namesOfType = (type) =>
    list.filter((p) => p && p.name && p.type === type).map((p) => p.name);
  const haveAiType = (type) =>
    list.some((p) => p && p.type === type && AI_TYPES.includes(type));

  const members = manifest.members
    .filter((m) => picked.has(m.role))
    .map(({ role, embedded: e }) => {
      const roleChoices = (choices && choices[role]) || {};
      const needs = [];
      const mcpServers = [];
      const toolSelections = {};
      for (const p of e.providers) {
        const options = namesOfType(p.type);
        const picked = roleChoices[p.type];
        const chosen = options.includes(picked)
          ? picked
          : options.length === 1
            ? options[0]
            : null;
        needs.push({ type: p.type, options, chosen });
        if (chosen && !mcpServers.includes(chosen)) {
          mcpServers.push(chosen);
          if (Array.isArray(p.tools)) toolSelections[chosen] = [...p.tools];
        }
      }
      const source = e.modelSource;
      const provider =
        source === "claude-code" || (source && haveAiType(source))
          ? source
          : null;
      return {
        role,
        fileApprovalPolicy: e.approvalPolicy,
        needs,
        definition: {
          name: e.name,
          instructions: e.instructions,
          provider,
          model: provider ? e.model : null,
          engine: e.engine,
          approvalPolicy: IMPORT_APPROVAL_POLICY,
          workspaceId,
          mcpServers,
          toolSelections,
          schedules: e.schedules.map((s) => ({
            cron: s.cron,
            prompt: s.prompt,
          })),
          subscriptions: [],
        },
      };
    });

  const copy = (w) => ({
    role: w.role,
    on: { role: w.on.role, event: w.on.event },
  });
  return {
    name: manifest.name,
    members,
    // Wiring only between the bots being installed.
    wiring: manifest.wiring
      .filter((w) => picked.has(w.role) && picked.has(w.on.role))
      .map(copy),
    // Triggers a picked bot loses because the bot that fired them stays out.
    droppedWiring: manifest.wiring
      .filter((w) => picked.has(w.role) && !picked.has(w.on.role))
      .map(copy),
    // Picked bots that look like they rely on team memory, when the team is
    // split (their teammates may have been the ones writing it).
    sharedMemory: isPartial
      ? manifest.members
          .filter(
            (m) =>
              picked.has(m.role) && MEMORY_HINT.test(m.embedded.instructions),
          )
          .map((m) => m.role)
      : [],
  };
}

/**
 * Resolve role wiring to the created bots' subscriptions (the shape the
 * event picker saves). Wiring to a role that wasn't created is dropped.
 *
 * @param {Array<{role, on: {role, event}}>} wiring
 * @param {{ [role]: { id, ref, name } }} created
 * @returns {{ [role]: object[] }}
 */
function wireTeam(wiring, created) {
  const out = {};
  for (const w of wiring || []) {
    const target = created[w.role];
    const src = created[w.on.role];
    if (!target || !src) continue;
    (out[w.role] = out[w.role] || []).push({
      eventType: `bot:${src.ref}[${src.id}].${w.on.event}`,
      source: {
        kind: "bot",
        ref: src.ref,
        instanceId: src.id,
        event: w.on.event,
      },
      label: `${src.name} › ${eventLabel(w.on.event)}`,
    });
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  TEAM_TYPE,
  IMPORT_APPROVAL_POLICY,
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  wireTeam,
};
