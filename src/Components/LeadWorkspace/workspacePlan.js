/**
 * workspacePlan.js — the plan in a lead workspace conversation (lead-workspace
 * release 3a). The Planner's plan arrives on its hand-off step (handoffSteps
 * keeps it there); the latest one is the plan the conversation is about.
 * Pure.
 */
import { countsLine, editNote } from "../Create/planChecklist";

/** The latest hand-off step that brought a plan, or null. */
export function latestPlanStep(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.who === "step" && m.plan) return m;
  }
  return null;
}

/** The plan's name: its layout's, the dashboard it changes, or its summary. */
export function planName(plan) {
  if (!plan) return "";
  const pieces = Array.isArray(plan.pieces) ? plan.pieces : [];
  const layout = pieces.find((p) => p && p.kind === "layout" && p.name);
  const name =
    (layout && layout.name) ||
    (plan.dashboard && plan.dashboard.name) ||
    (pieces.length === 1 && pieces[0] && pieces[0].name) ||
    String(plan.summary || "").trim() ||
    "The plan";
  return name.length > 60 ? `${name.slice(0, 57)}…` : name;
}

/** "Plan · 2 new widgets and 1 new bot" — the card's line. */
export function planLine(plan) {
  const counts = plan ? countsLine(plan) : "";
  return counts ? `Plan · ${counts}` : "Plan";
}

/**
 * Where the plan stands, in a few words, for its output row.
 * @param {{ plan, check, open }} p  check = validatePlan's result; open =
 *   Before it builds items still to do
 */
export function planStatus({ plan, check = null, open = 0 }) {
  if (!plan) return "";
  const questions = Array.isArray(plan.questions) ? plan.questions.length : 0;
  if (questions) {
    return questions === 1
      ? "The Planner has a question"
      : `The Planner has ${questions} questions`;
  }
  if (check && check.errors && check.errors.length) return "Needs fixing";
  return open
    ? `Waiting for your go-ahead · ${open} before it builds`
    : "Waiting for your go-ahead";
}

/**
 * Where the plan's reply choices go: after the lead's answer to the same
 * question as the latest plan (nothing the user said in between), when that
 * answer ends the conversation. Its index, or -1 — the plan on the right can
 * still be built then.
 */
export function choicesIndex(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const step = latestPlanStep(list);
  if (!step) return -1;
  const at = list.indexOf(step);
  const last = list.length - 1;
  const m = list[last];
  if (last <= at || !m || (m.who !== "lead" && m.who !== "role")) return -1;
  if (list.slice(at + 1, last).some((x) => x && x.who === "you")) return -1;
  return last;
}

/**
 * The lead is still answering: the user's question is the last word, or a
 * hand-off is still being answered. The plan isn't changed meanwhile — a
 * new one may be on its way.
 */
export function stillAnswering(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  if (!last) return false;
  if (last.who === "you") return true;
  return list.some((m) => m && m.who === "step" && m.status === "asking");
}

/** The plan can be built: nothing to answer, nothing broken. */
export function canBuild({ plan, check = null }) {
  if (!plan) return false;
  const pieces = Array.isArray(plan.pieces) ? plan.pieces : [];
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  return (
    pieces.length > 0 &&
    !questions.length &&
    !(check && check.errors && check.errors.length)
  );
}

/**
 * The conversation for Create, when the plan goes there to build: the
 * user's words, and a note that it was planned with the lead — Create shows
 * them as they were and doesn't ask the Planner again.
 */
export function createMessages(messages, leadName = "the Dash Lead") {
  const said = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.who === "you" && String(m.text || "").trim())
    .map((m) => ({ who: "you", text: String(m.text) }));
  return [...said, { who: "note", text: `Planned with ${leadName}.` }];
}

/**
 * What the user typed, sent to the lead with the plan as it stands — and the
 * changes they made to it on the right — so a change reaches the Planner
 * whole (it sees only what the lead sends).
 * @param {string} text
 * @param {object|null} plan
 * @param {string[]} edits  e.g. ["removed Weather"]
 */
export function withPlanContext(text, plan, edits = []) {
  const t = String(text || "").trim();
  if (!plan) return t;
  const note = editNote(edits);
  return [
    note,
    t,
    `(The plan as it stands. If this changes it, ask the Planner to change it and send it this plan with the change:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`)`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Who asks for each Before it builds item: the Planner made the list. */
export function whoAsks() {
  return "Planner · Dash team";
}
