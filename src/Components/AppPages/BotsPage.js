import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  ConfirmationModal,
  FontAwesomeIcon,
  SearchInput,
  SegmentedControl,
  StatusBadge,
  Switch,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { STATUS_DOT, triggerSummary } from "../Bots/teamUtils";
import { BotAvatar } from "../Bots/BotAvatar";
import { DASH_TEAM_CONTACT } from "../Bots/dashTeamContact";
import { useSpending } from "../Bots/useSpending";
import { money } from "../Bots/spendingText";
import { useAllBots } from "./useAllBots";
import { DashTeamPage } from "../Bots/DashTeamPage";
import { ManageLayout, OverflowMenu } from "./ManageLayout";
import { TeamOverview } from "./TeamOverview";
import { DASH_KEY, EMPTY_KEY, botsTree, treeNeeds } from "./botsTree";
import { useProfiles } from "../../hooks/useProfiles";
import { SpendingView } from "./SpendingView";
import { AuditLogView } from "./AuditLogView";
import { BotPage } from "../Bots/BotPage";

const isDashTeamBot = (bot) => !!bot && bot.system === "dash-team";
// The page's views (bot-factory US-019 AC5: spending by bot, dashboard and
// provider; US-003 AC5 / US-014 AC9: the saved audit log).
const PAGE_VIEWS = [
  { value: "bots", label: "Bots" },
  { value: "spending", label: "Spending" },
  { value: "log", label: "Log" },
];
// What the tree shows (frame 23).
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
];
const openWorkspace = (key) =>
  window.dispatchEvent(
    new CustomEvent("dash:open-workspace", { detail: { key } }),
  );

// Under a bot's name in the list: a Dash team role's job, else how it starts.
const rowSubtitle = (bot) =>
  isDashTeamBot(bot) ? bot.summary || "" : triggerSummary(bot);

