import React, { useEffect, useState } from "react";
import { Button3, SegmentedControl } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal, useGoals } from "../../hooks/useGoals";
import { GoalRow } from "./GoalRow";
import { GoalDetail } from "./GoalDetail";
import { goalBucket, goalCounts, shownGoals } from "./goalText";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs-you", label: "Needs you" },
  { value: "working", label: "Working" },
  { value: "done", label: "Done" },
];

/**
 * GoalsView — a dashboard's Goals tab (goals-ledger PRD, frames 1, 2 and 4):
 * everything its bots are working on, one row per goal. Selecting a goal
 * opens it beside the list.
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
  const goals = shownGoals(allGoals);
  const [filter, setFilter] = useState("all");
  // A job opened from elsewhere ({ goalId, seq }: a lead's check card).
  const [selectedId, setSelectedId] = useState(
    openGoal ? openGoal.goalId : null,
  );
  useEffect(() => {
    if (!openGoal || !openGoal.goalId) return;
    setFilter("all");
    setSelectedId(openGoal.goalId);
    // Opened once: coming back to Jobs later doesn't open it again.
    if (onOpenedGoal) onOpenedGoal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGoal && openGoal.seq, openGoal && openGoal.goalId]);
  const { goal: opened } = useGoal(selectedId);
  const counts = goalCounts(goals);
  const shown =
    filter === "all" ? goals : goals.filter((g) => goalBucket(g) === filter);
  // Open only while it's in the list shown (a filter can hide it).
  const selected = selectedId && shown.some((g) => g.id === selectedId);

  if (!loading && !goals.length) {
    return (
      <div
        data-testid="goals-view"
        className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-6 max-w-2xl ${strong}`}
      >
        <div
          className={`flex flex-col gap-1.5 p-4 rounded-lg border border-dashed ${hairline}`}
        >
          <span className="text-sm font-semibold">No jobs right now</span>
          <span className={`text-sm ${muted}`}>
            A job is one run of a bot that has checks, followed until its work
            passes them and is handed on. Bots without checks don't make jobs.
          </span>
          {workspace ? (
            <div className="pt-1">
              <Button3
                title="Add checks to a bot"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("dash:open-bots-view", {
                      detail: { workspaceId: workspace.id },
                    }),
                  )
                }
              />
            </div>
          ) : null}
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
          Everything this dashboard's bots are working on. Each job keeps its
          tasks, runs and proof together.
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
            selected ? "w-96 flex-shrink-0" : "flex-1"
          }`}
        >
          {shown.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              now={now}
              active={g.id === selectedId}
              onClick={() =>
                setSelectedId((cur) => (cur === g.id ? null : g.id))
              }
            />
          ))}
          {!shown.length && !loading ? (
            <span className={`text-sm px-2 py-1 ${muted}`}>No jobs here.</span>
          ) : null}
        </div>
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
