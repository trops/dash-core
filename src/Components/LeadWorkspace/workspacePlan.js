/**
 * workspacePlan.js — the plan in a lead workspace conversation (lead-workspace
 * release 3a). The Planner's plan arrives on its hand-off step (handoffSteps
 * keeps it there); the latest one is the plan the conversation is about.
 * Pure.
 */
import { countsLine, editNote } from "../Create/planChecklist";
import { planTarget } from "../../utils/teamPlan";
import {
  themeByName,
  themeColors,
  themeOrigin,
  themePublished,
} from "../../utils/themeStanding";

/** The latest hand-off step that brought a plan, or null. */
export function latestPlanStep(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.who === "step" && m.plan) return m;
  }
  return null;
}

/** A plan's new theme piece (lead-workspace theme round), or null. */
export function newTheme(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) ? plan.pieces : []).filter(
    Boolean,
  );
  return (
    pieces.find((p) => p.kind === "theme" && p.source === "new" && p.name) ||
    null
  );
}

/** A plan that only makes a theme (theme round, frame 45). */
export function isThemeOnly(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) ? plan.pieces : []).filter(
    Boolean,
  );
  return (
    !!newTheme(plan) &&
    !planTarget(plan) &&
    pieces.every((p) => p.kind === "theme")
  );
}

/** A plan's change to a saved theme (theme change round), or null. */
export function themeChange(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) ? plan.pieces : []).filter(
    Boolean,
  );
  return (
    pieces.find((p) => p.kind === "theme" && p.source === "update" && p.name) ||
    null
  );
}

/**
 * A plan that only changes a saved theme (frames 49-50) — on a dashboard
 * or not: the change (or the remix) reaches everywhere the theme is used.
 */
export function isThemeChangeOnly(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) ? plan.pieces : []).filter(
    Boolean,
  );
  return !!themeChange(plan) && pieces.every((p) => p.kind === "theme");
}

/**
 * The theme a plan changes, and whose it is: { key, raw, origin, published }
 * — origin set when it was downloaded (a remix is made); null when the user
 * has no theme by that name. `rawThemes`: ThemeContext's saved themes.
 */
export function changeStanding(plan, rawThemes, username = null) {
  const piece = themeChange(plan);
  const hit = piece ? themeByName(rawThemes, piece.name) : null;
  if (!hit) return null;
  const [key, raw] = hit;
  return {
    key,
    raw,
    // Your own registry scope is yours (theme change leftovers).
    origin: themeOrigin(raw, { username }),
    published: themePublished(raw, { username }),
  };
}

/** A new theme's four colors, one row each (frame 45). */
const THEME_COLORS = [
  ["primary", "Primary", "Buttons, links, what's selected"],
  ["secondary", "Secondary", "Highlights and badges"],
  ["tertiary", "Tertiary", "Charts and accents"],
  ["neutral", "Neutral", "Backgrounds and borders, dark and light"],
];
export function themeColorRows(piece) {
  const colors = (piece && piece.colors) || {};
  // The Planner's plain names ("rust"); the hex when it gave none.
  const names =
    piece && piece.colorNames && typeof piece.colorNames === "object"
      ? piece.colorNames
      : {};
  return THEME_COLORS.filter(([key]) => colors[key]).map(([key, name, sub]) => {
    const word =
      typeof names[key] === "string" && names[key].trim()
        ? names[key].trim().slice(0, 40)
        : String(colors[key]).toLowerCase();
    return { main: `${name} — ${word}`, sub, swatch: colors[key] };
  });
}

/**
 * A change to a theme, a row per color (frame 49): "Primary — slate blue →
 * rust", or "Tertiary — dusty blue · unchanged". `raw`: the theme as
 * saved now (null: only the new colors). `changed` marks a new color.
 */
export function themeChangeRows(piece, raw) {
  const colors = (piece && piece.colors) || {};
  const now = raw ? themeColors(raw) : {};
  const word = (names, key, fallback) =>
    names &&
    typeof names === "object" &&
    typeof names[key] === "string" &&
    names[key].trim()
      ? names[key].trim().slice(0, 40)
      : fallback;
  return THEME_COLORS.filter(([key]) => colors[key]).map(([key, name, sub]) => {
    const next = String(colors[key]).toLowerCase();
    const was = now[key] || null;
    const after = word(piece.colorNames, key, next);
    const before = word(piece.colorNamesNow, key, was);
    const same = !!was && was === next;
    return {
      main: same
        ? `${name} — ${before} · unchanged`
        : before
          ? `${name} — ${before} → ${after}`
          : `${name} — ${after}`,
      sub,
      swatch: colors[key],
      changed: !same,
    };
  });
}

