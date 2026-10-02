import React from "react";
import {
  Button,
  Tag,
  SectionLabel,
  EmptyState,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { useTeamBots } from "../Bots/useTeamBots";
import { triggerSummary } from "../Bots/teamUtils";

/**
 * BotsTab — Dashboard Config › Bots: a read-only summary of this dashboard's
 * team (bot-teams PRD TEAM-011). Managing bots — adding, editing, talking to
 * them — happens in the Bots view; "Open in Bots view" goes there.
 */
export const BotsTab = ({ workspace, onOpenBotsView = null }) => {
  const team = useTeamBots(workspace ? workspace.id : null);
  const { lead, members, attention, loading } = team;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <SectionLabel text="This dashboard's team" />
          <span className="text-xs opacity-60">
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
        <div className="flex flex-row items-center gap-2 text-sm">
          <span className="font-medium">{lead.name}</span>
          <Tag text="Lead" />
        </div>
      ) : null}

      {!loading && !members.length ? (
        <EmptyState
          icon={<FontAwesomeIcon icon="robot" className="h-8 w-8 opacity-50" />}
          title="No bots on this dashboard yet"
          description="Add bots, talk to them and change their settings in the Bots view."
        />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
          {members.map((bot) => (
            <div
              key={bot.id}
              className="flex flex-row items-center justify-between gap-3 py-2 border-b"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-sm font-medium truncate">{bot.name}</span>
                <span className="text-xs opacity-60">
                  {triggerSummary(bot)}
                </span>
              </div>
              <Tag text={team.statusOf(bot.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
