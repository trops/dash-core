import React, { useContext, useEffect, useRef, useState } from "react";
import { ButtonIcon3, ThemeContext, useStatusTokens } from "@trops/dash-react";
import { useWidgetIssues, isIssueOfWidget } from "../../../hooks/useIssues";
import { WidgetIssueChip } from "../../Issues/WidgetIssueChip";
import { RETRY_WIDGET_EVENT } from "../../Issues/issueActions";

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
 * @param {React.ReactNode} [badge] view mode: shown at the top right
 * @param {object} [issueTarget]    this copy — { component, itemId,
 *   workspaceId } (itemId = widgetItemId(item)) — for its open issues
 *   (issues PRD): a problem-coloured border, its problems chip at the top
 *   right in view mode (the card header has it while editing), and Retry
 *   from the Issues screens remounts just this copy.
 * @param {Function} [onSeeIssue]   view mode: the chip's "See what went wrong"
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
  badge = null,
  issueTarget = null,
  onSeeIssue = null,
  onSelect = null,
  label = "",
  selected = false,
  related = false,
  dimmed = false,
  children,
}) {
  const [hovered, setHovered] = useState(false);
  const target = issueTarget || {};
  const issues = useWidgetIssues(
    target.component || null,
    target.itemId ?? null,
    target.workspaceId ?? null,
  );
  const hasIssues = issues.length > 0;
  // Retry (Issues screens): this copy alone remounts — its error boundary
  // and its calls start over.
  const [retryCount, setRetryCount] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!target.component || typeof window === "undefined") return undefined;
    const onRetry = (e) => {
      const d = (e && e.detail) || {};
      const t = targetRef.current;
      const mine = isIssueOfWidget(
        {
          asset: {
            kind: "widget",
            component: d.component,
            itemId: d.itemId,
            workspaceId: d.workspaceId,
          },
        },
        t.component,
        t.itemId ?? null,
        t.workspaceId ?? null,
      );
      if (!mine) return;
      d.handled = true;
      setRetryCount((n) => n + 1);
    };
    window.addEventListener(RETRY_WIDGET_EVENT, onRetry);
    return () => window.removeEventListener(RETRY_WIDGET_EVENT, onRetry);
  }, [target.component]);
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
  const hairline = `${currentTheme["border-neutral-dark"] || ""} dr-role-hairline`;
  const borderClass =
    state === "selected"
      ? `border-2 ${currentTheme["border-primary-medium"] || ""}`
      : state === "related"
        ? `border-2 ${status.success.accentBorder}`
        : hasIssues
          ? `border-2 ${status.error.accentBorder}`
          : `border ${hairline}`;
  const fadeClass = state === "dimmed" ? "opacity-50" : "";
  return (
    <div
      className={
        editing
          ? `flex flex-col w-full h-full min-h-0 overflow-hidden rounded-lg ${borderClass} ${fadeClass}`
          : hasIssues
            ? `relative w-full h-full rounded-lg border-2 ${status.error.accentBorder}`
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
      <React.Fragment key={`retry-${retryCount}`}>{children}</React.Fragment>
      {editing ? footer : null}
      {/* View mode: its problems chip, then the popout, in one row at the
          top right — never over the widget's own title at the left. */}
      {!editing && (badge || hasIssues || showPopout) ? (
        <span className="absolute top-1 right-1 z-10 flex flex-row items-center gap-1">
          {badge}
          {hasIssues ? (
            <WidgetIssueChip
              align="right"
              component={target.component}
              itemId={target.itemId ?? null}
              workspaceId={target.workspaceId ?? null}
              onSee={onSeeIssue}
            />
          ) : null}
          {showPopout ? (
            // A quiet, square icon action: the theme's text colour, filled
            // only on hover (dr-row-actions).
            <span
              className={`dr-row-actions z-10 transition-opacity ${
                hovered ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <ButtonIcon3
                icon="arrow-up-right-from-square"
                ariaLabel="Pop out widget"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onPopout();
                }}
              />
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
