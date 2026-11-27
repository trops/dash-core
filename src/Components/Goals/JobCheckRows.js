/**
 * JobCheckRows — what a bot's checks did on its work, step by step, for a
 * job's timeline (DASH-56, Code Factory G5): each try ("try 2 of 3"), each
 * check that failed with why and what it printed, the checks that passed.
 *
 *   CheckOutput     a check's printed output, shown on request
 *   JobCheckRows    a bot's checks job (a goal) as short rows
 */
import React, { useState } from "react";
import { Button3, FontAwesomeIcon, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useGoal } from "../../hooks/useGoals";
import { jobBot, jobTimeline } from "./jobTimeline";
import { youCheckOf } from "../Jobs/needsYouView";

/** A check's output (its last lines) behind Show output. */
export const CheckOutput = ({ output, exitCode = null, label = null }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [open, setOpen] = useState(false);
  if (!output) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="check-output">
      <span className="flex flex-row flex-wrap items-center gap-2">
        <Button3
          title={
            open
              ? "Hide output"
              : label
                ? `Show ${label}'s output`
                : "Show output"
          }
          size="sm"
          onClick={() => setOpen(!open)}
        />
        {exitCode !== null && exitCode !== undefined ? (
          <span className={`text-xs ${muted}`}>{`exit code ${exitCode}`}</span>
        ) : null}
      </span>
      {open ? (
        <pre
          data-testid="check-output-text"
          className={`max-h-60 overflow-auto p-2 rounded-md border text-xs whitespace-pre-wrap break-words ${hairline} ${fieldBg} ${strong}`}
        >
          {output}
        </pre>
      ) : null}
    </div>
  );
};

/** The rows: a job's tries and checks, without who asked or what's next. */
export function checkRows(goal) {
  return jobTimeline(goal).filter((r) =>
    ["try", "failed", "passed", "came", "you"].includes(r.type),
  );
}

const Line = ({ icon, iconClass, testId, children }) => (
  <div className="flex flex-row gap-2 items-start" data-testid={testId}>
    <span className={`w-4 flex-shrink-0 text-xs pt-0.5 ${iconClass || ""}`}>
      <FontAwesomeIcon icon={icon} />
    </span>
    <div className="flex-1 min-w-0 flex flex-col gap-1">{children}</div>
  </div>
);

/**
 * What a failed check led to (DASH-122): "Coder was told what failed and
 * tried again", "No tries left, so the job failed", or "" (it came to you:
 * its card says so).
 */
export function failedThenText(row, botName = "The bot") {
  if (!row || row.type !== "failed") return "";
  if (row.then === "back")
    return `${botName} was told what failed and tried again.`;
  if (row.then === "stop") return "No tries left, so the job failed.";
  return "";
}

/**
 * A checks job's rows, short, for a step of a job (the Jobs pages): each
 * try, each check's result with its reason, and what a fail led to.
 * `title`: a heading over them ("Checks").
 */
export const JobCheckRows = ({ goalId, goal: given = null, title = null }) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const { goal: loaded } = useGoal(given ? null : goalId);
  const goal = given || loaded;
  const rows = goal ? checkRows(goal) : [];
  if (!rows.length) return null;
  const botName = jobBot(goal).name;
  // The "You approve" check it waits at (DASH-124): its card is below.
  const yours = youCheckOf(goal);
  return (
    <div className="flex flex-col gap-1.5 pt-1" data-testid="job-step-checks">
      {title ? (
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
        >
          {title}
        </span>
      ) : null}
      {rows.map((r, i) => {
        if (r.type === "try") {
          return (
            <Line key={i} icon="robot" iconClass={muted} testId="check-try">
              <span className={`text-xs ${muted}`}>
                {r.n === 1
                  ? `Try 1 of ${r.of}: its work went to its checks`
                  : `Try ${r.n} of ${r.of}: it tried again`}
              </span>
            </Line>
          );
        }
        if (r.type === "failed") {
          return (
            <Line
              key={i}
              icon="xmark"
              iconClass={status.error.icon}
              testId="check-failed"
            >
              <span className={`text-xs ${strong}`}>
                <span className="font-semibold">{r.name}</span>
                <span className={status.error.text}> failed</span>
                {r.reviewer ? (
                  <span className={muted}>{` · reviewer ${r.reviewer}`}</span>
                ) : null}
              </span>
              {r.reason ? (
                <span className={`text-xs ${muted}`}>{r.reason}</span>
              ) : null}
              {failedThenText(r, botName) ? (
                <span className={`text-xs ${muted}`} data-testid="check-then">
                  {failedThenText(r, botName)}
                </span>
              ) : null}
              <CheckOutput output={r.output} exitCode={r.exitCode} />
            </Line>
          );
        }
        if (r.type === "passed") {
          return (
            <Line
              key={i}
              icon="check"
              iconClass={status.success.icon}
              testId="check-passed"
            >
              {r.names.map((n, j) => (
                <div key={j} className="flex flex-col gap-1">
                  <span className={`text-xs ${strong}`}>
                    <span className="font-semibold">{n.name}</span>
                    <span className={status.success.text}> passed</span>
                    {n.reviewer && n.said ? (
                      <span
                        className={muted}
                      >{` · ${n.reviewer}: "${n.said}"`}</span>
                    ) : null}
                  </span>
                  <CheckOutput output={n.output} />
                </div>
              ))}
            </Line>
          );
        }
        if (r.type === "came") {
          return (
            <Line
              key={i}
              icon="hand"
              iconClass={status.warning.icon}
              testId="check-came"
            >
              <span className={`text-xs ${strong}`}>
                {`It came to you${r.reason ? `: ${r.reason}` : ""}`}
              </span>
            </Line>
          );
        }
        return (
          <Line key={i} icon="user" iconClass={muted} testId="check-you">
            <span className={`text-xs ${muted}`}>
              {r.action === "send-back"
                ? "You sent it back"
                : r.action === "done"
                  ? "You approved it"
                  : r.action === "close"
                    ? "You closed it"
                    : r.action === "one-more-round"
                      ? "You gave it one more try"
                      : r.action === "answer"
                        ? "You answered its question"
                        : "You moved it"}
            </span>
          </Line>
        );
      })}
      {yours ? (
        <Line icon="hand" iconClass={status.warning.icon} testId="check-yours">
          <span className={`text-xs ${strong}`}>
            <span className="font-semibold">{yours.name}</span>
            <span className={status.warning.text}>: waiting on you</span>
          </span>
        </Line>
      ) : null}
    </div>
  );
};

export default JobCheckRows;
