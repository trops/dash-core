import React, { createContext, useContext, useState } from "react";
import { FontAwesomeIcon } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * What a step's line ends with, when the conversation knows better than
 * the step (the wizard: "found 3 providers for Today's Calendar" — nothing
 * is planned until the user picks). (step) => string | null.
 */
export const StepTailContext = createContext(null);

/**
 * HandoffStep — one hand-off in a lead's conversation (lead-workspace
 * release 2): a quiet line, "Asked Inbox Watch · 2 need attention ▸", that
 * opens to what the bot was asked and what it answered.
 *
 * @param {{ bot, label, request, status, answer?, result? }} step
 */
export const HandoffStep = ({ step }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [open, setOpen] = useState(false);
  const tailFor = useContext(StepTailContext);
  if (!step) return null;
  const said = tailFor ? tailFor(step) : null;
  const asking = step.status === "asking";
  const failed = step.status === "failed";
  const stopped = step.status === "stopped";
  const tail = said
    ? said
    : asking
      ? "asking…"
      : failed
        ? "couldn't answer"
        : stopped
          ? "stopped"
          : // A plan says so, not the Planner's first words (release 3b).
            step.plan
            ? "drafted a plan"
            : step.result || "answered";
  return (
    <div className="flex flex-col gap-1" data-testid="handoff-step">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`self-start flex flex-row items-center gap-2 text-sm text-left ${muted}`}
      >
        <FontAwesomeIcon
          icon={
            asking
              ? "spinner"
              : failed
                ? "circle-exclamation"
                : stopped
                  ? "circle-stop"
                  : "check"
          }
          className={`h-3 w-3 ${asking ? "animate-spin" : ""}`}
        />
        <span>
          <span className={`font-medium ${strong}`}>{step.label}</span>
          {` · ${tail}`}
        </span>
        <FontAwesomeIcon
          icon={open ? "chevron-down" : "chevron-right"}
          className="h-2.5 w-2.5"
        />
      </button>
      {open ? (
        <div
          className={`ml-5 flex flex-col gap-2 border-l pl-3 text-sm ${hairline}`}
          data-testid="handoff-step-detail"
        >
          {step.request ? (
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs ${muted}`}>Asked</span>
              <span className="whitespace-pre-wrap">{step.request}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <span className={`text-xs ${muted}`}>
              {asking ? "Waiting for its answer…" : "Answered"}
            </span>
            {step.answer ? (
              <span className="whitespace-pre-wrap">{step.answer}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HandoffStep;
