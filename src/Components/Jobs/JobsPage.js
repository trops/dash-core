import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  EmptyState,
  FilterMenu,
  FontAwesomeIcon,
  SegmentedControl,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { ManageLayout } from "../AppPages/ManageLayout";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useJob, useJobs } from "../../hooks/useJobs";
import { openRunConversation } from "../Bots/runConversation";
import {
  JOB_STATUS,
  STEP_STATUS,
  filterJobs,
  groupByDashboard,
  jobCounts,
  startedByText,
  statusTone,
  tookText,
  whenText,
  whyText,
} from "./jobText";

// How many jobs the page reads at once (jobs are kept until you delete
// them, so a long history isn't read whole).
const PAGE_SIZE = 300;

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/** A job's or a step's status, as a dot. */
export const JobDot = ({ status, className = "" }) => {
  const tokens = useStatusTokens();
  const { hairline } = useConfigTokens();
  const tone = statusTone(status);
  // A status colour (dash-react status tokens), or an outline when muted.
  const fill = tone ? (tokens[tone] || {}).solidBg : `border ${hairline}`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${fill} ${className}`}
    />
  );
};

/** A status as a small badge. */
export const JobBadge = ({ status, step = false }) => (
  <StatusBadge
    state={statusTone(status) || "neutral"}
    label={(step ? STEP_STATUS : JOB_STATUS)[status] || status}
  />
);

/** The chain so far: "Lead → Designer → Drafter", each with its dot. */
export const JobChain = ({ job }) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <span className="flex flex-row flex-wrap items-center gap-1 text-xs">
      {(job.steps || []).map((s, i) => (
        <React.Fragment key={s.id || i}>
          {i ? <span className={muted}>→</span> : null}
          <span
            className={`inline-flex items-center gap-1 px-2 rounded-full border ${hairline}`}
          >
            <JobDot status={s.status} className="w-2 h-2" />
            {s.botName}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};

/** One job in the list. */
export const JobRow = ({ job, active = false, onClick, now }) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
  return (
    <div role="listitem">
      <button
        type="button"
        data-testid="job-row"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={`w-full text-left flex flex-row items-start gap-2.5 p-3 rounded-lg border ${
          active ? `${selectedBg} ${selectedBorder}` : hairline
        }`}
      >
        <JobDot status={job.status} className="mt-1.5" />
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className={`text-sm font-semibold break-words ${strong}`}>
            {job.title}
          </span>
          <span className={`text-xs ${muted}`}>{startedByText(job)}</span>
          <JobChain job={job} />
        </span>
        <span className="flex-shrink-0 flex flex-col items-end gap-1">
          <JobBadge status={job.status} />
          <span className={`text-xs ${muted}`}>
            {job.status === "running"
              ? tookText(job, now)
              : whenText(job.updatedAt, now)}
          </span>
        </span>
      </button>
    </div>
  );
};

const resume = (botId) => {
  const api = botsApi();
  if (api && api.resumeBot) api.resumeBot(botId);
};

/** One step of a job's timeline, with what can be done about it. */
const JobStep = ({ job, step, last }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const why = whyText(step.why);
  const inLead =
    step.botId === job.leadId || (step.why && step.why.kind === "asked");
  return (
    <div className="flex flex-row gap-3" data-testid="job-step">
      <span className="flex flex-col items-center">
        <JobDot status={step.status} className="mt-1.5" />
        {last ? null : <span className={`flex-1 border-l ${hairline} mt-1`} />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-1 pb-4">
        <span className="flex flex-row flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${strong}`}>
            {step.botName}
          </span>
          <JobBadge status={step.status} step />
        </span>
        <span className={`text-xs ${muted}`}>
          {[why, step.startedAt ? whenText(step.startedAt) : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {step.summary ? (
          <span
            className={`text-sm rounded-md px-3 py-2 break-words ${fieldBg} ${strong}`}
          >
            {step.summary}
          </span>
        ) : null}
        <span className="flex flex-row flex-wrap gap-2">
          {step.status === "needs-you" && step.waiting === "paused" ? (
            <Button
              title={`Turn on ${step.botName}`}
              size="sm"
              onClick={() => resume(step.botId)}
            />
          ) : null}
          {step.goalId ? (
            <Button3
              title="See checks"
              size="sm"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("dash:open-job", {
                    detail: {
                      workspaceId: job.workspaceId,
                      goalId: step.goalId,
                    },
                  }),
                )
              }
            />
          ) : null}
          {inLead ? (
            <Button3
              title="Open conversation"
              size="sm"
              onClick={() =>
                openRunConversation({
                  key: `lead:${job.leadId}`,
                  ...(step.conversationId || job.conversationId
                    ? { recentId: step.conversationId || job.conversationId }
                    : {}),
                })
              }
            />
          ) : (
            <Button3
              title="See its activity"
              size="sm"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("dash:open-bot", {
                    detail: { botId: step.botId, tab: "activity" },
                  }),
                )
              }
            />
          )}
        </span>
      </span>
    </div>
  );
};

