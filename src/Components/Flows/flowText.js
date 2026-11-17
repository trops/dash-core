/**
 * flowText — the words and shapes the Graph tab uses for flows (flows
 * PRD). Pure, so it's tested on its own: a flow's steps and arrows as
 * FlowGraph draws them, with where goals are now; a goal's steps as pills;
 * a check's one-line summary.
 */

export const FLOWS_CHANGED = "flows:changed";

const RULE_SHORT = {
  linksWork: "Links",
  words: "length",
  maxLength: "short enough",
  banned: "banned words",
  everyIncluded: "every item used",
  required: "filled in",
  equals: "matches",
  sumEquals: "totals add up",
  noDuplicates: "nothing twice",
};

/** "Links · length · banned words · notes used" for a check's card. */
export function checkSummary(check) {
  if (!check || !check.kind) return "Setting up…";
  if (check.kind === "rules") {
    const on = (check.rules || []).filter((r) => r && r.on !== false);
    if (!on.length) return "No rules ticked yet";
    return on
      .map((r) => RULE_SHORT[r.type] || r.type)
      .join(" · ")
      .replace(/^./, (c) => c.toUpperCase());
  }
  if (check.kind === "command") return check.command || "A command";
  if (check.kind === "script") {
    return check.scriptFile
      ? `Script: ${check.scriptFile.replace(/^local:/, "")}`
      : "A short script";
  }
  if (check.kind === "tool") {
    return check.tool
      ? `Asks ${check.server || "a provider"}: ${check.tool}`
      : "A tool call";
  }
  return "";
}

/**
 * A you step's mode, as the flow model reads it: steps saved before modes
 * that say "Approve…" approve, "Read…" are read, anything else is custom.
 */
export function youModeOf(step) {
  if (step && ["approve", "read", "custom"].includes(step.mode))
    return step.mode;
  const action = String((step && step.action) || "").trim();
  if (!action || /^approve\b/i.test(action)) return "approve";
  if (/^read\b/i.test(action)) return "read";
  return "custom";
}

