import React from "react";
import { Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useJobs } from "../../hooks/useJobs";
import { JobBadge } from "./JobsPage";
import { STEP_STATUS, aheadText, tookText } from "./jobText";

/** The newest job asked in a conversation, or null. */
export function jobForConversation(jobs, conversationId) {
  if (!conversationId) return null;
  const id = String(conversationId);
  return (
    (jobs || []).find(
      (j) =>
        String(j.conversationId || "") === id ||
        (j.steps || []).some((s) => String(s.conversationId || "") === id),
    ) || null
  );
}

/** "Designer done · Drafter running" — each step in a few words. */
export function stepsLine(job) {
  return ((job && job.steps) || [])
    .map(
      (s) =>
        `${s.botName} ${String(STEP_STATUS[s.status] || s.status).toLowerCase()}`,
    )
    .join(" · ");
}

/**
 * JobStrip — under a team lead's latest answer (DASH-31): the job that
 * answer set going, step by step, until it's done, with a way to the Jobs
 * page. Nothing when the conversation started no job.
 */
export const JobStrip = ({ conversationId, workspaceId = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  // Its lead's dashboard's newest jobs (the Dash Lead's make none).
  const { jobs } = useJobs(workspaceId, {
    limit: 30,
    skip: workspaceId == null,
  });
  const job = jobForConversation(jobs, conversationId);
  if (!job) return null;
  return (
    <div
      data-testid="job-strip"
      className={`self-start w-full max-w-2xl flex flex-row flex-wrap items-center gap-2 px-3 py-2 rounded-lg border ${hairline}`}
    >
      <JobBadge status={job.status} />
      <span className={`flex-1 min-w-0 text-sm break-words ${strong}`}>
        {aheadText(job) || stepsLine(job) || "Starting"}
      </span>
      <span className={`text-xs ${muted}`}>{tookText(job)}</span>
      <Button3
        title="See the job"
        size="sm"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("dash:open-page", {
              detail: { page: "jobs", jobId: job.id },
            }),
          )
        }
      />
    </div>
  );
};

export default JobStrip;
