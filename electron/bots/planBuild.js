/**
 * planBuild.js — build an approved Dash team plan (create-entry PRD CRE-004,
 * CRE-012 AC3, team-dashboards TD-008; phase 4d-1).
 *
 * Steps, in order:
 *   install     each approved registry widget                 Dash · no AI
 *   dashboard   create the dashboard the widgets go on        Dash · no AI
 *               (or use the one the plan names — 5e-2b)
 *   theme       apply one of the user's saved themes          Dash · no AI
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
 *   opts.autoFix   a failed build or check is fixed that way by itself, as
 *                  soon as it fails — the user only sees what's left after
 *   retry(stepId)  a failed Dash step runs again
 *   resume()       steps waiting for a provider that wasn't connected run
 *   opts.resume    an edited plan reuses what an earlier build already made
 * Finished steps are never run twice.
 *
 * Pure (NFR-006): every effect is an injected hook.
 */
"use strict";

const { buildDraft } = require("./botDrafts");
const { eventNames, settingsOf } = require("./configDiff");
const { parseDashConfig } = require("../utils/dashConfigParser");
const { planPages, planTarget } = require("./teamPlan");
const { removeWidgets } = require("../utils/placeWidget");

const AI_BUILT = /@ai-built\/[a-z0-9][a-z0-9-]*/gi;

// Placing failed because the widget couldn't be told apart — trying the same
// thing again can't help (widgetComponent.js's errors).
const CANT_TELL_WHICH =
  /has several widgets|has no component|isn't a widget package/;

// How much of the Builder's answer a failed build keeps.
const ANSWER_KEPT = 1500;

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

/**
 * The new dashboard's name: the layout piece's, without a trailing
 * "layout" (the Planner sometimes names the piece "Sales layout").
 */
function dashboardNameOf(layout) {
  const name = String((layout && layout.name) || "").trim();
  const bare = name.replace(/\s+layout$/i, "").trim();
  return bare || name || "New dashboard";
}

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
  // A plan that changes a dashboard the user has uses it instead (5e-2b).
  const target = planTarget(plan);
  if (target) {
    add({
      id: "dashboard",
      kind: "dashboard",
      role: "dash",
      label: `Use the "${target.name}" dashboard`,
      name: target.name,
      target: target.id,
    });
  } else {
    add({
      id: "dashboard",
      kind: "dashboard",
      role: "dash",
      label: `Create the "${dashboardName || dashboardNameOf(layout)}" dashboard`,
      name: dashboardName || dashboardNameOf(layout),
    });
  }
  const theme = pieces.find((p) => p.kind === "theme" && p.name);
  if (theme) {
    add({
      id: "theme",
      kind: "theme",
      role: "dash",
      label: `Apply the ${theme.name} theme`,
      theme: String(theme.name).trim(),
      needs: ["dashboard"],
    });
  }
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

