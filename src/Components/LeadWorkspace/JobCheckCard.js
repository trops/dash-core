import React from "react";
import { Button3, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal } from "../../hooks/useGoals";
import {
  checkResults,
  jobBot,
  jobStateText,
  jobTimeline,
} from "../Goals/jobTimeline";

/**
 * JobCheckCard — under a lead's "Asked <bot>" step when that bot has checks
 * (bot-checks PRD CHK-003, frame 3): each check's result on its try, where
 * the job is now, and Open in Jobs. It reads the job live, so it moves on
 * when you approve it in Jobs.
 *
 * @param {string} goalId  the job (the checked answer's marker)
 */
export const JobCheckCard = ({ goalId }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { goal } = useGoal(goalId);
  if (!goal) return null;
  const results = checkResults(goal);
  const rows = jobTimeline(goal);
  const now = rows[rows.length - 1] || {};
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("dash:open-job", {
        detail: { workspaceId: goal.workspaceId, goalId: goal.id },
      }),
    );
  return (
    <div
      data-testid="job-check-card"
      className={`ml-5 flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
    >
      <span
        className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
      >
        {`${jobBot(goal).name}'s checks`}
      </span>
      {results.length ? (
        results.map((r, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="flex flex-row items-center gap-2 min-w-0">
              <StatusBadge
                state={r.status === "passed" ? "success" : "error"}
                label={r.status === "passed" ? "Passed" : "Failed"}
              />
              <span className={`text-sm truncate ${strong}`}>{r.name}</span>
              <span className={`text-xs flex-shrink-0 ${muted}`}>
                {`try ${r.tryN}`}
              </span>
            </span>
            {r.reason ? (
              <span className={`text-xs ${muted}`}>{r.reason}</span>
            ) : null}
          </div>
        ))
      ) : (
        <span className={`text-sm ${muted}`}>Not checked yet.</span>
      )}
      <div
        className={`flex flex-row items-center gap-2 pt-2 border-t ${hairline}`}
      >
        <span
          className={`flex-1 text-sm ${
            now.state === "waiting" || now.state === "needs-you"
              ? `font-semibold ${strong}`
              : muted
          }`}
          data-testid="job-check-state"
        >
          {jobStateText(goal)}
        </span>
        <Button3 title="Open in Jobs →" size="sm" onClick={open} />
      </div>
    </div>
  );
};

export default JobCheckCard;
