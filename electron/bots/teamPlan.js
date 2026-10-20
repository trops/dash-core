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
 *                   // layout: the new dashboard's pages (planPages), each
 *                   // with an optional grid: where every widget goes
 *                   pages?: [{ name, widgets: [widget name],
 *                              grid?: { cols, rows,
 *                                colWidths?: { [col]: "1/4"|"1/3"|"1/2"|"2/3"|"shrink"|"grow" },
 *                                rowHeights?: { [row]: "shrink"|"grow" },
 *                                cells: [{ widget, row, col, rowSpan?, colSpan? }] } }],
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

// What a planned grid may ask for — what the dashboard grid draws
// (LayoutGridContainer colModes / rowModes).
const COL_WIDTHS = ["1/4", "1/3", "1/2", "2/3", "shrink", "grow"];
const ROW_HEIGHTS = ["shrink", "grow"];
const MAX_COLS = 6;
const MAX_ROWS = 12;
const isWhole = (v, min, max) =>
  Number.isInteger(v) && v >= min && (max === undefined || v <= max);
const nameKey = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

/**
 * A planned grid's cells that fit: [{ widget, row, col, rowSpan, colSpan }]
 * in order, and the problems with the rest — outside the grid, on top of
 * another cell, or a second cell for the same widget.
 */
function gridCells(grid) {
  const fits = [];
  const problems = [];
  const taken = new Map(); // "r.c" → widget
  const seen = new Set();
  for (const c of Array.isArray(grid.cells) ? grid.cells : []) {
    if (!c || !isStr(c.widget)) {
      problems.push("each cell needs a widget name.");
      continue;
    }
    const cell = {
      widget: c.widget.trim(),
      row: c.row,
      col: c.col,
      rowSpan: c.rowSpan === undefined ? 1 : c.rowSpan,
      colSpan: c.colSpan === undefined ? 1 : c.colSpan,
    };
    if (
      ![cell.row, cell.col, cell.rowSpan, cell.colSpan].every((n) =>
        isWhole(n, 1),
      )
    ) {
      problems.push(
        `${cell.widget} needs a row and col (whole numbers from 1).`,
      );
      continue;
    }
    if (
      cell.row + cell.rowSpan - 1 > grid.rows ||
      cell.col + cell.colSpan - 1 > grid.cols
    ) {
      problems.push(
        `${cell.widget} is outside the ${grid.rows}×${grid.cols} grid.`,
      );
      continue;
    }
    if (seen.has(nameKey(cell.widget))) {
      problems.push(`${cell.widget} has more than one cell.`);
      continue;
    }
    let clash = null;
    for (let r = cell.row; r < cell.row + cell.rowSpan && !clash; r++) {
      for (let k = cell.col; k < cell.col + cell.colSpan && !clash; k++) {
        clash = taken.get(`${r}.${k}`) || null;
      }
    }
    if (clash) {
      problems.push(`${cell.widget} overlaps ${clash}.`);
      continue;
    }
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let k = cell.col; k < cell.col + cell.colSpan; k++) {
        taken.set(`${r}.${k}`, cell.widget);
      }
    }
    seen.add(nameKey(cell.widget));
    fits.push(cell);
  }
  return { fits, problems, taken };
}

/** Whether a planned grid has a usable size. */
function gridSized(grid) {
  return (
    isObject(grid) &&
    isWhole(grid.cols, 1, MAX_COLS) &&
    isWhole(grid.rows, 1, MAX_ROWS)
  );
}

