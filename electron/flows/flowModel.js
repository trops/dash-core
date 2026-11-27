/**
 * flowModel.js
 *
 * A flow (flows PRD): the steps a piece of work goes through on a dashboard,
 * and who hands work to whom. Each goal follows one flow.
 *
 *   flow { id, workspaceId, name, brief, maxRounds,
 *          steps: [ { id, kind, name, note, botId?, check?, outputs?,
 *                     judgment?, onFail? } ],
 *          edges: [ { from, to, label?, kind: "next" | "fail" } ] }
 *
 * Step kinds:
 *   source  a bot that starts goals (an intake: tickets, notes, a schedule)
 *   bot     an AI step: a bot does the work and writes a done record
 *   check   a check with no AI (checks/): passed or failed, with proof
 *   you     waits for the user (approve, merge, read it)
 *
 * The "next" edges make one chain from the source to the end; a "fail" edge
 * goes back (a check or a reviewer sends the work back with a fix list, up
 * to the flow's round limit).
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const STEP_KINDS = ["source", "bot", "check", "you"];
const YOU_MODES = ["approve", "read", "custom"];
const CHECK_KINDS = [
  "rules",
  "command",
  "script",
  "tool",
  "repo",
  // Dash's built-in factory checks (DASH-103): checks/kinds/factory.js.
  "git-on-branch",
  "git-committed",
  "pr-ci",
  "handoff-has",
  // A check package (DASH-106): checks/kinds/package.js.
  "package",
  // dash-check building blocks on the step (DASH-133): checks/kinds/recipe.js.
  "recipe",
];
// Dash's own checks, put in a bot's checks flow by Dash, never saved on a
// bot (DASH-101: the Handoff check).
const BUILTIN_CHECK_KINDS = ["handoff"];
const FIELD_KINDS = [
  "text",
  "number",
  "boolean",
  "list",
  "links",
  "paths",
  "object",
];
const FLOW_ID = /^flow_[a-z0-9]{6,40}$/;
const STEP_ID = /^step_[a-z0-9]{1,40}$/;
const MAX_STEPS = 20;
const MAX_FIELDS = 30;
const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS_CAP = 10;

const str = (v, max = 400) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

function clampRounds(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_MAX_ROUNDS;
  return Math.min(v, MAX_ROUNDS_CAP);
}

/** A field a step's record must have: name, kind, required. */
function cleanField(f) {
  if (!f || typeof f !== "object") return null;
  const name = str(f.name, 60);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return {
    name,
    kind: FIELD_KINDS.includes(f.kind) ? f.kind : "text",
    required: f.required !== false,
  };
}

function cleanFields(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const f of list.slice(0, MAX_FIELDS)) {
    const c = cleanField(f);
    if (!c || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}

/**
 * A task's limits across all its runs (phase 5; G10): minutes and steps.
 * Rounds are the flow's maxRounds. Null when none are set.
 */
function cleanLimits(l) {
  if (!l || typeof l !== "object") return null;
  const minutes = Math.floor(Number(l.minutes));
  const steps = Math.floor(Number(l.steps));
  const out = {
    ...(minutes > 0 ? { minutes: Math.min(minutes, 24 * 60) } : {}),
    ...(steps > 0 ? { steps: Math.min(steps, 5000) } : {}),
  };
  return Object.keys(out).length ? out : null;
}

/** A check's settings, kept as given apart from its kind (checks/ reads them). */
function cleanCheck(check) {
  if (!check || typeof check !== "object") return null;
  if (
    !CHECK_KINDS.includes(check.kind) &&
    !BUILTIN_CHECK_KINDS.includes(check.kind)
  ) {
    return null;
  }
  // Settings are plain data; a round-trip through JSON drops anything else.
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(check));
  } catch (_e) {
    return null;
  }
  return copy;
}

/**
 * A you step saved before modes: "Approve…" approves (or sends back),
 * "Read…" is read and marked done, anything else it names is custom.
 */
function youModeOf(step) {
  if (step && YOU_MODES.includes(step.mode)) return step.mode;
  const action = String((step && step.action) || "").trim();
  if (!action || /^approve\b/i.test(action)) return "approve";
  if (/^read\b/i.test(action)) return "read";
  return "custom";
}

