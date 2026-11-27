import React, { useEffect, useRef } from "react";
import { Button, Button3, Table } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "../Bots/BotAvatar";
import { DASH_TEAM_CONTACT } from "../Bots/dashTeamContact";
import { triggerSummary } from "../Bots/teamUtils";
import { TeamSettingsPanel } from "../Bots/TeamSettingsForm";
import { TeamJobSettings } from "../Bots/TeamJobSettings";
import { TeamChecksPanel } from "../Bots/TeamChecksPanel";
import { TeamSetupBadge, TeamSetupBanner } from "../Bots/TeamSetupBanner";
import { TeamNeedsYouCards } from "../Jobs/NeedsYouCards";

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
 * @param {object[]} [approvals]  pending tool approvals (else read live)
 * @param {(botId) => void} onPickBot
 * @param {() => void} onOpenConversation
 * @param {(workspace) => void} [onOpenDashboard]
 * @param {() => void} [onDashTeamSettings]
 * @param {object|null} [setup]  the team's setup status when it isn't ready
 *   (teamSetupStatus, DASH-119): a badge by its name and a banner on top
 * @param {*} [setupFocus]  a new value scrolls to the team's setup
 *   sections (Team setup from the Bots view, a fresh install; DASH-118)
 * @param {(botId) => void} [onOpenBotSettings]  "Finish setup ›": a bot's
 *   Settings tab
 */
export const TeamOverview = ({
  team,
  statusOf = () => "Idle",
  spentOf = () => "",
  approvals = null,
  onPickBot = () => {},
  onOpenConversation = () => {},
  onOpenDashboard = null,
  onDashTeamSettings = null,
  setup = null,
  onOpenBotSettings = null,
  setupFocus = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  // Team setup (DASH-118): its sections in view. A team that isn't set up
  // starts at the top instead, where its banner says what's missing.
  const setupRef = useRef(null);
  const setupReady = !setup || setup.ready !== false;
  useEffect(() => {
    if (setupFocus == null || !setupReady) return;
    const el = setupRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupFocus]);
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
          <span className="flex flex-row items-center gap-2 min-w-0">
            <h3 className="text-lg font-semibold truncate">{title}</h3>
            <TeamSetupBadge status={setup} />
          </span>
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
      {/* The scroll area holds one column that isn't squeezed: as flex items
          of a fixed-height box, bordered boxes (overflow-hidden) shrank to
          nothing once the page was taller than the window (DASH-105). */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        data-testid="team-overview-scroll"
      >
        <div className="flex flex-col gap-4">
          {/* Not set up yet (DASH-119): what each bot needs, and the first
              one's Settings. */}
          <TeamSetupBanner
            status={setup}
            onFinish={
              onOpenBotSettings
                ? (first) => onOpenBotSettings(first.botId)
                : null
            }
          />
          {/* What needs you, as cards with their buttons (DASH-124):
              answered here, never "in the conversation". */}
          {isEmpty ? null : (
            <TeamNeedsYouCards
              workspaceId={team.workspace ? team.workspace.id : null}
              bots={[...(lead ? [lead] : []), ...(team.allMembers || [])]}
              approvals={approvals}
              testId="team-needs"
            />
          )}
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
          {/* The team's setup (Team setup lands here, DASH-118). */}
          {team.kind === "team" && team.workspace ? (
            <div
              ref={setupRef}
              data-testid="team-setup"
              className="flex flex-col gap-4"
            >
              {/* One job at a time (DASH-81): a team's, whatever its bots. */}
              <TeamJobSettings workspaceId={team.workspace.id} />
              <TeamChecksPanel workspaceId={team.workspace.id} />
              {/* Its settings (DASH-57), when its bots declare some. */}
              <TeamSettingsPanel
                key={String(team.workspace.id)}
                workspaceId={team.workspace.id}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default TeamOverview;
