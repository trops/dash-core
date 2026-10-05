import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  ConfirmationModal,
  FilterMenu,
  FontAwesomeIcon,
  SearchInput,
  SectionLabel,
  SegmentedControl,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotDetail } from "../Settings/details/BotDetail";
import { STATUS_DOT, groupBotsByTeam, triggerSummary } from "../Bots/teamUtils";
import { toPlainText } from "../Bots/botConversation";
import { useAllBots } from "./useAllBots";
import {
  approvalText,
  avatarColor,
  botHandle,
  botProviders,
} from "./botSummary";

// Widget config (declared `events`) by component name — feeds the bot
// editor's "Run on events" picker.
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

const UNASSIGNED = "unassigned";
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "Needs approval", label: "Needs approval" },
  { value: "Running", label: "Running" },
  { value: "Paused", label: "Paused" },
];
const RUN_STATUS = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  stopped: "Stopped",
  skipped: "Skipped",
};

const teamKey = (group) => group.workspaceId || UNASSIGNED;

/** The generic robot avatar on the bot's colour. */
const BotAvatar = ({ bot, large = false }) => {
  const color = avatarColor(bot);
  const size = large ? "h-12 w-12 text-xl" : "h-8 w-8 text-sm";
  return (
    <span
      data-testid="bot-avatar"
      className={`flex items-center justify-center rounded-lg flex-shrink-0 text-white ${size} ${color}`}
    >
      <FontAwesomeIcon icon="robot" />
    </span>
  );
};

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

