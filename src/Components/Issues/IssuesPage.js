import React, { useEffect, useMemo, useState } from "react";
import {
  Button3,
  EmptyState,
  FilterMenu,
  FontAwesomeIcon,
  SegmentedControl,
} from "@trops/dash-react";
import { ManageLayout } from "../AppPages/ManageLayout";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useIssues } from "../../hooks/useIssues";
import { IssueRow } from "./IssueRow";
import { IssueDetail } from "./IssueDetail";
import { clearResolved } from "./issueActions";

const KINDS = [
  { value: "all", label: "All" },
  { value: "widget", label: "Widgets" },
  { value: "bot", label: "Bots" },
  { value: "provider", label: "Providers" },
];

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "muted", label: "Muted" },
];

/**
 * IssuesPage — the Issues Manage page (issues PRD): what went wrong in
 * widgets, bots and providers, newest first. Filters: kind, dashboard,
 * Open / Resolved / Muted. A row opens its detail beside the list.
 *
 * @param {object} issueLink  { issueId, nonce } — open on that issue.
 */
export const IssuesPage = ({
  workspaces = [],
  dashApi = null,
  onOpenWorkspace = null,
  issueLink = null,
}) => {
  const { muted } = useConfigTokens();
  const [kind, setKind] = useState("all");
  // Dashboards picked in the filter (none = all).
  const [dashboards, setDashboards] = useState([]);
  const [status, setStatus] = useState("open");
  const [selectedId, setSelectedId] = useState(
    (issueLink && issueLink.issueId) || null,
  );
  const {
    issues: listed,
    counts,
    loading,
  } = useIssues({
    status,
    kind: kind === "all" ? null : kind,
    workspaceId: dashboards.length === 1 ? dashboards[0] : null,
  });
  // How many are muted, for the Status label and the note under Open.
  const { issues: mutedIssues } = useIssues({ status: "muted" });
  const mutedCount = mutedIssues.length;
  // Several dashboards picked: keep the issues on any of them.
  const issues =
    dashboards.length > 1
      ? listed.filter(
          (i) =>
            i.asset &&
            i.asset.workspaceId != null &&
            dashboards.includes(String(i.asset.workspaceId)),
        )
      : listed;

  // A link to one issue (a widget's problems chip): show it, whatever the
  // filters were.
  useEffect(() => {
    if (!issueLink || !issueLink.issueId) return;
    setKind("all");
    setDashboards([]);
    setStatus("open");
    setSelectedId(issueLink.issueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueLink && issueLink.issueId, issueLink && issueLink.nonce]);

  const dashboardOptions = useMemo(
    () =>
      (workspaces || [])
        .filter((w) => w && w.id != null)
        .map((w) => ({ value: String(w.id), label: w.name || "Untitled" })),
    [workspaces],
  );

  const shown =
    issues.find((i) => i.id === selectedId) ||
    (issues.length ? issues[0] : null);

  const kindOptions = KINDS.map((k) => {
    const n =
      status === "open"
        ? k.value === "all"
          ? counts.total
          : counts[k.value]
        : 0;
    return n ? { ...k, label: `${k.label} · ${n}` } : k;
  });

  const toolbar = (
    <>
      <SegmentedControl
        ariaLabel="Kind"
        options={kindOptions}
        value={kind}
        onChange={setKind}
      />
      <span className="flex-1" />
      {dashboardOptions.length ? (
        <FilterMenu
          label="Dashboard"
          options={dashboardOptions}
          selected={dashboards}
          onChange={(v) => setDashboards(Array.isArray(v) ? v : [])}
        />
      ) : null}
      <SegmentedControl
        ariaLabel="Status"
        options={STATUSES.map((s) =>
          s.value === "muted" && mutedCount
            ? { ...s, label: `Muted · ${mutedCount}` }
            : s,
        )}
        value={status}
        onChange={setStatus}
      />
      {status === "resolved" && issues.length ? (
        <Button3
          title="Clear resolved"
          size="sm"
          onClick={() => clearResolved()}
        />
      ) : null}
    </>
  );

  const nothing =
    status === "open"
      ? kind === "all" && !dashboards.length
        ? "Nothing has gone wrong. Problems in your widgets, bots and providers show here."
        : "No open issues match these filters."
      : status === "muted"
        ? "Nothing is muted. Mute an error that keeps coming back and doesn't matter, and it shows here instead."
        : "No resolved issues.";

  const list = issues.length ? (
    <>
      {issues.map((i) => (
        <IssueRow
          key={i.id}
          issue={i}
          active={shown && shown.id === i.id}
          onClick={() => setSelectedId(i.id)}
        />
      ))}
      {status === "muted" ? (
        <span className={`text-xs px-2 py-1 ${muted}`}>
          Muted errors never show on a card, in the menu count or in Open. One
          that stops happening for 30 days is removed from here.
        </span>
      ) : null}
      {status === "open" && mutedCount ? (
        <span
          className={`text-xs px-2 py-1 flex flex-row items-center gap-2 ${muted}`}
        >
          {`${mutedCount} muted ${mutedCount === 1 ? "error is" : "errors are"} hidden.`}
          <Button3
            title="See muted"
            size="xs"
            onClick={() => setStatus("muted")}
          />
        </span>
      ) : null}
    </>
  ) : loading ? null : (
    <span className={`text-sm px-2 py-1 ${muted}`}>{nothing}</span>
  );

  const allClear =
    !loading &&
    status === "open" &&
    kind === "all" &&
    !dashboards.length &&
    !issues.length;

  return (
    <ManageLayout
      testId="issues-page"
      listLabel="Issues"
      detailTestId="issue-detail-pane"
      toolbar={toolbar}
      list={list}
      detail={
        shown ? (
          <IssueDetail
            key={shown.id}
            issue={shown}
            dashApi={dashApi}
            workspaces={workspaces}
            onOpenWorkspace={onOpenWorkspace}
            onUnmuted={(issue, where) => {
              // Show it where it went: back in Open, or Resolved.
              setStatus(where);
              setSelectedId(issue.id);
            }}
          />
        ) : (
          <span className={`text-sm ${muted}`}>
            {loading ? "" : "Pick an issue to see what went wrong."}
          </span>
        )
      }
      empty={
        allClear ? (
          <EmptyState
            icon={<FontAwesomeIcon icon="circle-check" className="h-10 w-10" />}
            title="No problems"
            description={
              mutedCount
                ? `Nothing open. ${mutedCount} muted ${
                    mutedCount === 1 ? "error is" : "errors are"
                  } still counted under Muted.`
                : nothing
            }
          >
            <Button3
              title="See resolved issues"
              size="sm"
              onClick={() => setStatus("resolved")}
            />
            {mutedCount ? (
              <Button3
                title={`See muted · ${mutedCount}`}
                size="sm"
                onClick={() => setStatus("muted")}
              />
            ) : null}
          </EmptyState>
        ) : null
      }
    />
  );
};

export default IssuesPage;
