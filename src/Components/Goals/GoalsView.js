import React, { useEffect, useRef, useState } from "react";
import { Button3, SegmentedControl } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal, useGoals } from "../../hooks/useGoals";
import { GoalRow } from "./GoalRow";
import { GoalDetail } from "./GoalDetail";
import { goalBucket, goalCounts } from "./goalText";
import { NewGoalModal } from "./NewGoalModal";
import { useFlows } from "../../hooks/useFlows";
import { jobsStart } from "../Flows/FlowList";

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
export const GoalsView = ({ workspace, now, command = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const workspaceId = workspace ? workspace.id : null;
  const { goals, loading } = useGoals(workspaceId);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const { goal: opened } = useGoal(selectedId);
  // New goal (frame 29), from the header's button: in one of its flows.
  const { flows } = useFlows(workspaceId);
  // false, true (the first flow), or the id of the flow to start one in.
  const [newGoal, setNewGoal] = useState(false);
  // Only a press made while this tab is open counts, not the last one.
  const seenSeq = useRef(command ? command.seq : 0);
  useEffect(() => {
    if (!command || command.seq <= seenSeq.current) return;
    seenSeq.current = command.seq;
    if (command.type === "new-goal") setNewGoal(true);
  }, [command]);
  const newGoalModal = newGoal ? (
    <NewGoalModal
      workspace={workspace}
      flows={flows}
      initialFlowId={typeof newGoal === "string" ? newGoal : null}
      onClose={() => setNewGoal(false)}
      onStarted={(g) => {
        setNewGoal(false);
        if (g) setSelectedId(g.id);
      }}
    />
  ) : null;

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
            A job is one piece of work going through a flow, from its first step
            to its last. Most start by themselves from a flow's first step;
            start one by hand with New job.
          </span>
        </div>
        {flows.length ? (
          <div className="flex flex-col gap-2" data-testid="jobs-come-from">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
            >
              Where jobs come from here
            </span>
            {flows.map((f) => {
              const byHand = !(f.steps || []).some((x) => x.kind === "source");
              const line = jobsStart(f);
              return (
                <div
                  key={f.id}
                  className={`flex flex-row items-center gap-3 px-3 py-2.5 rounded-lg border ${hairline}`}
                >
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-sm font-semibold">{f.name}</span>
                    <span className={`text-xs ${muted}`}>
                      {byHand
                        ? "Nothing starts jobs here: you start them by hand"
                        : line.charAt(0).toUpperCase() + line.slice(1)}
                    </span>
                  </span>
                  {byHand ? (
                    <Button3
                      title="Start one"
                      size="sm"
                      onClick={() => setNewGoal(f.id)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>
            This dashboard has no flows yet. Make one on the Flows tab first.
          </span>
        )}
        {newGoalModal}
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
                onDeleted={() => setSelectedId(null)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {newGoalModal}
    </div>
  );
};

export default GoalsView;
