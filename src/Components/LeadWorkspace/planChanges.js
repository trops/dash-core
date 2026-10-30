/**
 * planChanges.js — a plan for a dashboard the user has, as what changes
 * (lead-workspace release 3c, frame 30): the dashboard's grid now and after,
 * and a row per change. Plans only add for now (removals and moves come
 * later): each new widget — and each new bot's results card — goes in the
 * next free cell of the page the dashboard shows, or a new row when the grid
 * is full, as the build places them (electron/utils/placeWidget.js). Pure.
 */
import { planTarget } from "../../utils/teamPlan";
import { shownSetting } from "./workspaceStart";
import { usageText } from "../Create/editCreate";

/** The page the dashboard shows, or null (activeLayout.js shownPage). */
function shownPage(ws) {
  if (!ws || !Array.isArray(ws.pages) || !ws.pages.length) return null;
  return ws.pages.find((p) => p && p.id === ws.activePageId) || ws.pages[0];
}

/** The layout the build places into: the shown page's, else the top one. */
export function shownLayout(ws) {
  const page = shownPage(ws);
  if (page) return Array.isArray(page.layout) ? page.layout : [];
  return Array.isArray(ws && ws.layout) ? ws.layout : [];
}

/** "ai-built.fridaycountdown.FridayCountdown" → "Friday Countdown". */
export function widgetLabel(item) {
  if (!item) return "";
  const title =
    item.userPrefs && typeof item.userPrefs.title === "string"
      ? item.userPrefs.title.trim()
      : "";
  if (title) return title;
  const tail = String(item.component || "")
    .split(".")
    .pop();
  return tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2") || "Widget";
}

/** What the plan adds to the dashboard, in the order the build places it. */
function additions(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  return [
    ...pieces
      .filter((p) => p.kind === "widget" && p.name)
      .map((p) => ({
        name: p.name,
        sub:
          p.source === "registry" && p.package
            ? `${p.package} from the registry`
            : p.source === "new"
              ? "New — the Builder makes it"
              : p.source === "update"
                ? "Yours, changed"
                : "Yours",
      })),
    ...pieces
      .filter((p) => p.kind === "bot" && p.source === "new" && p.showResults)
      .map((p) => ({
        name: `${p.name} results`,
        sub: "The new bot's results",
      })),
  ];
}

/** What a change does that isn't a cell: new bots, a theme. */
function others(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  return [
    ...pieces
      .filter(
        (p) =>
          p.kind === "bot" && p.source === "new" && !p.showResults && p.name,
      )
      .map((p) => ({
        mark: "+",
        main: `${p.name} — new bot`,
        sub: "Saved paused, on this dashboard's team",
      })),
    ...pieces
      .filter((p) => p.kind === "theme" && p.name)
      .flatMap((p) =>
        p.source === "new"
          ? [
              {
                mark: "+",
                main: `${p.name} — a new theme`,
                sub: "Dark and light, from its four colors",
              },
              {
                mark: "+",
                main: `This dashboard's theme → ${p.name}`,
                sub: "The theme it has now stays in your themes",
              },
            ]
          : [{ mark: "+", main: `${p.name} theme — applied`, sub: "" }],
      ),
  ];
}

/**
 * What a plan changes on a dashboard the user has — or null for a plan that
 * makes a new one.
 * @param {object} workspace  the dashboard as saved
 * @param {object} plan
 * @returns {null | { name, cols, now: Cell[][], after: Cell[][],
 *   rows: [{ mark: "+", main, sub }], unchanged: string[], added: number }}
 *   Cell = { name, kind: "add" | "keep" | "empty" | "hidden" } — hidden: a
 *   cell another one spans, kept so the columns stay in place. added: how
 *   many cells it fills (0: nothing to draw)
 * A plan for an empty cell (`plan.cell`, release 6c, frame 39): its one
 * widget goes in that cell of that grid, on its page; `cellOnly` is set.
 */
