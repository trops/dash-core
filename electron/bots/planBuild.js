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
};

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

/** The Builder's request for one widget. */
function buildRequest(plan, piece) {
  const providers = (piece.providers || []).join(", ") || "none";
  return [
    piece.source === "update"
      ? `Update the widget ${piece.package || piece.name} for this plan.`
      : `Build a new widget for this plan.`,
    `Plan: ${plan.summary || ""}`,
    `Widget: ${piece.name}${piece.notes ? ` — ${piece.notes}` : ""}`,
    `Providers: ${providers}`,
    ...wiringLines(plan, piece),
    `Use a PascalCase name based on "${piece.name}". Read widget_guide first, then build_widget${
      piece.source === "update" ? " with update: true" : ""
    }. Finish with the widget's package name (@ai-built/…).`,
  ].join("\n");
}

/** What the plan wires to this widget — the Builder must declare it. */
function wiringLines(plan, piece) {
  const lines = [];
  const events = Array.isArray(piece.events)
    ? piece.events.filter(Boolean)
    : [];
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
    throw new Error(
      `${piece.name} needs ${draft.missing.join(", ")}, which isn't connected`,
    );
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

/**
 * Run a plan build.
 * @param {object} plan  the approved plan
 * @param {object} deps
 *   installWidget(pkg, piece) → { component } | throws
 *   createDashboard(name, pieceCount) → { id, name } | throws
 *   askRole(role, request) → run record ({ status, output, error, model, usage, cost, skipped, reason })
 *   abortRole(role)
 *   placeWidget({ dashboardId, component|widget }) → { component, widgetId } | throws
 *   saveBot({ dashboardId, piece }) → { id, name } | throws
 *   placeBotResults({ dashboardId, botId }) → { component, widgetId } | throws
 *   wireTrigger({ dashboardId, botId, widgetId, component, event }) | throws
 *   wireListener({ dashboardId, widgetId, component, handler, botId, result }) | throws
 *   emit(state)   progress after every change
 *   now()
 * @param {{ dashboardName?: string }} [opts]
 * @returns {{ state, run: () => Promise<state>, stop: () => void }}
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
    // piece index → { component?, package? } — what to place
    made: {},
    // bot index → { id, name } — saved bots (offered as Run now at the end)
    bots: {},
    totals: { tokens: 0, usd: 0, includedInPlan: true },
  };
  let stopping = false;
  let current = null;
  const pieces = (plan.pieces || [])
    .filter(Boolean)
    .filter((p) => p.kind === "widget");
  const bots = botPieces(plan);
  const emit = () => deps.emit && deps.emit(JSON.parse(JSON.stringify(state)));

  const account = (step, record) => {
    if (!record) return;
    step.model = record.model || null;
    step.tokens = tokensOf(record.usage);
    const c = record.cost || null;
    step.usd = c && typeof c.usd === "number" ? c.usd : 0;
    step.includedInPlan = !!(c && c.includedInPlan);
    state.totals.tokens += step.tokens;
    state.totals.usd += step.usd;
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
        const record = await deps.askRole("builder", buildRequest(plan, piece));
        account(step, record);
        if (!record || record.skipped)
          throw new Error(
            `the Builder didn't run: ${(record && record.reason) || "unknown"}`,
          );
        if (record.status === "failed")
          throw new Error(record.error || "the Builder failed");
        const pkg = builtPackage(record.output);
        if (!pkg) throw new Error("the Builder didn't build it");
        state.made[step.piece] = { package: pkg };
        step.detail = pkg;
        return;
      }
      case "check": {
        const made = state.made[step.piece] || {};
        const record = await deps.askRole(
          "checker",
          `Check ${made.package}. Run check_widget, read the code if you need to, and end with VERDICT: PASSED or VERDICT: FAILED.`,
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

  async function run() {
    state.status = "running";
    state.startedAt = now();
    emit();
    for (const step of steps) {
      if (stopping) {
        step.status = STATUS.stopped;
        continue;
      }
      const blocked = blockersFor(step, steps).find(
        (b) => b.status !== STATUS.done,
      );
      if (blocked) {
        step.status = STATUS.skipped;
        step.error = `${blocked.label} didn't finish`;
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
        step.status = stopping ? STATUS.stopped : STATUS.failed;
        step.error = (err && err.message) || String(err);
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
        : "done";
    state.finishedAt = now();
    emit();
    return state;
  }

  function stop() {
    stopping = true;
    if (current && current.role !== "dash" && deps.abortRole)
      deps.abortRole(current.role);
  }

  return { state, run, stop };
}

module.exports = {
  STATUS,
  planSteps,
  blockersFor,
  botPieces,
  wiringLines,
  planBotDefinition,
  triggerSubscription,
  widgetWiring,
  publishesRaw,
  buildRequest,
  builtPackage,
  verdictOf,
  createPlanBuild,
};