const StatusLabel = ({ status, muted }) => {
  const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
  return (
    <span
      className={`flex flex-row items-center gap-1.5 text-xs flex-shrink-0 ${muted}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {status}
    </span>
  );
};

/** A team row's or a bot row's avatar, small. */
const TeamIcon = ({ team }) =>
  team.kind === "dash" ? (
    <BotAvatar bot={DASH_TEAM_CONTACT} icon="people-group" />
  ) : (
    <BotAvatar
      bot={team.lead || { name: team.name }}
      icon={team.kind === "team" ? "robot" : "folder"}
    />
  );

/**
 * BotsPage — managing bots, teams first (lead-workspace release 5, frames
 * 14, 15, 23–26): the Dash team, each dashboard's team (its lead, then its
 * bots), "Dashboards with no bots" folded into one group, and bots on no
 * dashboard; what needs the user on top. A team shows its overview (Open
 * conversation with its lead, Open dashboard, its bots); a bot shows its
 * page without a conversation — leads and bots on no dashboard have Open
 * conversation, the rest are talked to through their lead.
 */
export const BotsPage = ({
  workspaces = [],
  dashApi = null,
  onOpenBotInBotsView = () => {},
  onOpenAppSettings = null,
  onOpenWorkspace = null,
}) => {
  const { muted, strong, selectedBg, selectedBorder } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const appContext = useContext(AppContext) || {};
  const botsApi = dashApi && dashApi.bots;
  const all = useAllBots();
  const { summary } = useSpending();
  const profiles = useProfiles(appContext.credentials?.appId);
  // A bot being taken out of the active profile (it stays on the computer).
  const [removeTarget, setRemoveTarget] = useState(null);

  const [pageView, setPageView] = useState("bots");
  // The Log's Bot filter — a bot's details open the Log filtered to it.
  const [logBotIds, setLogBotIds] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // "team:<key>" | "bot:<id>"; null = the first team that needs the user.
  const [selected, setSelected] = useState(null);
  // The user's open/closed teams.
  const [openTeams, setOpenTeams] = useState({});
  // The Dash team's Settings, from its overview.
  const [dashSettings, setDashSettings] = useState(false);
  // The bot page has unsaved Settings edits: leaving it asks first.
  const [pageDirty, setPageDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(null);
  // Global switch: give every dashboard an idle team lead (TEAM-002).
  const [autoLeads, setAutoLeads] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!botsApi || typeof botsApi.getSettings !== "function") return undefined;
    Promise.resolve(botsApi.getSettings())
      .then((s) => {
        if (alive) setAutoLeads(!(s && s.autoLeads === false));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botsApi]);

  const toggleAutoLeads = async (next) => {
    setAutoLeads(next);
    try {
      await botsApi.setSettings({ autoLeads: next });
    } catch (_e) {
      setAutoLeads(!next);
    }
  };

  const dashTeam = all.dashTeam || [];
  const needs = useMemo(
    () =>
      treeNeeds({
        approvals: all.approvals,
        bots: all.bots,
        dashTeam,
        workspaces,
      }),
    [all.approvals, all.bots, dashTeam, workspaces],
  );
  // Nothing picked yet: the first team that needs the user, else the first
  // dashboard's team, else the first.
  const fullTree = botsTree({
    bots: all.bots,
    dashTeam,
    workspaces,
    statusOf: all.statusOf,
  });
  // A pick that's gone (deleted elsewhere, its team folded away) falls
  // back to the default.
  const exists = (key) =>
    !!key &&
    (key.startsWith("bot:")
      ? [...all.bots, ...dashTeam].some((b) => `bot:${b.id}` === key)
      : fullTree.some((t) => t.key === key));
  const current =
    (exists(selected) && selected) ||
    (
      fullTree.find((t) => t.needs > 0) ||
      fullTree.find((t) => t.kind === "team") ||
      fullTree[0] || { key: null }
    ).key;
  const teams = botsTree({
    bots: all.bots,
    dashTeam,
    workspaces,
    statusOf: all.statusOf,
    query,
    filter: statusFilter,
    open: openTeams,
    selected: current,
  });

  const selBotId =
    current && current.startsWith("bot:") ? current.slice(4) : null;
  const selBot = selBotId
    ? [...all.bots, ...dashTeam].find((b) => String(b.id) === selBotId) || null
    : null;
  const selTeam =
    current && current.startsWith("team:")
      ? fullTree.find((t) => t.key === current) || null
      : null;
  const spentOf = (id) => {
    const row = ((summary && summary.bots) || []).find((b) => b.id === id);
    return money(row ? row.usd : 0);
  };

  // Leaving a bot page with unsaved edits asks first (NAV-016 AC3).
  function guard(leave) {
    if (pageDirty) setPendingLeave(() => leave);
    else leave();
  }
  function discardAndLeave() {
    const leave = pendingLeave;
    setPendingLeave(null);
    setPageDirty(false);
    if (leave) leave();
  }
  const pick = (key) =>
    guard(() => {
      setDashSettings(false);
      setSelected(key);
    });
  // A team row: picks it and opens or closes it (frame 23's Play).
  const pickTeam = (team) =>
    guard(() => {
      setDashSettings(false);
      setSelected(team.key);
      setOpenTeams((o) => ({ ...o, [team.key]: !team.open }));
    });
  // A bot inside a closed team (from Needs you, or a team's table): its
  // team opens too.
  const pickBot = (botId, teamKey) =>
    guard(() => {
      setDashSettings(false);
      setSelected(`bot:${botId}`);
      if (teamKey) setOpenTeams((o) => ({ ...o, [teamKey]: true }));
    });

  let detail;
  if (dashSettings || (selBot && isDashTeamBot(selBot))) {
    detail = (
      <DashTeamPage
        key={dashSettings ? "dash-settings" : `dash-${selBot.role}`}
        // The team's Settings: no role, so the Dash team's own header.
        role={dashSettings ? null : selBot.role}
        initialTab={dashSettings ? "settings" : "activity"}
        workspaces={workspaces}
        onDirtyChange={setPageDirty}
      />
    );
  } else if (selBot) {
    // Management only (frames 14, 15, 24).
    detail = (
      <BotPage
        key={selBot.id}
        botId={selBot.id}
        initialTab="activity"
        workspaces={workspaces}
        onOpenInBotsView={onOpenBotInBotsView}
        onOpenSettings={onOpenAppSettings}
        actions={
          profiles.hasProfiles ? (
            <OverflowMenu
              items={[
                {
                  label: `Remove from ${profiles.active?.name || "this profile"}`,
                  icon: "circle-minus",
                  onClick: () => setRemoveTarget(selBot),
                },
              ]}
            />
          ) : null
        }
        onChanged={all.refresh}
        onDirtyChange={setPageDirty}
        onDeleted={() => {
          setPageDirty(false);
          setSelected(null);
          all.refresh();
        }}
      />
    );
  } else if (selTeam) {
    detail = (
      <TeamOverview
        team={selTeam}
        statusOf={all.statusOf}
        spentOf={spentOf}
        need={needs.find((n) => n.teamKey === selTeam.key) || null}
        onPickBot={(id) => pickBot(id, selTeam.key)}
        onOpenConversation={() =>
          openWorkspace(
            selTeam.kind === "dash"
              ? "role:dashlead"
              : `lead:${selTeam.lead && selTeam.lead.id}`,
          )
        }
        onOpenDashboard={onOpenWorkspace}
        onDashTeamSettings={
          selTeam.kind === "dash" ? () => setDashSettings(true) : null
        }
      />
    );
  } else {
    detail = (
      <span className={`text-sm ${muted}`}>
        {all.bots.length
          ? "No bots match these filters."
          : "No bots yet. Create one to delegate recurring work."}
      </span>
    );
  }

  const viewSwitch = (
    <SegmentedControl
      ariaLabel="Show"
      options={PAGE_VIEWS}
      value={pageView}
      onChange={(v) => guard(() => setPageView(v))}
    />
  );

  if (pageView === "spending") {
    return (
      <div
        data-testid="bots-page"
        className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
      >
        <div className="flex-shrink-0 flex flex-row items-center gap-2">
          {viewSwitch}
        </div>
        <SpendingView />
      </div>
    );
  }

  if (pageView === "log") {
    return (
      <div
        data-testid="bots-page"
        className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
      >
        <div className="flex-shrink-0 flex flex-row items-center gap-2">
          {viewSwitch}
        </div>
        <AuditLogView
          bots={all.bots}
          botIds={logBotIds}
          onBotIdsChange={setLogBotIds}
        />
      </div>
    );
  }

  const rowClass = (active, indent) =>
    `w-full text-left rounded-lg ${indent ? "pl-8 pr-2" : "px-2"} py-2 border flex flex-row items-center gap-3 ${
      active ? `${selectedBg} ${selectedBorder}` : "border-transparent"
    }`;
  const botRow = (bot, team, { isLead = false, sub = null } = {}) => {
    const key = `bot:${bot.id}`;
    const active = current === key && !dashSettings;
    return (
      <button
        key={key}
        type="button"
        data-testid="bots-tree-bot"
        aria-current={active ? "true" : undefined}
        onClick={() => {
          if (!active) pick(key);
        }}
        className={rowClass(active, true)}
      >
        <BotAvatar bot={bot} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="flex flex-row items-center gap-2 min-w-0">
            <span
              data-name
              className={`text-sm font-medium truncate ${strong}`}
            >
              {bot.name || "Untitled bot"}
            </span>
            {isLead ? <StatusBadge state="neutral" label="Lead" /> : null}
          </span>
          <span className={`text-xs truncate ${muted}`}>
            {sub || rowSubtitle(bot)}
          </span>
        </span>
        <StatusLabel status={all.statusOf(bot.id)} muted={muted} />
      </button>
    );
  };

  return (
    <ManageLayout
      testId="bots-page"
      listLabel="Teams and bots"
      detailTestId="bot-detail"
      // A bot's page, or a team's overview, fills the pane and scrolls
      // itself; the "no bots" line fits its content.
      detailFlush={!!(selBot || selTeam || dashSettings)}
      detailFit={!(selBot || selTeam || dashSettings)}
      toolbar={
        <>
          {viewSwitch}
          <div className="w-72">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search bots and teams…"
            />
          </div>
          <SegmentedControl
            ariaLabel="Status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </>
      }
      // A setting, not a filter: it sits under the list, not in the toolbar.
      listFooter={
        autoLeads !== null ? (
          <div className="flex flex-col gap-1" data-testid="auto-leads-setting">
            <Switch
              label="Create team leads automatically"
              checked={autoLeads}
              onChange={toggleAutoLeads}
            />
            <span className={`text-xs ${muted}`}>
              Every dashboard gets an idle lead that plans work for its bots.
            </span>
          </div>
        ) : null
      }
      list={
        <>
          {/* What needs the user, on top (frame 23). */}
          {needs.length && !query.trim() && statusFilter === "all" ? (
            <div
              data-testid="bots-tree-needs"
              className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${statusTokens.warning.border}`}
            >
              <span
                className={`text-xs font-semibold ${statusTokens.warning.icon}`}
              >
                Needs you
              </span>
              {needs.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => pickBot(n.botId, n.teamKey)}
                  className={`text-left text-sm ${strong}`}
                >
                  {n.text}
                  {n.where ? (
                    <span className={muted}>{` · ${n.where}`}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {teams.map((team) => {
            const active = current === team.key && !dashSettings;
            return (
              <div
                key={team.key}
                className="flex flex-col gap-0.5"
                data-testid="bots-tree-team"
              >
                <button
                  type="button"
                  aria-expanded={team.open}
                  aria-current={active ? "true" : undefined}
                  onClick={() => pickTeam(team)}
                  className={rowClass(active, false)}
                >
                  <span className={`w-3 flex-shrink-0 text-xs ${muted}`}>
                    <FontAwesomeIcon
                      icon={team.open ? "chevron-down" : "chevron-right"}
                    />
                  </span>
                  <TeamIcon team={team} />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span
                      data-name
                      className={`text-sm font-semibold truncate ${strong}`}
                    >
                      {team.name}
                    </span>
                    <span className={`text-xs truncate ${muted}`}>
                      {team.sub}
                    </span>
                  </span>
                  {team.needs ? (
                    <StatusBadge
                      state="warning"
                      label={`${team.needs} need${team.needs === 1 ? "s" : ""} you`}
                    />
                  ) : team.running ? (
                    <StatusBadge
                      state="success"
                      label={`${team.running} running`}
                    />
                  ) : null}
                </button>
                {team.open && team.kind === "empty"
                  ? team.dashboards.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        data-testid="bots-tree-bot"
                        onClick={() => pick(EMPTY_KEY)}
                        className={rowClass(false, true)}
                      >
                        <BotAvatar bot={d.lead || { name: d.name }} />
                        <span className="flex-1 min-w-0 flex flex-col">
                          <span className="flex flex-row items-center gap-2 min-w-0">
                            <span
                              data-name
                              className={`text-sm font-medium truncate ${strong}`}
                            >
                              {d.lead ? d.lead.name : d.name}
                            </span>
                            {d.lead ? (
                              <StatusBadge state="neutral" label="Lead" />
                            ) : null}
                          </span>
                          <span className={`text-xs truncate ${muted}`}>
                            {`${d.name} · no bots yet`}
                          </span>
                        </span>
                        {d.lead ? (
                          <StatusLabel
                            status={all.statusOf(d.lead.id)}
                            muted={muted}
                          />
                        ) : null}
                      </button>
                    ))
                  : null}
                {team.open && team.kind !== "empty" ? (
                  <>
                    {team.lead
                      ? botRow(team.lead, team, {
                          isLead: true,
                          sub: "Lead · talks to you for this team",
                        })
                      : null}
                    {team.members.map((b) => botRow(b, team))}
                  </>
                ) : null}
              </div>
            );
          })}
          {!teams.length ? (
            <span className={`text-sm px-2 ${muted}`}>No bots match.</span>
          ) : null}
        </>
      }
      detail={detail}
    >
      <ConfirmationModal
        isOpen={!!pendingLeave}
        setIsOpen={() => setPendingLeave(null)}
        title="Discard unsaved changes?"
        message="Your changes to this bot haven't been saved."
        confirmLabel="Discard"
        variant="danger"
        onConfirm={discardAndLeave}
        onCancel={() => setPendingLeave(null)}
      />
      <ConfirmationModal
        isOpen={!!removeTarget}
        setIsOpen={() => setRemoveTarget(null)}
        title={`Remove "${removeTarget?.name || "bot"}" from ${
          profiles.active?.name || "this profile"
        }`}
        message={(() => {
          if (!removeTarget) return "";
          const elsewhere = profiles.otherHolders("bots", removeTarget.id);
          return elsewhere.length
            ? `"${removeTarget.name}" stays in ${elsewhere.join(", ")} and stops running here.`
            : `"${removeTarget.name}" isn't in any other profile, so it won't run or show anywhere. It stays on this computer — add it back in Settings › Profiles.`;
        })()}
        confirmLabel="Remove"
        onConfirm={async () => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (!target) return;
          const res = await profiles.removeFromActive("bots", target.id);
          if (!res.success) {
            window.dispatchEvent(
              new CustomEvent("dash:notify", {
                detail: {
                  type: "error",
                  title: "Couldn't remove the bot from this profile",
                  message: res.error || "Try again.",
                  duration: 8000,
                },
              }),
            );
            return;
          }
          setSelected(null);
          all.refresh();
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </ManageLayout>
  );
};

export default BotsPage;
