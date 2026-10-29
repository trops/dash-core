/**
 * workspacePlan.js — the plan in a lead workspace conversation (lead-workspace
 * release 3a). The Planner's plan arrives on its hand-off step (handoffSteps
 * keeps it there); the latest one is the plan the conversation is about.
 * Pure.
 */
import { countsLine, editNote } from "../Create/planChecklist";
import { planTarget } from "../../utils/teamPlan";

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

/**
 * "Plan · 2 new widgets and 1 new bot" — the card's line; a change to a
 * dashboard the user has (release 3c): "Plan · 1 added · on Kitchen Sink".
 */
export function planLine(plan) {
  const target = plan ? planTarget(plan) : null;
  const added = target ? addedCount(plan) : 0;
  if (added) return `Plan · ${added} added · on ${target.name}`;
  const counts = plan ? countsLine(plan) : "";
  // A change that fills no cells (a new bot, a theme): what it makes.
  const on = target ? ` · on ${target.name}` : "";
  return counts ? `Plan · ${counts}${on}` : `Plan${on}`;
}

/** What a change adds: its widgets, and new bots' results cards. */
function addedCount(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  return (
    pieces.filter((p) => p.kind === "widget" && p.name).length +
    pieces.filter(
      (p) => p.kind === "bot" && p.source === "new" && p.showResults,
    ).length
  );
}

/** Yes, build it — or, for a dashboard the user has, Yes, make the changes. */
export function yesLabel(plan) {
  return plan && planTarget(plan) ? "Yes, make the changes" : "Yes, build it";
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

const SOURCE_LINE = {
  yours: "Yours",
  "ai-built": "AI-built",
  registry: "From the registry",
  new: "New",
  update: "Yours, changed",
};

/** "1 widget" · "3 widgets" */
const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The providers the plan needs connected (Before it builds' connects). */
const connectItems = (checklist) =>
  (checklist || []).filter((it) => it && it.kind === "connect");
const providerName = (it) => String(it.label || "").replace(/^Connect /, "");

/**
 * The opened plan's line (frame 6): "4 widgets · 1 bot · uses Home
 * Assistant".
 */
export function planSubLine(plan, checklist = []) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const widgets = pieces.filter((p) => p && p.kind === "widget").length;
  const bots = pieces.filter((p) => p && p.kind === "bot").length;
  const uses = connectItems(checklist).map(providerName);
  return [
    widgets ? count(widgets, "widget") : null,
    bots ? count(bots, "bot") : null,
    uses.length ? `uses ${uses.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The opened plan's rows (frame 6): one per widget or bot — its name, where
 * it comes from and what it's for — then a warning row per provider still to
 * connect. `isDone(item)` says whether a connect is done.
 * @returns {{ main: string, sub: string, warn?: boolean }[]}
 */
export function planRows(plan, checklist = [], isDone = () => false) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const rows = pieces
    .filter((p) => p && (p.kind === "widget" || p.kind === "bot") && p.name)
    .map((p) => {
      const source = SOURCE_LINE[p.source] || SOURCE_LINE.new;
      const what = String(p.adds || p.notes || p.package || "").trim();
      return { main: p.name, sub: what ? `${source} — ${what}` : source };
    });
  for (const it of connectItems(checklist)) {
    if (isDone(it)) continue;
    rows.push({
      main: `Needs ${providerName(it)} connected`,
      sub: "Before it builds, or during the build",
      warn: true,
    });
  }
  return rows;
}

/**
 * The Providers line at the foot of the right column: each provider the plan
 * needs and whether it's connected; "none needed" for a plan that needs
 * none.
 */
export function providersLine(checklist = [], isDone = () => false) {
  const items = connectItems(checklist);
  if (!items.length) return "none needed";
  return items
    .map(
      (it) =>
        `${providerName(it)} · ${isDone(it) ? "connected" : "not connected yet"}`,
    )
    .join(" · ");
}

const firstLineOf = (t) =>
  String(t || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";

/**
 * A plan from another chat (Open as a plan, release 3c) as a Dash Lead
 * conversation: what the user said, the Planner's answers as its steps —
 * the last one bringing the plan — and the lead asking whether to build it.
 * @param {{ plan, messages: [{ who: "you"|"planner"|"note", text }] }} seed
 * @returns {object[]} messages for a saved conversation
 */
export function seedConversation(seed) {
  const list = (seed && Array.isArray(seed.messages) && seed.messages) || [];
  const lastPlanner = list.map((m) => m && m.who).lastIndexOf("planner");
  const out = [];
  list.forEach((m, i) => {
    if (!m || !String(m.text || "").trim()) return;
    if (m.who === "you") out.push({ who: "you", text: String(m.text) });
    else if (m.who === "planner") {
      out.push({
        who: "step",
        id: `seed:${i}`,
        bot: "the Planner",
        label: "Asked the Planner",
        status: "done",
        answer: String(m.text),
        result: firstLineOf(m.text),
        ...(i === lastPlanner && seed.plan ? { plan: seed.plan } : {}),
      });
    } else if (m.who === "note") {
      out.push({ who: "note", text: String(m.text) });
    }
  });
  // No Planner answer kept: the plan still needs its step.
  if (lastPlanner < 0 && seed && seed.plan) {
    out.push({
      who: "step",
      id: "seed:plan",
      bot: "the Planner",
      label: "Asked the Planner",
      status: "done",
      answer: String(seed.plan.summary || ""),
      result: firstLineOf(seed.plan.summary),
      plan: seed.plan,
    });
  }
  out.push({
    who: "role",
    text: "Here's the plan from your chat with the Planner — it's on the right. Want me to build it?",
  });
  return out;
}
