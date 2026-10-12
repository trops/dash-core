/**
 * planBuild.js — build an approved Dash team plan (create-entry PRD CRE-004,
 * CRE-012 AC3, team-dashboards TD-008; phase 4d-1).
 *
 * Steps, in order:
 *   install     each approved registry widget                 Dash · no AI
 *   dashboard   create the dashboard the widgets go on        Dash · no AI
 *   build       each new / updated widget                     Builder
 *   check       each widget the Builder built                 Checker
 *   place       each widget, onto the dashboard               Dash · no AI
 *   bot         save each new bot on the dashboard (TD-008)   Dash · no AI
 *   results     a Bot results widget for a bot (showResults)  Dash · no AI
 *   trigger     a widget event starts a bot (TD-006)          Dash · no AI
 *   listen      a widget shows a bot's result                 Dash · no AI
 *
 * Steps that need judgment go to the team's roles; everything else is done
 * directly, so it's instant and free. A failed step is kept (with why); the
 * build carries on with the steps that don't depend on it. Stop halts after
 * the current step (and aborts a running role). Nothing here asks the user
 * anything — approving the plan was the consent (CRE-003 AC3).
 *
 * After it finishes (4d-3, CRE-004 AC4/AC5):
 *   fix(stepId)    the Builder fixes the widget a failed step is about (at
 *                  most twice per widget), then what depends on it runs again
 *   retry(stepId)  a failed Dash step runs again
 *   resume()       steps waiting for a provider that wasn't connected run
 *   opts.resume    an edited plan reuses what an earlier build already made
 * Finished steps are never run twice.
 *
 * Pure (NFR-006): every effect is an injected hook.
 */
"use strict";

const { buildDraft } = require("./botDrafts");
const { eventNames } = require("./configDiff");
const { parseDashConfig } = require("../utils/dashConfigParser");

const AI_BUILT = /@ai-built\/[a-z0-9][a-z0-9-]*/g;

const STATUS = {
  waiting: "waiting",
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "skipped",
  stopped: "stopped",
  // Needs a provider the user skipped connecting ("waiting for Gmail").
  needsProvider: "needs-provider",
};

// How many times the Builder may fix one widget before it's over to the user.
const MAX_FIXES = 2;

/** The steps for a plan, all waiting. */
function planSteps(plan, { dashboardName } = {}) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const widgets = pieces.filter((p) => p.kind === "widget");
  const layout = pieces.find((p) => p.kind === "layout");
  const steps = [];
  const add = (step) => steps.push({ status: STATUS.waiting, ...step });

  widgets.forEach((p, i) => {
    if (p.source === "registry" && p.package) {
      add({
        id: `install:${i}`,
        kind: "install",
        piece: i,
        role: "dash",
        label: `Install ${p.name}`,
      });
    }
  });
  add({
    id: "dashboard",
    kind: "dashboard",
    role: "dash",
    label: `Create the "${dashboardName || (layout && layout.name) || "New dashboard"}" dashboard`,
    name: dashboardName || (layout && layout.name) || "New dashboard",
  });
  widgets.forEach((p, i) => {
    if (p.source === "new" || p.source === "update") {
      add({
        id: `build:${i}`,
        kind: "build",
        piece: i,
        source: p.source,
        role: "builder",
        label: `Build ${p.name}`,
      });
      add({
        id: `check:${i}`,
        kind: "check",
        piece: i,
        role: "checker",
        label: `Check ${p.name}`,
      });
    }
  });
  widgets.forEach((p, i) => {
    add({
      id: `place:${i}`,
      kind: "place",
      piece: i,
      role: "dash",
      label: `Place ${p.name}`,
    });
  });
  // Bots are saved as planned, then wired to the placed widgets (4d-2).
  const bots = botPieces(plan);
  const widgetIndex = indexByName(widgets);
  const botIndex = indexByName(bots);
  bots.forEach((b, i) => {
    add({
      id: `bot:${i}`,
      kind: "bot",
      bot: i,
      role: "dash",
      label: `Save the ${b.name} bot`,
      needs: ["dashboard"],
    });
  });
  bots.forEach((b, i) => {
    if (b.showResults) {
      add({
        id: `results:${i}`,
        kind: "results",
        bot: i,
        role: "dash",
        label: `Show ${b.name}'s results on the dashboard`,
        needs: [`bot:${i}`],
      });
    }
  });
  bots.forEach((b, i) => {
    (Array.isArray(b.on) ? b.on : []).forEach((o, j) => {
      const w = widgetIndex.get(lower(o && o.widget));
      if (w === undefined || !o.event) return;
      add({
        id: `trigger:${i}:${j}`,
        kind: "trigger",
        bot: i,
        piece: w,
        event: o.event,
        role: "dash",
        label: `Start ${b.name} when ${widgets[w].name} sends ${o.event}`,
        needs: [`bot:${i}`, `place:${w}`],
      });
    });
  });
  widgets.forEach((p, w) => {
    (Array.isArray(p.listens) ? p.listens : []).forEach((l, j) => {
      const i = botIndex.get(lower(l && l.bot));
      if (i === undefined || !l.result || !l.handler) return;
      add({
        id: `listen:${w}:${j}`,
        kind: "listen",
        bot: i,
        piece: w,
        result: l.result,
        handler: l.handler,
        role: "dash",
        label: `${p.name} shows ${bots[i].name}'s ${l.result}`,
        needs: [`bot:${i}`, `place:${w}`],
      });
    });
  });
  return steps;
}

