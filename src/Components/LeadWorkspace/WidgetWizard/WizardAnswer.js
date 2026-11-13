import React from "react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/**
 * Where you answer a wizard step: one focused card under the Planner's
 * question (the approved "Wizard steps read like a chat" frames). Its parts
 * are separated by a line, each under a small heading; the step's buttons
 * end it.
 *
 * @param {React.ReactNode} actions  the step's buttons (Next, Back)
 */
export const WizardAnswer = ({ children, actions = null, testId }) => {
  const { hairline } = useConfigTokens();
  return (
    <div
      className={`dr-chat-answer self-start w-full flex flex-col gap-4 rounded-2xl border p-4 ${hairline}`}
      data-testid={testId}
    >
      {children}
      {actions ? <div className="flex flex-row gap-2">{actions}</div> : null}
    </div>
  );
};

/**
 * One part of the answer: a small heading (`title`, with an optional muted
 * `note` after it) and what to choose. All but the `first` have a line above.
 */
export const AnswerPart = ({
  title = null,
  note = null,
  first = false,
  children,
}) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <div
      className={`flex flex-col gap-2 ${first ? "" : `pt-4 border-t ${hairline}`}`}
    >
      {title ? (
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
        >
          {title}
          {note ? (
            <span className="font-normal normal-case tracking-normal">
              {" "}
              — {note}
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
    </div>
  );
};

/**
 * The Planner's question for a step, as its chat bubble: the question, large,
 * and one line on why it's asked.
 */
export const StepQuestion = ({ question, why = null }) => {
  const { muted, strong } = useConfigTokens();
  return (
    <span className="flex flex-col gap-1" data-testid="wizard-question">
      <span className={`text-base font-semibold ${strong}`}>{question}</span>
      {why ? <span className={`text-sm ${muted}`}>{why}</span> : null}
    </span>
  );
};

export default WizardAnswer;
