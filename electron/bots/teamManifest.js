/**
 * teamManifest.js
 *
 * A dashboard's team as a portable `.team.json` (bot-teams TEAM-006/007,
 * slice 1: local export/import). Members are embedded and named by **role**;
 * providers are carried by **type** (e.g. "gmail") with the member's tool
 * choices; wiring is between roles. A manifest never carries bot or
 * dashboard ids, provider names, grants, sessions, memory or credentials.
 *
 * Inside a dashboard package (create-entry phase 5a) a team also carries what
 * ties it to the dashboard's widgets, by layout-local widget id (kept on
 * import): `triggers` (a widget event starts a role) and `listeners` (a
 * widget handler shows a role's result). Members keep their results
 * (`publishes`), and bot → bot wiring may be on a result (`result.<name>`).
 * `resultWidgets` (5b): which Bot results widget shows which role — its
 * bot is a personal setting, stripped on export, so it's rebound on import.
 * Older versions drop these fields, never fail on them.
 *
 * A team's settings (DASH-57) travel as `settings` (name, label, type,
 * default — never the values: those are filled in at install). Members
 * carry their checks (a reviewer by role) and the folders they work in
 * that come from a setting ("{workFolder}/repo"); a folder on this
 * computer stays behind.
 *
 * A member may declare its own settings (DASH-136) as `settings` on its
 * embedded bot, in the same shape, values again left behind: they're the
 * settings for that bot's job, filled in on its section of the install
 * form and on its Settings tab. Its folders may come from them too.
 *
 * Pure (NFR-006): decisions only; botController reads/writes files and saves
 * the bots.
 */
"use strict";

const { RESULT_NAME_RE } = require("./botSchema");
const { botEventType, parseResultEventType } = require("./botEvents");
const { cleanBotChecks, checksError } = require("./botChecks");
const { cleanSettings, usesSetting } = require("./teamValues");

const SCHEMA_VERSION = 1;
const TEAM_TYPE = "bot-team";
const AI_TYPES = ["anthropic", "openai", "xai"];
const APPROVAL_POLICIES = ["ask", "ask-every", "allow", "unattended"];
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
  // A trigger's note to the triggered bot (botSchema MAX_NOTE).
  note: 2000,
  short: 200,
  results: 20,
  triggers: 100,
  listeners: 100,
  resultWidgets: 50,
  folders: 20,
};

/** A wiring entry, with its note when it has one. */
function wiringEntry(role, on, note) {
  const entry = { role, on: { role: on.role, event: on.event } };
  if (typeof note === "string" && note.trim()) entry.note = note.trim();
  return entry;
}

const ROLE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EVENT_RE =
  /^(completed|failed|tool\.[A-Za-z0-9_.:-]{1,200}|result\.[A-Za-z][A-Za-z0-9_]{0,39})$/;
// A widget's own event name, and a handler it declares.
const WIDGET_EVENT_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const HANDLER_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
// dash-core's built-in Bot results widget (botController BOT_WIDGETS).
const BOT_RESULTS_COMPONENT = "dash.bots.BotResults";

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

/** Every layout of a workspace: main, pages and the sidebar. */
function layoutsOf(workspace) {
  const ws = workspace || {};
  return [
    ws.layout,
    ...(Array.isArray(ws.pages) ? ws.pages.map((p) => p && p.layout) : []),
    ws.sidebarLayout,
  ].filter(Array.isArray);
}

/**
 * A workspace without the listener entries that point at these bots' results
 * — they travel as role-based `listeners` instead, so no bot id leaks into
 * a package (create-entry 5a).
 */
function stripBotListeners(workspace, botIds) {
  const ids = new Set((botIds || []).map(String));
  const ws = JSON.parse(JSON.stringify(workspace || {}));
  for (const layout of layoutsOf(ws)) {
    for (const item of layout) {
      if (!item || !item.listeners || typeof item.listeners !== "object") {
        continue;
      }
      for (const [handler, list] of Object.entries(item.listeners)) {
        if (!Array.isArray(list)) continue;
        const kept = list.filter((ev) => {
          const r = parseResultEventType(ev);
          return !(r && ids.has(r.botId));
        });
        if (kept.length) item.listeners[handler] = kept;
        else delete item.listeners[handler];
      }
    }
  }
  return ws;
}

