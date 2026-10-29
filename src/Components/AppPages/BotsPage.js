import React, { useContext, useEffect, useState } from "react";
import {
  ConfirmationModal,
  FilterMenu,
  SearchInput,
  SegmentedControl,
  StatusBadge,
  Switch,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { STATUS_DOT, groupBotsByTeam, triggerSummary } from "../Bots/teamUtils";
import { BotAvatar } from "../Bots/BotAvatar";
import { useAllBots } from "./useAllBots";
import { DashTeamPage } from "../Bots/DashTeamPage";
import { botHandle } from "./botSummary";
import { ListGroupLabel, ManageLayout, OverflowMenu } from "./ManageLayout";
import { useProfiles } from "../../hooks/useProfiles";
import { SpendingView } from "./SpendingView";
import { AuditLogView } from "./AuditLogView";
import { BotPage } from "../Bots/BotPage";

const UNASSIGNED = "unassigned";
// The Dash team's group key (CRE-011) — listed first, above dashboard teams.
const DASH_TEAM = "dash-team";
const isDashTeamBot = (bot) => !!bot && bot.system === "dash-team";
// The page's views (bot-factory US-019 AC5: spending by bot, dashboard and
// provider; US-003 AC5 / US-014 AC9: the saved audit log).
const PAGE_VIEWS = [
  { value: "bots", label: "Bots" },
  { value: "spending", label: "Spending" },
  { value: "log", label: "Log" },
];
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "Needs approval", label: "Needs approval" },
  { value: "Running", label: "Running" },
  { value: "Paused", label: "Paused" },
];
const teamKey = (group) => group.workspaceId || UNASSIGNED;

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

/**
 * BotsPage — every bot as list + detail (app-navigation PRD NAV-006):
 * grouped by team, with search, a Team filter and status chips; the detail is
 * the bot's page (NAV-016 — conversation, activity, log, spending, settings).
 * A Dash team role shows the Dash team's page (its conversation, to that
 * role, and Settings). It opens on the user's first bot, not the Dash team.
 */
export const BotsPage = ({
  workspaces = [],
  dashApi = null,
  onOpenBotInBotsView = () => {},
  onOpenAppSettings = null,
}) => {
  const { muted, strong, selectedBg, selectedBorder } = useConfigTokens();
  const appContext = useContext(AppContext) || {};
  const botsApi = dashApi && dashApi.bots;
  const all = useAllBots();
  const profiles = useProfiles(appContext.credentials?.appId);
  // A bot being taken out of the active profile (it stays on the computer).
  const [removeTarget, setRemoveTarget] = useState(null);

  const [pageView, setPageView] = useState("bots");
  // The Log's Bot filter — a bot's details open the Log filtered to it.
  const [logBotIds, setLogBotIds] = useState([]);
  const [query, setQuery] = useState("");
  const [teams, setTeams] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
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

  const allGroups = [
    ...(all.dashTeam && all.dashTeam.length
      ? [{ workspaceId: DASH_TEAM, label: "Dash team", bots: all.dashTeam }]
      : []),
    ...groupBotsByTeam(all.bots, workspaces),
  ];
  const q = query.trim().toLowerCase();
  const matches = (bot) => {
    if (statusFilter !== "all" && all.statusOf(bot.id) !== statusFilter) {
      return false;
    }
    if (!q) return true;
    return [bot.name || "", botHandle(bot), rowSubtitle(bot)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  };
  const groups = allGroups
    .filter((g) => !teams.length || teams.includes(teamKey(g)))
    .map((g) => ({ ...g, bots: g.bots.filter(matches) }))
    .filter((g) => g.bots.length);
  const ordered = groups.flatMap((g) => g.bots);
  // A bot with unsaved edits stays shown even if a filter would hide it.
  const pinned =
    pageDirty && selectedId
      ? [...all.bots, ...(all.dashTeam || [])].find(
          (b) => b.id === selectedId,
        ) || null
      : null;
  // Nothing picked yet: the first of the user's own bots (its conversation),
  // else the Dash team.
  const selected =
    ordered.find((b) => b.id === selectedId) ||
    pinned ||
    ordered.find((b) => !isDashTeamBot(b)) ||
    ordered[0] ||
    null;
  const teamOptions = allGroups.map((g) => ({
    value: teamKey(g),
    label: g.label,
    count: g.bots.length,
  }));

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

  let detail;
  if (selected && isDashTeamBot(selected)) {
    // The Dash team's conversation (to this role) and its Settings — the
    // same page as the Bots panel's pinned row. One page for every role:
    // picking another role follows it (and its To: picker moves the list).
    const roleBot = (role) =>
      (all.dashTeam || []).find((b) => b && b.role === role) || null;
    detail = (
      <DashTeamPage
        key="dash-team"
        role={selected.role}
        onRoleChange={(role) => {
          const b = roleBot(role);
          if (b) setSelectedId(b.id);
        }}
        workspaces={workspaces}
        onOpenPlan={(seed) =>
          window.dispatchEvent(
            // Carried on with the Dash Lead (lead-workspace release 3c).
            new CustomEvent("dash:open-workspace", {
              detail: { key: "role:dashlead", seed },
            }),
          )
        }
        onDirtyChange={(dirty) => {
          setPageDirty(dirty);
          if (dirty) setSelectedId(selected.id);
        }}
      />
    );
  } else if (selected) {
    // Everything about the bot in one place (NAV-016).
    detail = (
      <BotPage
        key={selected.id}
        botId={selected.id}
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
                  onClick: () => setRemoveTarget(selected),
                },
              ]}
            />
          ) : null
        }
        onChanged={all.refresh}
        onDirtyChange={(dirty) => {
          setPageDirty(dirty);
          // Pin it: the first bot is shown without being picked.
          if (dirty) setSelectedId(selected.id);
        }}
        onDeleted={() => {
          setPageDirty(false);
          setSelectedId(null);
          all.refresh();
        }}
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

  return (
    <ManageLayout
      testId="bots-page"
      listLabel="Bots"
      detailTestId="bot-detail"
      // A bot's page (or the Dash team's) fills the pane and scrolls itself;
      // the "no bots" line fits its content.
      detailFlush={!!selected}
      detailFit={!selected}
      toolbar={
        <>
          {viewSwitch}
          <div className="w-72">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search bots…"
            />
          </div>
          <FilterMenu
            label="Team"
            options={teamOptions}
            selected={teams}
            onChange={setTeams}
          />
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
          {groups.map((g) => (
            <div key={teamKey(g)} className="flex flex-col gap-0.5">
              <ListGroupLabel text={g.label} />
              {g.bots.map((bot) => {
                const active = selected && bot.id === selected.id;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      if (bot.id === (selected && selected.id)) return;
                      guard(() => setSelectedId(bot.id));
                    }}
                    className={`w-full text-left rounded-lg px-2 py-2 border flex flex-row items-center gap-3 ${
                      active
                        ? `${selectedBg} ${selectedBorder}`
                        : "border-transparent"
                    }`}
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
                        {bot.role === "lead" ? (
                          <StatusBadge state="neutral" label="Lead" />
                        ) : null}
                      </span>
                      <span className={`text-xs truncate ${muted}`}>
                        {rowSubtitle(bot)}
                      </span>
                    </span>
                    <StatusLabel status={all.statusOf(bot.id)} muted={muted} />
                  </button>
                );
              })}
            </div>
          ))}
          {!ordered.length ? (
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
          setSelectedId(null);
          all.refresh();
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </ManageLayout>
  );
};

export default BotsPage;
