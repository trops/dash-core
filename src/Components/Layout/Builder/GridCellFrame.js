import React, { useContext, useState } from "react";
import {
  FontAwesomeIcon,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";

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
 * @param {Function} [onSelect]     edit mode: select this widget (phase 1c)
 * @param {string}   [label]        the widget's name, for screen readers
 * @param {boolean}  [selected]     edit mode: this widget is selected
 * @param {boolean}  [related]      edit mode: connected to the selection
 * @param {boolean}  [dimmed]       edit mode: unrelated to a selected bot
 */
export function GridCellFrame({
  editing,
  header = null,
  footer = null,
  onPopout = null,
  onSelect = null,
  label = "",
  selected = false,
  related = false,
  dimmed = false,
  children,
}) {
  const [hovered, setHovered] = useState(false);
  const showPopout = !editing && typeof onPopout === "function";
  const canSelect = editing && typeof onSelect === "function";
  const state = !editing
    ? undefined
    : selected
      ? "selected"
      : related
        ? "related"
        : dimmed
          ? "dimmed"
          : undefined;
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const status = useStatusTokens();
  // Edit mode: this frame is the ONE card around the widget — a hairline,
  // rounded-lg box; the header and footer sit inside it with no borders or
  // fills of their own. Theme tokens only (they follow light/dark); the
  // border carries the state, dimmed fades the whole card.
  const hairline = currentTheme["border-neutral-dark"] || "";
  const borderClass =
    state === "selected"
      ? `border-2 ${currentTheme["border-primary-medium"] || ""}`
      : state === "related"
        ? `border-2 ${status.success.accentBorder}`
        : `border ${hairline}`;
  const fadeClass = state === "dimmed" ? "opacity-50" : "";
  return (
    <div
      className={
        editing
          ? `flex flex-col w-full h-full min-h-0 overflow-hidden rounded-lg ${borderClass} ${fadeClass}`
          : "relative w-full h-full"
      }
      data-state={state}
      role={canSelect ? "group" : undefined}
      aria-label={canSelect ? label || undefined : undefined}
      tabIndex={canSelect ? 0 : undefined}
      onClick={canSelect ? () => onSelect() : undefined}
      onKeyDown={
        canSelect
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
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
