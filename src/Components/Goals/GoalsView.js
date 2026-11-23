import React, { useEffect, useState } from "react";
import { SegmentedControl } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal, useGoals } from "../../hooks/useGoals";
import { GoalRow } from "./GoalRow";
import { GoalDetail } from "./GoalDetail";
import { goalBucket, goalCounts, shownGoals } from "./goalText";
import { useJobs } from "../../hooks/useJobs";
import { JobDetail, JobRow } from "../Jobs/JobsPage";

// A job's status as the tab's filters see it.
const jobBucket = (j) =>
  j.status === "needs-you"
    ? "needs-you"
    : j.status === "running"
      ? "working"
      : "done";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs-you", label: "Needs you" },
  { value: "working", label: "Working" },
  { value: "done", label: "Done" },
];

/**
 * GoalsView — a dashboard's Jobs tab (goals-ledger PRD, DASH-31): its jobs
 * through its team lead, each a chain of bots, and checked runs that aren't
 * part of one (a bot with checks on a schedule). Selecting one opens it
 * beside the list.
 */
export const GoalsView = ({
  workspace,
  now,
  openGoal = null,
  onOpenedGoal = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const workspaceId = workspace ? workspace.id : null;
  // Not jobs that followed a flow (flows are gone, DASH-13).
  const { goals: allGoals, loading } = useGoals(workspaceId);
  const { jobs, loading: jobsLoading } = useJobs(workspaceId, { limit: 300 });
  // A checks job that's a stage of one of these shows there instead.
  const inJobs = new Set(
    jobs.flatMap((j) => (j.steps || []).map((st) => st.goalId).filter(Boolean)),
  );
  const goals = shownGoals(allGoals).filter((g) => !inJobs.has(g.id));
  const [jobId, setJobId] = useState(null);
  const [filter, setFilter] = useState("all");
  // A job opened from elsewhere ({ goalId, seq }: a lead's check card).
  const [selectedId, setSelectedId] = useState(
    openGoal ? openGoal.goalId : null,
  );
  useEffect(() => {
    if (!openGoal || !openGoal.goalId) return;
    setFilter("all");
    // From a job's step (See checks): its checks replace the job shown.
    setJobId(null);
    setSelectedId(openGoal.goalId);
    // Opened once: coming back to Jobs later doesn't open it again.
    if (onOpenedGoal) onOpenedGoal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGoal && openGoal.seq, openGoal && openGoal.goalId]);
  const { goal: opened } = useGoal(selectedId);
  const counts = goalCounts(goals);
  for (const j of jobs) {
    const b = jobBucket(j);
    counts[b] = (counts[b] || 0) + 1;
  }
  counts.all = (counts.all || 0) + jobs.length;
  const shown =
    filter === "all" ? goals : goals.filter((g) => goalBucket(g) === filter);
  const shownJobs =
    filter === "all" ? jobs : jobs.filter((j) => jobBucket(j) === filter);
  // Open only while it's in the list shown (a filter can hide it).
  const selectedJob = jobId ? shownJobs.find((j) => j.id === jobId) : null;
  // A checks job opened from elsewhere (See checks) shows even when it's
  // listed as a stage of its job rather than a row of its own.
  const selected =
    !selectedJob &&
    selectedId &&
    (shown.some((g) => g.id === selectedId) ||
      (filter === "all" && inJobs.has(selectedId)));
  const pick = (kind, id) => {
    if (kind === "job") {
      setJobId((cur) => (cur === id ? null : id));
      setSelectedId(null);
    } else {
      setSelectedId((cur) => (cur === id ? null : id));
      setJobId(null);
    }
  };

  if (!loading && !jobsLoading && !goals.length && !jobs.length) {
    return (
      <div
        data-testid="goals-view"
        className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-6 max-w-2xl ${strong}`}
      >
        <div
          className={`flex flex-col gap-1.5 p-4 rounded-lg border border-dashed ${hairline}`}
        >
          <span className="text-sm font-semibold">No jobs yet</span>
          <span className={`text-sm ${muted}`}>
            When you ask this dashboard's team lead for something — here or as a
            task over MCP — its job shows here: each bot that works on it, until
            it's done.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="goals-view"
      className={`flex-1 min-h-0 flex flex-col gap-3 px-4 pt-3 pb-4 ${strong}`}
    >
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-3">
        <span className={`text-sm flex-1 min-w-0 ${muted}`}>
          Everything this dashboard's bots are working on: each job its team
          lead started, bot by bot, and checked runs on their own.
        </span>
        <SegmentedControl
          ariaLabel="Show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            ...f,
            label: counts[f.value] ? `${f.label} ${counts[f.value]}` : f.label,
          }))}
        />
      </div>
      <div className="flex-1 min-h-0 flex flex-row gap-4">
        <div
          role="list"
          aria-label="Jobs"
          className={`min-h-0 overflow-y-auto flex flex-col gap-2 ${
            selected || selectedJob ? "w-96 flex-shrink-0" : "flex-1"
          }`}
        >
          {shownJobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              now={now}
              active={j.id === jobId}
              onClick={() => pick("job", j.id)}
            />
          ))}
          {shown.length && shownJobs.length ? (
            <span
              className={`text-xs font-semibold uppercase tracking-wider px-1 pt-2 ${muted}`}
            >
              Checked runs
            </span>
          ) : null}
          {shown.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              now={now}
              active={g.id === selectedId}
              onClick={() => pick("goal", g.id)}
            />
          ))}
          {!shown.length && !shownJobs.length && !loading ? (
            <span className={`text-sm px-2 py-1 ${muted}`}>No jobs here.</span>
          ) : null}
        </div>
        {selectedJob ? (
          <div
            data-testid="job-detail-pane"
            className={`flex-1 min-w-0 min-h-0 overflow-y-auto pl-4 border-l ${hairline}`}
          >
            <JobDetail key={selectedJob.id} job={selectedJob} />
          </div>
        ) : null}
        {selected ? (
          <div
            data-testid="goal-detail-pane"
            className={`flex-1 min-w-0 min-h-0 overflow-y-auto pl-4 border-l ${hairline}`}
          >
            {opened && opened.id === selectedId ? (
              <GoalDetail
                goal={opened}
                now={now}
                workspace={workspace}
                onDeleted={() => setSelectedId(null)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GoalsView;
