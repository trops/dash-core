import React, { useRef, useState } from "react";
import { useStatusTokens } from "@trops/dash-react";

// The most boxes one fix carries (the main process keeps as many).
export const MAX_SPOTS = 6;
// A drag shorter than this is a click, not a box.
const MIN_SIZE = 6;

/**
 * The box between where a drag started and where it is now, inside the
 * area (w × h) — rounded, never outside it.
 */
export function boxFrom(start, end, w, h) {
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const x1 = clamp(start.x, w);
  const y1 = clamp(start.y, h);
  const x2 = clamp(end.x, w);
  const y2 = clamp(end.y, h);
  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    width: Math.round(Math.abs(x2 - x1)),
    height: Math.round(Math.abs(y2 - y1)),
  };
}

/** Big enough to be a box (not a stray click). */
export const isBox = (b) => !!b && b.width >= MIN_SIZE && b.height >= MIN_SIZE;

/**
 * Mark a spot: over the running preview, drag a box around what's wrong;
 * each box gets its number. Drawn into the preview's frame, so the picture
 * the app takes shows them. Its parent is `relative`.
 *
 * @param {{ active: boolean, spots: object[], onAdd: (box) => void,
 *           onRemove: (index) => void }} props
 */
export const MarkSpots = ({ active, spots = [], onAdd, onRemove }) => {
  const status = useStatusTokens();
  const area = useRef(null);
  const [drag, setDrag] = useState(null); // { start, box }
  if (!active && !spots.length) return null;

  const at = (e) => {
    const r = area.current.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      w: r.width,
      h: r.height,
    };
  };
  const down = (e) => {
    if (!active || spots.length >= MAX_SPOTS || e.button !== 0) return;
    const p = at(e);
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDrag({ start: p, box: boxFrom(p, p, p.w, p.h) });
  };
  const move = (e) => {
    if (!drag) return;
    const p = at(e);
    setDrag({ ...drag, box: boxFrom(drag.start, p, p.w, p.h) });
  };
  const up = () => {
    if (drag && isBox(drag.box)) onAdd(drag.box);
    setDrag(null);
  };

  const boxes = drag && isBox(drag.box) ? [...spots, drag.box] : spots;
  return (
    <div
      ref={area}
      className={`absolute inset-0 z-10 select-none ${active ? "" : "pointer-events-none"}`}
      style={active ? { cursor: "crosshair" } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      role={active ? "application" : undefined}
      aria-label={
        active ? "Mark a spot: drag a box around what's wrong" : undefined
      }
      data-testid="mark-spots"
    >
      {boxes.map((b, i) => (
        <div
          key={i}
          className={`absolute rounded-md border-2 border-dashed ${status.info.accentBorder}`}
          style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
          data-testid="mark-spot"
        >
          <button
            type="button"
            className={`absolute flex items-center justify-center h-5 w-5 rounded-full text-xs font-semibold text-white ${status.info.solidBg}`}
            style={{ top: -10, right: -10 }}
            aria-label={`Remove spot ${i + 1}`}
            title={`Spot ${i + 1} — click to remove`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => i < spots.length && onRemove(i)}
          >
            {i + 1}
          </button>
        </div>
      ))}
    </div>
  );
};

export default MarkSpots;
