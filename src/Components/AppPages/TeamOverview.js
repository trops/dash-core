import React, { useContext } from "react";
import {
  Button,
  Button3,
  Table,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "../Bots/BotAvatar";
import { DASH_TEAM_CONTACT } from "../Bots/dashTeamContact";
import { triggerSummary } from "../Bots/teamUtils";

const howItRuns = (bot) =>
  bot && bot.system === "dash-team" ? bot.summary || "" : triggerSummary(bot);

/**
 * TeamOverview — a picked team on the Bots page (lead-workspace release 5,
 * frames 23 and 26): who leads it, Open conversation (with its lead) and
 * Open dashboard, what needs the user, and its bots — how each runs, its
 * status and this month's spending. A row opens that bot. "Dashboards with
 * no bots" lists those dashboards instead.
 *
 * @param {object} team  a botsTree() team
 * @param {(id) => string} statusOf
 * @param {(id) => string} spentOf   this month, e.g. "$1.20"
 * @param {object|null} need         the first waiting approval on the team
 * @param {(botId) => void} onPickBot
 * @param {() => void} onOpenConversation
 * @param {(workspace) => void} [onOpenDashboard]
 * @param {() => void} [onDashTeamSettings]
 */
export const TeamOverview = ({
  team,
  statusOf = () => "Idle",
  spentOf = () => "",
  need = null,
  onPickBot = () => {},
  onOpenConversation = () => {},
  onOpenDashboard = null,
  onDashTeamSettings = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const link = `${(currentTheme && currentTheme["text-primary-medium"]) || ""} dr-role-accent`;
  const statusTokens = useStatusTokens();
  if (!team) return null;
  const isEmpty = team.kind === "empty";
  const isDash = team.kind === "dash";
  const lead = team.lead;

  const title = isEmpty ? "Dashboards with no bots" : team.name;
  const line = isEmpty
    ? `${team.dashboards.length} dashboard${team.dashboards.length === 1 ? "" : "s"} · each has a lead, ready when you add a bot`
    : team.kind === "lone"
      ? `${team.allMembers.length} bot${team.allMembers.length === 1 ? "" : "s"} · you talk to each directly`
      : `${team.allMembers.length} bot${team.allMembers.length === 1 ? "" : "s"}${lead ? ` · lead: ${lead.name}` : ""}`;

  const nameCell = (label, onClick) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`text-left text-sm font-medium ${strong}`}
    >
      {label}
    </button>
  );
  const columns = isEmpty
    ? [
        { key: "name", label: "Dashboard" },
        { key: "runs", label: "Bots" },
        { key: "status", label: "Status" },
        { key: "cost", label: "This month" },
      ]
    : [
        {
          key: "name",
          label: "Bot",
          render: (v, row) => nameCell(v, () => onPickBot(row.id)),
        },
        { key: "runs", label: "How it runs" },
        { key: "status", label: "Status" },
        { key: "cost", label: "This month" },
      ];
  const data = isEmpty
    ? team.dashboards.map((d) => ({
        id: d.id,
        name: d.name,
        runs: "No bots yet",
        status: d.lead ? "Lead idle" : "No lead",
        cost: "$0",
      }))
    : team.allMembers.map((b) => ({
        id: b.id,
        name: b.name || "Untitled bot",
        runs: howItRuns(b),
        status: statusOf(b.id),
        cost: spentOf(b.id),
      }));

  const note = isEmpty
    ? "Add a bot to one of these from its dashboard, or turn off “Create team leads automatically” under the list to stop new dashboards getting a lead."
    : team.kind === "lone"
      ? "Pick a bot for its activity, log, spending and settings. Open conversation is on its page."
      : `Talk to this team through ${lead ? lead.name : "its lead"} — Open conversation. Pick a bot for its activity, log, spending and settings.`;

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${strong}`}
      data-testid="team-overview"
    >
      <div
        className={`flex-shrink-0 flex flex-row items-center gap-3 px-5 pt-4 pb-3 border-b ${hairline}`}
      >
        <BotAvatar
          bot={isDash ? DASH_TEAM_CONTACT : lead || { name: title }}
          icon={isDash ? "people-group" : undefined}
          large
        />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h3 className="text-lg font-semibold truncate">{title}</h3>
          <span className={`text-xs ${muted}`}>{line}</span>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2 flex-shrink-0">
          {lead ? (
            <Button
              title="Open conversation"
              size="sm"
              onClick={onOpenConversation}
            />
          ) : null}
          {team.workspace && onOpenDashboard ? (
            <Button3
              title="Open dashboard"
              size="sm"
              onClick={() => onOpenDashboard(team.workspace)}
            />
          ) : null}
          {isDash && onDashTeamSettings ? (
            <Button3
              title="Dash team settings"
              size="sm"
              onClick={onDashTeamSettings}
            />
          ) : null}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {need ? (
          <div
            data-testid="team-needs"
            className={`flex flex-row flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${statusTokens.warning.border}`}
          >
            <span className="flex-1 min-w-0 text-sm">{need.text}.</span>
            {lead ? (
              <button
                type="button"
                onClick={onOpenConversation}
                className={`text-sm ${link}`}
              >
                Answer in the conversation ›
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPickBot(need.botId)}
                className={`text-sm ${link}`}
              >
                Answer on its page ›
              </button>
            )}
          </div>
        ) : null}
        <span className="text-sm font-semibold">
          {isEmpty ? "Dashboards" : "Bots on this team"}
        </span>
        <Table
          columns={columns}
          data={data}
          sortable={false}
          compact
          onRowClick={isEmpty ? null : (row) => onPickBot(row.id)}
        />
        <span className={`text-xs ${muted}`}>{note}</span>
      </div>
    </div>
  );
};

export default TeamOverview;
