/**
 * flowText — a bot's checks job as pills (bot-checks PRD): the steps its
 * work goes through, in order, with where the job is now. Pure, so it's
 * tested on its own.
 */

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
  // Closed: the step it stopped at is red when it failed there, grey when
  // it was just closed — never "running" (DASH-13).
  const closed = task && task.status === "closed";
  let reached = false;
  return order.map((s) => {
    const at = task && task.stepId === s.id;
    if (at) reached = true;
    let state = "neutral";
    if (done || (!reached && passed.has(s.id))) state = "success";
    if (at && !done) {
      // Its own record, not the close that came after it.
      const lastHere = [...history]
        .reverse()
        .find((r) => r.stepId === s.id && r.status !== "close");
      const failedHere = !!(lastHere && lastHere.status === "failed");
      state = closed
        ? failedHere
          ? "error"
          : "neutral"
        : task.status === "needs-you" || task.status === "ready"
          ? "warning"
          : failedHere
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
