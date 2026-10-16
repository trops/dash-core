/**
 * planPreview.js — the plan's preview sketch (create-entry PRD CRE-003 AC6,
 * phase 5d): the dashboard laid out the way the build will lay it out, each
 * box with made-up sample lines from the Planner.
 *
 * The build makes a grid for the plan's widgets — one column for one widget,
 * two otherwise (botController _planCreateDashboard) — then adds a Bot
 * results widget per bot that shows its results in the next free cell.
 * When the layout's first page plans a grid (plan grids), its widgets sit
 * in their planned cells, with the planned column widths.
 */

// Column widths the grid draws (LayoutGridContainer getColTemplate).
const COL_TRACK = {
  "1/4": "25%",
  "1/3": "33.333%",
  "1/2": "50%",
  "2/3": "66.667%",
  shrink: "auto",
};

/** The first page's planned grid, or null. */
function firstPageGrid(pieces) {
  const layout = pieces.find((p) => p.kind === "layout");
  const page = layout && Array.isArray(layout.pages) ? layout.pages[0] : null;
  const grid = page && page.grid;
  if (
    !grid ||
    !Number.isInteger(grid.cols) ||
    grid.cols < 1 ||
    !Array.isArray(grid.cells)
  ) {
    return null;
  }
  return grid;
}

const nameKey = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

const MAX_LINES = 3;
const MAX_CHARS = 80;

const clip = (t) => {
  const s = String(t || "").trim();
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s;
};

/** A piece's sample lines (up to three, trimmed), or []. */
export function sampleLines(piece) {
  const sample = piece && piece.sample;
  if (!Array.isArray(sample)) return [];
  return sample
    .filter((x) => typeof x === "string" && x.trim())
    .slice(0, MAX_LINES)
    .map(clip);
}

/**
 * The boxes, in grid order: { cols, template, boxes: [{ key, kind: "widget" |
 * "results", title, lines, note, area? }] } — `lines` are sample lines;
 * `note` is the piece's notes, shown muted when there's no sample;
 * `template` (the column widths) and each box's `area` (its grid row and
 * column) come from a planned grid, else null / absent.
 */
export function previewBoxes(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const widgets = pieces.filter((p) => p.kind === "widget");
  const shown = pieces.filter((p) => p.kind === "bot" && p.showResults);
  const grid = firstPageGrid(pieces);
  const areaOf = (p) => {
    const c =
      grid &&
      grid.cells.find((x) => x && nameKey(x.widget) === nameKey(p.name));
    if (!c || !Number.isInteger(c.row) || !Number.isInteger(c.col)) return null;
    return {
      gridRow: `${c.row} / span ${c.rowSpan || 1}`,
      gridColumn: `${c.col} / span ${c.colSpan || 1}`,
    };
  };
  const boxes = [
    ...widgets.map((p, i) => ({
      key: `w${i}`,
      kind: "widget",
      title: p.name || "Widget",
      lines: sampleLines(p),
      note: clip(p.notes),
      ...(areaOf(p) ? { area: areaOf(p) } : {}),
    })),
    ...shown.map((p, i) => ({
      key: `r${i}`,
      kind: "results",
      title: `${p.name || "Bot"} · results`,
      lines: sampleLines(p),
      note: (p.results || []).length
        ? clip(
            p.results
              .map((r) => (r && (r.label || r.name)) || "")
              .filter(Boolean)
              .join(", "),
          )
        : "",
    })),
  ];
  if (grid) {
    const widths = grid.colWidths || {};
    const template = Array.from(
      { length: grid.cols },
      (_, i) => COL_TRACK[widths[i + 1]] || "minmax(0, 1fr)",
    ).join(" ");
    return { cols: grid.cols, template, boxes };
  }
  return { cols: widgets.length > 1 ? 2 : 1, template: null, boxes };
}

/** Whether any box has sample data (else the preview says so). */
export function hasSamples(preview) {
  return ((preview && preview.boxes) || []).some((b) => b.lines.length);
}