// ─── Export ──────────────────────────────────────────────────────────

/**
 * Build a manifest from a dashboard's bots (the lead is left out — every
 * dashboard makes its own).
 *
 * @param {{ name: string, description?: string, bots: object[], providers: object[] }} input
 * @returns {{ manifest: object, notIncluded: string[] }}
 */
function buildTeamManifest({
  name,
  description = "",
  bots,
  providers,
  // The dashboard the team is exported with (5a): its widget triggers and
  // result listeners travel too.
  dashboardId = null,
  workspace = null,
  // The team's declared settings (DASH-57): their values stay here.
  settings = [],
  // Its bots pass work in the standard format (DASH-101): on when it's
  // installed (DASH-129).
  usesHandoffs = false,
}) {
  const members = (Array.isArray(bots) ? bots : []).filter(
    (b) => b && b.role !== "lead",
  );
  const declared = cleanSettings(settings).settings;
  const settingNames = declared.map((d) => d.name);
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
    // Its own settings (DASH-136): declared, never their values.
    const ownSettings = cleanSettings(bot.settings, { of: "a bot" }).settings;
    const ownNames = ownSettings.map((d) => d.name);
    // Folders from a setting travel; one on this computer doesn't.
    const projects = [];
    for (const p of Array.isArray(bot.projects) ? bot.projects : []) {
      if (usesSetting(p, [...settingNames, ...ownNames])) {
        projects.push(String(p));
      } else if (String(p || "").trim()) {
        notIncluded.push(
          `${bot.name}: the folder "${p}" (a folder on this computer: use a setting, like {workFolder})`,
        );
      }
    }
    const checks = exportChecks(bot, roleOf, notIncluded);
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
        // Only when it has fewer than all of them (DASH-27).
        ...(["none", "read-only"].includes(bot.builtinTools)
          ? { builtinTools: bot.builtinTools }
          : {}),
        // Strict (DASH-116), only when set; else its team's default.
        ...(typeof bot.strict === "boolean" ? { strict: bot.strict } : {}),
        schedules: (bot.schedules || [])
          .filter((s) => s && typeof s.cron === "string")
          .map((s) => ({ cron: s.cron, prompt: s.prompt || "" })),
        providers: providersOut,
        publishes: (Array.isArray(bot.publishes) ? bot.publishes : [])
          .filter((p) => p && RESULT_NAME_RE.test(String(p.name || "")))
          .map((p) => ({
            name: p.name,
            label: p.label || "",
            description: p.description || "",
          })),
        ...(projects.length ? { projects } : {}),
        ...(checks ? { checks } : {}),
        ...(ownSettings.length ? { settings: ownSettings } : {}),
      },
    };
  });

  const wiring = [];
  const triggers = [];
  const onThisDashboard = (src) =>
    dashboardId != null &&
    src.kind === "widget" &&
    String(src.workspaceId) === String(dashboardId) &&
    src.instanceId != null &&
    src.ref &&
    WIDGET_EVENT_RE.test(String(src.event || ""));
  for (const bot of members) {
    for (const sub of bot.subscriptions || []) {
      const src = (sub && sub.source) || {};
      const label = (sub && (sub.label || sub.eventType)) || "a trigger";
      if (onThisDashboard(src)) {
        const t = {
          role: roleOf.get(bot.id),
          widget: String(src.instanceId),
          component: src.ref,
          event: src.event,
        };
        if (typeof sub.note === "string" && sub.note.trim()) {
          t.note = sub.note.trim();
        }
        triggers.push(t);
      } else if (src.kind === "bot" && roleOf.has(src.instanceId)) {
        wiring.push(
          wiringEntry(
            roleOf.get(bot.id),
            { role: roleOf.get(src.instanceId), event: src.event },
            sub.note,
          ),
        );
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

  // Widgets showing a team bot's result (listeners[handler] holds its
  // result event).
  const listeners = [];
  for (const layout of layoutsOf(workspace)) {
    for (const item of layout) {
      if (!item || !item.listeners || typeof item.listeners !== "object") {
        continue;
      }
      for (const [handler, list] of Object.entries(item.listeners)) {
        if (!Array.isArray(list) || !HANDLER_RE.test(handler)) continue;
        for (const ev of list) {
          const r = parseResultEventType(ev);
          if (!r || !roleOf.has(r.botId)) continue;
          const l = {
            widget: String(item.id),
            component: item.component || "",
            handler,
            role: roleOf.get(r.botId),
            result: r.name,
          };
          if (
            !listeners.some(
              (x) =>
                x.widget === l.widget &&
                x.handler === l.handler &&
                x.role === l.role &&
                x.result === l.result,
            )
          ) {
            listeners.push(l);
          }
        }
      }
    }
  }

  // Bot results widgets showing a team bot (5b).
  const resultWidgets = [];
  for (const layout of layoutsOf(workspace)) {
    for (const item of layout) {
      if (!item || item.component !== BOT_RESULTS_COMPONENT) continue;
      const botId = item.userPrefs && item.userPrefs.botId;
      if (!botId || !roleOf.has(botId)) continue;
      const w = { widget: String(item.id), role: roleOf.get(botId) };
      if (!resultWidgets.some((x) => x.widget === w.widget)) {
        resultWidgets.push(w);
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
      triggers,
      listeners,
      resultWidgets,
      ...(declared.length ? { settings: declared } : {}),
      ...(usesHandoffs === true ? { usesHandoffs: true } : {}),
    },
    notIncluded,
  };
}

/**
 * A bot's checks as they travel: a reviewer by its role (one outside the
 * team stays behind), a script from a file on this computer stays behind.
 */
function exportChecks(bot, roleOf, notIncluded) {
  const checks = cleanBotChecks(bot && bot.checks);
  if (!checks) return null;
  const steps = [];
  for (const s of checks.steps) {
    if (s.kind === "reviewer") {
      const role = roleOf.get(s.botId);
      if (!role || s.botId === bot.id) {
        notIncluded.push(
          `${bot.name}: the check "${s.name}" (its reviewer isn't on this team)`,
        );
        continue;
      }
      const { botId: _b, ...rest } = s;
      steps.push({ ...rest, role });
      continue;
    }
    if (
      s.kind === "check" &&
      s.check.kind === "script" &&
      /^local:/.test(String(s.check.script || ""))
    ) {
      notIncluded.push(
        `${bot.name}: the check "${s.name}" (its script is a file on this computer)`,
      );
      continue;
    }
    const { held: _h, ...plain } = s;
    steps.push(plain);
  }
  if (!steps.length) return null;
  return { ...checks, steps };
}

/**
 * A member's checks from a file, checked: { checks, error }. Reviewers
 * name a role of the team (not its own).
 */
function importChecks(input, role, roles) {
  if (input === undefined || input === null) return { checks: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "checks must be an object" };
  }
  const steps = Array.isArray(input.steps) ? input.steps : [];
  for (const s of steps) {
    if (s && s.kind === "reviewer") {
      if (typeof s.role !== "string" || !roles.has(s.role)) {
        return { error: "a reviewer check must name one of the team's roles" };
      }
      if (s.role === role) return { error: "a bot can't review its own work" };
    }
  }
  // Checked as a save checks it, a reviewer standing in by its role.
  const asBot = {
    ...input,
    steps: steps.map((s) =>
      s && s.kind === "reviewer" ? { ...s, botId: `role:${s.role}` } : s,
    ),
  };
  const err = checksError(asBot);
  if (err) return { error: err };
  const clean = cleanBotChecks(asBot);
  if (!clean) return { checks: null };
  return {
    checks: {
      ...clean,
      steps: clean.steps.map((s) => {
        if (s.kind !== "reviewer") return s;
        const { botId, ...rest } = s;
        return { ...rest, role: botId.slice(5) };
      }),
    },
  };
}

/** A member's checks for install: reviewers stand in as "role:<role>". */
function checksForInstall(checks, picked) {
  if (!checks) return null;
  const steps = [];
  for (const s of checks.steps) {
    if (s.kind === "reviewer") {
      if (!picked.has(s.role)) continue;
      const { role, ...rest } = s;
      steps.push({ ...rest, botId: `role:${role}` });
    } else {
      const copy = JSON.parse(JSON.stringify(s));
      // A command from a package runs on this computer: it installs off,
      // until you turn it on (DASH-57).
      // A repo check runs your repo's own file, so it doesn't, unless its
      // fallback is the package's command (DASH-102).
      const c = copy.kind === "check" ? copy.check : null;
      if (
        c &&
        (c.kind === "command" ||
          (c.kind === "repo" && c.fallback && c.fallback.kind === "command") ||
          // A registry check package runs its author's code too (DASH-106);
          // the ones Dash ships don't.
          (c.kind === "package" && /\//.test(String(c.package || ""))))
      )
        copy.held = true;
      steps.push(copy);
    }
  }
  return steps.length ? { ...checks, steps } : null;
}

/** Installed bots' checks with each reviewer's role turned into its bot. */
function resolveReviewers(checks, created) {
  if (!checks || !Array.isArray(checks.steps)) return checks;
  const steps = checks.steps
    .map((s) => {
      if (!s || s.kind !== "reviewer") return s;
      const m = /^role:(.+)$/.exec(String(s.botId || ""));
      if (!m) return s;
      const bot = created[m[1]];
      return bot ? { ...s, botId: bot.id } : null;
    })
    .filter(Boolean);
  return steps.length ? { ...checks, steps } : null;
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

  // Its settings (DASH-57): what its bots use as {name}.
  const settingsRead = cleanSettings(input.settings);
  for (const e of settingsRead.errors) errors.push(e);
  const settingNames = settingsRead.settings.map((d) => d.name);
  // Every role first: a reviewer check names another member's.
  const allRoles = new Set(
    (Array.isArray(input.members) ? input.members : [])
      .map((m) => m && m.role)
      .filter((r) => typeof r === "string"),
  );

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
      if (e.strict != null && typeof e.strict !== "boolean") {
        errors.push(`${where}: strict must be true or false`);
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
      const pubs = Array.isArray(e.publishes) ? e.publishes : [];
      if (
        pubs.length > LIMITS.results ||
        !pubs.every(
          (p) =>
            p &&
            typeof p.name === "string" &&
            RESULT_NAME_RE.test(p.name) &&
            (p.label == null || str(p.label, LIMITS.short)) &&
            (p.description == null || str(p.description, LIMITS.description)),
        )
      ) {
        errors.push(`${where}: results are malformed`);
      }
      // Its own settings (DASH-136).
      const ownRead = cleanSettings(e.settings, { of: "a bot" });
      for (const err of ownRead.errors) errors.push(`${where}: ${err}`);
      const ownNames = ownRead.settings.map((d) => d.name);
      const projects = [];
      if (e.projects != null) {
        if (!Array.isArray(e.projects) || e.projects.length > LIMITS.folders) {
          errors.push(`${where}: projects must be a list of folders`);
        } else {
          for (const f of e.projects) {
            if (
              !str(f, LIMITS.short) ||
              !usesSetting(f, [...settingNames, ...ownNames])
            ) {
              errors.push(
                `${where}: a folder must start with one of the team's or the bot's settings, like {workFolder}`,
              );
              break;
            }
            projects.push(f);
          }
        }
      }
      const checksRead = importChecks(e.checks, m.role, allRoles);
      if (checksRead.error) errors.push(`${where}: ${checksRead.error}`);
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
          ...(["none", "read-only"].includes(e.builtinTools)
            ? { builtinTools: e.builtinTools }
            : {}),
          ...(typeof e.strict === "boolean" ? { strict: e.strict } : {}),
          schedules: schedules.map((s) => ({
            cron: s && s.cron,
            prompt: (s && s.prompt) || "",
          })),
          providers: provs.map((p) => ({
            type: p && p.type,
            tools: p && Array.isArray(p.tools) ? [...p.tools] : null,
          })),
          publishes: pubs.map((p) => ({
            name: p && p.name,
            label: (p && p.label) || "",
            description: (p && p.description) || "",
          })),
          ...(projects.length ? { projects } : {}),
          ...(checksRead.checks ? { checks: checksRead.checks } : {}),
          ...(ownRead.settings.length ? { settings: ownRead.settings } : {}),
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
      if (w.note != null && !str(w.note, LIMITS.note)) {
        errors.push(
          `${where}: note must be text of at most ${LIMITS.note} characters`,
        );
        return;
      }
      wiring.push(wiringEntry(w.role, on, w.note));
    });
  }

  // A role's declared results, for listeners.
  const resultsOf = new Map(
    members.map((m) => [m.role, m.embedded.publishes.map((p) => p.name)]),
  );
  const widgetId = (v) => typeof v === "string" && v.length && v.length <= 64;

  const triggers = [];
  const rawTriggers = input.triggers == null ? [] : input.triggers;
  if (!Array.isArray(rawTriggers) || rawTriggers.length > LIMITS.triggers) {
    errors.push("triggers must be a list");
  } else {
    rawTriggers.forEach((t, i) => {
      const where = `trigger ${i + 1}`;
      if (
        !t ||
        !roles.has(t.role) ||
        !widgetId(t.widget) ||
        !str(t.component, LIMITS.short) ||
        !t.component ||
        typeof t.event !== "string" ||
        !WIDGET_EVENT_RE.test(t.event)
      ) {
        errors.push(
          `${where}: needs a role, a widget, its component and an event`,
        );
        return;
      }
      if (t.note != null && !str(t.note, LIMITS.note)) {
        errors.push(`${where}: note is too long`);
        return;
      }
      const out = {
        role: t.role,
        widget: t.widget,
        component: t.component,
        event: t.event,
      };
      if (typeof t.note === "string" && t.note.trim()) out.note = t.note.trim();
      triggers.push(out);
    });
  }

  const listeners = [];
  const rawListeners = input.listeners == null ? [] : input.listeners;
  if (!Array.isArray(rawListeners) || rawListeners.length > LIMITS.listeners) {
    errors.push("listeners must be a list");
  } else {
    rawListeners.forEach((l, i) => {
      const where = `listener ${i + 1}`;
      if (
        !l ||
        !roles.has(l.role) ||
        !widgetId(l.widget) ||
        !str(l.component, LIMITS.short) ||
        typeof l.handler !== "string" ||
        !HANDLER_RE.test(l.handler) ||
        typeof l.result !== "string" ||
        !RESULT_NAME_RE.test(l.result)
      ) {
        errors.push(
          `${where}: needs a widget, its handler, a role and a result`,
        );
        return;
      }
      if (!(resultsOf.get(l.role) || []).includes(l.result)) {
        errors.push(`${where}: ${l.role} doesn't send "${l.result}"`);
        return;
      }
      listeners.push({
        widget: l.widget,
        component: l.component || "",
        handler: l.handler,
        role: l.role,
        result: l.result,
      });
    });
  }

  const resultWidgets = [];
  const rawResults = input.resultWidgets == null ? [] : input.resultWidgets;
  if (!Array.isArray(rawResults) || rawResults.length > LIMITS.resultWidgets) {
    errors.push("resultWidgets must be a list");
  } else {
    rawResults.forEach((r, i) => {
      if (!r || !roles.has(r.role) || !widgetId(r.widget)) {
        errors.push(`result widget ${i + 1}: needs a widget and a role`);
        return;
      }
      resultWidgets.push({ widget: r.widget, role: r.role });
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
      triggers,
      listeners,
      resultWidgets,
      ...(settingsRead.settings.length
        ? { settings: settingsRead.settings }
        : {}),
      // Its bots pass work in the standard format (DASH-129).
      ...(input.usesHandoffs === true ? { usesHandoffs: true } : {}),
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
          // Fewer built-ins as the file says; never more (DASH-27).
          ...(["none", "read-only"].includes(e.builtinTools)
            ? { builtinTools: e.builtinTools }
            : {}),
          // Strict as the file says (DASH-116).
          ...(typeof e.strict === "boolean" ? { strict: e.strict } : {}),
          workspaceId,
          mcpServers,
          toolSelections,
          schedules: e.schedules.map((s) => ({
            cron: s.cron,
            prompt: s.prompt,
          })),
          subscriptions: [],
          publishes: (e.publishes || []).map((p) => ({ ...p })),
          // Folders from the team's settings, filled in when it runs.
          ...(Array.isArray(e.projects) && e.projects.length
            ? { projects: [...e.projects] }
            : {}),
          // Reviewers stand in by role until the bots exist
          // (resolveReviewers).
          ...(e.checks ? { checks: checksForInstall(e.checks, picked) } : {}),
          // Its own settings (DASH-136); their values come from the
          // install form's section for this bot.
          ...(Array.isArray(e.settings) && e.settings.length
            ? { settings: e.settings.map((d) => ({ ...d })) }
            : {}),
        },
      };
    });

  const copy = (w) => wiringEntry(w.role, w.on, w.note);
  return {
    name: manifest.name,
    // Its settings, for the install form (DASH-57).
    settings: (manifest.settings || []).map((d) => ({ ...d })),
    // The standard handoff, turned on at install (DASH-129).
    usesHandoffs: manifest.usesHandoffs === true,
    // Each bot's own (DASH-136), for the form's section per bot.
    botSettings: botSettingsOf(
      manifest.members.filter((m) => picked.has(m.role)),
    ),
    members,
    // Wiring only between the bots being installed.
    wiring: manifest.wiring
      .filter((w) => picked.has(w.role) && picked.has(w.on.role))
      .map(copy),
    // Triggers a picked bot loses because the bot that fired them stays out.
    droppedWiring: manifest.wiring
      .filter((w) => picked.has(w.role) && !picked.has(w.on.role))
      .map(copy),
    // The dashboard's widgets ↔ the picked bots (5a).
    triggers: (manifest.triggers || [])
      .filter((t) => picked.has(t.role))
      .map((t) => ({ ...t })),
    listeners: (manifest.listeners || [])
      .filter((l) => picked.has(l.role))
      .map((l) => ({ ...l })),
    resultWidgets: (manifest.resultWidgets || [])
      .filter((r) => picked.has(r.role))
      .map((r) => ({ ...r })),
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
      ...(typeof w.note === "string" && w.note ? { note: w.note } : {}),
    });
  }
  return out;
}

