import React from "react";
import {
  Button,
  SectionLabel,
  EmptyState,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { useTeamBots } from "../Bots/useTeamBots";
import { STATUS_DOT, triggerSummary } from "../Bots/teamUtils";
import { useConfigTokens } from "./ConfigListRow";

/** A bot's status as the Bots view shows it: a coloured dot + text. */
const StatusDot = ({ status, muted }) => {
  const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
  return (
    <span
      data-testid="bot-status"
      className={`flex flex-row items-center gap-1.5 text-xs flex-shrink-0 ${muted}`}
    >
      <span
        data-testid="bot-status-dot"
        className={`inline-block h-2 w-2 rounded-full ${dot}`}
      />
      {status}
    </span>
  );
};

/**
 * BotsTab — Dashboard Config › Bots: a read-only summary of this dashboard's
 * team (bot-teams PRD TEAM-011). Managing bots — adding, editing, talking to
 * them — happens in the Bots view; "Open in Bots view" goes there.
 */
export const BotsTab = ({ workspace, onOpenBotsView = null }) => {
  const team = useTeamBots(workspace ? workspace.id : null);
  const { lead, members, attention, loading } = team;
  const { muted, hairline } = useConfigTokens();
  const card = `rounded-lg border px-3 py-2 flex flex-row items-center justify-between gap-3 ${hairline}`;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <SectionLabel text="This dashboard's team" />
          <span className={`text-xs ${muted}`}>
            {[
              `${members.length} bot${members.length === 1 ? "" : "s"}`,
              lead ? `led by ${lead.name}` : "no team lead",
              attention > 0
                ? `${attention} need${attention === 1 ? "s" : ""} attention`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {onOpenBotsView ? (
          <Button
            title="Open in Bots view"
            size="sm"
            onClick={onOpenBotsView}
          />
        ) : null}
      </div>

      {lead ? (
        <div className={card}>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex flex-row items-center gap-2 text-sm">
              <span className="font-medium truncate">{lead.name}</span>
              <span
                className={`text-xs uppercase tracking-wider font-semibold ${muted}`}
              >
                Lead
              </span>
            </div>
            <span className={`text-xs truncate ${muted}`}>
              Answers questions about this team
            </span>
          </div>
          <StatusDot status={team.statusOf(lead.id)} muted={muted} />
        </div>
      ) : null}

      {!loading && !members.length ? (
        <EmptyState
          icon={<FontAwesomeIcon icon="robot" className="h-8 w-8 opacity-50" />}
          title="No bots on this dashboard yet"
          description="Add bots, talk to them and change their settings in the Bots view."
        />
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto min-h-0">
          {members.map((bot) => (
            <div key={bot.id} className={card}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium truncate">{bot.name}</span>
                <span className={`text-xs truncate ${muted}`}>
                  {triggerSummary(bot)}
                </span>
              </div>
              <StatusDot status={team.statusOf(bot.id)} muted={muted} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
