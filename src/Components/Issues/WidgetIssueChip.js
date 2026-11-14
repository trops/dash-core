import React, { useContext, useRef, useState } from "react";
import {
  Button,
  Button2,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useWidgetIssues } from "../../hooks/useIssues";
import { countText, errorText, problemsText } from "./issueText";
import { IssueDot, useRetryWidget } from "./IssueParts";

/** Open the Issues page on an issue (where there's no panel to open). */
export function openIssueOnPage(issue) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("dash:open-page", {
      detail: { page: "issues", issueId: (issue && issue.id) || null },
    }),
  );
}

/**
 * WidgetIssueChip — a red "N problem(s)" chip on a widget copy with open
 * issues (issues PRD). Hover or click shows the newest one: what failed,
 * the error, "See what went wrong" (the widget's panel at Problems, or the
 * Issues page) and Retry. Nothing when the copy has no open issues.
 *
 * @param {string} component     the widget's component name
 * @param {*}      itemId        widgetItemId(its layout item): uuid, else id
 * @param {*}      workspaceId   its dashboard
 * @param {Function} [onSee]     (issue) => open its panel at Problems
 */
export const WidgetIssueChip = ({
  component,
  itemId = null,
  workspaceId = null,
  onSee = null,
  // "right": the card opens leftward (a chip at a cell's top right).
  align = "left",
  className = "",
}) => {
  const issues = useWidgetIssues(component, itemId, workspaceId);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const newest = issues[0];
  const { retry, note } = useRetryWidget(newest);
  if (!issues.length) return null;
  const count = countText(newest);
  const err = errorText(newest);
  const see = () => {
    setOpen(false);
    pinned.current = false;
    if (onSee) onSee(newest);
    else openIssueOnPage(newest);
  };
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned.current) setOpen(false);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid="widget-issue-chip"
        aria-label={`${problemsText(issues.length)} — see what went wrong`}
        aria-expanded={open}
        onClick={() => {
          // A click pins the card open — even when hovering opened it
          // first; a second click closes it.
          const pin = !pinned.current;
          pinned.current = pin;
          setOpen(pin);
        }}
        className={`inline-flex flex-row items-center gap-1.5 h-6 px-2.5 rounded-full border text-xs font-semibold cursor-pointer ${status.error.border} ${status.error.bg} ${status.error.text}`}
      >
        <IssueDot severity={newest.severity} />
        {problemsText(issues.length)}
      </button>
      {open ? (
        <div
          role="tooltip"
          data-testid="widget-issue-card"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 z-30 w-80 flex flex-col gap-1.5 p-3 rounded-lg border shadow-lg text-left ${hairline} ${
            currentTheme["bg-neutral-very-dark"] || ""
          } dr-role-surface`}
        >
          <span className="flex flex-row items-center gap-2">
            <IssueDot severity={newest.severity} />
            <span className={`text-sm font-semibold ${strong}`}>
              {newest.title}
            </span>
          </span>
          {err || count ? (
            <span className={`text-xs ${muted}`}>
              {[
                err && count && !/[.!?]$/.test(err) ? `${err}.` : err,
                count ? `${count}.` : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          ) : null}
          <span className="flex flex-row gap-2 pt-0.5">
            <Button title="See what went wrong" size="sm" onClick={see} />
            <Button2 title="Retry" size="sm" onClick={() => retry()} />
          </span>
          {note ? (
            <span role="status" className={`text-xs ${muted}`}>
              {note}
            </span>
          ) : null}
        </div>
      ) : null}
    </span>
  );
};

export default WidgetIssueChip;