const lower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

/** The plan's new bots — the ones a build saves. */
function botPieces(plan) {
  return ((plan && plan.pieces) || []).filter(
    (p) => p && p.kind === "bot" && p.source === "new",
  );
}

function indexByName(list) {
  const out = new Map();
  list.forEach((p, i) => {
    if (!out.has(lower(p.name))) out.set(lower(p.name), i);
  });
  return out;
}

/** What a widget piece needs to have happened before it can be placed. */
function blockersFor(step, steps) {
  if (Array.isArray(step.needs)) {
    return steps.filter((s) => step.needs.includes(s.id));
  }
  if (step.kind === "check")
    return steps.filter((s) => s.id === `build:${step.piece}`);
  if (step.kind === "place") {
    return steps.filter(
      (s) =>
        s.id === "dashboard" ||
        s.id === `install:${step.piece}` ||
        s.id === `build:${step.piece}` ||
        s.id === `check:${step.piece}`,
    );
  }
  return [];
}

/**
 * The Builder's request for one widget. With `fix` ({ package, problem }) it
 * asks the Builder to fix what it built (Let Builder fix it, 4d-3).
 */
function buildRequest(plan, piece, fix = null) {
  const providers = (piece.providers || []).join(", ") || "none";
  const update = piece.source === "update" || !!(fix && fix.package);
  const first = fix
    ? fix.package
      ? `Fix the widget ${fix.package} you built for this plan.`
      : `Build this plan's widget again — the last try didn't work.`
    : piece.source === "update"
      ? `Update the widget ${piece.package || piece.name} for this plan.`
      : `Build a new widget for this plan.`;
  return [
    first,
    ...(fix ? [`What went wrong: ${fix.problem}`] : []),
    `Plan: ${plan.summary || ""}`,
    `Widget: ${piece.name}${piece.notes ? ` — ${piece.notes}` : ""}`,
    `Providers: ${providers}`,
    ...wiringLines(plan, piece),
    `Use a PascalCase name based on "${piece.name}"${
      fix && fix.package ? " (keep the same name)" : ""
    }. Read widget_guide first, then build_widget${
      update ? " with update: true" : ""
    }. Finish with the widget's package name (@ai-built/…).`,
  ].join("\n");
}

/**
 * The events a widget must send: its own, plus any a planned bot starts on
 * (the bot's `on` wins when the two disagree — both are sent).
 */
function eventsToSend(plan, piece) {
  return [
    ...(Array.isArray(piece.events) ? piece.events : []),
    ...botPieces(plan).flatMap((b) =>
      (Array.isArray(b.on) ? b.on : [])
        .filter((o) => o && lower(o.widget) === lower(piece.name))
        .map((o) => o.event),
    ),
  ].filter((e, i, all) => e && all.indexOf(e) === i);
}

/**
 * The Checker's request for one widget. A widget made new in this build has
 * no users yet, so a config that changed since its first version isn't a
 * breaking change — and after Let Builder fix it, the Checker is told what
 * the fix was for, so the change it asked for isn't held against it (4d-3).
 */
