import React, { useState } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

/**
 * GridCellFrame — the frame around an occupied grid cell's widget, in BOTH
 * view and edit mode (create-entry phase 1c).
 *
 * The element tree is identical in both modes — only the slots' content and
 * the root's classes change — so the widget passed as `children` stays
 * mounted when the dashboard switches modes instead of being rebuilt (and
 * reconnecting its providers). Edit mode shows the header and footer; view
 * mode shows the hover popout button.
 *
 * Declared at module level on purpose: a component declared inside another
 * component's render is a new type on every render and remounts its subtree.
 *
 * @param {boolean} editing
 * @param {React.ReactNode} header  edit-mode header (WidgetCard.Header)
 * @param {React.ReactNode} footer  edit-mode footer (WidgetCard.Footer)
 * @param {Function} [onPopout]     view mode: pop the widget out
 * @param {React.ReactNode} children the cell body wrapping the widget — the
 *   same component type in both modes
 */
export function GridCellFrame({
  editing,
  header = null,
  footer = null,
  onPopout = null,
  children,
}) {
  const [hovered, setHovered] = useState(false);
  const showPopout = !editing && typeof onPopout === "function";
  return (
    <div
      className={
        editing
          ? "flex flex-col w-full h-full min-h-0 overflow-hidden rounded border border-dashed border-gray-700"
          : "relative w-full h-full"
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? header : null}
      {children}
      {editing ? footer : null}
      {showPopout ? (
        <button
          type="button"
          aria-label="Pop out widget"
          title="Pop out widget"
          className={`absolute top-1 right-1 p-1 rounded transition-opacity bg-black/60 hover:bg-black/80 text-gray-300 hover:text-white z-10 ${
            hovered ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onPopout();
          }}
        >
          <FontAwesomeIcon
            icon="arrow-up-right-from-square"
            className="h-3 w-3"
          />
        </button>
      ) : null}
    </div>
  );
}
