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
 * A widget for one cell (consolidation Phase 2b, opts.cell): the plan is one
 * widget, built for a dashboard the user is editing. Its steps are install
 * (registry) or build → check, then **preview**: the build waits for the
 * user to see it running and pick its connection and settings —
 *   approve(stepId, inputs)  looks good: carry on (Install), keeping inputs
 *   revise(stepId, note)     change something: back to the Builder with the
 *                            note, checked again, previewed again
 * — then Install. Nothing touches the dashboard: the editor places it.
 *
 * A change to one widget the user has (consolidation Phase 3, opts.edit:
 * { package, component, componentName, mode, displayName, settings,
 * providers }): the cell build's steps — build → check → preview → save —
 * for that widget. "update" changes it in place (its own package; the
 * install keeps a backup), "new" saves the change as a new AI-built widget.
 * The Builder is told which widget; the main process holds it to that.
 *
 * Only a widget's settings (lead-workspace release 6c, opts.settings:
 * { workspaceId, itemId, pageId, scope, component, displayName }): the plan
 * is that widget, source "settings", with what changes — one step sets them
 * on that copy of the widget (its dashboard, as saved). Nothing is built.
 *
 * One bot (consolidation Phase 2c-1, opts.bot): the plan is one new bot —
 * checked (checkbot), then saved paused on the dashboard the plan names, with
 * its results card if planned, or Unassigned. Never a new dashboard.
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
  // Waits for the user to look at it (a cell build's Preview, Phase 2b).
  needsYou: "needs-you",
};

// How many times the Builder may fix one widget before it's over to the user.
const MAX_FIXES = 2;
// How many changes the user can ask for at a cell build's preview.
const MAX_REVISIONS = 5;

/** A plain object, or null — the user's picks from the preview. */
const plainObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : null;

/**
 * The new dashboard's name: the layout piece's, without a trailing
 * "layout" (the Planner sometimes names the piece "Sales layout").
 */
function dashboardNameOf(layout) {
  const name = String((layout && layout.name) || "").trim();
  const bare = name.replace(/\s+layout$/i, "").trim();
  return bare || name || "New dashboard";
}

/**
 * A cell build's steps (opts.cell): its one widget installed (registry) or
 * built and checked, previewed by the user, then installed (built ones).
 * No dashboard, theme, bot or place steps — the editor places it. A change
 * to a widget (edit) says so in its labels.
 */
function cellSteps(widgets, add, edit = null) {
  const label = (kind, p) => {
    if (!edit) {
      return {
        build: `Build ${p.name}`,
        check: `Check ${p.name}`,
        preview: `Preview ${p.name}`,
        save: `Install ${p.name}`,
      }[kind];
    }
    const name = edit.displayName || edit.componentName || p.name;
    return {
      build: "Write the change into a draft",
      check: "Check the draft",
      preview: `Preview ${edit.mode === "update" ? name : p.name}`,
      save: edit.mode === "update" ? `Update ${name}` : `Install ${p.name}`,
    }[kind];
  };
  widgets.forEach((p, i) => {
    const built = p.source === "new" || p.source === "update";
    if (p.source === "registry" && p.package) {
      add({
        id: `install:${i}`,
        kind: "install",
        piece: i,
        role: "dash",
        label: `Install ${p.name}`,
      });
    }
    if (built) {
      add({
        id: `build:${i}`,
        kind: "build",
        piece: i,
        source: p.source,
        role: "builder",
        label: label("build", p),
      });
      add({
        id: `check:${i}`,
        kind: "check",
        piece: i,
        role: "checker",
        label: label("check", p),
      });
    }
    add({
      id: `preview:${i}`,
      kind: "preview",
      piece: i,
      role: "you",
      label: label("preview", p),
    });
    if (built) {
      add({
        id: `save:${i}`,
        kind: "save",
        piece: i,
        role: "dash",
        label: label("save", p),
      });
    }
  });
}

/**
 * A bot build's steps (opts.bot): one bot, checked, then saved paused — on
 * the dashboard the plan names (its results card there too, if planned) or
 * Unassigned. Never a new dashboard.
 */