function cleanStep(s, i) {
  if (!s || typeof s !== "object") return null;
  const kind = STEP_KINDS.includes(s.kind) ? s.kind : null;
  if (!kind) return null;
  const id = STEP_ID.test(s.id || "") ? s.id : `step_${i + 1}`;
  const step = {
    id,
    kind,
    name: str(s.name, 80) || (kind === "you" ? "You" : `Step ${i + 1}`),
    note: str(s.note, 300),
  };
  if (kind === "source" || kind === "bot") {
    step.botId = s.botId ? String(s.botId) : null;
    step.outputs = cleanFields(s.outputs);
  }
  if (kind === "bot") {
    step.judgment = s.judgment === true;
    if (s.limits && typeof s.limits === "object") {
      const minutes = Math.floor(Number(s.limits.minutes));
      const steps = Math.floor(Number(s.limits.steps));
      step.limits = {
        ...(minutes > 0 ? { minutes: Math.min(minutes, 24 * 60) } : {}),
        ...(steps > 0 ? { steps: Math.min(steps, 1000) } : {}),
      };
    }
  }
  if (kind === "check") step.check = cleanCheck(s.check);
  if (kind === "you") {
    // approve: Approve or Send back (with a reason); read: one button,
    // marked done; custom: one button named by `action`.
    // A step saved before modes: its own action named something else to do.
    step.mode = YOU_MODES.includes(s.mode) ? s.mode : youModeOf(s);
    step.action =
      str(s.action, 120) ||
      (step.mode === "read"
        ? "Read it"
        : step.mode === "custom"
          ? "Done"
          : "Approve");
    if (s.sendBackTo && STEP_ID.test(String(s.sendBackTo)))
      step.sendBackTo = String(s.sendBackTo);
    // A bot's check that came with a package and is off (DASH-125): what
    // it would run, so the job can say "Turn on npm test".
    const off = str(s.offCommand, 200);
    if (off) step.offCommand = off;
  }
  return step;
}

/**
 * A flow as stored: steps and edges cleaned, ids unique, edges only between
 * steps that exist.
 */
function normalizeFlow(input = {}) {
  const steps = [];
  const ids = new Set();
  const list = Array.isArray(input.steps)
    ? input.steps.slice(0, MAX_STEPS)
    : [];
  list.forEach((s, i) => {
    const step = cleanStep(s, i);
    if (!step) return;
    let id = step.id;
    let n = 1;
    while (ids.has(id)) id = `${step.id}${n++}`;
    step.id = id;
    ids.add(id);
    steps.push(step);
  });
  const edges = [];
  const seen = new Set();
  for (const e of Array.isArray(input.edges) ? input.edges : []) {
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const kind = e.kind === "fail" ? "fail" : "next";
    const key = `${e.from}>${e.to}>${kind}`;
    if (seen.has(key)) continue;
    // Work goes round only on a fail arrow (with a round limit): a "next"
    // arrow back to where it came from is dropped.
    if (kind === "next" && reaches(edges, e.to, e.from)) continue;
    seen.add(key);
    edges.push({ from: e.from, to: e.to, kind, label: str(e.label, 60) });
  }
  return {
    id: input.id || null,
    workspaceId:
      input.workspaceId == null || input.workspaceId === ""
        ? null
        : String(input.workspaceId),
    name: str(input.name, 80) || "New flow",
    brief: str(input.brief, 300),
    maxRounds: clampRounds(input.maxRounds),
    steps,
    edges,
    criteria: Array.isArray(input.criteria) ? input.criteria.slice(0, 20) : [],
    taskLimits: cleanLimits(input.taskLimits),
  };
}

/** Can `from` reach `to` along the "next" edges so far? */
function reaches(edges, from, to) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges)
      if (e.kind === "next" && e.from === cur) stack.push(e.to);
  }
  return false;
}

/** Steps in chain order: from the source along the "next" edges. */
function chain(flow) {
  const steps = (flow && flow.steps) || [];
  const next = new Map();
  const hasIn = new Set();
  for (const e of (flow && flow.edges) || []) {
    if (e.kind !== "next") continue;
    if (!next.has(e.from)) next.set(e.from, e.to);
    hasIn.add(e.to);
  }
  const start =
    steps.find((s) => s.kind === "source") ||
    steps.find((s) => !hasIn.has(s.id)) ||
    steps[0];
  const out = [];
  const seen = new Set();
  let cur = start;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    const to = next.get(cur.id);
    cur = to ? steps.find((s) => s.id === to) : null;
  }
  // Steps off the chain come last, so nothing is lost.
  for (const s of steps) if (!seen.has(s.id)) out.push(s);
  return out;
}

const stepById = (flow, id) =>
  ((flow && flow.steps) || []).find((s) => s.id === id) || null;

/** The step after `stepId` on the chain, or null at the end. */
function nextStep(flow, stepId) {
  const e = ((flow && flow.edges) || []).find(
    (x) => x.kind === "next" && x.from === stepId,
  );
  return e ? stepById(flow, e.to) : null;
}

/** The step before `stepId` on the chain, or null. */
function prevStep(flow, stepId) {
  const e = ((flow && flow.edges) || []).find(
    (x) => x.kind === "next" && x.to === stepId,
  );
  return e ? stepById(flow, e.from) : null;
}

/**
 * Where "Send back" at a you step reruns the work: the step it names, else
 * the nearest bot step before it.
 */