/**
 * The pages a new dashboard gets from its layout piece: [{ name, widgets:
 * [widget piece index], grid? }] — each widget on the first page that names
 * it (in its list or a grid cell, any case), widgets no page names on the
 * first page; pages with the same name are merged, blank ones dropped. No
 * named page: [] (a single page keeps its name — plan grids).
 *
 * A page with a usable grid gets `grid`: { cols, rows, colModes, rowModes
 * (every row, "grow" unless planned), cells: [{ piece, row, col, rowSpan,
 * colSpan }] }. Cells that don't fit are left out, and a widget on the page
 * without a cell gets the first free cell no other widget is planned for
 * (none left: no cell, and the build adds a row).
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
      page = { name: pg.name.trim(), names: [], grid: null };
      pages.push(page);
    }
    if (Array.isArray(pg.widgets)) page.names.push(...pg.widgets.map(key));
    if (!page.grid && gridSized(pg.grid)) {
      page.grid = pg.grid;
      const { fits } = gridCells(pg.grid);
      page.names.push(...fits.map((c) => key(c.widget)));
    }
  }
  if (!pages.length) return [];
  const out = pages.map((p) => ({ name: p.name, widgets: [] }));
  widgets.forEach((w, i) => {
    const at = pages.findIndex((p) => p.names.includes(key(w.name)));
    out[at < 0 ? 0 : at].widgets.push(i);
  });
  pages.forEach((p, n) => {
    if (p.grid) out[n].grid = pageGrid(p.grid, out[n].widgets, widgets);
  });
  return out;
}

/** A page's planned grid for the build (see planPages). */
function pageGrid(grid, onPage, widgets) {
  const colModes = {};
  for (const [c, v] of Object.entries(
    isObject(grid.colWidths) ? grid.colWidths : {},
  )) {
    if (COL_WIDTHS.includes(v) && isWhole(Number(c), 1, grid.cols)) {
      colModes[String(Number(c))] = v;
    }
  }
  const rowModes = {};
  const heights = isObject(grid.rowHeights) ? grid.rowHeights : {};
  for (let r = 1; r <= grid.rows; r++) {
    rowModes[String(r)] = ROW_HEIGHTS.includes(heights[r])
      ? heights[r]
      : "grow";
  }
  const { fits, taken } = gridCells(grid);
  const cells = [];
  const placed = new Set();
  for (const c of fits) {
    const piece = onPage.find(
      (i) => !placed.has(i) && nameKey(widgets[i].name) === nameKey(c.widget),
    );
    if (piece === undefined) continue;
    placed.add(piece);
    cells.push({
      piece,
      row: c.row,
      col: c.col,
      rowSpan: c.rowSpan,
      colSpan: c.colSpan,
    });
  }
  // Widgets on the page with no cell: the first free cells, in reading order.
  for (const piece of onPage) {
    if (placed.has(piece)) continue;
    let free = null;
    for (let r = 1; r <= grid.rows && !free; r++) {
      for (let k = 1; k <= grid.cols && !free; k++) {
        if (!taken.has(`${r}.${k}`)) free = { row: r, col: k };
      }
    }
    if (!free) continue;
    taken.set(`${free.row}.${free.col}`, widgets[piece].name);
    placed.add(piece);
    cells.push({ piece, ...free, rowSpan: 1, colSpan: 1 });
  }
  cells.sort((a, b) => a.piece - b.piece);
  return {
    cols: grid.cols,
    rows: grid.rows,
    colModes,
    rowModes,
    cells,
  };
}

