/**
 * planPreview.js — the plan's preview sketch (create-entry PRD CRE-003 AC6,
 * phase 5d): the dashboard laid out the way the build will lay it out, each
 * box with made-up sample lines from the Planner.
 *
 * The build makes a grid for the plan's widgets — one column for one widget,
 * two otherwise (botController _planCreateDashboard) — then adds a Bot
 * results widget per bot that shows its results in the next free cell.
 */

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
 * The boxes, in grid order: { cols, boxes: [{ key, kind: "widget" |
 * "results", title, lines, note }] } — `lines` are sample lines; `note` is
 * the piece's notes, shown muted when there's no sample.
 */
export function previewBoxes(plan) {
  const pieces = ((plan && plan.pieces) || []).filter(Boolean);
  const widgets = pieces.filter((p) => p.kind === "widget");
  const shown = pieces.filter((p) => p.kind === "bot" && p.showResults);
  const boxes = [
    ...widgets.map((p, i) => ({
      key: `w${i}`,
      kind: "widget",
      title: p.name || "Widget",
      lines: sampleLines(p),
      note: clip(p.notes),
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
  return { cols: widgets.length > 1 ? 2 : 1, boxes };
}

/** Whether any box has sample data (else the preview says so). */
export function hasSamples(preview) {
  return ((preview && preview.boxes) || []).some((b) => b.lines.length);
}
