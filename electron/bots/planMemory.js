/**
 * planMemory.js — a Create plan's build memory (create-entry phase 4e-1).
 *
 * Each plan has its own memory bucket (BotMemory scope "plan", id = its
 * Recent entry). Dash writes the facts here itself, with no AI:
 *   request   what the user asked for
 *   answers   what they answered or asked the Planner since
 *   plan      the plan as it stands (summary + one line per piece)
 *   build     the build so far: status, dashboard, what failed, what the
 *             Builder fixed and why, what waits for a provider
 * The Dash team's roles read (and add to) the same bucket while they work on
 * the plan, so a reopened draft, a fix or a later build knows its history.
 *
 * When a build makes a dashboard, aboutDashboard() is handed to that
 * dashboard's team memory ("about"), so its lead and bots know why it exists.
 *
 * Pure: returns { key: value } maps; botController writes them.
 */
"use strict";

const MAX_ANSWERS = 20;
const MAX_TEXT = 600;

const clip = (t, n = MAX_TEXT) => {
  const s = String(t || "").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** One line per plan piece: "widget AskRecover (new) — notes". */
function pieceLines(plan) {
  return ((plan && plan.pieces) || []).filter(Boolean).map((p) => {
    const bits = [`${p.kind} ${p.name}`, p.source ? `(${p.source})` : ""];
    if (p.kind === "bot") {
      const on = (p.on || [])
        .filter(Boolean)
        .map((o) => `${o.widget} › ${o.event}`);
      if (on.length) bits.push(`starts on ${on.join(", ")}`);
      if (p.schedule && p.schedule.cron)
        bits.push(`schedule ${p.schedule.cron}`);
      const providers = (p.tools || [])
        .map((t) => t && t.provider)
        .filter(Boolean);
      if (providers.length) bits.push(`uses ${providers.join(", ")}`);
    }
    if (p.kind === "widget" && (p.events || []).length) {
      bits.push(`sends ${p.events.join(", ")}`);
    }
    if (p.notes) bits.push(`— ${clip(p.notes, 200)}`);
    return bits.filter(Boolean).join(" ");
  });
}

/** The conversation's facts: request, answers, plan. */
function conversationFacts(entry) {
  const conv = (entry && entry.conversation) || {};
  const out = {};
  if (entry && entry.prompt) out.request = clip(entry.prompt);
  // What the user said after asking (the request itself is "request").
  const asked = String((entry && entry.prompt) || "").trim();
  const answers = (conv.messages || [])
    .filter((m) => m && m.who === "you" && m.text && m.text.trim() !== asked)
    .map((m) => clip(m.text, 300))
    .slice(-MAX_ANSWERS);
  if (answers.length) out.answers = answers;
  if (conv.plan) {
    out.plan = {
      summary: clip(conv.plan.summary || ""),
      pieces: pieceLines(conv.plan),
    };
  }
  return out;
}

/** The build's facts, from its state (planBuild.js). */
function buildFacts(state, plan) {
  if (!state) return {};
  const widgets = ((plan && plan.pieces) || []).filter(
    (p) => p && p.kind === "widget",
  );
  const steps = state.steps || [];
  const fixes = Object.entries(state.fixes || {})
    .filter(([, n]) => n > 0)
    .map(([i, n]) => {
      const w = widgets[Number(i)];
      const made = (state.made && state.made[i]) || {};
      return `${w ? w.name : `widget ${i}`}: the Builder fixed it ${n}×${
        made.fixedFor ? ` — last for: ${clip(made.fixedFor, 300)}` : ""
      }`;
    });
  return {
    build: {
      status: state.status,
      dashboard: state.dashboard ? state.dashboard.name : null,
      made: Object.values(state.made || {})
        .map((m) => m && m.package)
        .filter(Boolean),
      bots: Object.values(state.bots || {})
        .map((b) => b && b.name)
        .filter(Boolean),
      problems: steps
        .filter((s) => s.status === "failed" && s.error)
        .map((s) => `${s.label}: ${clip(s.error, 300)}`),
      fixes,
      waitingFor: [
        ...new Set(
          steps
            .filter((s) => s.status === "needs-provider")
            .flatMap((s) => s.waitingFor || []),
        ),
      ],
    },
  };
}

/**
 * What a built dashboard's team should know about itself — written to its
 * team memory under "about" once its build finishes.
 */
function aboutDashboard(entry, plan, state) {
  if (!state || !state.dashboard) return null;
  const bots = ((plan && plan.pieces) || []).filter(
    (p) => p && p.kind === "bot",
  );
  return {
    madeWith: "Create (Dash team plan)",
    request: clip(entry && entry.prompt),
    summary: clip(plan && plan.summary),
    widgets: pieceLines({
      pieces: ((plan && plan.pieces) || []).filter(
        (p) => p && p.kind === "widget",
      ),
    }),
    bots: bots.map(
      (b) =>
        `${b.name}: ${clip(String(b.instructions || "").split("\n")[0], 200)}`,
    ),
  };
}

/**
 * How a Dash team role is told about the plan's memory — added to its
 * request for every run inside a plan.
 */
const MEMORY_NOTE =
  "This plan has its own memory (memory_list / memory_get): request, answers, plan and build hold what was asked, decided, built and fixed so far. Read what you need before you start; memory_set anything the next role or a later fix should know (keep keys short).";

module.exports = {
  conversationFacts,
  buildFacts,
  aboutDashboard,
  pieceLines,
  MEMORY_NOTE,
};
