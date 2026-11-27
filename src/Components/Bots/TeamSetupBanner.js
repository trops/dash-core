import React from "react";
import { Button, StatusBadge, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { setupSentence } from "../../utils/teamSetupStatus";

/**
 * A team's setup, shown until it's ready (DASH-119, mockups 1 and 2).
 *
 * TeamSetupBadge: "Setup · 2 bots need you" beside the team's name (the
 * Bots view header, the team page). `compact` shows the short form
 * ("Setup · 2") with the full text as its tooltip, for a tree row.
 *
 * TeamSetupBanner: "This team can't take work yet", the bots and what each
 * needs, and "Finish setup ›", which opens the first bot's Settings tab
 * (`onFinish(first)`, first = { botId, name }). A ready team with an
 * untested change (DASH-121) shows only the badge ("Setup · untested
 * change"), with what changed as its tooltip. When no one bot needs
 * anything (only Check setup's other problems), first is null and the
 * button shows only with `finishWithoutBot` (somewhere else to go).
 */
export const TeamSetupBadge = ({ status, compact = false }) => {
  // Ready but changed since its last self-test (DASH-121): still a badge.
  if (!status || !status.badge || (status.ready && !status.untested))
    return null;
  return (
    <span
      className="flex-shrink-0"
      title={
        status.ready && status.untested
          ? `Untested change: ${status.untested}. Run a self-test.`
          : status.badge
      }
      data-testid="team-setup-badge"
    >
      <StatusBadge
        state="warning"
        label={compact ? status.short : status.badge}
      />
    </span>
  );
};

export const TeamSetupBanner = ({
  status,
  onFinish = null,
  finishWithoutBot = false,
}) => {
  const { muted, strong } = useConfigTokens();
  const statusTokens = useStatusTokens();
  if (!status || status.ready) return null;
  return (
    <div
      role="status"
      data-testid="team-setup-banner"
      className={`flex flex-row flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${statusTokens.warning.border}`}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={`text-sm font-semibold ${strong}`}>
          This team can't take work yet
        </span>
        <span className={`text-xs ${muted}`}>{setupSentence(status)}</span>
      </div>
      {onFinish && (status.first || finishWithoutBot) ? (
        <Button
          title="Finish setup ›"
          size="sm"
          onClick={() => onFinish(status.first)}
        />
      ) : null}
    </div>
  );
};

export default TeamSetupBanner;