/**
 * Resolve a plan's widget triggers and result listeners to the created bots
 * on this dashboard (create-entry 5a). Widget ids are the package's own —
 * kept on import.
 *
 * @param {{ triggers?: object[], listeners?: object[] }} plan
 * @param {{ [role]: { id, ref, name } }} created
 * @param {string|number} dashboardId
 * @returns {{ subscriptions: { [role]: object[] },
 *   listeners: Array<{ widget, component, handler, eventType }> }}
 */
function wireWidgets(plan, created, dashboardId) {
  const subscriptions = {};
  for (const t of (plan && plan.triggers) || []) {
    if (!created[t.role]) continue;
    (subscriptions[t.role] = subscriptions[t.role] || []).push({
      eventType: `${t.component}[${t.widget}].${t.event}`,
      source: {
        kind: "widget",
        ref: t.component,
        instanceId: String(t.widget),
        event: t.event,
        workspaceId: String(dashboardId),
      },
      label: `${String(t.component).split(".").pop()} › ${t.event}`,
      ...(t.note ? { note: t.note } : {}),
    });
  }
  const listeners = [];
  for (const l of (plan && plan.listeners) || []) {
    const bot = created[l.role];
    if (!bot) continue;
    listeners.push({
      widget: l.widget,
      component: l.component || null,
      handler: l.handler,
      eventType: botEventType(bot, `result.${l.result}`),
    });
  }
  return { subscriptions, listeners };
}