function checkRequest(plan, piece, made = {}) {
  const lines = [
    `Check ${made.package}. Run check_widget, read the code if you need to, and end with VERDICT: PASSED or VERDICT: FAILED.`,
  ];
  const sends = eventsToSend(plan, piece);
  if (sends.length) {
    lines.push(`The plan needs it to send: ${sends.join(", ")}.`);
  }
  if (piece.source === "new") {
    lines.push(
      "It was made new in this build, so nothing else uses an earlier version: a config that changed since then is not a breaking change.",
    );
  }
  if (made.fixedFor) {
    lines.push(
      `The Builder just changed it to fix this: ${made.fixedFor}\nA change that fix asked for is not a problem — judge the widget against the plan.`,
    );
  }
  return lines.join("\n");
}

/** What the plan wires to this widget — the Builder must declare it. */
function wiringLines(plan, piece) {
  const lines = [];
  const events = eventsToSend(plan, piece);
  if (events.length) {
    const starts = botPieces(plan)
      .filter((b) =>
        (b.on || []).some((o) => o && lower(o.widget) === lower(piece.name)),
      )
      .map((b) => b.name);
    lines.push(
      `It must publish these events with publishEvent from useWidgetEvents (never api.publishEvent — bots can't hear that) and list them in events in its .dash.js: ${events.join(", ")}${
        starts.length
          ? ` (they start the ${starts.join(", ")} bot — Dash wires that)`
          : ""
      }.`,
    );
  }
  if (events.length && !(piece.providers || []).length) {
    lines.push(
      "It's an action widget: give it a title, a short line saying what the button does, and a sent status after it's pressed (as in the widget rules' Action widgets section). It needs no provider, so no loading or empty states.",
    );
  }
  const listens = Array.isArray(piece.listens) ? piece.listens : [];
  for (const l of listens) {
    if (!l || !l.handler) continue;
    lines.push(
      `It must declare the event handler ${l.handler} (eventHandlers in its .dash.js) and show what arrives there: the ${l.bot} bot's "${l.result}" result. Dash wires the listener.`,
    );
  }
  return lines;
}

/**
 * A plan's new bot as a bot definition, saved exactly as planned
 * (team-dashboards TD-008): checked like a draft — only the user's providers
 * and tools, a valid schedule, valid result names — with its providers and
 * tools taken as chosen. Throws when it can't work (a provider that isn't
 * connected) rather than saving a bot that can't.
 * @param {object} piece  the plan's bot piece
 * @param {{ dashboardId, sources, team }} ctx  sources = listToolSources
 */
function planBotDefinition(piece, { dashboardId, sources, team }) {
  const res = buildDraft({
    proposal: {
      name: piece.name,
      instructions: piece.instructions,
      providers: (Array.isArray(piece.tools) ? piece.tools : []).map((t) => ({
        name: t && t.provider,
        tools: (t && t.tools) || [],
      })),
      schedule: piece.schedule || null,
      publishes: Array.isArray(piece.results) ? piece.results : [],
      reasoning: piece.notes || "",
    },
    sources: sources || [],
    team: team || [],
    workspaceId: dashboardId,
    leadId: null,
    knownProviders: {},
    author: "dash-team",
  });
  if (res.error) throw new Error(res.error);
  const draft = res.draft;
  if (draft.missing.length) {
    // The build waits for these instead of failing (CRE-004 AC5).
    const err = new Error(
      `${piece.name} needs ${draft.missing.join(", ")}, which isn't connected`,
    );
    err.waitingFor = draft.missing.slice();
    throw err;
  }
  const definition = {
    ...draft.definition,
    mcpServers: [],
    toolSelections: {},
  };
  for (const sug of draft.suggestions) {
    definition.mcpServers.push(sug.provider);
    if (sug.tools.length) definition.toolSelections[sug.provider] = sug.tools;
  }
  return definition;
}