function botSteps(plan, add) {
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
  }
  botPieces(plan)
    .slice(0, 1)
    .forEach((b, i) => {
      add({
        id: `checkbot:${i}`,
        kind: "checkbot",
        bot: i,
        role: "dash",
        label: "Check the bot",
        needs: target ? ["dashboard"] : [],
      });
      add({
        id: `bot:${i}`,
        kind: "bot",
        bot: i,
        role: "dash",
        label: `Save ${b.name} — paused`,
        needs: [`checkbot:${i}`],
      });
      if (target && b.showResults) {
        add({
          id: `results:${i}`,
          kind: "results",
          bot: i,
          role: "dash",
          label: `Show its results on ${target.name}`,
          needs: [`bot:${i}`],
        });
      }
    });
}

/** The steps for a plan, all waiting. */
function planSteps(
  plan,
  {
    dashboardName,
    cell = false,
    bot = false,
    edit = null,
    settings = null,
  } = {},
) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const widgets = pieces.filter((p) => p.kind === "widget");
  const layout = pieces.find((p) => p.kind === "layout");
  const steps = [];
  const add = (step) => steps.push({ status: STATUS.waiting, ...step });
  if (settings) {
    const name =
      settings.displayName || (widgets[0] && widgets[0].name) || "the widget";
    add({
      id: "settings:0",
      kind: "settings",
      piece: 0,
      role: "dash",
      label: `Change ${name}'s settings`,
    });
    return steps;
  }
  if (cell || edit) {
    // A change is to one widget (validatePlan).
    cellSteps(edit ? widgets.slice(0, 1) : widgets, add, edit);
    return steps;
  }
  if (bot) {
    botSteps(plan, add);
    return steps;
  }
  // A new theme (lead-workspace theme round) is made from its four colors;
  // a change to a saved one (theme change round) gives it new ones — in
  // place when it's the user's, as a remix when it was downloaded. Then, on
  // a dashboard plan, the theme step below applies the one it made.
  const newTheme = pieces.find(
    (p) =>
      p.kind === "theme" &&
      (p.source === "new" || p.source === "update") &&
      p.name,
  );
  const makeTheme = () => {
    const name = String(newTheme.name).trim();
    const change = newTheme.source === "update";
    add({
      id: change ? "changetheme" : "maketheme",
      kind: change ? "changetheme" : "maketheme",
      role: "dash",
      label: change ? `Change the ${name} theme` : `Make the ${name} theme`,
      name,
      colors: { ...(newTheme.colors || {}) },
    });
  };
  if (
    newTheme &&
    (!planTarget(plan) || newTheme.source === "update") &&
    pieces.every((p) => p.kind === "theme")
  ) {
    makeTheme();
    return steps;
  }

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
    if (theme === newTheme) makeTheme();
    add({
      id: "theme",
      kind: "theme",
      role: "dash",
      label: `Apply the ${theme.name} theme`,
      theme: String(theme.name).trim(),
      needs:
        theme === newTheme
          ? [
              "dashboard",
              theme.source === "update" ? "changetheme" : "maketheme",
            ]
          : ["dashboard"],
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
      // Installed only once the Checker passed it (consolidation 1b).
      add({
        id: `save:${i}`,
        kind: "save",
        piece: i,
        role: "dash",
        label: `Install ${p.name}`,
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
  if (step.kind === "preview")
    return steps.filter(
      (s) =>
        s.id === `install:${step.piece}` ||
        s.id === `build:${step.piece}` ||
        s.id === `check:${step.piece}`,
    );
  if (step.kind === "save")
    return steps.filter(
      (s) =>
        s.id === `build:${step.piece}` ||
        s.id === `check:${step.piece}` ||
        // A cell build installs only what the user saw and liked.
        s.id === `preview:${step.piece}`,
    );
  if (step.kind === "place") {
    return steps.filter(
      (s) =>
        s.id === "dashboard" ||
        s.id === `install:${step.piece}` ||
        s.id === `build:${step.piece}` ||
        s.id === `check:${step.piece}` ||
        s.id === `save:${step.piece}`,
    );
  }
  return [];
}

/**
 * The Builder's request for one widget. With `fix` ({ package, problem }) it
 * asks the Builder to fix what it built (Let Builder fix it, 4d-3).
 */
function buildRequest(
  plan,
  piece,
  fix = null,
  { cell = false, standalone = false, edit = null } = {},
) {
  if (edit) return editBuildRequest(plan, piece, fix, edit);
  const providers = (piece.providers || []).join(", ") || "none";
  const update = piece.source === "update" || !!(fix && fix.installed);
  const first = fix
    ? fix.change && fix.draft
      ? `Change the widget you wrote for this plan (${fix.draft}) — the user looked at it and wants a change.`
      : fix.draft
        ? `Fix the widget you wrote for this plan (${fix.draft}).`
        : fix.package
          ? `Fix the widget ${fix.package} you built for this plan.`
          : `Build this plan's widget again — the last try didn't work.`
    : piece.source === "update"
      ? `Update the widget ${piece.package || piece.name} for this plan.`
      : `Build a new widget for this plan.`;
  return [
    first,
    ...(fix
      ? [`${fix.change ? "What to change" : "What went wrong"}: ${fix.problem}`]
      : []),
    ...(cell
      ? [
          standalone
            ? "It's one new widget for the user's widgets, not for a dashboard: build only this widget, and don't place it — the user previews it, then it's installed."
            : "It goes into one cell of a dashboard the user is editing: build only this widget, and don't place it — the user previews it and the editor puts it in the cell.",
        ]
      : []),
    `Plan: ${plan.summary || ""}`,
    `Widget: ${piece.name}${piece.notes ? ` — ${piece.notes}` : ""}`,
    `Providers: ${providers}`,
    ...wiringLines(plan, piece),
    `Use a PascalCase name based on "${piece.name}"${
      fix && (fix.package || fix.draft) ? " (keep the same name)" : ""
    }. Read widget_guide first, then build_widget${
      update ? " with update: true" : ""
    }${
      update || fix
        ? ""
        : " (if it says the widget already exists, build it again with update: true)"
    }. It writes a draft (draft:<Name>) — the Checker checks it, then it's installed. Finish with the draft's name.`,
  ].join("\n");
}

/**
 * The Builder's request for a change to one widget the user has (Phase 3):
 * read it, change only it — in place under its own name, or as a new
 * self-contained widget — and finish with the draft. The main process holds
 * build_widget to that widget whatever the Builder sends.
 */
function editBuildRequest(plan, piece, fix, edit) {
  const name = edit.componentName;
  const pkg = edit.package;
  const update = edit.mode === "update";
  const first = fix
    ? fix.change
      ? `Change the draft you wrote (${fix.draft || `draft:${name}`}) — the user looked at it and wants a change.`
      : `Fix the draft you wrote (${fix.draft || `draft:${name}`}).`
    : update
      ? `Change the user's widget ${name} (package ${pkg}). The change goes into that widget, everywhere it's used.`
      : `Make a new widget from the user's widget ${name} (package ${pkg}), with a change. ${name} itself stays as it is.`;
  return [
    first,
    ...(fix
      ? [`${fix.change ? "What to change" : "What went wrong"}: ${fix.problem}`]
      : []),
    `Read it first: read_widget with name "${pkg}" and component "${name}". If it imports other files of its package, read them with read_widget's file.`,
    `Plan: ${plan.summary || ""}`,
    ...(isStr(piece.adds) && piece.adds.trim()
      ? [`The change: ${piece.adds.trim()}`]
      : []),
    ...(isStr(piece.notes) && piece.notes.trim()
      ? [`Notes: ${piece.notes.trim()}`]
      : []),
    ...(Array.isArray(piece.keeps) && piece.keeps.length
      ? [`Keep: ${piece.keeps.filter(isStr).join("; ")}.`]
      : []),
    "Keep every setting, its connection and the events it sends, unless the plan says to drop one.",
    ...wiringLines(plan, piece),
    update
      ? `Keep the name ${name} and change only widgets/${name}.js and widgets/${name}.dash.js — not its other files. Read widget_guide, then build_widget with name "${name}" and update: true; it's built inside a copy of its package, so the other files come along.`
      : `Give it a new PascalCase name based on "${piece.name}" (not ${name}) and change only its component and .dash.js — it's built inside a copy of the package, so it can keep importing the package's other files. Read widget_guide, then build_widget with that name (no update).`,
    "It writes a draft (draft:<Name>): the Checker checks it and the user previews it before anything is installed. Don't place or install it. Finish with the draft's name.",
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
function checkRequest(plan, piece, made = {}, { edit = null } = {}) {
  const lines = [
    `Check ${made.draft || made.package}. Run check_widget on ${made.draft || made.package}, read the code if you need to, and end with VERDICT: PASSED or VERDICT: FAILED.`,
  ];
  // A change to a widget the user has (Phase 3): it's compared with what
  // it was — losing a setting, its connection or an event breaks the
  // dashboards that use it.
  if (edit) {
    lines.push(
      edit.mode === "update"
        ? `It's a change to the user's widget ${edit.componentName} (${edit.package}), which is in use: check_widget compares its config with the installed one. A setting, provider or event it had and doesn't now fails it, unless the plan says to drop it. Read the original with read_widget if you need to.`
        : `It's a new widget made from the user's widget ${edit.componentName} (${edit.package}): it must keep that widget's settings, connection and events unless the plan says otherwise. Read the original with read_widget to compare.`,
    );
    if (isStr(piece.adds) && piece.adds.trim()) {
      lines.push(`The change it should make: ${piece.adds.trim()}`);
    }
  }
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
    // A bot build with no dashboard (2c-1): Unassigned, not "null".
    workspaceId: dashboardId == null ? null : String(dashboardId),
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
  if (pkg) return { package: pkg, draft: (built && built.draft) || null };
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

/**
 * Was the Builder's widget for piece `j` installed in this build state? Its
 * Install step finished — or, in a build from before the Install step
 * (Phase 1b), its build step did (it installed then).
 */
function installedIn(state, j) {
  const steps = (state && state.steps) || [];
  const save = steps.find((x) => x.id === `save:${j}`);
  if (save) return save.status === STATUS.done;
  return steps.some((x) => x.id === `build:${j}` && x.status === STATUS.done);
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
    // Never installed (it didn't pass) — nothing to uninstall.
    const built = installedIn(prev, j);
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
      const builtHere = BUILT.has(widgets[i].source);
      const installed = builtHere && installedIn(prev, j);
      // Checked but never installed: built and checked again (its draft
      // may be gone — drafts aren't kept across restarts).
      (builtHere && !installed
        ? ["install"]
        : ["install", "build", "check", "place"]
      ).forEach((k) => keep(`${k}:${i}`, `${k}:${j}`));
      if (installed) {
        const save = byId.get(`save:${i}`);
        if (save) {
          save.status = STATUS.done;
          save.detail = made.package || null;
          save.reused = true;
        }
      }
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
          // Installed already: the change is an update of it.
          installed: installedIn(prev, j),
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
    // A changed theme (theme change round): Remove puts its old colors
    // back, or — a remix — the original back where the remix replaced it.
    ...(state.changedTheme
      ? {
          changedTheme: {
            key: state.changedTheme.key,
            name: state.changedTheme.name,
            remix: !!state.changedTheme.remix,
            ...(state.changedTheme.previous
              ? { previous: { ...state.changedTheme.previous } }
              : {}),
            ...(state.changedTheme.of
              ? { of: { ...state.changedTheme.of } }
              : {}),
            replaced: (state.changedTheme.replaced || []).slice(),
            appUsesOriginal: !!state.changedTheme.appUsesOriginal,
          },
        }
      : {}),
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
    if (
      step.kind === "save" ||
      // A build from before the Install step installed at its build step.
      (step.kind === "build" &&
        !(state.steps || []).some((x) => x.id === `save:${step.piece}`))
    ) {
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
 *   makeTheme({ name, colors }) → { key, name } | throws — a new theme from
 *     { primary, secondary, tertiary, neutral }, saved in the user's themes
 *   changeTheme({ name, colors }) → { key, name, remix, previous?, of?,
 *     allowRemix?, published?, usedBy? } | throws — a saved theme with new
 *     colors: in place when it's the user's (previous: its old colors, for
 *     Remove), a remix crediting its author when it was downloaded
 *   askRole(role, request) → run record ({ status, output, error, model, usage, cost, skipped, reason })
 *   abortRole(role)
 *   placeWidget({ dashboardId, component|widget, name, page, provider,
 *     settings }) → { component, widgetId, pageId, dropped? } | throws —
 *     page: the page's name (null: the page shown); row / col: its planned
 *     cell (null: the next free one); dropped: what of the
 *     connection and settings it couldn't use, said under the step
 *   checkBot({ dashboardId, piece }) → { detail } | throws — a bot build's
 *     check before the save (opts.bot); dashboardId null = Unassigned
 *   saveBot({ dashboardId, piece, botId? }) → { id, name } | throws (an
 *     error with waitingFor = provider names → the step waits for them)
 *   placeBotResults({ dashboardId, botId }) → { component, widgetId, pageId } | throws
 *   wireTrigger({ dashboardId, botId, widgetId, component, event }) | throws
 *   wireListener({ dashboardId, widgetId, component, handler, botId, result }) | throws
 *   setWidgetSettings({ workspaceId, itemId, pageId, scope, component,
 *     settings }) → { dashboard: { id, name }, changed, dropped } | throws —
 *     opts.settings: that copy of the widget, as saved
 *   emit(state)   progress after every change
 *   now()
 * @param {{ dashboardName?: string, resume?: { plan, state },
 *           autoFix?: boolean, cell?: boolean, bot?: boolean,
 *           edit?: object, settings?: object }} [opts]
 *   resume — an earlier build of this plan whose work is reused (Edit plan)
 *   autoFix — a failed build or check is fixed by the Builder by itself
 *   edit — a change to one widget the user has (Phase 3, see the top)
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
    // piece index → changes the user asked for at the preview (cell builds)
    revisions: {},
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
  // A change's widget as it is now (opts.edit): its cell's connection and
  // settings, to preview the change with.
  const editOf = (key) =>
    opts.edit && plainObject(opts.edit[key]) ? opts.edit[key] : null;
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
      case "settings": {
        const res = await deps.setWidgetSettings({
          ...opts.settings,
          settings: (piece && piece.settings) || {},
        });
        if (res && res.dashboard) {
          state.dashboard = {
            id: String(res.dashboard.id),
            name: res.dashboard.name,
            targeted: true,
          };
        }
        state.made[step.piece] = {
          changed: (res && res.changed) || [],
          dropped: (res && res.dropped) || [],
        };
        step.detail = ((res && res.changed) || []).join(", ");
        return;
      }
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
      case "maketheme": {
        const res = await deps.makeTheme({
          name: step.name,
          colors: step.colors,
        });
        state.madeTheme = {
          key: (res && res.key) || step.name,
          name: (res && res.name) || step.name,
          colors: step.colors,
        };
        step.detail = state.madeTheme.name;
        return;
      }
      case "changetheme": {
        const res = await deps.changeTheme({
          name: step.name,
          colors: step.colors,
        });
        state.changedTheme = {
          ...(res || {}),
          key: (res && res.key) || step.name,
          name: (res && res.name) || step.name,
          colors: step.colors,
        };
        // The theme step applies it like one this plan made.
        state.madeTheme = {
          key: state.changedTheme.key,
          name: state.changedTheme.name,
          colors: step.colors,
        };
        step.detail = state.changedTheme.remix
          ? `${state.changedTheme.name}, a remix`
          : state.changedTheme.name;
        return;
      }
      case "theme": {
        // The theme this plan made is applied by its id, so a same-named
        // one can't be picked instead.
        const res = await deps.applyTheme({
          dashboardId: state.dashboard.id,
          theme: (state.madeTheme && state.madeTheme.key) || step.theme,
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
          buildRequest(plan, piece, step.fix || null, {
            cell: !!opts.cell,
            standalone: !!opts.standalone,
            edit: opts.edit || null,
          }),
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
          // The draft build_widget wrote — checked, then installed (1b).
          draft: outcome.draft,
          // What this pass fixed — the Checker judges the change by it.
          fixedFor: step.fix ? step.fix.problem : null,
        };
        step.detail = outcome.draft || pkg;
        step.fix = null;
        return;
      }
      case "check": {
        const made = state.made[step.piece] || {};
        const record = await deps.askRole(
          "checker",
          checkRequest(plan, piece, made, { edit: opts.edit || null }),
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
      case "save": {
        // The checked draft, installed exactly as the Checker passed it.
        const made = state.made[step.piece] || {};
        if (!made.draft) {
          throw new Error(
            "the Builder didn't write a draft with build_widget, so there's nothing checked to install",
          );
        }
        const res = deps.installBuilt
          ? await deps.installBuilt(made.draft)
          : { success: false, error: "installing isn't available here" };
        if (!res || !res.success) {
          throw new Error((res && res.error) || "it wasn't installed");
        }
        if (res.widgetName) made.package = String(res.widgetName).toLowerCase();
        // A cell build hands the editor the widget's component to place. A
        // change in place keeps the component it was opened on — whatever
        // the Planner called the piece.
        if (opts.edit && opts.edit.mode === "update") {
          made.component = opts.edit.component;
        } else if ((opts.cell || opts.edit) && deps.resolveComponent) {
          made.component =
            (await deps.resolveComponent(made.package, piece.name)) || null;
          if (!made.component) {
            state.made[step.piece] = made;
            throw new Error(
              `it was installed, but its widget couldn't be found in ${made.package} to place`,
            );
          }
        }
        state.made[step.piece] = made;
        step.detail = made.package;
        return;
      }
      case "preview": {
        // What to show: the checked draft, or the installed widget.
        let made = state.made[step.piece] || {};
        if (!made.draft && !made.component && piece.package) {
          made = {
            ...made,
            package: piece.package,
            component:
              (piece.component &&
                String(piece.component).split(".").length >= 3 &&
                piece.component) ||
              (deps.resolveComponent
                ? (await deps.resolveComponent(piece.package, piece.name)) ||
                  null
                : null),
          };
          state.made[step.piece] = made;
          if (!made.component) {
            throw new Error(
              `couldn't tell which widget in ${piece.package} to use`,
            );
          }
        }
        // Its inputs for the preview — settings and the providers it needs —
        // read from its config without running it (the AST parser).
        if (!made.preview && deps.previewConfig) {
          const src = await deps.previewConfig({
            draft: made.draft || null,
            component: made.component || null,
          });
          const parsed =
            src && src.configCode ? parseDashConfig(src.configCode) : null;
          const config = parsed && parsed.ok ? parsed.config || {} : {};
          made = {
            ...made,
            preview: {
              componentName:
                (src && src.componentName) ||
                String(made.component || piece.name || "")
                  .split(".")
                  .pop(),
              userConfig: config.userConfig || {},
              providers: Array.isArray(config.providers)
                ? config.providers
                : [],
              // The installed widget's name, to load its code by.
              widgetName: (src && src.widgetName) || null,
              // What the plan said to use, to start from.
              // A change starts from the cell's own connection and settings.
              provider: piece.provider || editOf("providers") || null,
              settings:
                piece.settings || editOf("settings")
                  ? { ...editOf("settings"), ...piece.settings }
                  : null,
            },
          };
          state.made[step.piece] = made;
        }
        if (step.approved) {
          // The connection and settings the user picked go into the cell.
          state.made[step.piece] = { ...made, inputs: step.approved };
          step.detail = "Looks good";
          return;
        }
        const wait = new Error("waiting for you to look at it");
        wait.needsYou = true;
        throw wait;
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
      case "checkbot": {
        // As the save will check it, before anything is saved (2c-1).
        const res = await deps.checkBot({
          dashboardId: state.dashboard ? state.dashboard.id : null,
          piece: bots[step.bot],
        });
        step.detail = (res && res.detail) || "";
        return;
      }
      case "bot": {
        const saved = await deps.saveBot({
          // A bot build with no dashboard saves it Unassigned.
          dashboardId: state.dashboard ? state.dashboard.id : null,
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
  const BUILDER_FIXES = new Set([
    "build",
    "check",
    "save",
    "trigger",
    "listen",
  ]);
  const RETRIES = new Set([
    // A cell build's preview couldn't find its widget (Phase 2b).
    "preview",
    // Saving a new theme (theme round), or a change to one.
    "maketheme",
    "changetheme",
    "install",
    "dashboard",
    "theme",
    "place",
    "checkbot",
    "bot",
    "results",
  ]);
  // An Install step the Builder can help with: its draft is missing or
  // didn't pass — not a disk or network problem.
  const DRAFT_PROBLEM =
    /draft|hasn't passed the Checker|didn't pass its checks/i;
  function markOptions(step) {
    const piece = step.piece != null ? pieces[step.piece] : null;
    const used = step.piece != null ? state.fixes[step.piece] || 0 : 0;
    const builderFixes =
      BUILDER_FIXES.has(step.kind) &&
      (step.kind !== "save" || DRAFT_PROBLEM.test(step.error || ""));
    step.fixesLeft =
      piece && BUILT.has(piece.source) && builderFixes
        ? Math.max(0, MAX_FIXES - used)
        : 0;
    step.canFix = step.fixesLeft > 0;
    // The Builder's tries are used up — over to the user.
    step.fixesUsedUp =
      !!piece && BUILT.has(piece.source) && builderFixes && !step.canFix;
    step.canRetry =
      (RETRIES.has(step.kind) &&
        !(step.kind === "place" && CANT_TELL_WHICH.test(step.error || ""))) ||
      (step.kind === "save" && !builderFixes);
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
    // Behind the user's preview: it waits, untouched, until they decide.
    if (blocked.status === STATUS.needsYou) return true;
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
        if (err && err.needsYou && !stopping) {
          step.status = STATUS.needsYou;
          step.finishedAt = now();
          current = null;
          emit();
          continue;
        }
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
        : steps.some((s) => s.status === STATUS.needsYou)
          ? "waiting-for-you"
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
    const saveStep = steps.find((s) => s.id === `save:${w}`);
    const installed = !!saveStep && saveStep.status === STATUS.done;
    // A cell build: what the Builder fixes is previewed again — nothing the
    // user hasn't seen is installed (Phase 2b).
    const preview = steps.find((s) => s.id === `preview:${w}`);
    if (preview) {
      reset(preview);
      delete preview.approved;
      if (state.made[w]) {
        delete state.made[w].preview;
        delete state.made[w].inputs;
      }
    }
    // A change the user asked for stays asked for.
    const asked =
      build && build.fix && build.fix.change ? build.fix.problem : null;
    if (build) {
      reset(build);
      build.fix = {
        package: made.package || null,
        draft: made.draft || null,
        installed,
        problem: asked
          ? `${problem}\n(While making the change the user asked for: ${asked})`
          : problem,
      };
      // Which try this is ("fixing, try 1 of 2").
      build.fixTry = state.fixes[w];
    }
    if (check) reset(check);
    const save = steps.find((s) => s.id === `save:${w}`);
    if (save) reset(save);
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

  /** The preview, as the user decided it. */
  const waitingPreview = (stepId) => {
    const step = steps.find((s) => s.id === stepId);
    return step && step.kind === "preview" && step.status === STATUS.needsYou
      ? step
      : null;
  };

  /**
   * Looks good (a cell build's preview): carry on — the widget is installed
   * — keeping the user's picks { providers, settings } for the cell.
   */
  function approve(stepId, inputs = {}) {
    if (busy) return Promise.resolve({ error: "The build is still running." });
    const step = waitingPreview(stepId);
    if (!step) return Promise.resolve({ error: "Nothing is waiting there." });
    const picked = inputs && typeof inputs === "object" ? inputs : {};
    reset(step);
    step.approved = JSON.parse(
      JSON.stringify({
        providers: plainObject(picked.providers),
        settings: plainObject(picked.settings),
      }),
    );
    return run();
  }

  /**
   * Change something (a cell build's preview): the Builder changes its
   * draft as the user asked, the Checker checks it again, and it's
   * previewed again. Doesn't use up the Builder's own fixes.
   */
  function revise(stepId, note) {
    if (busy) return Promise.resolve({ error: "The build is still running." });
    const step = waitingPreview(stepId);
    if (!step) return Promise.resolve({ error: "Nothing is waiting there." });
    const w = step.piece;
    const build = steps.find((s) => s.id === `build:${w}`);
    if (!build) {
      return Promise.resolve({
        error: "This widget wasn't built here — ask the Planner for another.",
      });
    }
    const change = String(note || "").trim();
    if (!change) return Promise.resolve({ error: "Say what to change." });
    if ((state.revisions[w] || 0) >= MAX_REVISIONS) {
      return Promise.resolve({
        error: `That's ${MAX_REVISIONS} changes — discard it and describe what you want again.`,
      });
    }
    state.revisions[w] = (state.revisions[w] || 0) + 1;
    const made = state.made[w] || {};
    reset(build);
    build.fix = {
      package: made.package || null,
      draft: made.draft || null,
      installed: false,
      change: true,
      problem: change,
    };
    build.revision = state.revisions[w];
    if (state.made[w]) delete state.made[w].preview;
    for (const id of [`check:${w}`, `save:${w}`]) {
      const s = steps.find((x) => x.id === id);
      if (s) reset(s);
    }
    reset(step);
    delete step.approved;
    return run();
  }

  function stop() {
    stopping = true;
    if (current && current.role !== "dash" && deps.abortRole)
      deps.abortRole(current.role);
  }

  return { state, run, stop, fix, retry, resume, approve, revise };
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