/**
 * The registry's display summary of a team (what bot-team packages and,
 * since 5a-2, dashboards with bots carry in manifest.json): roles, names and
 * bot → bot wiring. The full definition stays in the zip.
 */
function teamSummaryFor(manifest) {
  return {
    members: (manifest.members || []).map((m) => ({
      role: m.role,
      name: m.embedded.name,
      // Its own settings (DASH-136), so the install form shows them
      // before the download.
      ...(Array.isArray(m.embedded.settings) && m.embedded.settings.length
        ? { settings: m.embedded.settings.map((d) => ({ ...d })) }
        : {}),
    })),
    wiring: (manifest.wiring || []).map((w) => ({
      role: w.role,
      on: { role: w.on.role, event: w.on.event },
    })),
    // Its settings, so the install form shows before the download.
    ...(Array.isArray(manifest.settings) && manifest.settings.length
      ? { settings: manifest.settings.map((d) => ({ ...d })) }
      : {}),
  };
}

/**
 * The members that declare settings of their own (DASH-136), for the install
 * form: [{ role, name, settings }].
 */
function botSettingsOf(members) {
  return (members || [])
    .filter(
      (m) =>
        m &&
        m.embedded &&
        Array.isArray(m.embedded.settings) &&
        m.embedded.settings.length,
    )
    .map((m) => ({
      role: m.role,
      name: m.embedded.name,
      settings: m.embedded.settings.map((d) => ({ ...d })),
    }));
}