// `api.publishEvent(...)` publishes the bare name — no widget prefix — so no
// bot subscription can match it. Widgets publish with useWidgetEvents'
// publishEvent (or the publishEvent prop), which adds the prefix.
const RAW_PUBLISH = /\bapi\s*(?:\?\.|\.)\s*publishEvent\s*\(/;

/** True when widget code publishes with the raw api.publishEvent. */
function publishesRaw(componentCode) {
  return RAW_PUBLISH.test(String(componentCode || ""));
}

/**
 * The events a widget sends and the handlers it declares, from its .dash.js
 * source — null when it can't be read (then wiring isn't checked) — and
 * whether its code publishes with the raw api.publishEvent (rawPublish).
 */
function widgetWiring(configCode, componentCode = "") {
  if (!configCode) return null;
  let parsed;
  try {
    parsed = parseDashConfig(configCode);
  } catch (_e) {
    return null;
  }
  if (!parsed || !parsed.ok || !parsed.config) return null;
  const handlers = (
    Array.isArray(parsed.config.eventHandlers)
      ? parsed.config.eventHandlers
      : []
  )
    .map((h) => (typeof h === "string" ? h : h && (h.name || h.handler)))
    .filter(Boolean);
  return {
    events: eventNames(parsed.config),
    handlers,
    rawPublish: publishesRaw(componentCode),
  };
}

/** A bot's subscription to one placed widget's event (TD-006). */
function triggerSubscription({ dashboardId, widgetId, component, event }) {
  return {
    eventType: `${component}[${widgetId}].${event}`,
    source: {
      kind: "widget",
      ref: component,
      instanceId: String(widgetId),
      event,
      workspaceId: String(dashboardId),
    },
    label: `${String(component).split(".").pop()} › ${event}`,
  };
}

/** The package the Builder says it built (the last @ai-built/… it names). */
function builtPackage(output) {
  const hits = String(output || "").match(AI_BUILT);
  return hits && hits.length ? hits[hits.length - 1] : null;
}

/** "VERDICT: PASSED" / "FAILED" at the end of the Checker's answer. */
function verdictOf(output) {
  const m = /VERDICT:\s*(PASSED|FAILED)/i.exec(String(output || ""));
  return m ? m[1].toUpperCase() : null;
}

function tokensOf(usage) {
  const u = usage || {};
  return (
    (Number(u.inputTokens) || 0) +
    (Number(u.outputTokens) || 0) +
    (Number(u.cacheReadTokens) || 0) +
    (Number(u.cacheWriteTokens) || 0)
  );
}

const widgetPieces = (plan) =>
  ((plan && plan.pieces) || []).filter((p) => p && p.kind === "widget");

const BUILT = new Set(["new", "update"]);

/** What makes a planned widget or bot "the same" across plan edits. */
function pieceSignature(p) {
  if (!p) return "";
  if (p.kind === "bot") {
    return JSON.stringify([
      p.instructions || "",
      p.tools || [],
      p.schedule || null,
      p.results || [],
      p.on || [],
      !!p.showResults,
    ]);
  }
  return BUILT.has(p.source)
    ? JSON.stringify([
        p.source,
        p.package || "",
        p.providers || [],
        p.events || [],
        p.listens || [],
        p.notes || "",
      ])
    : JSON.stringify([p.source, p.package || ""]);
}

/** new index → old index, by kind and name (first match wins). */
function matchByName(list, prevList) {
  const prevIndex = indexByName(prevList);
  const out = new Map();
  list.forEach((p, i) => {
    const j = prevIndex.get(lower(p.name));
    if (j !== undefined) out.set(i, j);
  });
  return out;
}

/**
 * Reuse what an earlier build of this plan made (Edit plan, 4d-3): the same
 * dashboard; unchanged widgets and bots are kept as they are; a changed
 * widget the Builder made is updated in place (it stays placed); a changed
 * bot is saved over the old one. Pieces the edited plan dropped are left
 * where they are and listed in state.leftovers.
 */
function reuseEarlier(plan, steps, state, earlier) {
  const prev = earlier && earlier.state;
  if (!prev || !prev.dashboard || !earlier.plan) return;
  const widgets = widgetPieces(plan);
  const prevWidgets = widgetPieces(earlier.plan);
  const prevMade = prev.made || {};
  const byId = new Map(steps.map((s) => [s.id, s]));
  const prevById = new Map((prev.steps || []).map((s) => [s.id, s]));
  const keep = (id, prevId) => {
    const s = byId.get(id);
    const p = prevById.get(prevId);
    if (!s || !p || p.status !== STATUS.done) return false;
    s.status = STATUS.done;
    s.detail = p.detail;
    s.reused = true;
    return true;
  };
  // Carried from earlier edits too, so Remove still finds them.
  const leftovers = Array.isArray(prev.leftovers) ? prev.leftovers.slice() : [];
  const widgetLeftover = (j) => {
    const p = prevWidgets[j];
    const made = prevMade[j] || {};
    const built = (prev.steps || []).some(
      (x) => x.id === `build:${j}` && x.status === STATUS.done,
    );
    return {
      kind: "widget",
      name: p.name,
      package: made.package || p.package || null,
      // Made by this build (not an update of an earlier widget).
      built: built && p.source === "new",
    };
  };

  state.dashboard = { ...prev.dashboard };
  const dash = byId.get("dashboard");
  if (dash) {
    dash.status = STATUS.done;
    dash.detail = prev.dashboard.name;
    dash.reused = true;
  }

  const wMatch = matchByName(widgets, prevWidgets);
  wMatch.forEach((j, i) => {
    const same = pieceSignature(widgets[i]) === pieceSignature(prevWidgets[j]);
    const made = prevMade[j] || {};
    if (same) {
      ["install", "build", "check", "place"].forEach((k) =>
        keep(`${k}:${i}`, `${k}:${j}`),
      );
      state.made[i] = { ...made };
    } else if (
      BUILT.has(widgets[i].source) &&
      BUILT.has(prevWidgets[j].source) &&
      made.package
    ) {
      // Changed: the Builder updates what it made; it stays placed.
      const b = byId.get(`build:${i}`);
      if (b) {
        b.fix = {
          package: made.package,
          problem: "the plan for this widget changed — make it match the plan",
        };
      }
      keep(`place:${i}`, `place:${j}`);
      state.made[i] = { ...made };
    } else if (made.widgetId != null || made.package) {
      leftovers.push(widgetLeftover(j));
    }
    if (prev.fixes && prev.fixes[j]) state.fixes[i] = prev.fixes[j];
  });
  const matchedW = new Set(wMatch.values());
  prevWidgets.forEach((_p, j) => {
    const made = prevMade[j];
    if (!matchedW.has(j) && made && (made.widgetId != null || made.package)) {
      leftovers.push(widgetLeftover(j));
    }
  });

  const bots = botPieces(plan);
  const prevBots = botPieces(earlier.plan);
  const bMatch = matchByName(bots, prevBots);
  const prevSaved = prev.bots || {};
  bMatch.forEach((j, i) => {
    const saved = prevSaved[j];
    if (!saved) return;
    state.bots[i] = { ...saved };
    if (pieceSignature(bots[i]) === pieceSignature(prevBots[j])) {
      keep(`bot:${i}`, `bot:${j}`);
    } else {
      // Changed: saved over the old bot (its triggers stay; new ones added).
      const s = byId.get(`bot:${i}`);
      if (s) s.replaces = saved.id;
    }
    keep(`results:${i}`, `results:${j}`);
  });
  const matchedB = new Set(bMatch.values());
  prevBots.forEach((p, j) => {
    if (!matchedB.has(j) && prevSaved[j]) {
      leftovers.push({ kind: "bot", name: p.name, id: prevSaved[j].id });
    }
  });

  // Wiring: kept when the same bot, widget and event (or handler) were wired.
  const oldW = new Map(wMatch);
  const oldB = new Map(bMatch);
  for (const s of steps) {
    if (s.kind !== "trigger" && s.kind !== "listen") continue;
    const p = (prev.steps || []).find(
      (x) =>
        x.kind === s.kind &&
        x.status === STATUS.done &&
        x.bot === oldB.get(s.bot) &&
        x.piece === oldW.get(s.piece) &&
        (s.kind === "trigger"
          ? x.event === s.event
          : x.handler === s.handler && x.result === s.result),
    );
    if (p) keep(s.id, p.id);
  }
  state.leftovers = leftovers;
}

/**
 * What a build has made so far, for Remove what was built (4d-3):
 *   dashboard  { id, name } | null — deleted
 *   bots       [{ id, name }] — deleted
 *   widgets    [package] — widgets the Builder made new here; uninstalled
 *   updated    [package] — widgets it updated; they keep their changes
 *   installs   [package] — registry installs; they stay installed
 * Includes what an earlier build of the plan made (state.leftovers).
 */
function builtSummary(state, plan) {
  const pieces = widgetPieces(plan);
  const out = {
    dashboard: state.dashboard ? { ...state.dashboard } : null,
    bots: [],
    widgets: [],
    updated: [],
    installs: [],
  };
  const add = (list, v) => v && !list.includes(v) && list.push(v);
  for (const step of state.steps || []) {
    if (step.status !== STATUS.done) continue;
    const piece = step.piece != null ? pieces[step.piece] : null;
    const made = (step.piece != null && state.made[step.piece]) || {};
    if (step.kind === "install") add(out.installs, piece && piece.package);
    if (step.kind === "build") {
      add(
        piece && piece.source === "update" ? out.updated : out.widgets,
        made.package,
      );
    }
  }
  for (const b of Object.values(state.bots || {})) {
    if (b && b.id && !out.bots.some((x) => x.id === b.id)) out.bots.push(b);
  }
  for (const l of state.leftovers || []) {
    if (l.kind === "bot" && l.id && !out.bots.some((x) => x.id === l.id)) {
      out.bots.push({ id: l.id, name: l.name });
    }
    if (l.kind === "widget" && l.built) add(out.widgets, l.package);
  }
  return out;
}

/**
 * Run a plan build.
 * @param {object} plan  the approved plan
 * @param {object} deps
 *   installWidget(pkg, piece) → { component } | throws
 *   createDashboard(name, pieceCount) → { id, name } | throws
 *   askRole(role, request) → run record ({ status, output, error, model, usage, cost, skipped, reason })
 *   abortRole(role)
 *   placeWidget({ dashboardId, component|widget }) → { component, widgetId } | throws
 *   saveBot({ dashboardId, piece, botId? }) → { id, name } | throws (an
 *     error with waitingFor = provider names → the step waits for them)
 *   placeBotResults({ dashboardId, botId }) → { component, widgetId } | throws
 *   wireTrigger({ dashboardId, botId, widgetId, component, event }) | throws
 *   wireListener({ dashboardId, widgetId, component, handler, botId, result }) | throws
 *   emit(state)   progress after every change
 *   now()
 * @param {{ dashboardName?: string, resume?: { plan, state } }} [opts]
 *   resume — an earlier build of this plan whose work is reused (Edit plan)
 * @returns {{ state, run, stop, fix, retry, resume }} — run/fix/retry/resume
 *   resolve with the state when that pass ends, or { error }
 */
function createPlanBuild(plan, deps, opts = {}) {
  const now = deps.now || (() => new Date().toISOString());
  const steps = planSteps(plan, opts);
  const state = {
    status: "waiting",
    startedAt: null,
    finishedAt: null,
    steps,
    dashboard: null, // { id, name }
    // piece index → { component?, package?, widgetId? } — what to place
    made: {},
    // bot index → { id, name } — saved bots (offered as Run now at the end)
    bots: {},
    // piece index → how many times the Builder has fixed it
    fixes: {},
    // what an earlier build made that the edited plan no longer has
    leftovers: [],
    totals: { tokens: 0, usd: 0, includedInPlan: true },
  };
  reuseEarlier(plan, steps, state, opts.resume);
  let stopping = false;
  let current = null;
  let busy = false;
  const pieces = widgetPieces(plan);
  const bots = botPieces(plan);
  const emit = () => {
    state.built = builtSummary(state, plan);
    if (deps.emit) deps.emit(JSON.parse(JSON.stringify(state)));
  };

  const account = (step, record) => {
    if (!record) return;
    const tokens = tokensOf(record.usage);
    const c = record.cost || null;
    const usd = c && typeof c.usd === "number" ? c.usd : 0;
    step.model = record.model || null;
    // A fixed step adds up every try.
    step.tokens = (step.tokens || 0) + tokens;
    step.usd = (step.usd || 0) + usd;
    step.includedInPlan = !!(c && c.includedInPlan);
    state.totals.tokens += tokens;
    state.totals.usd += usd;
    if (c && !c.includedInPlan) state.totals.includedInPlan = false;
  };

  async function runStep(step) {
    const piece = step.piece != null ? pieces[step.piece] : null;
    switch (step.kind) {
      case "install": {
        const res = await deps.installWidget(piece.package, piece);
        state.made[step.piece] = {
          component: res && res.component,
          package: piece.package,
        };
        step.detail = res && res.component ? res.component : piece.package;
        return;
      }
      case "dashboard": {
        const ws = await deps.createDashboard(step.name, pieces.length);
        state.dashboard = { id: String(ws.id), name: ws.name || step.name };
        step.detail = state.dashboard.name;
        return;
      }
      case "build": {
        const record = await deps.askRole(
          "builder",
          buildRequest(plan, piece, step.fix || null),
        );
        account(step, record);
        if (!record || record.skipped)
          throw new Error(
            `the Builder didn't run: ${(record && record.reason) || "unknown"}`,
          );
        if (record.status === "failed")
          throw new Error(record.error || "the Builder failed");
        const pkg = builtPackage(record.output);
        if (!pkg) throw new Error("the Builder didn't build it");
        state.made[step.piece] = {
          ...state.made[step.piece],
          package: pkg,
          // What this pass fixed — the Checker judges the change by it.
          fixedFor: step.fix ? step.fix.problem : null,
        };
        step.detail = pkg;
        step.fix = null;
        return;
      }
      case "check": {
        const made = state.made[step.piece] || {};
        const record = await deps.askRole(
          "checker",
          checkRequest(plan, piece, made),
        );
        account(step, record);
        if (!record || record.skipped)
          throw new Error(
            `the Checker didn't run: ${(record && record.reason) || "unknown"}`,
          );
        if (record.status === "failed")
          throw new Error(record.error || "the Checker failed");
        const verdict = verdictOf(record.output);
        step.detail = record.output ? String(record.output).slice(-1500) : "";
        if (verdict !== "PASSED") {
          throw new Error(
            verdict === "FAILED"
              ? "the Checker found problems"
              : "the Checker gave no verdict",
          );
        }
        return;
      }
      case "place": {
        const made = state.made[step.piece] || {};
        const res = await deps.placeWidget({
          dashboardId: state.dashboard.id,
          component: made.component || null,
          widget: made.package || piece.package,
        });
        state.made[step.piece] = {
          ...made,
          component: (res && res.component) || made.component || null,
          widgetId: res && res.widgetId != null ? res.widgetId : null,
        };
        step.detail =
          res && res.component ? res.component : made.package || piece.package;
        return;
      }
      case "bot": {
        const saved = await deps.saveBot({
          dashboardId: state.dashboard.id,
          piece: bots[step.bot],
          ...(step.replaces ? { botId: step.replaces } : {}),
        });
        state.bots[step.bot] = { id: saved.id, name: saved.name };
        step.detail = saved.name;
        return;
      }
      case "results": {
        const res = await deps.placeBotResults({
          dashboardId: state.dashboard.id,
          botId: state.bots[step.bot].id,
        });
        step.detail = res && res.component ? res.component : "Bot results";
        return;
      }
      case "trigger": {
        const made = state.made[step.piece] || {};
        await deps.wireTrigger({
          dashboardId: state.dashboard.id,
          botId: state.bots[step.bot].id,
          widgetId: made.widgetId,
          component: made.component,
          event: step.event,
        });
        step.detail = `${made.component}[${made.widgetId}].${step.event}`;
        return;
      }
      case "listen": {
        const made = state.made[step.piece] || {};
        await deps.wireListener({
          dashboardId: state.dashboard.id,
          widgetId: made.widgetId,
          component: made.component,
          handler: step.handler,
          botId: state.bots[step.bot].id,
          result: step.result,
        });
        step.detail = `${step.handler} ← ${step.result}`;
        return;
      }
      default:
        throw new Error(`unknown step ${step.kind}`);
    }
  }

  // What the user can do about a failed step (CRE-004 AC4): the Builder can
  // fix a widget it made (at most MAX_FIXES times); Dash's own steps can run
  // again. Edit plan and Remove what was built are always there.
  const BUILDER_FIXES = new Set(["build", "check", "trigger", "listen"]);
  const RETRIES = new Set(["install", "dashboard", "place", "bot", "results"]);
  function markOptions(step) {
    const piece = step.piece != null ? pieces[step.piece] : null;
    const used = step.piece != null ? state.fixes[step.piece] || 0 : 0;
    step.fixesLeft =
      piece && BUILT.has(piece.source) && BUILDER_FIXES.has(step.kind)
        ? Math.max(0, MAX_FIXES - used)
        : 0;
    step.canFix = step.fixesLeft > 0;
    // The Builder's tries are used up — over to the user.
    step.fixesUsedUp =
      !!piece &&
      BUILT.has(piece.source) &&
      BUILDER_FIXES.has(step.kind) &&
      !step.canFix;
    step.canRetry = RETRIES.has(step.kind);
  }

  function reset(step) {
    step.status = STATUS.waiting;
    for (const k of [
      "error",
      "canFix",
      "canRetry",
      "fixesLeft",
      "fixesUsedUp",
      "waitingFor",
      "startedAt",
      "finishedAt",
    ]) {
      delete step[k];
    }
  }

  // A step can't run until what it needs is done; when what it needs is
  // waiting for a provider, it waits too.
  function hold(step) {
    const blocked = blockersFor(step, steps).find(
      (b) => b.status !== STATUS.done,
    );
    if (!blocked) return false;
    if (blocked.status === STATUS.needsProvider) {
      step.status = STATUS.needsProvider;
      step.waitingFor = (blocked.waitingFor || []).slice();
    } else {
      step.status = STATUS.skipped;
      step.error = `${blocked.label} didn't finish`;
    }
    return true;
  }

  async function run() {
    if (busy) return { error: "The build is still running." };
    busy = true;
    stopping = false;
    state.status = "running";
    state.startedAt = state.startedAt || now();
    state.finishedAt = null;
    emit();
    for (const step of steps) {
      if (step.status !== STATUS.waiting) continue;
      if (stopping) {
        step.status = STATUS.stopped;
        continue;
      }
      if (hold(step)) {
        emit();
        continue;
      }
      step.status = STATUS.running;
      step.startedAt = now();
      current = step;
      emit();
      try {
        await runStep(step);
        step.status = STATUS.done;
      } catch (err) {
        const waitingFor =
          err && Array.isArray(err.waitingFor) && err.waitingFor;
        if (waitingFor && waitingFor.length && !stopping) {
          step.status = STATUS.needsProvider;
          step.waitingFor = waitingFor.slice();
        } else {
          step.status = stopping ? STATUS.stopped : STATUS.failed;
          step.error = (err && err.message) || String(err);
          if (step.status === STATUS.failed) markOptions(step);
        }
      }
      step.finishedAt = now();
      current = null;
      emit();
    }
    state.status = stopping
      ? "stopped"
      : steps.some(
            (s) => s.status === STATUS.failed || s.status === STATUS.skipped,
          )
        ? "finished-with-problems"
        : steps.some((s) => s.status === STATUS.needsProvider)
          ? "waiting-for-providers"
          : "done";
    state.finishedAt = now();
    busy = false;
    emit();
    return state;
  }

  // Skipped steps get another go after a fix or retry: what held them back
  // may be done now (if not, they're skipped again).
  const resetSkipped = () =>
    steps.filter((s) => s.status === STATUS.skipped).forEach(reset);

  /** Let Builder fix it: the Builder fixes the widget, then it's checked again. */
  function fix(stepId) {
    const step = steps.find((s) => s.id === stepId);
    if (busy) return Promise.resolve({ error: "The build is still running." });
    if (!step || step.status !== STATUS.failed || !step.canFix) {
      return Promise.resolve({ error: "The Builder can't fix that step." });
    }
    const w = step.piece;
    state.fixes[w] = (state.fixes[w] || 0) + 1;
    const made = state.made[w] || {};
    const build = steps.find((s) => s.id === `build:${w}`);
    const check = steps.find((s) => s.id === `check:${w}`);
    const problem = [
      `${step.label}: ${step.error}`,
      step.kind === "check" && step.detail
        ? `The Checker said:\n${step.detail}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    if (build) {
      reset(build);
      build.fix = { package: made.package || null, problem };
    }
    if (check) reset(check);
    reset(step);
    resetSkipped();
    return run();
  }

  /** Try again: one of Dash's own steps runs again. */
  function retry(stepId) {
    const step = steps.find((s) => s.id === stepId);
    if (busy) return Promise.resolve({ error: "The build is still running." });
    if (!step || step.status !== STATUS.failed || !step.canRetry) {
      return Promise.resolve({ error: "That step can't be tried again." });
    }
    reset(step);
    resetSkipped();
    return run();
  }

  /** Providers were connected: the steps waiting for them run (AC5). */
  function resume() {
    if (busy) return Promise.resolve({ error: "The build is still running." });
    const waiting = steps.filter((s) => s.status === STATUS.needsProvider);
    if (!waiting.length) {
      return Promise.resolve({ error: "Nothing is waiting." });
    }
    waiting.forEach(reset);
    return run();
  }

  function stop() {
    stopping = true;
    if (current && current.role !== "dash" && deps.abortRole)
      deps.abortRole(current.role);
  }

  return { state, run, stop, fix, retry, resume };
}

module.exports = {
  STATUS,
  MAX_FIXES,
  builtSummary,
  pieceSignature,
  reuseEarlier,
  planSteps,
  blockersFor,
  botPieces,
  wiringLines,
  planBotDefinition,
  triggerSubscription,
  widgetWiring,
  publishesRaw,
  buildRequest,
  checkRequest,
  eventsToSend,
  builtPackage,
  verdictOf,
  createPlanBuild,
};
