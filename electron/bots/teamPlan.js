/**
 * teamPlan.js
 *
 * The Dash team's plan (create-entry PRD CRE-002 / CRE-012, scenarios G11):
 * what the Planner hands back before anything is built. The Create screen
 * will show it (phase 4); defined now so the Planner's output can be checked
 * by tests and by the app.
 *
 *   {
 *     summary:   "A widget with your unread Gmail count",
 *     dashboard?: { id, name },   // a dashboard the user has: the plan
 *                                 // changes it instead of making one (5e-2b)
 *     questions: [{ question, options?: [string] }],       // for the user
 *     pieces:    [{ kind: "widget" | "bot" | "layout" | "theme",
 *                   name,
 *                   source: "yours" | "ai-built" | "registry" | "new" | "update",
 *                   package?,        // yours / ai-built / registry / update
 *                   component?,      // which widget, when the package has several
 *                   providers?: [type],
 *                   // widget: which connection per type, and its settings
 *                   provider?: { [type]: connection name },
 *                   settings?: { [userConfig key]: value },
 *                   // layout: the new dashboard's pages (planPages)
 *                   pages?: [{ name, widgets: [widget name] }],
 *                   notes?,
 *                   // widget: events it publishes; bot results it shows
 *                   events?: [string], listens?: [{ bot, result, handler }],
 *                   // new bot (saved as planned, 4d-2)
 *                   instructions?, tools?: [{ provider, tools: [string] }],
 *                   schedule?: { cron, prompt? }, results?: [{ name, label? }],
 *                   on?: [{ widget, event }], showResults?: boolean,
                   // made-up lines for the plan's preview (5d)
                   sample?: [string] }],
                   // theme: one of the user's saved themes (source "yours")
 *     beforeBuilding: [{ kind: "connect" | "install" | "approve", what }],
 *     checks:    [string],                                 // how to tell it worked
 *     access?:   [string],                                 // what bots can / can't do (CRE-003 AC5)
 *     estimate:  { build: string, running?: string|null }
 *   }
 *
 * The Planner ends its answer with the plan as JSON inside <plan></plan>.
 * Pure (NFR-006).
 */
"use strict";