/** The bot's latest run, fetched when it's selected. */
function useLastRun(botId) {
  const [run, setRun] = useState(null);
  useEffect(() => {
    let alive = true;
    setRun(null);
    const b = window.mainApi && window.mainApi.bots;
    if (!b || !b.getRuns) return undefined;
    Promise.resolve(b.getRuns(botId, 1))
      .then((runs) => {
        if (alive && Array.isArray(runs) && runs.length) {
          setRun(runs[runs.length - 1]);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botId]);
  return run;
}

/** One bot's details (the right-hand panel, view mode). */
const BotDetailPanel = ({
  bot,
  team,
  status,
  approvals,
  onApprove,
  onRunNow,
  onOpenInBotsView,
  onEdit,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const lastRun = useLastRun(bot.id);
  const isLead = bot.role === "lead";
  const providers = botProviders(bot);
  const [runStatus, setRunStatus] = useState(null);

  const runNow = async () => {
    setRunStatus("Starting…");
    try {
      await onRunNow(bot.id);
      setRunStatus("Started.");
    } catch (err) {
      setRunStatus((err && err.message) || "Couldn't start the bot.");
    }
    setTimeout(() => setRunStatus(null), 3000);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-row items-center gap-3 min-w-0">
          <BotAvatar bot={bot} large />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex flex-row items-center gap-2 min-w-0">
              <h3 className={`text-lg font-semibold truncate ${strong}`}>
                {bot.name || "Untitled bot"}
              </h3>
              {isLead ? (
                <span
                  className={`text-xs uppercase tracking-wider font-semibold ${muted}`}
                >
                  Lead
                </span>
              ) : null}
            </span>
            <span className={`text-xs font-mono truncate ${muted}`}>
              {botHandle(bot)}
            </span>
            <StatusLabel status={status} muted={muted} />
          </div>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {team.workspace ? (
            <Button
              title={`Open in ${team.label}'s Bots view`}
              size="sm"
              onClick={() => onOpenInBotsView(team.workspace, bot.id)}
            />
          ) : null}
          {isLead ? null : (
            <Button3 title="Run now" size="sm" onClick={runNow} />
          )}
          <Button3 title="Edit" size="sm" onClick={onEdit} />
        </div>
      </div>
      {runStatus ? (
        <span className={`text-xs ${muted}`}>{runStatus}</span>
      ) : null}

      {/* Waiting approvals, answered inline */}
      {approvals.map((a) => (
        <div
          key={a.id}
          className="flex flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400 px-4 py-3"
        >
          <span className="flex flex-row items-center gap-2 text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            {approvalText(a)}
          </span>
          <span className="flex flex-row gap-2">
            <Button
              title="Allow"
              size="sm"
              onClick={() => onApprove(a.id, { allow: true })}
            />
            <Button3
              title="Deny"
              size="sm"
              onClick={() => onApprove(a.id, { allow: false })}
            />
          </span>
        </div>
      ))}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Team" />
          <span className="text-sm truncate">{team.label}</span>
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Runs" />
          <span className="text-sm">{triggerSummary(bot)}</span>
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Providers" />
          {isLead ? (
            <span className={`text-sm ${muted}`}>Team tools only</span>
          ) : providers.length ? (
            <div className="flex flex-col gap-2">
              {providers.map((p) => (
                <div key={p.name} className="flex flex-col gap-1 min-w-0">
                  <span className="text-sm truncate">{p.name}</span>
                  <span className="flex flex-row flex-wrap gap-1.5">
                    {p.tools.length ? (
                      p.tools.map((t) => (
                        <span
                          key={t}
                          className={`px-1.5 py-0.5 rounded border text-xs font-mono ${hairline} ${muted}`}
                        >
                          {t}
                        </span>
                      ))
                    ) : (
                      <span className={`text-xs ${muted}`}>All tools</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>None</span>
          )}
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Last run" />
          {lastRun ? (
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-sm">
                {RUN_STATUS[lastRun.status] || lastRun.status || "Run"}
                {lastRun.endedAt
                  ? ` · ${new Date(lastRun.endedAt).toLocaleString()}`
                  : ""}
              </span>
              {lastRun.error || lastRun.output ? (
                <span className={`text-xs line-clamp-3 ${muted}`}>
                  {toPlainText(lastRun.error || lastRun.output)}
                </span>
              ) : null}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>Hasn't run yet</span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * BotsPage — every bot as list + detail (app-navigation PRD NAV-006):
 * grouped by team, with search, a Team filter and status chips; the detail
 * shows the bot's status, waiting approvals (Allow / Deny), team, triggers,
 * providers + tools and last run, with Open in Bots view / Run now / Edit.
 * Edit and New Bot use the bot editor in the detail panel.
 */
export const BotsPage = ({
  workspaces = [],
  dashApi = null,
  onOpenBotInBotsView = () => {},
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
  const appContext = useContext(AppContext) || {};
  const providers = appContext.providers || {};
  const botsApi = dashApi && dashApi.bots;
  const all = useAllBots();

  const [query, setQuery] = useState("");
  const [teams, setTeams] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  // null | "edit" | "create"
  const [mode, setMode] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  // The header's New Bot opens a blank editor in the detail panel.
  const prevCreate = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreate.current) setMode("create");
    prevCreate.current = createRequested;
    if (createRequested && onCreateAcknowledged) onCreateAcknowledged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  const allGroups = groupBotsByTeam(all.bots, workspaces);
  const q = query.trim().toLowerCase();
  const matches = (bot) => {
    if (statusFilter !== "all" && all.statusOf(bot.id) !== statusFilter) {
      return false;
    }
    if (!q) return true;
    return [bot.name || "", botHandle(bot), triggerSummary(bot)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  };
  const groups = allGroups
    .filter((g) => !teams.length || teams.includes(teamKey(g)))
    .map((g) => ({ ...g, bots: g.bots.filter(matches) }))
    .filter((g) => g.bots.length);
  const ordered = groups.flatMap((g) => g.bots);
  const selected =
    ordered.find((b) => b.id === selectedId) || ordered[0] || null;
  const selectedGroup = selected
    ? groups.find((g) => g.bots.includes(selected))
    : null;
  const teamOptions = allGroups.map((g) => ({
    value: teamKey(g),
    label: g.label,
    count: g.bots.length,
  }));

  const handleSave = async (definition) => {
    const saved = await botsApi.save(definition);
    await all.refresh();
    setMode(null);
    if (saved && saved.id) setSelectedId(saved.id);
    return saved;
  };

  const confirmDelete = async () => {
    const id = deleteTarget;
    setDeleteTarget(null);
    if (!id || !botsApi) return;
    try {
      await botsApi.delete(id);
      setMode(null);
      if (selectedId === id) setSelectedId(null);
      await all.refresh();
    } catch (err) {
      console.error("Delete bot error:", err);
    }
  };

  let detail;
  if (mode === "create") {
    detail = (
      <BotDetail
        key="new"
        isCreating
        providers={providers}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        bots={all.bots}
        onSave={handleSave}
        onCancel={() => setMode(null)}
      />
    );
  } else if (mode === "edit" && selected) {
    // BotDetail only shows Cancel when creating — this is the way back.
    detail = (
      <div className="flex flex-col gap-2">
        <div>
          <Button3
            title="Back to details"
            size="sm"
            onClick={() => setMode(null)}
          />
        </div>
        <BotDetail
          key={selected.id}
          bot={selected}
          providers={providers}
          workspaces={workspaces}
          getWidgetConfig={getWidgetConfig}
          bots={all.bots}
          onSave={handleSave}
          onCancel={() => setMode(null)}
          onDelete={() => setDeleteTarget(selected.id)}
        />
      </div>
    );
  } else if (selected) {
    const ws = selectedGroup.workspaceId
      ? workspaces.find((w) => String(w.id) === selectedGroup.workspaceId)
      : null;
    detail = (
      <BotDetailPanel
        key={selected.id}
        bot={selected}
        team={{ label: selectedGroup.label, workspace: ws || null }}
        status={all.statusOf(selected.id)}
        approvals={all.approvalsFor(selected.id)}
        onApprove={all.approve}
        onRunNow={(id) => botsApi.run(id)}
        onOpenInBotsView={onOpenBotInBotsView}
        onEdit={() => setMode("edit")}
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

  return (
    // The page's base text colour (plain names inherit it); muted text
    // keeps its own token.
    <div
      data-testid="bots-page"
      className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
    >
      {/* Filter bar — fixed; the list and detail scroll on their own. */}
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
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
        <span className="flex-1" />
        {autoLeads !== null ? (
          <Checkbox
            label="Create team leads automatically"
            checked={autoLeads}
            onChange={toggleAutoLeads}
          />
        ) : null}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        <div
          role="list"
          aria-label="Bots"
          className="min-h-0 overflow-y-auto flex flex-col gap-3 pr-2"
        >
          {groups.map((g) => (
            <div key={teamKey(g)} className="flex flex-col gap-1">
              <SectionLabel text={g.label} className="px-3" />
              {g.bots.map((bot) => {
                const active =
                  mode !== "create" && selected && bot.id === selected.id;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setMode(null);
                      setSelectedId(bot.id);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 border flex flex-row items-center gap-3 ${
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
                          <span
                            className={`text-xs uppercase tracking-wider font-semibold ${muted}`}
                          >
                            Lead
                          </span>
                        ) : null}
                      </span>
                      <span className={`text-xs truncate ${muted}`}>
                        {triggerSummary(bot)}
                      </span>
                    </span>
                    <StatusLabel status={all.statusOf(bot.id)} muted={muted} />
                  </button>
                );
              })}
            </div>
          ))}
          {!ordered.length ? (
            <span className={`text-sm px-3 ${muted}`}>No bots match.</span>
          ) : null}
        </div>
        <div
          data-testid="bot-detail"
          className={`col-span-2 min-h-0 overflow-y-auto rounded-lg border p-5 ${hairline}`}
        >
          {detail}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete bot?"
        message="This removes the bot, its run history, and its working directory."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default BotsPage;
