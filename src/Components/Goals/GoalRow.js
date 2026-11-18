import React from "react";
import { StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { whenText } from "../Issues/issueText";
import {
  goalLabel,
  shownStatus,
  goalLine,
  goalState,
  roundText,
  sourceText,
  taskLabel,
  taskState,
} from "./goalText";
import { stepPills } from "../Flows/flowText";
import { isBotJob, jobLine } from "./jobTimeline";

const PILL_MAX = 24;
const clip = (s) =>
  s && s.length > PILL_MAX ? `${s.slice(0, PILL_MAX - 1)}…` : s || "";

/**
 * GoalRow — one goal in the Goals tab (goals-ledger PRD, frame 1): its
 * status, title and when it last moved; where it came from and what
 * happened last; a pill for each task in its status colour, and the round.
 */
export const GoalRow = ({ goal, active = false, onClick, now }) => {
  const { muted, strong, hairline, selectedBg, selectedBorder, fieldBg } =
    useConfigTokens();
  const attention = goal.status === "needs-you" || goal.status === "ready";
  const botJob = isBotJob(goal);
  // A bot's job counts tries, not rounds (bot-checks CHK-003).
  const round = botJob
    ? roundText(goal).replace(/^Round/, "Try")
    : roundText(goal);
  return (
    <div role="listitem">
      <button
        type="button"
        data-testid="goal-row"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={`w-full text-left flex flex-col gap-1.5 p-3 rounded-lg border ${
          active ? `${selectedBg} ${selectedBorder}` : hairline
        }`}
      >
        <span className="flex flex-row items-center gap-2 min-w-0">
          <StatusBadge
            state={goalState(shownStatus(goal))}
            label={goalLabel(shownStatus(goal))}
          />
          <span className={`text-sm font-semibold truncate flex-1 ${strong}`}>
            {goal.title}
          </span>
          <span className={`text-xs flex-shrink-0 ${muted}`}>
            {whenText(goal.updatedAt, now)}
          </span>
        </span>
        <span className="flex flex-row items-center gap-2 min-w-0">
          <span
            className={`text-xs flex-shrink-0 px-2 rounded ${fieldBg} ${muted}`}
          >
            {sourceText(goal)}
          </span>
          <span
            className={`text-xs truncate ${attention ? strong : muted}`}
            data-testid="goal-row-line"
          >
            {botJob ? jobLine(goal) : goalLine(goal)}
          </span>
        </span>
        <span className="flex flex-row items-center gap-2 min-w-0">
          <span className="flex flex-row flex-wrap gap-1 flex-1 min-w-0">
            {goal.flow
              ? // A goal in a flow: one pill per step (frame 3).
                stepPills(goal).map((p) => (
                  <span key={p.id} title={p.label}>
                    <StatusBadge state={p.state} label={clip(p.label)} />
                  </span>
                ))
              : (goal.tasks || []).map((t) => (
                  <span
                    key={t.id}
                    title={`${t.title} · ${taskLabel(t.status)}`}
                  >
                    <StatusBadge
                      state={taskState(t.status)}
                      label={clip(t.title)}
                    />
                  </span>
                ))}
          </span>
          {round ? (
            <span className={`text-xs flex-shrink-0 ${muted}`}>{round}</span>
          ) : null}
        </span>
      </button>
    </div>
  );
};

export default GoalRow;