/** An error a Builder fix can't help with (the role didn't run, or broke). */
function notFixable(message) {
  const err = new Error(message);
  err.notFixable = true;
  return err;
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
    }${
      update
        ? ""
        : " (if it says the widget already exists, build it again with update: true)"
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

const isStr = (v) => typeof v === "string";

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
  if (isStr(piece.notes) && piece.notes.trim()) {
    lines.push(`What the plan says it does: ${piece.notes.trim()}`);
  }
  const connections = Object.entries(
    piece.provider && typeof piece.provider === "object" ? piece.provider : {},
  ).filter(([type, name]) => type && isStr(name) && name.trim());
  for (const [type, name] of connections) {
    lines.push(
      `It must use the user's ${type} connection "${name.trim()}": a widget that asks for keys in its settings or calls ${type} itself with fetch fails.`,
    );
  }
  const settings = Object.keys(
    piece.settings && typeof piece.settings === "object" ? piece.settings : {},
  );
  if (settings.length) {
    lines.push(`The plan sets these settings: ${settings.join(", ")}.`);
  }
  const sends = eventsToSend(plan, piece);
  if (sends.length) {
    lines.push(`The plan needs it to send: ${sends.join(", ")}.`);
  }
  const checks = (Array.isArray(plan.checks) ? plan.checks : []).filter(
    (c) => isStr(c) && c.trim(),
  );
  if (checks.length) {
    lines.push(
      `The plan's checks — say for each whether the code does it (some need the running widget: say so):\n${checks
        .map((c) => `- ${c.trim()}`)
        .join("\n")}`,
    );
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

/** A widget's setting names (its userConfig keys), or null when unreadable. */
function settingKeys(configCode) {
  if (!configCode) return null;
  let parsed;
  try {
    parsed = parseDashConfig(configCode);
  } catch (_e) {
    return null;
  }
  if (!parsed || !parsed.ok || !parsed.config) return null;
  return Object.keys(settingsOf(parsed.config));
}

/**
 * A planned widget's connection and settings, checked before it's placed:
 * a connection the user has of that type (any case; its saved name kept),
 * settings the widget has (all kept when its settings can't be read).
 * @param {{ provider?, settings? }} piece
 * @param {{ connections: [{ name, type }], settingKeys: string[]|null }} ctx
 * @returns {{ selectedProviders, userPrefs, dropped: string[] }}
 */
function placeChoices(piece, { connections = [], settingKeys: keys = null }) {
  const out = { selectedProviders: {}, userPrefs: {}, dropped: [] };
  const provider = (piece && piece.provider) || {};
  for (const [type, name] of Object.entries(provider)) {
    const hit = (connections || []).find(
      (c) =>
        c && lower(c.type) === lower(type) && lower(c.name) === lower(name),
    );
    if (hit) out.selectedProviders[hit.type] = hit.name;
    else out.dropped.push(`connection "${name}"`);
  }
  const settings = (piece && piece.settings) || {};
  for (const [key, value] of Object.entries(settings)) {
    if (!keys || keys.includes(key)) out.userPrefs[key] = value;
    else out.dropped.push(`setting "${key}"`);
  }
  return out;
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
  return hits && hits.length ? hits[hits.length - 1].toLowerCase() : null;
}

/**
 * What a Builder run built: build_widget's own results (record.builds, noted
 * by the controller), else the package its answer names. A failure says why.
 * @returns {{ package: string } | { error: string }}
 */
function buildOutcome(record) {
  const builds = Array.isArray(record && record.builds) ? record.builds : [];
  const last = (pick) => builds.filter(pick).pop();
  const built = last((b) => b && b.ok && b.package);
  const pkg =
    (built && String(built.package).toLowerCase()) ||
    builtPackage(record && record.output);
  if (pkg) return { package: pkg };
  const failed = last((b) => b && !b.ok);
  const said =
    failed && failed.error ? String(failed.error).split("\n")[0].trim() : "";
  return {
    error: said
      ? `the Builder didn't build it — build_widget said: ${said}`
      : builds.length
        ? "the Builder didn't build it"
        : "the Builder didn't build it — it never called build_widget",
  };
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
      // Where it was placed (Remove on a dashboard you have takes it off).
      placed: placedOf(made),
    };
  };

  state.dashboard = { ...prev.dashboard };
  const dash = byId.get("dashboard");
  if (dash) {
    dash.status = STATUS.done;
    dash.detail = prev.dashboard.name;
    dash.reused = true;
  }
  // The theme it applied, and what was there before (Remove puts it back).
  if (prev.theme) {
    state.theme = { ...prev.theme };
    const t = byId.get("theme");
    if (t && t.theme === prev.theme.name) keep("theme", "theme");
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
  const prevResults = prev.results || {};
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
    if (keep(`results:${i}`, `results:${j}`) && prevResults[j]) {
      state.results[i] = { ...prevResults[j] };
    }
  });
  const matchedB = new Set(bMatch.values());
  prevBots.forEach((p, j) => {
    if (!matchedB.has(j) && prevSaved[j]) {
      leftovers.push({ kind: "bot", name: p.name, id: prevSaved[j].id });
    }
    // A results widget the edited plan no longer shows: still placed.
    const i = [...bMatch.keys()].find((k) => bMatch.get(k) === j);
    if (prevResults[j] && !(i !== undefined && state.results[i])) {
      leftovers.push({
        kind: "widget",
        name: `${p.name} results`,
        package: null,
        built: false,
        placed: { ...prevResults[j] },
      });
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

/** Where a widget was placed: { widgetId, component, pageId } or null. */
function placedOf(made) {
  return made && made.widgetId != null
    ? {
        widgetId: made.widgetId,
        component: made.component || null,
        pageId: made.pageId != null ? made.pageId : null,
      }
    : null;
}

/**
 * What a build has made so far, for Remove what was built (4d-3):
 *   dashboard  { id, name, targeted? } | null — deleted, unless targeted
 *              (a dashboard the user had, 5e-2b): then it stays, and
 *   placed     [{ widgetId, component, pageId }] — come off it
 *   theme      { name, key, previous, previousName } | null — previous
 *              (a saved theme's id; null = the app's theme) goes back
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
    placed: [],
    theme: state.theme ? { ...state.theme } : null,
  };
  const add = (list, v) => v && !list.includes(v) && list.push(v);
  const addPlaced = (p) =>
    p &&
    !out.placed.some(
      (x) => String(x.widgetId) === String(p.widgetId) && x.pageId === p.pageId,
    ) &&
    out.placed.push(p);
  for (const step of state.steps || []) {
    if (step.status !== STATUS.done) continue;
    const piece = step.piece != null ? pieces[step.piece] : null;
    const made = (step.piece != null && state.made[step.piece]) || {};
    if (step.kind === "install") add(out.installs, piece && piece.package);
    if (step.kind === "place") addPlaced(placedOf(made));
    if (step.kind === "results") {
      addPlaced(placedOf((state.results || {})[step.bot]));
    }
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
    if (l.kind === "widget") addPlaced(l.placed);
  }
  return out;
}

/**
 * The user's saved themes as { key, name } (themes.json is keyed by id; a
 * theme without a name goes by its id).
 */
function themeChoices(themes) {
  return Object.entries(themes || {}).map(([key, t]) => ({
    key,
    name:
      t && typeof t.name === "string" && t.name.trim() ? t.name.trim() : key,
  }));
}

/**
 * A plan's theme — by name (any case) or id — among the saved themes.
 * @returns {{ key, name } | { error }}
 */
function resolveTheme(themes, want) {
  const choices = themeChoices(themes);
  const w = String(want || "").trim();
  const byKey = choices.find((c) => c.key === w);
  if (byKey) return byKey;
  const byName = choices.filter(
    (c) => c.name.toLowerCase() === w.toLowerCase(),
  );
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    return {
      error: `more than one saved theme is called "${w}" — rename one in Themes`,
    };
  }
  return { error: `there's no saved theme called "${w}"` };
}

/**
 * Remove what was built on a dashboard the user had (5e-2b): the dashboard
 * with the build's widgets taken off and the theme it replaced put back —
 * only while the theme is still the one the build applied (the user may
 * have changed it since). The dashboard itself always stays.
 * @param {object} workspace  the dashboard as saved now
 * @param {object} built      builtSummary
 * @returns {{ workspace, placed: number, theme: string|null, changed: boolean }}
 *   theme — what it went back to ("" for the app's theme), null if untouched
 */
function undoOnDashboard(workspace, built) {
  const res = removeWidgets(workspace, (built && built.placed) || []);
  let next = res.workspace;
  let theme = null;
  const t = built && built.theme;
  if (t && (next.themeKey || null) === (t.key || t.name)) {
    next = { ...next, themeKey: t.previous || null };
    if (t.previous) next.theme = t.previous;
    else delete next.theme;
    theme = t.previousName || t.previous || "";
  }
  return {
    workspace: next,
    placed: res.removed,
    theme,
    changed: res.removed > 0 || theme !== null,
  };
}

/**
 * Run a plan build.
 * @param {object} plan  the approved plan
 * @param {object} deps
 *   installWidget(pkg, piece) → { component } | throws
 *   createDashboard(name, pieceCount, pages) → { id, name } | throws —
 *     pages: [{ name, widgets: count }], [] for one page
 *   useDashboard(id) → { id, name } | throws — a dashboard the user has
 *   applyTheme({ dashboardId, theme }) → { key, name, previous,
 *     previousName } | throws — theme by name; key = the saved theme's id
 *   askRole(role, request) → run record ({ status, output, error, model, usage, cost, skipped, reason })
 *   abortRole(role)
 *   placeWidget({ dashboardId, component|widget, name, page, provider,
 *     settings }) → { component, widgetId, pageId, dropped? } | throws —
 *     page: the page's name (null: the page shown); row / col: its planned
 *     cell (null: the next free one); dropped: what of the
 *     connection and settings it couldn't use, said under the step
 *   saveBot({ dashboardId, piece, botId? }) → { id, name } | throws (an
 *     error with waitingFor = provider names → the step waits for them)
 *   placeBotResults({ dashboardId, botId }) → { component, widgetId, pageId } | throws
 *   wireTrigger({ dashboardId, botId, widgetId, component, event }) | throws
 *   wireListener({ dashboardId, widgetId, component, handler, botId, result }) | throws
 *   emit(state)   progress after every change
 *   now()
 * @param {{ dashboardName?: string, resume?: { plan, state },
 *           autoFix?: boolean }} [opts]
 *   resume — an earlier build of this plan whose work is reused (Edit plan)
 *   autoFix — a failed build or check is fixed by the Builder by itself
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
    dashboard: null, // { id, name, targeted? }
    // piece index → { component?, package?, widgetId? } — what to place
    made: {},
    // bot index → { id, name } — saved bots (offered as Run now at the end)
    bots: {},
    // piece index → how many times the Builder has fixed it
    fixes: {},
    // bot index → its Bot results widget { component, widgetId, pageId }
    results: {},
    // the theme applied { name, key, previous, previousName } (5e-2b)
    theme: null,
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
  // The new dashboard's pages, and which one each widget goes on.
  const pages = planPages(plan);
  const pageOf = (i) => {
    const page = pages.find((p) => p.widgets.includes(i));
    return page ? page.name : null;
  };
  // Its planned cell ({ row, col }), or null: the next free one.
  const cellOf = (i) => {
    for (const p of pages) {
      const c = p.grid && p.grid.cells.find((x) => x.piece === i);
      if (c) return { row: c.row, col: c.col };
    }
    return null;
  };
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
        if (step.target) {
          // A dashboard the user has: it's used, never made or deleted.
          const ws = await deps.useDashboard(step.target);
          state.dashboard = {
            id: String(ws.id),
            name: ws.name || step.name,
            targeted: true,
          };
        } else {
          const ws = await deps.createDashboard(
            step.name,
            pieces.length,
            pages.map((p) => ({
              name: p.name,
              widgets: p.widgets.length,
              ...(p.grid ? { grid: p.grid } : {}),
            })),
          );
          state.dashboard = { id: String(ws.id), name: ws.name || step.name };
        }
        step.detail = state.dashboard.name;
        return;
      }
      case "theme": {
        const res = await deps.applyTheme({
          dashboardId: state.dashboard.id,
          theme: step.theme,
        });
        // The first theme it replaced is the one Remove puts back.
        const first = state.theme || {
          previous: res && res.previous != null ? res.previous : null,
          previousName: (res && res.previousName) || null,
        };
        state.theme = {
          name: (res && res.name) || step.theme,
          key: (res && res.key) || step.theme,
          previous: first.previous,
          previousName: first.previousName || null,
        };
        step.detail = state.theme.name;
        return;
      }
      case "build": {
        const record = await deps.askRole(
          "builder",
          buildRequest(plan, piece, step.fix || null),
        );
        account(step, record);
        if (!record || record.skipped)
          throw notFixable(
            `the Builder didn't run: ${(record && record.reason) || "unknown"}`,
          );
        if (record.status === "failed")
          throw notFixable(record.error || "the Builder failed");
        const outcome = buildOutcome(record);
        if (outcome.error) {
          // The Builder's own account, to read under the step.
          step.detail = record.output
            ? String(record.output).slice(-ANSWER_KEPT)
            : "";
          throw new Error(outcome.error);
        }
        const pkg = outcome.package;
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
          throw notFixable(
            `the Checker didn't run: ${(record && record.reason) || "unknown"}`,
          );
        if (record.status === "failed")
          throw notFixable(record.error || "the Checker failed");
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
          component: made.component || piece.component || null,
          widget: made.package || piece.package,
          // Picks the component when the package has several.
          name: piece.name,
          // The user's answers: its page, connection and settings. A
          // dashboard the user had keeps its pages (the page shown).
          page: state.dashboard.targeted ? null : pageOf(step.piece),
          // Its planned cell on a new dashboard (plan grids).
          row: state.dashboard.targeted
            ? null
            : (cellOf(step.piece) || {}).row || null,
          col: state.dashboard.targeted
            ? null
            : (cellOf(step.piece) || {}).col || null,
          provider: piece.provider || null,
          settings: piece.settings || null,
        });
        state.made[step.piece] = {
          ...made,
          component: (res && res.component) || made.component || null,
          widgetId: res && res.widgetId != null ? res.widgetId : null,
          pageId: res && res.pageId != null ? res.pageId : null,
        };
        step.detail =
          res && res.component ? res.component : made.package || piece.package;
        if (res && Array.isArray(res.dropped) && res.dropped.length) {
          step.detail += ` · left out: ${res.dropped.join(", ")}`;
        }
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
        if (res && res.widgetId != null) {
          state.results[step.bot] = {
            component: res.component || null,
            widgetId: res.widgetId,
            pageId: res.pageId != null ? res.pageId : null,
          };
        }
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
  const RETRIES = new Set([
    "install",
    "dashboard",
    "theme",
    "place",
    "bot",
    "results",
  ]);
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
    step.canRetry =
      RETRIES.has(step.kind) &&
      !(step.kind === "place" && CANT_TELL_WHICH.test(step.error || ""));
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
      step.error =
        blocked.status === STATUS.failed && blocked.error
          ? `${blocked.label} didn't finish: ${blocked.error}`
          : `${blocked.label} didn't finish`;
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
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k];
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
          step.autoFixable = !(err && err.notFixable);
        }
      }
      step.finishedAt = now();
      current = null;
      // Fixed by itself (opts.autoFix): the Builder fixes it, then its build
      // and check run again — at most MAX_FIXES times, then it's the user's.
      if (
        opts.autoFix &&
        !stopping &&
        step.status === STATUS.failed &&
        step.canFix &&
        step.autoFixable &&
        (step.kind === "build" || step.kind === "check")
      ) {
        prepareFix(step);
        const at = steps.findIndex((s) => s.id === `build:${step.piece}`);
        k = (at < 0 ? k : at) - 1;
      }
      delete step.autoFixable;
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
    prepareFix(step);
    resetSkipped();
    return run();
  }

  /** Hand a failed step's widget to the Builder: its build and check wait. */
  function prepareFix(step) {
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
      // Which try this is ("fixing, try 1 of 2").
      build.fixTry = state.fixes[w];
    }
    if (check) reset(check);
    reset(step);
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
  undoOnDashboard,
  themeChoices,
  resolveTheme,
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
  placeChoices,
  settingKeys,
  buildRequest,
  checkRequest,
  eventsToSend,
  builtPackage,
  buildOutcome,
  verdictOf,
  createPlanBuild,
};