export function planChanges(workspace, plan) {
  const target = planTarget(plan);
  if (!target || !workspace) return null;
  const at = plan.cell || null;
  const page =
    at && at.pageId != null && Array.isArray(workspace.pages)
      ? workspace.pages.find((p) => p && String(p.id) === String(at.pageId))
      : null;
  const layout = page
    ? Array.isArray(page.layout)
      ? page.layout
      : []
    : shownLayout(workspace);
  const byId = new Map(layout.map((i) => [String(i && i.id), i]));
  const gridNode = at
    ? layout.find((i) => i && String(i.id) === String(at.gridItemId) && i.grid)
    : layout.find((i) => i && i.component === "LayoutGridContainer" && i.grid);
  const grid = gridNode ? gridNode.grid : null;
  const rows = grid ? Number(grid.rows) || 0 : 0;
  const cols = grid ? Number(grid.cols) || 1 : 1;
  // Now: each cell, by its widget's name.
  const now = [];
  for (let r = 1; r <= rows; r += 1) {
    const line = [];
    for (let c = 1; c <= cols; c += 1) {
      const key = `${r}.${c}`;
      const cell = grid[key];
      // Empty exactly as the build sees it (placeWidget findNextEmptyCell).
      const empty = !cell || (cell.component === null && !cell.hide);
      if (empty) line.push({ name: "", kind: "empty", key });
      else if (cell.hide) line.push({ name: "", kind: "hidden", key });
      else {
        const item = byId.get(String(cell.component));
        line.push({
          name: item ? widgetLabel(item) : "Widget",
          kind: "keep",
          key,
        });
      }
    }
    now.push(line);
  }
  // After: the additions in the next free cells, then new rows.
  const after = now.map((line) => line.map((c) => ({ ...c })));
  const adds = additions(plan);
  if (at) {
    // The picked cell, and nothing else — a plan with more (or other) than
    // one widget doesn't fit: nothing drawn, each piece listed.
    const pieces = ((plan && plan.pieces) || []).filter(Boolean);
    if (pieces.length !== 1 || pieces[0].kind !== "widget") {
      return {
        name: target.name,
        cols,
        now,
        after: now,
        rows: pieces.map((p) => ({
          mark: "!",
          main: `${p.name || "Something"} — ${p.kind || "piece"}`,
          sub: "A cell takes one widget — say which one in the chat",
        })),
        unchanged: [],
        added: 0,
        cellOnly: true,
        fits: false,
      };
    }
    const add = adds[0] || null;
    const slot = add
      ? after.flat().find((c) => c.key === String(at.cellNumber)) || null
      : null;
    if (slot) {
      slot.name = add.name;
      slot.kind = "add";
    }
    const row = String(at.cellNumber).split(".")[0];
    return {
      name: target.name,
      cols,
      now,
      after,
      rows: add
        ? [
            {
              mark: "+",
              main: `${add.name} — in the empty cell, row ${row}`,
              sub: add.sub,
            },
          ]
        : [],
      unchanged: [],
      added: slot ? 1 : 0,
      cellOnly: true,
      fits: true,
    };
  }
  for (const add of adds) {
    let slot = null;
    for (const line of after) {
      slot = line.find((c) => c.kind === "empty");
      if (slot) break;
    }
    if (!slot) {
      const r = after.length + 1;
      const line = [];
      for (let c = 1; c <= cols; c += 1)
        line.push({ name: "", kind: "empty", key: `${r}.${c}` });
      after.push(line);
      slot = line[0];
    }
    slot.name = add.name;
    slot.kind = "add";
  }
  const unchanged = now
    .flat()
    .filter((c) => c.kind === "keep")
    .map((c) => c.name);
  return {
    name: target.name,
    cols,
    now,
    after,
    rows: [
      ...adds.map((a) => ({
        mark: "+",
        main: `${a.name} — added`,
        sub: a.sub,
      })),
      ...others(plan),
    ],
    unchanged,
    added: adds.length,
  };
}

/** "1 added" · "2 added" — the plan card's line for a change. */
export function changesLine(changes) {
  if (!changes) return "";
  return `${changes.added} added`;
}

/**
 * What a change to one widget does (release 6c, frame 40), a row each:
 * its settings, old → new; or what the Builder changes and where it goes.
 * A plan that is more than that widget doesn't fit: each piece, flagged.
 * @returns {null | { name, fits, rows: [{ mark: "~" | "!" | "", main, sub }] }}
 */
export function widgetChanges(plan) {
  const w = plan && plan.widgetChange;
  if (!w) return null;
  const name = w.displayName || "The widget";
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const one =
    pieces.length === 1 && pieces[0].kind === "widget" ? pieces[0] : null;
  if (!one) {
    return {
      name,
      fits: false,
      rows: pieces.map((p) => ({
        mark: "!",
        main: `${p.name || "Something"} — ${p.kind || "piece"}`,
        sub: `A change to ${name} is only ${name} — say what to leave out in the chat`,
      })),
    };
  }
  if (one.source === "settings") {
    const labels = w.settingLabels || {};
    const now = w.settingsNow || {};
    const options = w.settingOptions || {};
    const said = (k, v) =>
      options[k] && options[k][String(v)] !== undefined
        ? options[k][String(v)]
        : shownSetting(v);
    // Only a widget on a dashboard has a copy whose settings can change.
    if (!w.onDashboard) {
      return {
        name,
        fits: false,
        rows: [
          {
            mark: "!",
            main: `${name}'s settings`,
            sub: "Settings change on a copy on a dashboard — open it from there, or ask for a change to what it does",
          },
        ],
      };
    }
    return {
      name,
      fits: true,
      rows: [
        ...Object.entries(one.settings || {}).map(([k, v]) =>
          labels[k] === undefined
            ? {
                mark: "!",
                main: `${k} — ${name} has no setting by that name`,
                sub: "It's left out",
              }
            : {
                mark: "~",
                main: `${labels[k]} — ${k in now ? said(k, now[k]) : "set"} → ${said(k, v)}`,
                sub: "A setting",
              },
        ),
        {
          mark: "",
          main: "Place and size — unchanged",
          sub: "A change to what it does would go to the Builder, with a preview",
        },
      ],
    };
  }
  const used = Array.isArray(w.usedOn) ? w.usedOn : [];
  return {
    name,
    fits: true,
    rows: [
      {
        mark: "~",
        main: "What it does — the Builder changes it",
        sub: "You see it running before it's saved",
      },
      w.mode === "update"
        ? {
            mark: "",
            main: `In place — everywhere ${name} is used`,
            sub: used.length ? `On ${usageText(used)}` : "",
          }
        : {
            mark: "",
            main: `A new widget — ${name} stays as it is`,
            sub: w.onDashboard
              ? `It takes this copy's place on ${w.dashboardName || "the dashboard"}`
              : "It goes in your widgets",
          },
    ],
  };
}