const KINDS = ["widget", "bot", "layout", "theme"];
const SOURCES = ["yours", "ai-built", "registry", "new", "update"];
const BEFORE_KINDS = ["connect", "install", "approve"];
// Pieces that already exist somewhere and so must say which package.
const NEEDS_PACKAGE = new Set(["yours", "ai-built", "registry", "update"]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The pages a new dashboard gets from its layout piece: [{ name, widgets:
 * [widget piece index] }] — each widget on the first page that names it
 * (any case), widgets no page names on the first page; pages with the same
 * name are merged, blank ones dropped. Fewer than two pages: [] (one page
 * needs no tabs).
 */
function planPages(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const layout = pieces.find((p) => p.kind === "layout");
  if (!layout || !Array.isArray(layout.pages)) return [];
  const widgets = pieces.filter((p) => p.kind === "widget");
  const key = (v) =>
    String(v || "")
      .trim()
      .toLowerCase();
  const pages = [];
  for (const pg of layout.pages) {
    if (!pg || !isStr(pg.name)) continue;
    let page = pages.find((x) => key(x.name) === key(pg.name));
    if (!page) {
      page = { name: pg.name.trim(), names: [] };
      pages.push(page);
    }
    if (Array.isArray(pg.widgets)) page.names.push(...pg.widgets.map(key));
  }
  if (pages.length < 2) return [];
  const out = pages.map((p) => ({ name: p.name, widgets: [] }));
  widgets.forEach((w, i) => {
    const at = pages.findIndex((p) => p.names.includes(key(w.name)));
    out[at < 0 ? 0 : at].widgets.push(i);
  });
  return out;
}

/**
 * The dashboard a plan changes (5e-2b): { id, name } with the id as a
 * string, or null when the plan makes a new dashboard.
 */
function planTarget(plan) {
  const d = plan && plan.dashboard;
  if (!d || typeof d !== "object") return null;
  const id = typeof d.id === "number" ? String(d.id) : d.id;
  if (!isStr(id)) return null;
  return { id: id.trim(), name: isStr(d.name) ? d.name.trim() : id.trim() };
}

/** The plan inside a Planner answer's <plan>…</plan>, or null. */
function extractPlan(text) {
  const m = /<plan>([\s\S]*?)<\/plan>/i.exec(String(text || ""));
  if (!m) return null;
  const body = m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}

/**
 * Check a plan's shape and its promises.
 * @param {object} plan
 * @param {{ providers?: string[], dashboards?: [{ id }], themes?: string[] }}
 *   [context]  the user's provider types — a piece needing one they don't
 *   have must list it under beforeBuilding — and, when given, their
 *   dashboards and saved theme names (a target or theme must be one of them).
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlan(plan, context = {}) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: ["The plan isn't an object."], warnings };
  }
  if (!isStr(plan.summary)) errors.push("summary is missing.");

  const questions = plan.questions === undefined ? [] : plan.questions;
  if (!Array.isArray(questions)) errors.push("questions must be a list.");
  else {
    questions.forEach((q, i) => {
      if (!q || !isStr(q.question))
        errors.push(`questions[${i}] has no question.`);
      if (q && q.options !== undefined && !Array.isArray(q.options)) {
        errors.push(`questions[${i}].options must be a list.`);
      }
    });
  }

  const pieces = plan.pieces === undefined ? [] : plan.pieces;
  if (!Array.isArray(pieces)) errors.push("pieces must be a list.");
  else if (!pieces.length && !(Array.isArray(questions) && questions.length)) {
    errors.push("A plan needs pieces, or questions to ask first.");
  }

  // A plan that changes a dashboard the user has (5e-2b).
  const target = planTarget(plan);
  if (plan.dashboard !== undefined && plan.dashboard !== null && !target) {
    errors.push("dashboard needs the id of one of the user's dashboards.");
  }
  if (
    target &&
    Array.isArray(context.dashboards) &&
    !context.dashboards.some((d) => d && String(d.id) === target.id)
  ) {
    errors.push(`The "${target.name}" dashboard isn't there any more.`);
  }

  const before = plan.beforeBuilding === undefined ? [] : plan.beforeBuilding;
  if (!Array.isArray(before)) errors.push("beforeBuilding must be a list.");
  else {
    before.forEach((b, i) => {
      if (!b || !BEFORE_KINDS.includes(b.kind)) {
        errors.push(
          `beforeBuilding[${i}].kind must be one of ${BEFORE_KINDS.join(", ")}.`,
        );
      }
      if (!b || !isStr(b.what))
        errors.push(`beforeBuilding[${i}] has no what.`);
    });
  }
  const beforeText = (Array.isArray(before) ? before : [])
    .map((b) => `${b && b.kind} ${b && b.what}`.toLowerCase())
    .join(" | ");

  const have = new Set(
    (context.providers || []).map((p) => String(p).toLowerCase()),
  );
  if (Array.isArray(pieces)) {
    pieces.forEach((p, i) => {
      const at = `pieces[${i}]`;
      if (!p || typeof p !== "object") {
        errors.push(`${at} isn't an object.`);
        return;
      }
      if (!KINDS.includes(p.kind)) {
        errors.push(`${at}.kind must be one of ${KINDS.join(", ")}.`);
      }
      if (!isStr(p.name)) errors.push(`${at} has no name.`);
      // A layout is always new, so the Planner may leave its source out.
      const layoutAsNew = p.kind === "layout" && p.source === undefined;
      if (!layoutAsNew && !SOURCES.includes(p.source)) {
        errors.push(`${at}.source must be one of ${SOURCES.join(", ")}.`);
      } else if (NEEDS_PACKAGE.has(p.source) && p.kind === "widget") {
        if (!isStr(p.package)) {
          errors.push(`${at} (${p.source}) must say which package.`);
        }
      }
      if (p.kind === "layout" && target) {
        errors.push(
          `${at}: a plan that changes a dashboard you have can't add a layout.`,
        );
      }
      if (p.kind === "theme") {
        if (p.source !== "yours") {
          errors.push(`${at} (a theme) must be one of your saved themes.`);
        } else if (
          isStr(p.name) &&
          Array.isArray(context.themes) &&
          !context.themes.includes(p.name.trim())
        ) {
          errors.push(`${at}: there's no saved theme called "${p.name}".`);
        }
      }
      if (p.component !== undefined && !isStr(p.component)) {
        errors.push(`${at}.component must be the component's name.`);
      }
      if (p.providers !== undefined && !Array.isArray(p.providers)) {
        errors.push(`${at}.providers must be a list.`);
      }
      // Which of the user's connections a widget uses, and its settings —
      // the user's answers, applied when it's placed (build fixes 2).
      if (
        p.provider !== undefined &&
        !(isObject(p.provider) && Object.values(p.provider).every(isStr))
      ) {
        errors.push(
          `${at}.provider must map a provider type to a connection name.`,
        );
      }
      if (p.settings !== undefined && !isObject(p.settings)) {
        errors.push(`${at}.settings must be an object.`);
      }
      if (p.kind === "layout" && p.pages !== undefined) {
        if (!Array.isArray(p.pages)) errors.push(`${at}.pages must be a list.`);
        else {
          const names = new Set(
            pieces
              .filter((x) => x && x.kind === "widget" && isStr(x.name))
              .map((x) => x.name.trim().toLowerCase()),
          );
          p.pages.forEach((pg, j) => {
            if (!pg || !isStr(pg.name) || !Array.isArray(pg.widgets)) {
              errors.push(
                `${at}.pages[${j}] needs a name and a list of widgets.`,
              );
              return;
            }
            for (const w of pg.widgets) {
              if (!names.has(String(w).trim().toLowerCase())) {
                warnings.push(
                  `${at}.pages[${j}] names "${w}", which isn't a widget in the plan.`,
                );
              }
            }
          });
        }
      }
      // Made-up preview data (5d): never blocks building — the preview
      // only shows short text lines.
      if (
        p.sample !== undefined &&
        !(
          Array.isArray(p.sample) &&
          p.sample.every((x) => typeof x === "string")
        )
      ) {
        warnings.push(
          `${at}.sample should be a list of short lines; it isn't shown.`,
        );
      }
      // A registry widget is installed first — the user approves it.
      if (
        p.source === "registry" &&
        isStr(p.package) &&
        !beforeText.includes("install")
      ) {
        warnings.push(
          `${at} comes from the registry, but beforeBuilding doesn't list installing it.`,
        );
      }
      // Providers the user doesn't have must be connected first.
      if (have.size && Array.isArray(p.providers)) {
        for (const type of p.providers) {
          const t = String(type).toLowerCase();
          if (!have.has(t) && !beforeText.includes(t)) {
            errors.push(
              `${at} needs ${type}, which isn't connected — add it to beforeBuilding.`,
            );
          }
        }
      }
    });
  }

  // Bots are saved exactly as planned (phase 4d-2): a new bot needs
  // instructions; what starts it must name a widget in the plan, and what a
  // widget shows must name a bot in the plan.
  if (Array.isArray(pieces)) {
    const byName = (kind) => {
      const out = new Map();
      for (const p of pieces) {
        if (p && p.kind === kind && isStr(p.name)) {
          out.set(p.name.trim().toLowerCase(), p);
        }
      }
      return out;
    };
    const widgets = byName("widget");
    const bots = byName("bot");
    pieces.forEach((p, i) => {
      if (!p || typeof p !== "object") return;
      const at = `pieces[${i}]`;
      if (p.kind === "bot" && p.source === "new" && !isStr(p.instructions)) {
        errors.push(`${at} (a new bot) needs instructions.`);
      }
      for (const key of ["events", "results", "tools"]) {
        if (p[key] !== undefined && !Array.isArray(p[key])) {
          errors.push(`${at}.${key} must be a list.`);
        }
      }
      if (p.on !== undefined) {
        if (!Array.isArray(p.on)) errors.push(`${at}.on must be a list.`);
        else {
          p.on.forEach((o, j) => {
            if (!o || !isStr(o.widget) || !isStr(o.event)) {
              errors.push(`${at}.on[${j}] needs a widget and an event.`);
              return;
            }
            const w = widgets.get(o.widget.trim().toLowerCase());
            if (!w) {
              errors.push(
                `${at}.on[${j}] names "${o.widget}", which isn't a widget in the plan.`,
              );
            } else if (Array.isArray(w.events) && !w.events.includes(o.event)) {
              warnings.push(
                `${at}.on[${j}]: ${o.widget} doesn't list the event "${o.event}".`,
              );
            }
          });
        }
      }
      if (p.listens !== undefined) {
        if (!Array.isArray(p.listens)) {
          errors.push(`${at}.listens must be a list.`);
        } else {
          p.listens.forEach((l, j) => {
            if (!l || !isStr(l.bot) || !isStr(l.result) || !isStr(l.handler)) {
              errors.push(
                `${at}.listens[${j}] needs a bot, a result and a handler.`,
              );
            } else if (!bots.has(l.bot.trim().toLowerCase())) {
              errors.push(
                `${at}.listens[${j}] names "${l.bot}", which isn't a bot in the plan.`,
              );
            }
          });
        }
      }
    });
  }

  if (
    Array.isArray(pieces) &&
    pieces.filter((p) => p && p.kind === "theme").length > 1
  ) {
    errors.push("A plan applies one theme at most.");
  }

  if (plan.checks !== undefined && !Array.isArray(plan.checks)) {
    errors.push("checks must be a list.");
  } else if (
    Array.isArray(pieces) &&
    pieces.some((p) => p && ["new", "update"].includes(p.source)) &&
    !(plan.checks || []).length
  ) {
    warnings.push("Something gets built, but there are no checks.");
  }

  if (plan.access !== undefined) {
    if (!Array.isArray(plan.access) || plan.access.some((a) => !isStr(a))) {
      errors.push("access must be a list of sentences.");
    }
  } else if (
    Array.isArray(pieces) &&
    pieces.some((p) => p && p.kind === "bot")
  ) {
    warnings.push(
      "The plan has bots but doesn't say what they can and can't do.",
    );
  }

  if (!plan.estimate || !isStr(plan.estimate.build)) {
    errors.push("estimate.build is missing.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = {
  KINDS,
  SOURCES,
  BEFORE_KINDS,
  extractPlan,
  planPages,
  planTarget,
  validatePlan,
};