/** Provider types the team's bots need, once each. */
function teamProviderTypes(manifest) {
  const out = [];
  for (const m of (manifest && manifest.members) || []) {
    for (const p of (m.embedded && m.embedded.providers) || []) {
      if (p && p.type && !out.includes(p.type)) out.push(p.type);
    }
  }
  return out;
}

/**
 * Each bot in plain words, for the publish screen (create-entry 5a-2):
 * { role, name, starts: ["on a schedule", "when Ask sends askClicked",
 * "when Greeter sends its greeting result"], providers: ["gmail"] }.
 */
function describeTeam(manifest) {
  const names = Object.fromEntries(
    ((manifest && manifest.members) || []).map((m) => [
      m.role,
      m.embedded.name,
    ]),
  );
  return ((manifest && manifest.members) || []).map((m) => {
    const starts = [];
    if ((m.embedded.schedules || []).length) starts.push("on a schedule");
    for (const t of (manifest.triggers || []).filter(
      (x) => x.role === m.role,
    )) {
      starts.push(
        `when ${String(t.component).split(".").pop()} sends ${t.event}`,
      );
    }
    for (const w of (manifest.wiring || []).filter((x) => x.role === m.role)) {
      const from = names[w.on.role] || w.on.role;
      const ev = w.on.event;
      starts.push(
        ev === "completed"
          ? `when ${from} finishes`
          : ev === "failed"
            ? `when ${from} fails`
            : ev.startsWith("result.")
              ? `when ${from} sends its ${ev.slice(7)} result`
              : `when ${from} uses ${ev.replace(/^tool\./, "")}`,
      );
    }
    return {
      role: m.role,
      name: m.embedded.name,
      starts,
      providers: (m.embedded.providers || []).map((p) => p.type),
    };
  });
}

module.exports = {
  SCHEMA_VERSION,
  TEAM_TYPE,
  IMPORT_APPROVAL_POLICY,
  buildTeamManifest,
  validateTeamManifest,
  planTeamInstall,
  resolveReviewers,
  wireTeam,
  wireWidgets,
  stripBotListeners,
  teamSummaryFor,
  botSettingsOf,
  teamProviderTypes,
  describeTeam,
};