/** A job's detail: who started it, each step, Stop and Delete. */
export const JobDetail = ({ job: listed, dashboardName = null }) => {
  const { muted, strong } = useConfigTokens();
  // The list's copy has no step summaries; this one does.
  const { job: full } = useJob(listed && listed.id);
  const job = full && full.id === listed.id ? full : listed;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    setConfirmDelete(false);
    setNote("");
  }, [listed && listed.id]);
  if (!job) return null;
  const going = job.status === "running" || job.status === "needs-you";
  const steps = job.steps || [];
  return (
    <div className="flex flex-col gap-4" data-testid="job-detail">
      <div className="flex flex-col gap-1">
        <span className="flex flex-row flex-wrap items-center gap-2">
          <span className={`text-base font-semibold break-words ${strong}`}>
            {job.title}
          </span>
          <JobBadge status={job.status} />
        </span>
        <span className={`text-xs ${muted}`}>
          {[
            dashboardName,
            `Started by ${startedByText(job)}`,
            whenText(job.createdAt),
            tookText(job),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex flex-col">
        {steps.length ? (
          steps.map((s, i) => (
            <JobStep
              key={s.id || i}
              job={job}
              step={s}
              last={i === steps.length - 1}
            />
          ))
        ) : (
          <span className={`text-sm ${muted}`}>
            Its team lead is about to start.
          </span>
        )}
      </div>
      <div className="flex flex-row flex-wrap items-center gap-2">
        {going ? (
          <Button3
            title="Stop job"
            size="sm"
            onClick={() => {
              const api = botsApi();
              if (api && api.stopJob) api.stopJob(job.id);
            }}
          />
        ) : confirmDelete ? (
          <>
            <span className={`text-sm ${strong}`}>Delete this job?</span>
            <Button
              title="Delete"
              size="sm"
              onClick={async () => {
                const api = botsApi();
                const r =
                  api && api.deleteJob ? await api.deleteJob(job.id) : null;
                if (!(r && r.ok)) {
                  setNote((r && r.error) || "It couldn't be deleted.");
                }
                setConfirmDelete(false);
              }}
            />
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            />
          </>
        ) : (
          <Button3
            title="Delete"
            size="sm"
            onClick={() => setConfirmDelete(true)}
          />
        )}
        {note ? <span className={`text-xs ${muted}`}>{note}</span> : null}
      </div>
    </div>
  );
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "needs-you", label: "Needs you" },
  { value: "failed", label: "Failed" },
  { value: "done", label: "Done" },
];

/**
 * JobsPage — every job, on every dashboard (DASH-31): each chain of work
 * through a team lead, what started it and each bot's step, until it's
 * done. Filters: status and dashboard. A row opens its timeline beside the
 * list. `workspaceId`: one dashboard's jobs only (its Jobs tab).
 *
 * @param {object} jobLink  { jobId, nonce } — open on that job.
 */