function sendBackTarget(flow, stepId) {
  const step = stepById(flow, stepId);
  if (!step || step.kind !== "you") return null;
  const named = step.sendBackTo ? stepById(flow, step.sendBackTo) : null;
  // Only a bot step reruns work (the runner never picks up a source step).
  if (named && named.kind === "bot") return named;
  const seen = new Set();
  let cur = prevStep(flow, stepId);
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === "bot") return cur;
    seen.add(cur.id);
    cur = prevStep(flow, cur.id);
  }
  return null;
}

/** Where a failed step sends the work back to, or null (it comes to you). */
function failTarget(flow, stepId) {
  const e = ((flow && flow.edges) || []).find(
    (x) => x.kind === "fail" && x.from === stepId,
  );
  return e ? stepById(flow, e.to) : null;
}

/** The first step that does work: the one after the source. */
function firstWorkStep(flow) {
  const order = chain(flow);
  const src = order.find((s) => s.kind === "source");
  if (src) return nextStep(flow, src.id);
  return order[0] || null;
}

/**
 * The step whose record a step reads: the nearest step before it that makes
 * something (a bot or the source) — checks pass the work through.
 */
function inputStep(flow, stepId) {
  let cur = prevStep(flow, stepId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    // In a bot's own checks (bot-checks PRD) a reviewer only judges: the
    // work it judged passes through it. (A flow's reviewer stays an input.)
    const passThrough = cur.judgment && flow && flow.kind === "bot-checks";
    if ((cur.kind === "bot" && !passThrough) || cur.kind === "source")
      return cur;
    cur = prevStep(flow, cur.id);
  }
  return null;
}

/** Bots a flow uses, by id. */
function botIdsOf(flow) {
  return [
    ...new Set(
      ((flow && flow.steps) || []).filter((s) => s.botId).map((s) => s.botId),
    ),
  ];
}

/**
 * Insert a step between two chained steps (the + on an arrow): the "next"
 * edge from→to becomes from→new→to. A new check gets a fail edge back to
 * the step whose work it checks.
 */
function insertBetween(flow, fromId, toId, step) {
  const f = normalizeFlow(flow);
  const id = uniqueStepId(f, step.id);
  const added = cleanStep({ ...step, id }, f.steps.length);
  if (!added) return { error: "That step isn't complete." };
  const edges = f.edges.filter(
    (e) => !(e.kind === "next" && e.from === fromId && e.to === toId),
  );
  if (fromId) edges.push({ from: fromId, to: id, kind: "next", label: "" });
  if (toId) edges.push({ from: id, to: toId, kind: "next", label: "" });
  const steps = [...f.steps];
  const at = steps.findIndex((s) => s.id === toId);
  if (at >= 0) steps.splice(at, 0, added);
  else steps.push(added);
  const out = normalizeFlow({ ...f, steps, edges });
  if (added.kind === "check" && step.failTo !== null) {
    const back =
      step.failTo || (inputStep(out, id) ? inputStep(out, id).id : null);
    if (back && back !== id) {
      out.edges.push({ from: id, to: back, kind: "fail", label: "" });
    }
  }
  return { flow: { ...flow, ...out, id: flow.id }, stepId: id };
}

function uniqueStepId(flow, want) {
  const ids = new Set(((flow && flow.steps) || []).map((s) => s.id));
  if (want && STEP_ID.test(want) && !ids.has(want)) return want;
  let n = ids.size + 1;
  while (ids.has(`step_${n}`)) n++;
  return `step_${n}`;
}

/** Remove a step, joining the steps either side of it. */
function removeStep(flow, stepId) {
  const f = normalizeFlow(flow);
  const before = prevStep(f, stepId);
  const after = nextStep(f, stepId);
  const edges = f.edges.filter((e) => e.from !== stepId && e.to !== stepId);
  if (before && after) {
    edges.push({ from: before.id, to: after.id, kind: "next", label: "" });
  }
  const steps = f.steps.filter((s) => s.id !== stepId);
  return { ...flow, ...normalizeFlow({ ...f, steps, edges }), id: flow.id };
}

/** One line for the flow switcher: "5 steps · from Jira, label auto". */
function briefLine(flow) {
  const n = ((flow && flow.steps) || []).length;
  const steps = `${n} step${n === 1 ? "" : "s"}`;
  return flow && flow.brief ? `${steps} · ${flow.brief}` : steps;
}

module.exports = {
  STEP_KINDS,
  CHECK_KINDS,
  BUILTIN_CHECK_KINDS,
  FIELD_KINDS,
  FLOW_ID,
  STEP_ID,
  DEFAULT_MAX_ROUNDS,
  clampRounds,
  cleanFields,
  normalizeFlow,
  chain,
  stepById,
  nextStep,
  prevStep,
  failTarget,
  sendBackTarget,
  YOU_MODES,
  youModeOf,
  firstWorkStep,
  inputStep,
  botIdsOf,
  insertBetween,
  removeStep,
  uniqueStepId,
  briefLine,
};
