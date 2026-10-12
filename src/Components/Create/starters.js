/**
 * starters.js — Create's starters (create-entry PRD CRE-002, phase 5b):
 * public registry dashboard packages tagged "starter" that come with bots.
 * A card says what one makes and needs; picking it opens a plan built from
 * the package (Remix) — it never installs or builds directly.
 */
import { providerLabel } from "./planChecklist";

export const STARTER_TAG = "starter";

const titleCase = (s) =>
  String(s || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** The registry index's starters: public dashboards tagged "starter" with bots. */
export function starterPackages(index) {
  const list = Array.isArray(index)
    ? index
    : (index && Array.isArray(index.packages) && index.packages) || [];
  return list.filter(
    (p) =>
      p &&
      p.type === "dashboard" &&
      Array.isArray(p.tags) &&
      p.tags.includes(STARTER_TAG) &&
      p.visibility !== "private" &&
      p.team &&
      Array.isArray(p.team.members) &&
      p.team.members.length > 0,
  );
}

/** "Productivity", … — the categories present, in order of first use. */
export function starterCategories(starters) {
  const out = [];
  for (const p of starters || []) {
    const c = p.category || "general";
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** A card's words: name, one line, what it makes, what it needs. */
export function starterCard(pkg) {
  const widgets = (pkg.widgets || []).length;
  const bots = ((pkg.team && pkg.team.members) || []).length;
  const makes = [
    widgets ? `${widgets} widget${widgets === 1 ? "" : "s"}` : null,
    bots ? `${bots} bot${bots === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const needs = (pkg.providerTypes || []).map(providerLabel);
  return {
    key: `${pkg.scope || ""}/${pkg.name}`,
    packageName: pkg.name,
    name: pkg.displayName || titleCase(pkg.name),
    line: pkg.description || "",
    makes,
    needs: needs.length ? needs.join(", ") : "Nothing to connect",
    category: pkg.category || "general",
  };
}

/** The layout's widget items (not containers), main layout first. */
function widgetItems(workspace) {
  const ws = workspace || {};
  return [
    ...(ws.layout || []),
    ...(ws.pages || []).flatMap((p) => (p && p.layout) || []),
  ].filter(
    (i) =>
      i &&
      i.component &&
      i.component !== "LayoutGridContainer" &&
      i.component !== "Container",
  );
}

/** "DigitalClockWidget" → "Digital Clock"; "dash.bots.BotResults" → "Bot Results". */
export function widgetLabel(component) {
  const last =
    String(component || "")
      .split(".")
      .pop() || "";
  return (
    last
      .replace(/Widget$/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
      .replace(/\bGit Hub\b/g, "GitHub")
      .trim() || last
  );
}

/**
 * A drawn thumbnail: the first grid's rows × cols with a label per filled
 * cell; without a grid, the widgets in two columns.
 * @returns {{ rows, cols, cells: Array<{ key, row, col, label }> }}
 */
export function thumbnailGrid(config) {
  const ws = (config && config.workspace) || {};
  const byId = new Map(widgetItems(ws).map((i) => [String(i.id), i]));
  const grid = (ws.layout || []).find(
    (i) => i && i.grid && typeof i.grid === "object" && i.grid.rows,
  );
  if (grid) {
    const rows = Number(grid.grid.rows) || 1;
    const cols = Number(grid.grid.cols) || 1;
    const cells = [];
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const cell = grid.grid[`${r}.${c}`];
        const item =
          cell && cell.component != null
            ? byId.get(String(cell.component))
            : null;
        cells.push({
          key: `${r}.${c}`,
          row: r,
          col: c,
          label: item ? widgetLabel(item.component) : "",
        });
      }
    }
    return { rows, cols, cells };
  }
  const items = [...byId.values()];
  const cols = items.length > 1 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(items.length / cols));
  return {
    rows,
    cols,
    cells: items.map((i, n) => ({
      key: String(i.id),
      row: Math.floor(n / cols) + 1,
      col: (n % cols) + 1,
      label: widgetLabel(i.component),
    })),
  };
}

/**
 * A starter as a plan the Planner can adapt (Remix): its registry widgets,
 * its bots as new bots (instructions, tools by provider type, schedule,
 * results, shown in Bot results), and the dashboard. Nothing is installed.
 */
export function starterToPlan(config, pkg = {}) {
  const ws = (config && config.workspace) || {};
  const deps = (config && config.widgets) || [];
  const providers = (config && config.providers) || [];
  const team = (config && config.team) || { members: [] };

  const depFor = (component) => {
    const [scope, packageName] = String(component).split(".");
    return (
      deps.find((d) => d.scope === scope && d.packageName === packageName) ||
      null
    );
  };
  const widgetPieces = [];
  const nameOfWidget = new Map();
  for (const item of widgetItems(ws)) {
    if (item.component === "dash.bots.BotResults") continue;
    const dep = depFor(item.component);
    const name = widgetLabel(item.component);
    nameOfWidget.set(String(item.id), name);
    widgetPieces.push({
      kind: "widget",
      name,
      source: "registry",
      package: dep ? `@${dep.scope}/${dep.packageName}` : null,
      providers: providers
        .filter((p) => (p.usedBy || []).includes(item.component))
        .map((p) => p.type),
      notes: `From the ${pkg.displayName || config.name || "starter"} starter`,
    });
  }

  const shown = new Set((team.resultWidgets || []).map((r) => r.role));
  const botPieces = (team.members || []).map((m) => {
    const e = m.embedded || {};
    const schedule = (e.schedules || [])[0];
    return {
      kind: "bot",
      name: e.name,
      source: "new",
      instructions: e.instructions,
      // Types it needs connected (Before building lists them).
      providers: (e.providers || []).map((p) => p.type),
      tools: (e.providers || []).map((p) => ({
        provider: p.type,
        tools: Array.isArray(p.tools) ? p.tools : [],
      })),
      ...(schedule ? { schedule: { cron: schedule.cron } } : {}),
      results: (e.publishes || []).map((p) => ({
        name: p.name,
        label: p.label || "",
      })),
      on: (team.triggers || [])
        .filter((t) => t.role === m.role && nameOfWidget.has(t.widget))
        .map((t) => ({ widget: nameOfWidget.get(t.widget), event: t.event })),
      showResults: shown.has(m.role),
    };
  });

  return {
    summary: (config && config.description) || pkg.description || "",
    pieces: [
      ...widgetPieces,
      ...botPieces,
      {
        kind: "layout",
        name: (config && config.name) || pkg.displayName || "New dashboard",
        source: "new",
      },
    ],
  };
}

/** The Planner's first message for a starter the user picked. */
export function remixRequest(card, plan) {
  return [
    `I picked the "${card.name}" starter${card.line ? ` — ${card.line}` : ""}.`,
    "Here's its plan. Keep it unless something needs changing for me; ask me at most a couple of questions about what to adapt, then show the plan.",
    `<plan>${JSON.stringify(plan)}</plan>`,
  ].join("\n");
}