/** A layout page's planned grid → problems into errors / warnings. */
function checkGrid(grid, at, names, errors, warnings) {
  if (!gridSized(grid)) {
    errors.push(
      `${at} needs cols (1–${MAX_COLS}) and rows (1–${MAX_ROWS}) as whole numbers.`,
    );
    return;
  }
  if (grid.colWidths !== undefined) {
    if (!isObject(grid.colWidths))
      errors.push(`${at}.colWidths must be an object.`);
    else {
      for (const [c, v] of Object.entries(grid.colWidths)) {
        if (!isWhole(Number(c), 1, grid.cols)) {
          errors.push(`${at}.colWidths names column ${c}, outside the grid.`);
        } else if (!COL_WIDTHS.includes(v)) {
          errors.push(
            `${at}.colWidths: "${v}" isn't one of ${COL_WIDTHS.join(", ")}.`,
          );
        }
      }
    }
  }
  if (grid.rowHeights !== undefined) {
    if (!isObject(grid.rowHeights))
      errors.push(`${at}.rowHeights must be an object.`);
    else {
      for (const [r, v] of Object.entries(grid.rowHeights)) {
        if (!isWhole(Number(r), 1, grid.rows)) {
          errors.push(`${at}.rowHeights names row ${r}, outside the grid.`);
        } else if (!ROW_HEIGHTS.includes(v)) {
          errors.push(
            `${at}.rowHeights: "${v}" isn't one of ${ROW_HEIGHTS.join(", ")}.`,
          );
        }
      }
    }
  }
  if (!Array.isArray(grid.cells)) {
    errors.push(`${at}.cells must be a list.`);
    return;
  }
  const { fits, problems } = gridCells(grid);
  for (const p of problems) errors.push(`${at}: ${p}`);
  for (const c of fits) {
    if (!names.has(nameKey(c.widget))) {
      warnings.push(
        `${at} names "${c.widget}", which isn't a widget in the plan.`,
      );
    }
  }
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
 *   dashboards and saved theme names (a target or theme must be one of them);
 *   context.cell: a plan for one cell of a dashboard being edited
 *   (consolidation Phase 2b) — exactly one widget, nothing else;
 *   context.bot: a plan for one bot (Phase 2c-1) — exactly one new bot.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlan(plan, context = {}) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: ["The plan isn't an object."], warnings };
  }
  // What it says about itself (summary, checks, access, estimate) is
  // shown, not built: a slip there is a warning — only what the build needs
  // stops it (consolidation Phase 1b, the main process refuses errors).
  if (!isStr(plan.summary)) warnings.push("summary is missing.");

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
  // A widget for one cell (Phase 2b): the editor places it, so a cell plan
  // is exactly one widget — no bots, theme, layout or dashboard.
  if (context.cell && Array.isArray(pieces)) {
    const widgets = pieces.filter((p) => p && p.kind === "widget");
    if (widgets.length !== 1 || pieces.length !== 1 || target) {
      errors.push(
        "A plan for one cell is one widget — no bots, theme, layout or dashboard.",
      );
    }
  }
  // One bot (Phase 2c-1): saved on the dashboard it names, or Unassigned —
  // exactly one new bot, nothing else.
  if (context.bot && Array.isArray(pieces)) {
    const bots = pieces.filter(
      (p) => p && p.kind === "bot" && p.source === "new",
    );
    if (bots.length !== 1 || pieces.length !== 1) {
      errors.push(
        "A plan for one bot is one new bot — no widgets, theme or layout.",
      );
    }
  }
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
            if (pg.grid !== undefined) {
              // A layout slip is a warning: cells that don't fit are
              // skipped when it's placed (planPages), so it still builds.
              checkGrid(
                pg.grid,
                `${at}.pages[${j}].grid`,
                names,
                warnings,
                warnings,
              );
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
      // A provider the user doesn't have: the build waits on that step
      // ("needs a provider", CRE-004 AC5) — a warning, not an error.
      if (have.size && Array.isArray(p.providers)) {
        for (const type of p.providers) {
          const t = String(type).toLowerCase();
          if (!have.has(t) && !beforeText.includes(t)) {
            warnings.push(
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
    warnings.push("checks must be a list.");
  } else if (
    Array.isArray(pieces) &&
    pieces.some((p) => p && ["new", "update"].includes(p.source)) &&
    !(plan.checks || []).length
  ) {
    warnings.push("Something gets built, but there are no checks.");
  }

  if (plan.access !== undefined) {
    if (!Array.isArray(plan.access) || plan.access.some((a) => !isStr(a))) {
      warnings.push("access must be a list of sentences.");
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
    warnings.push("estimate.build is missing.");
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
