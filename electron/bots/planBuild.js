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
  return steps;
}

/** What a widget piece needs to have happened before it can be placed. */
function blockersFor(step, steps) {
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
    `Use a PascalCase name based on "${piece.name}". Read widget_guide first, then build_widget${
      piece.source === "update" ? " with update: true" : ""
    }. Finish with the widget's package name (@ai-built/…).`,
  ].join("\n");
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
 *   placeWidget({ dashboardId, component|widget }) → { component } | throws
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
    totals: { tokens: 0, usd: 0, includedInPlan: true },
  };
  let stopping = false;
  let current = null;
  const pieces = (plan.pieces || [])
    .filter(Boolean)
    .filter((p) => p.kind === "widget");
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
        step.detail =
          res && res.component ? res.component : made.package || piece.package;
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
  buildRequest,
  builtPackage,
  verdictOf,
  createPlanBuild,
};