/** The plan's name: its layout's, the dashboard it changes, or its summary. */
export function planName(plan) {
  if (!plan) return "";
  // A change to one widget (release 6c): that widget.
  if (plan.widgetChange) return plan.widgetChange.displayName || "The widget";
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
export function planLine(plan, { rawThemes = null, username = null } = {}) {
  const target = plan ? planTarget(plan) : null;
  const added = target ? addedCount(plan) : 0;
  // A change to one widget (release 6c, frame 40): its settings, or what
  // it does.
  if (plan && plan.widgetChange) {
    if (!fitsWidget(plan)) return "Plan · more than this widget";
    const n = settingsChanged(plan).length;
    return isSettingsChange(plan)
      ? `Plan · ${n} setting${n === 1 ? "" : "s"} change`
      : "Plan · a change to what it does";
  }
  // One widget for an empty cell (release 6c, frame 39) — or a plan that
  // doesn't fit one.
  if (plan && plan.cell)
    return fitsCell(plan)
      ? "Plan · 1 added, in the cell you picked"
      : "Plan · doesn't fit one cell";
  if (isThemeOnly(plan)) return "Plan · 1 new theme";
  // A change to a saved theme (theme change round, frames 49-50).
  if (isThemeChangeOnly(plan)) {
    const piece = themeChange(plan);
    const st = changeStanding(plan, rawThemes, username);
    const on = "";
    if (st && st.origin) {
      return `Plan · a remix of ${st.raw.name}${
        st.origin.author ? `, by ${st.origin.author}` : ""
      }${on}`;
    }
    const n = st
      ? themeChangeRows(piece, st.raw).filter((r) => r.changed).length
      : 0;
    return n
      ? `Plan · ${n} color${n === 1 ? "" : "s"} change${on}`
      : `Plan · a change to ${piece.name}${on}`;
  }
  // Only a new theme, on a dashboard you have (frame 46).
  if (
    target &&
    newTheme(plan) &&
    plan.pieces.every((p) => p && p.kind === "theme")
  ) {
    return `Plan · a new theme, on ${target.name}`;
  }
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

/**
 * Yes, build it — or, for a dashboard the user has, Yes, make the changes;
 * for an empty cell, Yes, add it.
 */
export function yesLabel(plan, { rawThemes = null, username = null } = {}) {
  if (plan && plan.cell) return "Yes, add it";
  if (plan && plan.widgetChange) return "Yes, change it";
  if (isThemeOnly(plan)) return "Yes, make it";
  // A change to a saved theme: a downloaded one becomes a remix.
  if (isThemeChangeOnly(plan)) {
    const st = changeStanding(plan, rawThemes, username);
    return st && st.origin ? "Yes, make the remix" : "Yes, change it";
  }
  return plan && planTarget(plan) ? "Yes, make the changes" : "Yes, build it";
}

/** A plan that fits an empty cell: exactly one widget, nothing else. */
export function fitsCell(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  return pieces.length === 1 && pieces[0].kind === "widget";
}

/**
 * A conversation about an empty cell (release 6c): its plan is for that
 * cell's dashboard, and says which cell (`cell`) — so it shows what
 * changes there. What's built goes without them: the editor places it.
 */
export function planForCell(plan, cell) {
  if (!plan || !cell) return plan;
  return {
    ...plan,
    dashboard: {
      id: String(cell.workspaceId),
      name: cell.dashboardName || "Your dashboard",
    },
    cell: {
      cellNumber: cell.cellNumber,
      gridItemId: cell.gridItemId,
      pageId: cell.pageId ?? null,
      scope: cell.scope || "main",
    },
  };
}

/**
 * A conversation about changing one widget (release 6c): its plan says
 * which (`widgetChange`). A settings change is for that copy's dashboard
 * (unsaved edits there come first); a change to what it does names no
 * dashboard.
 */
export function planForWidget(plan, widget) {
  if (!plan || !widget) return plan;
  const { dashboard: _d, ...rest } = plan;
  const next = { ...rest, widgetChange: widget };
  if (
    widget.onDashboard &&
    isSettingsChange(next) &&
    widget.workspaceId != null
  ) {
    next.dashboard = {
      id: String(widget.workspaceId),
      name: widget.dashboardName || "Your dashboard",
    };
  }
  return next;
}

/** The widget piece of a change, when the plan is that one widget. */
function changePiece(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  return pieces.length === 1 && pieces[0].kind === "widget" ? pieces[0] : null;
}

/**
 * A change plan that is that one widget, nothing else — and a settings
 * change only for a copy on a dashboard.
 */
export function fitsWidget(plan) {
  const p = changePiece(plan);
  if (!p) return false;
  if (p.source === "settings")
    return !!(plan.widgetChange && plan.widgetChange.onDashboard);
  return true;
}

/** Only its settings change (source "settings"): nothing is built. */
export function isSettingsChange(plan) {
  const p = changePiece(plan);
  return !!(p && p.source === "settings");
}

/** The settings a settings change sets: [key]. */
export function settingsChanged(plan) {
  const p = changePiece(plan);
  return p && p.settings && typeof p.settings === "object"
    ? Object.keys(p.settings)
    : [];
}

/** The plan as a change's build takes it: no dashboard, no widgetChange. */
export function widgetBuildPlan(plan) {
  if (!plan) return plan;
  const { dashboard: _d, widgetChange: _w, ...rest } = plan;
  return rest;
}

/** The plan as a cell build takes it: no dashboard, no cell. */
export function cellBuildPlan(plan) {
  if (!plan) return plan;
  const { dashboard: _d, cell: _c, ...rest } = plan;
  return rest;
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
  // The app's own hand-off to the Planner brought it (an answer, Decide for
  // me): no lead answers after it, so the choices go under it.
  if (at === last && step.direct && step.status === "done") return last;
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
  // The plan still asks something: this answers it, and only the Planner's
  // new plan can be built (a theme plan stayed on its question otherwise).
  const asks = Array.isArray(plan.questions) && plan.questions.length > 0;
  const how = asks
    ? "This answers the Planner's questions — send it to the Planner with this plan, so it can finish the plan"
    : "If this changes it, ask the Planner to change it and send it this plan with the change";
  return [
    note,
    t,
    `(The plan as it stands. ${how}:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`)`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A typed reply that only says yes to the plan ("yes", "yes build it", "go
 * ahead") — it builds, as Yes does. Anything more ("yes but purple") goes to
 * the lead.
 */
export function isPlainYes(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, "")
    .replace(/\s+/g, " ");
  return /^(?:(?:yes|yep|yeah)(?:,? please)?(?:[,\s—-]+(?:go ahead|do it|build it|make it|save it))?(?:,? please)?|(?:ok|okay|sure)[,\s—-]+(?:go ahead|do it|build it|make it|save it)(?:,? please)?|(?:please )?(?:go ahead|do it|build it|make it|save it)(?:,? please)?)$/.test(
    t,
  );
}

// What the Planner is told with every request the app sends it: it sees
// only what it's sent, not the conversation.
function planBlock(plan, asked) {
  return [
    asked ? `The user's request: "${String(asked).trim()}"` : "",
    `The plan as it stands:\n\`\`\`json\n${JSON.stringify(plan || {})}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}
const SEND_IT_BACK =
  "Send the whole plan back inside <plan></plan>, as always, and say in a sentence or two what you changed.";

/**
 * The user's answer to the plan's questions, sent by the app straight to
 * the Planner (not through the lead): only the Planner's new plan can be
 * built.
 * @param {string} answer  what they picked or typed
 * @param {object} plan    the plan as it stands
 * @param {{ asked?: string, edits?: string[] }} [opts]  their first words;
 *   changes they made to the plan on the right
 */
export function answerRequest(answer, plan, { asked = "", edits = [] } = {}) {
  return [
    editNote(edits),
    `The user answered your questions about this plan: "${String(answer || "").trim()}"`,
    `Finish the plan with their answer: leave out every question it answers. If it changes what they want, plan that instead. Ask again only what still only they can decide. ${SEND_IT_BACK}`,
    planBlock(plan, asked),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Decide for me and finish the plan: the Planner picks, no questions left. */
export function decideRequest(plan, { asked = "", edits = [] } = {}) {
  return [
    editNote(edits),
    "The user asked you to decide for them and finish the plan.",
    `For each of the plan's questions, pick the answer that fits their request best (when in doubt, the one that changes the least). Leave no questions in the plan, so it can be built. ${SEND_IT_BACK} Say what you picked.`,
    planBlock(plan, asked),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Ask the Planner to fill the gaps the plan check found. */
export function fixRequest(errors, plan, { asked = "", edits = [] } = {}) {
  const list = (Array.isArray(errors) ? errors : []).filter(Boolean);
  return [
    editNote(edits),
    `The plan can't be built yet. What's missing:\n${list.map((e) => `- ${e}`).join("\n")}`,
    `Fill these gaps. Ask the user only what only they can decide. ${SEND_IT_BACK}`,
    planBlock(plan, asked),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Start the plan over: from the user's request, as if it were new. */
export function startOverRequest(asked) {
  return `Plan this from the start, as a new request — forget any earlier plan. The user's request: "${String(asked || "").trim()}"`;
}

/** The last message is the app's own hand-off to the Planner, answered without a plan. */
function directWithoutPlan(list) {
  const last = list[list.length - 1];
  return !!(
    last &&
    last.who === "step" &&
    last.direct &&
    last.status !== "asking" &&
    !last.plan
  );
}

/**
 * The plan's next step, for its card (always one — the plan never leaves
 * the user stuck):
 *   "build"     it's building or built: the build's own choices
 *   "waiting"   the app asked the Planner; it's answering
 *   "answering" the lead is answering; the plan may change
 *   "sent"      sent to the retired Create window
 *   "nothing"   the Planner answered the app without a new plan
 *   "question"  the Planner has questions
 *   "gaps"      the plan check found gaps
 *   "ready"     Yes, make it
 *   "empty"     the plan makes nothing
 * @param {{ messages, busy, plan, check, sent, build }} p  busy: the
 *   conversation is still being answered (the lead may still be writing)
 */
export function planNext({
  messages = [],
  busy = false,
  plan = null,
  check = null,
  sent = false,
  build = null,
}) {
  const list = Array.isArray(messages) ? messages : [];
  if (!plan) return directWithoutPlan(list) ? "nothing" : null;
  if (build) return "build";
  const last = list[list.length - 1];
  if (last && last.who === "step" && last.direct && last.status === "asking")
    return "waiting";
  if (busy || stillAnswering(list)) return "answering";
  if (sent) return "sent";
  if (directWithoutPlan(list)) return "nothing";
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  if (questions.length) return "question";
  if (check && check.errors && check.errors.length) return "gaps";
  if (canBuild({ plan, check })) return "ready";
  return "empty";
}

/** The next step waits on the user: the card is marked. */
export function nextNeedsYou(next) {
  return (
    next === "question" ||
    next === "ready" ||
    next === "nothing" ||
    next === "gaps" ||
    next === "empty"
  );
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
export function planSubLine(
  plan,
  checklist = [],
  { rawThemes = null, username = null } = {},
) {
  if (isThemeOnly(plan)) {
    return "A new theme — nothing is saved until you say yes";
  }
  if (isThemeChangeOnly(plan)) {
    const st = changeStanding(plan, rawThemes, username);
    return st && st.origin
      ? `${st.raw.name} is by ${
          st.origin.author || "someone else"
        } — your change is saved as a remix that credits them`
      : "Your theme — nothing changes until you say yes";
  }
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
export function planRows(
  plan,
  checklist = [],
  isDone = () => false,
  // themeNow: a changed theme as it was before its build (theme change round).
  { rawThemes = null, username = null, themeNow = null } = {},
) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const rows = pieces
    .filter((p) => p && (p.kind === "widget" || p.kind === "bot") && p.name)
    .map((p) => {
      const source = SOURCE_LINE[p.source] || SOURCE_LINE.new;
      const what = String(p.adds || p.notes || p.package || "").trim();
      return { main: p.name, sub: what ? `${source} — ${what}` : source };
    });
  // A new theme: its colors (theme round).
  if (isThemeOnly(plan)) rows.push(...themeColorRows(newTheme(plan)));
  // A change to a saved theme: each color, before and after (frame 49).
  if (isThemeChangeOnly(plan)) {
    const st = changeStanding(plan, rawThemes, username);
    rows.push(
      ...themeChangeRows(themeChange(plan), themeNow || (st ? st.raw : null)),
    );
  }
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
  // No Planner answer kept: the plan still needs its step — the seed's own
  // (a registry dashboard, release 6c), or the Planner's.
  if (lastPlanner < 0 && seed && seed.plan) {
    const step =
      (seed.step && typeof seed.step === "object" && seed.step) || {};
    out.push({
      who: "step",
      id: "seed:plan",
      bot: step.bot || "the Planner",
      label: step.label || "Asked the Planner",
      status: "done",
      answer: String(seed.plan.summary || ""),
      result: firstLineOf(seed.plan.summary),
      plan: seed.plan,
    });
  }
  out.push({
    who: "role",
    text:
      (seed && typeof seed.reply === "string" && seed.reply) ||
      "Here's the plan from your chat with the Planner — it's on the right. Want me to build it?",
  });
  return out;
}
