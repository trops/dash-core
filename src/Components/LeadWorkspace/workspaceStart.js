/**
 * workspaceStart.js — what a new Dash Lead conversation opened by a page's
 * New button says (lead-workspace release 6c, frame 41), and the registry's
 * dashboards as Start from lists them (frame 42). Pure.
 */
import { providerLabel } from "../Create/planChecklist";
import { starterToPlan } from "../Create/starters";

const MAKING = {
  widget: {
    what: "a widget",
    title: "What should the widget do?",
    text: "Describe it in your own words. The Dash team plans it with you and builds it; it lands on the Widgets page, ready to add to any dashboard.",
    starters: [
      "Show my calendar for today",
      "Track a stock price",
      "A to-do list",
      "Show my AWS bill",
    ],
  },
  bot: {
    what: "a bot",
    title: "What should the bot do?",
    text: "Describe it in your own words — what it watches, when it runs, what it tells you. The Dash team plans it with you; it's saved paused until you turn it on.",
    starters: [
      "Sum up my email each morning",
      "Tell me when a stock moves 5%",
      "Check my AWS bill every day",
      "Remind me of tomorrow's meetings",
    ],
  },
  dashboard: {
    what: "a dashboard",
    title: "What should the dashboard show?",
    text: "Describe it in your own words. The Dash team plans it with you — its widgets, bots and layout — and nothing is made until you say yes.",
    starters: [
      "My smart home",
      "My day: calendar, email and weather",
      "My AWS costs",
      "Sales at a glance",
    ],
  },
};

const PAGES = {
  widgets: "the Widgets page",
  bots: "the Bots page",
  dashboards: "the Dashboards page",
};

/**
 * A page's New: { kind: "widget" | "bot" | "dashboard", from?: page } →
 * the conversation's start — its "Making:" line, greeting and starters,
 * and what the Dash Lead is told with the first question. null for
 * anything else.
 */
export function makingStart(making) {
  const m = making && MAKING[making.kind];
  if (!m) return null;
  const page = making.from ? PAGES[making.from] : null;
  return {
    label: "Making",
    text: page ? `${m.what} — from ${page}` : m.what,
    title: m.title,
    greeting: m.text,
    starters: m.starters,
    // Goes with the first question (and the first reply after a reopen).
    note: `(The user wants to make ${m.what} — plan ${m.what}.)`,
  };
}

/** "row 2, column 1" — and its size when it spans more than one cell. */
export function cellPlace(cell) {
  const [row, col] = String((cell && cell.cellNumber) || "")
    .split(".")
    .map((n) => Number(n));
  if (!row || !col) return "the empty cell";
  const span = (cell && cell.span) || {};
  const wide = Number(span.col) || 1;
  const tall = Number(span.row) || 1;
  const size = wide > 1 || tall > 1 ? ` (${wide} × ${tall})` : "";
  return `the empty cell in row ${row}, column ${col}${size}`;
}

/**
 * An empty cell's Build with AI (release 6c, frame 38):
 * the conversation's "For:" line, greeting and starters, and what the lead
 * is told — one widget, for that cell, placed by the editor. `cell`:
 * { workspaceId, gridItemId, cellNumber, pageId, scope, span? }.
 */
export function cellStart(cell, { dashboardName = "", leadName = "" } = {}) {
  if (!cell || cell.gridItemId == null || !cell.cellNumber) return null;
  const name = dashboardName || "this dashboard";
  const place = cellPlace(cell);
  return {
    label: "For",
    text: `${dashboardName || "Your dashboard"} — ${place}`,
    title: "What should go in this cell?",
    greeting: `Describe it, or pick one below. ${leadName || "The lead"} brings in the Dash team to find or make it, and it goes in the cell you picked — nothing changes until you say yes.`,
    starters: [
      "My calendar for today",
      "The weather",
      "A clock",
      "Something from the registry",
    ],
    note: `(The user is editing ${name} and picked ${place}. Plan exactly one widget for that cell — no bots, theme or layout. The user previews the widget and it goes into that one cell. Put the connection and settings they want on the widget piece. When you bring in the Dash team, tell the Planner this.)`,
    cell: { ...cell, dashboardName: dashboardName || "" },
  };
}

/** What the conversation saves as its `about` (AskStep): line, note, cell. */
export function makingAbout(start) {
  return start
    ? {
        label: start.label,
        text: start.text,
        note: start.note,
        ...(start.cell ? { cell: start.cell } : {}),
      }
    : null;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The registry index's public dashboards, as Start from lists them:
 * { key, packageName, name, sub } — "trops · 4 widgets · 1 bot · needs
 * Home Assistant".
 */
export function registryDashboards(index) {
  const list = Array.isArray(index)
    ? index
    : (index && Array.isArray(index.packages) && index.packages) || [];
  return list
    .filter((p) => p && p.type === "dashboard" && p.visibility !== "private")
    .map((p) => {
      const widgets = (p.widgets || []).length;
      const bots = ((p.team && p.team.members) || []).length;
      const needs = (p.providerTypes || []).map(providerLabel);
      return {
        key: `${p.scope || ""}/${p.name}`,
        packageName: p.name,
        name: p.displayName || p.name,
        sub: [
          p.scope || null,
          widgets ? plural(widgets, "widget") : null,
          bots ? plural(bots, "bot") : null,
          needs.length ? `needs ${needs.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
}

/**
 * A registry dashboard as a new Dash Lead conversation's seed: its plan
 * (as Create's starters made it), what the user picked, and the lead
 * asking whether to set it up.
 */
export function registrySeed(dashboard, config) {
  const plan = starterToPlan(config, { displayName: dashboard.name });
  return {
    plan,
    label: `Start from ${dashboard.name}`,
    messages: [
      { who: "you", text: `Start from ${dashboard.name}, from the registry` },
    ],
    step: { bot: "the registry", label: `Read ${dashboard.name}` },
    reply: `Here's ${dashboard.name} from the registry as a plan — it's on the right. Want me to set it up? Tell me anything to change first.`,
  };
}
