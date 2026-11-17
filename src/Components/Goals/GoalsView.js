import React, { useEffect, useRef, useState } from "react";
import {
  EmptyState,
  FontAwesomeIcon,
  SegmentedControl,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal, useGoals } from "../../hooks/useGoals";
import { GoalRow } from "./GoalRow";
import { GoalDetail } from "./GoalDetail";
import { goalBucket, goalCounts } from "./goalText";
import { NewGoalModal } from "./NewGoalModal";
import { useFlows } from "../../hooks/useFlows";

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
        className="flex-1 min-h-0 flex flex-col items-center justify-center p-6"
      >
        <EmptyState
          icon={<FontAwesomeIcon icon="bullseye" className="h-10 w-10" />}
          title="No goals yet"
          description="When a bot on this dashboard starts a goal — from a ticket, a note, or something you asked — it shows here with its tasks, who's working on what, and the proof each step left."
        />
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
          Everything this dashboard's bots are working on. Each goal keeps its
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
          aria-label="Goals"
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
            <span className={`text-sm px-2 py-1 ${muted}`}>No goals here.</span>
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
