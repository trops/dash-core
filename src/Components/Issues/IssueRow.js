import React from "react";
import { StatusBadge, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { IssueDot } from "./IssueParts";
import {
  assetName,
  kindLabel,
  whatText,
  whenText,
  whereText,
} from "./issueText";

const KIND_STATE = { widget: "neutral", bot: "info", provider: "success" };

/** The kind of thing an issue is about, as a small badge. */
export const IssueKindBadge = ({ kind }) => (
  <StatusBadge state={KIND_STATE[kind] || "neutral"} label={kindLabel(kind)} />
);

/**
 * IssueRow — one issue in the Issues list: its dot, the asset's name and
 * kind, what went wrong, where, when, and how many times.
 */
export const IssueRow = ({ issue, active = false, onClick, now }) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
  const status = useStatusTokens();
  const kind = issue && issue.asset && issue.asset.kind;
  const where = whereText(issue);
  const n = (issue && issue.count) || 1;
  return (
    <div role="listitem">
      <button
        type="button"
        data-testid="issue-row"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={`w-full text-left flex flex-row items-start gap-2.5 p-3 rounded-lg border ${
          active ? `${selectedBg} ${selectedBorder}` : hairline
        }`}
      >
        <IssueDot
          severity={
            issue.status === "resolved"
              ? "ok"
              : issue.status === "muted"
                ? "muted"
                : issue.severity
          }
          className="mt-1.5"
        />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="flex flex-row items-center gap-2 min-w-0">
            <span className={`text-sm font-semibold truncate ${strong}`}>
              {assetName(issue)}
            </span>
            <IssueKindBadge kind={kind} />
          </span>
          <span className={`text-xs truncate ${strong}`}>
            {whatText(issue)}
          </span>
          {where ? (
            <span className={`text-xs truncate ${muted}`}>{where}</span>
          ) : null}
        </span>
        <span className="flex-shrink-0 flex flex-col items-end gap-1">
          <span className={`text-xs ${muted}`}>
            {whenText(issue.lastAt, now)}
          </span>
          {n > 1 ? (
            <span
              className={`text-xs font-semibold px-2 rounded-full ${
                issue.status === "muted"
                  ? `border ${hairline} ${muted}`
                  : `${status.error.bg} ${status.error.text}`
              }`}
            >
              {`×${n}`}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
};

export default IssueRow;