export const plural = (n, one, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * A flow's steps as FlowGraph draws them, with where its goals are now
 * (frame 5): "1 goal · round 2", "1 ready", "or stopped at round 3".
 */
export function graphSteps(flow, { warnSteps = [] } = {}) {
  if (!flow) return [];
  const where = (flow.where && flow.where.counts) || {};
  const names = flow.botNames || {};
  const hasFail = (flow.edges || []).some((e) => e.kind === "fail");
  return (flow.steps || []).map((s) => {
    const c = where[s.id];
    let badge = null;
    if (c && c.goals) {
      if (s.kind === "you") {
        badge = { state: "warning", label: `${c.ready || c.goals} ready` };
      } else if (c.stopped) {
        badge = {
          state: "warning",
          label: `${plural(c.stopped, "job")} stopped`,
        };
      } else {
        const maxRound = Math.max(...(c.rounds || [1]));
        badge = {
          state: "info",
          label: `${plural(c.goals, "job")}${maxRound > 1 ? ` · round ${maxRound}` : ""}`,
        };
      }
    }
    const note =
      s.kind === "check"
        ? s.note || checkSummary(s.check)
        : s.note || (s.botId && names[s.botId] ? names[s.botId] : "");
    const step = {
      id: s.id,
      kind: s.kind,
      name: s.name,
      note,
      badge,
      warn: warnSteps.includes(s.id),
    };
    if (s.kind === "you" && hasFail) {
      step.below = {
        text: `or stopped at round ${flow.maxRounds || 3}`,
        state: "warning",
      };
    }
    return step;
  });
}

/** A flow's arrows, with a label on each fix round. */
export function graphEdges(flow) {
  if (!flow) return [];
  const byId = Object.fromEntries((flow.steps || []).map((s) => [s.id, s]));
  return (flow.edges || []).map((e) => {
    if (e.kind !== "fail") return { ...e };
    const from = byId[e.from];
    const judged = from && from.kind === "bot";
    return {
      ...e,
      state: judged ? "warning" : "error",
      label:
        e.label ||
        `${judged ? "fix list" : "failed → fix list"} · up to ${flow.maxRounds || 3} rounds`,
    };
  });
}

/** Steps the warnings point at (their cards get an amber border). */
export function warnedSteps(flow) {
  const ids = new Set();
  for (const w of (flow && flow.warnings) || []) {
    if (
      w.id.startsWith("unanchored:") ||
      w.id.startsWith("no-bot:") ||
      w.id.startsWith("no-check:")
    ) {
      ids.add(w.stepId);
    }
  }
  return [...ids];
}

/** One line for the flow switcher: "5 steps · from Jira, label auto". */
export function flowLine(flow) {
  if (!flow) return "";
  return flow.line || `${plural((flow.steps || []).length, "step")}`;
}

/** The count pill in the switcher: "4 goals", "1 running", or nothing. */
export function flowCount(flow) {
  const w = (flow && flow.where) || {};
  if (w.running) return { state: "info", label: `${w.running} running` };
  if (w.total) return { state: "info", label: plural(w.total, "job") };
  return null;
}

/**
 * A goal's steps as pills (frame 3): passed steps green, the step it's at
 * in progress (red when its last record there failed, amber when it waits
 * for you), steps ahead plain.
 */
export function stepPills(goal) {
  const flow = goal && goal.flow;
  if (!flow) return [];
  const task = (goal.tasks || [])[0];
  const order = chainOrder(flow).filter((s) => s.kind !== "source");
  const history = (task && task.history) || [];
  const passed = new Set(
    history
      .filter((r) => r.status === "passed" && r.stepId)
      .map((r) => r.stepId),
  );
  const done = task && task.status === "done";
  let reached = false;
  return order.map((s) => {
    const at = task && task.stepId === s.id;
    if (at) reached = true;
    let state = "neutral";
    if (done || (!reached && passed.has(s.id))) state = "success";
    if (at && !done) {
      const lastHere = [...history].reverse().find((r) => r.stepId === s.id);
      state =
        task.status === "needs-you" || task.status === "ready"
          ? "warning"
          : lastHere && lastHere.status === "failed"
            ? "error"
            : "info";
    }
    return { id: s.id, label: s.name, state };
  });
}

/** Steps in chain order (the "next" edges from the first step). */
export function chainOrder(flow) {
  const steps = (flow && flow.steps) || [];
  if (flow && Array.isArray(flow.order) && flow.order.length) {
    return flow.order
      .map((id) => steps.find((s) => s.id === id))
      .filter(Boolean);
  }
  const next = new Map();
  const hasIn = new Set();
  for (const e of (flow && flow.edges) || []) {
    if (e.kind !== "next") continue;
    next.set(e.from, e.to);
    hasIn.add(e.to);
  }
  const start =
    steps.find((s) => s.kind === "source") ||
    steps.find((s) => !hasIn.has(s.id));
  const out = [];
  const seen = new Set();
  let cur = start;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    const to = next.get(cur.id);
    cur = to ? steps.find((s) => s.id === to) : null;
  }
  for (const s of steps) if (!seen.has(s.id)) out.push(s);
  return out;
}

/** The step before and after a step, by name ("between Writer and Sender"). */
export function betweenText(flow, from, to) {
  const name = (id) => {
    const s = ((flow && flow.steps) || []).find((x) => x.id === id);
    return s ? s.name : null;
  };
  const a = name(from);
  const b = name(to);
  if (a && b) return `between ${a} and ${b}`;
  if (a) return `after ${a}`;
  if (b) return `before ${b}`;
  return "";
}

/** Where a failed check sends the work: the step on its fail edge. */
export function failTargetOf(flow, stepId) {
  const e = ((flow && flow.edges) || []).find(
    (x) => x.kind === "fail" && x.from === stepId,
  );
  if (!e) return null;
  return ((flow && flow.steps) || []).find((s) => s.id === e.to) || null;
}

/** The step a step reads (the nearest bot or source before it). */
export function inputStepOf(flow, stepId) {
  const steps = (flow && flow.steps) || [];
  const prev = (id) => {
    const e = ((flow && flow.edges) || []).find(
      (x) => x.kind === "next" && x.to === id,
    );
    return e ? steps.find((s) => s.id === e.from) : null;
  };
  let cur = prev(stepId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.kind === "bot" || cur.kind === "source") return cur;
    cur = prev(cur.id);
  }
  return null;
}

/** The kinds a field can be, as the fields table names them. */
export const FIELD_KIND_LABELS = {
  text: "Text",
  number: "Number",
  boolean: "Yes / no",
  list: "List",
  links: "List of links",
  paths: "List of paths",
  object: "Group of fields",
  empty: "Empty",
};