export const JobsPage = ({
  workspaces = [],
  jobLink = null,
  workspaceId = null,
}) => {
  const { muted } = useConfigTokens();
  const [filter, setFilter] = useState("all");
  const [dashboards, setDashboards] = useState([]);
  const [selectedId, setSelectedId] = useState(
    (jobLink && jobLink.jobId) || null,
  );
  const { jobs: all, loading } = useJobs(workspaceId, { limit: PAGE_SIZE });
  // A running job's time moves on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!jobLink || !jobLink.jobId) return;
    setFilter("all");
    setDashboards([]);
    setSelectedId(jobLink.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobLink && jobLink.jobId, jobLink && jobLink.nonce]);

  const onDashboards =
    dashboards.length && workspaceId == null
      ? all.filter((j) => dashboards.includes(String(j.workspaceId)))
      : all;
  const counts = jobCounts(onDashboards);
  const jobs = filterJobs(onDashboards, filter);
  const groups = groupByDashboard(jobs, workspaces);
  // A job linked from elsewhere that isn't among those read: read it alone.
  const listed = jobs.find((j) => j.id === selectedId) || null;
  const { job: linked } = useJob(
    selectedId && !listed && !loading ? selectedId : null,
  );
  const shown =
    listed ||
    (linked && linked.id === selectedId ? linked : null) ||
    (jobs.length ? jobs[0] : null);
  const nameOf = (id) => {
    const w = (workspaces || []).find((d) => String(d.id) === String(id));
    return w ? w.name : null;
  };

  const dashboardOptions = useMemo(
    () =>
      (workspaces || [])
        .filter((w) => w && w.id != null)
        .map((w) => ({ value: String(w.id), label: w.name || "Untitled" })),
    [workspaces],
  );

  const filterOptions = FILTERS.map((f) => {
    const n =
      f.value === "running"
        ? counts.running
        : f.value === "needs-you"
          ? counts.needsYou
          : 0;
    return n ? { ...f, label: `${f.label} · ${n}` } : f;
  });

  const toolbar = (
    <>
      <SegmentedControl
        ariaLabel="Status"
        options={filterOptions}
        value={filter}
        onChange={setFilter}
      />
      <span className="flex-1" />
      {workspaceId == null && dashboardOptions.length ? (
        <FilterMenu
          label="Dashboard"
          options={dashboardOptions}
          selected={dashboards}
          onChange={(v) => setDashboards(Array.isArray(v) ? v : [])}
        />
      ) : null}
    </>
  );

  const list = jobs.length ? (
    groups.map((g) => (
      <div key={String(g.workspaceId)} className="flex flex-col gap-2">
        {workspaceId == null ? (
          <span
            className={`text-xs font-semibold uppercase tracking-wider px-1 pt-2 ${muted}`}
          >
            {g.name}
          </span>
        ) : null}
        {g.jobs.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            active={shown && shown.id === j.id}
            onClick={() => setSelectedId(j.id)}
            now={now}
          />
        ))}
      </div>
    ))
  ) : loading ? null : (
    <span className={`text-sm px-2 py-1 ${muted}`}>
      No jobs match these filters.
    </span>
  );

  const none = !loading && !all.length;

  return (
    <ManageLayout
      testId="jobs-page"
      listLabel="Jobs"
      detailTestId="job-detail-pane"
      toolbar={toolbar}
      list={list}
      detail={
        shown ? (
          <JobDetail
            key={shown.id}
            job={shown}
            dashboardName={
              workspaceId == null ? nameOf(shown.workspaceId) : null
            }
          />
        ) : (
          <span className={`text-sm ${muted}`}>
            {loading ? "" : "Pick a job to see each step."}
          </span>
        )
      }
      empty={
        none ? (
          <EmptyState
            icon={<FontAwesomeIcon icon="list-check" className="h-10 w-10" />}
            title="No jobs yet"
            description="When you ask a team lead for something — in Dash or as a task over MCP — its job shows here: each bot that works on it, until it's done."
          />
        ) : null
      }
    />
  );
};

export default JobsPage;
