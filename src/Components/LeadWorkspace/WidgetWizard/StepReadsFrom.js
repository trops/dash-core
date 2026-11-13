import React from "react";
import { ChatMessage } from "@trops/dash-react";
import { useKnownProviders } from "../../../hooks/useKnownProviders";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { ProviderPick } from "../../Create/ProviderPick";
import { providerPickRows } from "../../Create/planChecklist";
import { reasonFor, widgetLabel } from "./widgetSpec";
import { StepQuestion, WizardAnswer } from "./WizardAnswer";

/**
 * Step 1 · Reads from (the approved "Pick the provider" frames 1–3): the
 * user's providers that can serve the widget — found by the app from
 * providers.json, never the AI's pick — nothing ticked, a Claude connector
 * shown off with why, the rest one tap away. Nothing is planned or built
 * until the user picks.
 *
 * @param {object} piece   the widget
 * @param {object} reads   readsFromStep(piece, …)
 * @param {(rows) => void} onUse
 */
export const StepReadsFrom = ({
  piece,
  reads,
  onUse,
  readOnly = false,
  // The Planner's own words on each (its question's reasons).
  reasons: given = null,
}) => {
  // providers.json + what the app loaded: never empty by mistake.
  const known = useKnownProviders();
  const { muted } = useConfigTokens();
  const reasons = {};
  for (const n of reads.candidates) {
    reasons[n] =
      (given && typeof given[n] === "string" && given[n]) ||
      reasonFor(n, reads.kinds, known);
  }
  const rows = providerPickRows(known, reads.candidates, { reasons });
  const name = widgetLabel(piece);
  // Only what a widget can use counts (a Claude connector shows, off).
  const n = reads.usable.length;
  // A question from the Planner, like the steps after it.
  return (
    <ChatMessage
      role="reply"
      label="Planner"
      meta="Step 1 of 5"
      testId="wizard-reads-from"
      footer={
        <WizardAnswer>
          {reads.none ? (
            <span className={`text-sm ${muted}`}>
              Add one on the Providers page, then ask again — this conversation
              keeps your place.
            </span>
          ) : (
            <ProviderPick rows={rows} onUse={onUse} readOnly={readOnly} />
          )}
        </WizardAnswer>
      }
    >
      <StepQuestion
        question={
          reads.none
            ? `None of your providers can give ${name} what it needs yet.`
            : `Where should ${name} read from?`
        }
        why={
          reads.none
            ? null
            : n === 1
              ? `One of your providers can do this. Should ${name} read from it?`
              : `${n} of your providers can do this. Which should ${name} read from? Pick one, or more than one to see them together in one list.`
        }
      />
    </ChatMessage>
  );
};
