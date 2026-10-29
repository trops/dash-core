import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon3,
  ConfirmationModal,
  SegmentedControl,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotDetail } from "../Settings/details/BotDetail";
import { AuditLogView } from "../AppPages/AuditLogView";
import { approvalText } from "../AppPages/botSummary";
import { BotAvatar } from "./BotAvatar";
import { BotChat } from "./BotChat";
import { BotRunHistory } from "./BotRunHistory";
import { BotSpending } from "./BotSpending";
import { botStatus } from "./botConversation";
import { budgetLimitText } from "./contactsList";
import { STATUS_DOT } from "./teamUtils";
import { useBotContacts } from "./useBotContacts";

/**
 * BotPage — everything about one bot in one place (app-navigation NAV-016):
 * a header with Run now / Turn on·Pause / Stop, then Conversation · Activity ·
 * Log · Spending · Settings. The same page in Manage › Bots, in the large
 * modal opened from the Bots panel, and in a dashboard's Bots view.
 *
 * @param {string} botId
 * @param {string} [initialTab]  "conversation" (default) | "activity" | "log" | "spending" | "settings"
 * @param {object[]} [workspaces]  dashboards (team names, event picker)
 * @param {(workspace, botId) => void} [onOpenInBotsView]  a team bot's Bots view
 * @param {() => void} [onClose]  the modal's close (×)
 * @param {(botId) => void} [onDeleted]
 * @param {() => void} [onChanged]  after Turn on / Pause / Save (the host's list)
 * @param {(dirty: boolean) => void} [onDirtyChange]  Settings has unsaved edits
 * @param {(tab: string) => void} [onTabChange]  the tab now showing
 * @param {(section: string) => void} [onOpenSettings]  an error's next step
 *   ("Open Settings › Providers") — the app's settings, not this bot's
 * @param {React.ReactNode} [actions]  more header buttons (the Bots view's ⋯)
 * @param {React.ReactNode} [below]  shown under the header (that menu's row)
 * @param {object} [chatProps]  more Conversation props for BotChat
 */
export const BOT_PAGE_TABS = [
  { value: "conversation", label: "Conversation" },
  { value: "activity", label: "Activity" },
  { value: "log", label: "Log" },
  { value: "spending", label: "Spending" },
  { value: "settings", label: "Settings" },
];

const EMPTY = [];
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

export const BotPage = ({
  botId,
  initialTab = "conversation",
  workspaces = EMPTY,
  onOpenInBotsView = null,
  onClose = null,
  onDeleted = null,
  onChanged = null,
  onDirtyChange = null,
  onTabChange = null,
  onOpenSettings = null,
  actions = null,
  below = null,
  chatProps = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const appContext = useContext(AppContext) || {};
  const c = useBotContacts();
  const [tab, setTabState] = useState(
    BOT_PAGE_TABS.some((t) => t.value === initialTab)
      ? initialTab
      : "conversation",
  );
  const setTab = (next) => {
    setTabState(next);
    if (onTabChange) onTabChange(next);
  };
  const [runStatus, setRunStatus] = useState(null);
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (v) => {
    setDirtyState(v);
    if (onDirtyChange) onDirtyChange(v);
  };
  // A tab (or "close") waiting on "Discard unsaved changes?".
  const [leaveTo, setLeaveTo] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Remounts Settings to drop unsaved edits.
  const [formKey, setFormKey] = useState(0);
  const logBotIds = useMemo(() => [botId], [botId]);

  const bots = c.bots || EMPTY;
  const bot = bots.find((b) => b.id === botId) || null;
  // Deleted elsewhere mid-edit: its unsaved edits went with it.
  const gone = !bot && !c.loading;
  useEffect(() => {
    if (gone && dirty) setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone, dirty]);

  if (!bot) {
    return (
      <div
        className={`flex flex-row items-center gap-3 p-6 text-sm ${muted}`}
        data-testid="bot-page-missing"
      >
        <span className="flex-1">
          {c.loading ? "Loading…" : "This bot no longer exists."}
        </span>
        {onClose ? (
          <ButtonIcon3 icon="xmark" ariaLabel="Close" onClick={onClose} />
        ) : null}
      </div>
    );
  }

  const approvals = (c.approvals || EMPTY).filter(
    (a) => a && a.request && a.request.botId === bot.id,
  );
  const running = (c.running || EMPTY).map((r) => (r && r.id) || r);
  const isRunning = running.includes(bot.id);
  const isPaused = !!(c.paused && c.paused.has(bot.id));
  const budget = (c.budgets || {})[bot.id] || null;
  const isOver = !!(budget && budget.over);
  const isLead = bot.role === "lead";
  const hasDashboard =
    bot.workspaceId !== null &&
    bot.workspaceId !== undefined &&
    bot.workspaceId !== "";
  const status = isOver
    ? "Over budget"
    : botStatus({
        botId: bot.id,
        running,
        paused: { bots: isPaused ? [bot.id] : [] },
        approvals,
        lastRun: (c.lastRuns || {})[bot.id] || null,
      });
  const ws =
    bot.workspaceId === null || bot.workspaceId === undefined
      ? null
      : workspaces.find((w) => String(w.id) === String(bot.workspaceId)) ||
        null;
  const nameOf = (id) => {
    const b = bots.find((x) => x.id === id);
    return b ? b.name : id;
  };
  const toSettings = () => go("settings");
  async function setPaused(pause) {
    await c.setBotPaused(bot.id, pause);
    if (onChanged) onChanged();
  }

  function go(next) {
    if (next === tab) return;
    if (tab === "settings" && dirty) {
      setLeaveTo(next);
      return;
    }
    setTab(next);
  }
  function close() {
    if (tab === "settings" && dirty) {
      setLeaveTo("close");
      return;
    }
    if (onClose) onClose();
  }
  // The lead workspace (release 2) — after "Discard unsaved changes?" when
  // Settings has edits.
  function openWorkspace() {
    window.dispatchEvent(
      new CustomEvent("dash:open-workspace", {
        detail: { key: `${isLead ? "lead" : "bot"}:${bot.id}` },
      }),
    );
  }
  function talk() {
    if (tab === "settings" && dirty) {
      setLeaveTo("workspace");
      return;
    }
    openWorkspace();
  }
  function discardAndLeave() {
    const next = leaveTo;
    setLeaveTo(null);
    setDirty(false);
    setFormKey((k) => k + 1);
    if (next === "close") {
      if (onClose) onClose();
    } else if (next === "workspace") {
      openWorkspace();
    } else if (next) {
      setTab(next);
    }
  }

  // What actually happened (Phase 1d): a paused bot's Run now is a test run.
  async function runNow() {
    const b = window.mainApi && window.mainApi.bots;
    if (!b || !b.run) return;
    const wasPaused = isPaused;
    setRunStatus("Running…");
    try {
      const res = await b.run(bot.id);
      if (res && res.skipped) {
        setRunStatus(`It didn't run: ${res.reason || "it was skipped"}.`);
      } else if (res && res.status === "failed") {
        setRunStatus(`The run failed: ${res.error || "no details"}.`);
      } else {
        setRunStatus(
          wasPaused
            ? `It worked. ${bot.name} is still paused — turn it on?`
            : "It worked.",
        );
      }
    } catch (err) {
      setRunStatus((err && err.message) || "Couldn't start the bot.");
    }
  }

  async function save(definition) {
    const b = window.mainApi && window.mainApi.bots;
    const saved = await b.save(definition);
    setDirty(false);
    if (onChanged) onChanged();
    return saved;
  }

  async function deleteBot() {
    setConfirmDelete(false);
    const b = window.mainApi && window.mainApi.bots;
    if (!b || !b.delete) return;
    try {
      await b.delete(bot.id);
    } catch (err) {
      const why = ((err && err.message) || "try again").replace(/\.+$/, "");
      setRunStatus(`Couldn't delete ${bot.name || "the bot"}: ${why}.`);
      return;
    }
    if (onDeleted) onDeleted(bot.id);
  }

  const dot = STATUS_DOT[status] || STATUS_DOT.Idle;

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${strong}`}
      data-testid="bot-page"
    >
      {/* Header */}
      <div
        className={`flex-shrink-0 flex flex-row flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 border-b ${hairline}`}
      >
        <div className="flex flex-row items-center gap-3 min-w-0">
          <BotAvatar bot={bot} large />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex flex-row items-center gap-2 min-w-0">
              <h3 className="text-lg font-semibold truncate">
                {bot.name || "Untitled bot"}
              </h3>
              {isLead ? <StatusBadge state="neutral" label="Lead" /> : null}
            </span>
            <span
              className={`flex flex-row items-center gap-1.5 text-xs ${muted}`}
              data-testid="bot-page-status"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
              {status} · {ws ? ws.name : "No dashboard"}
              {bot.installedFrom
                ? ` · From ${bot.installedFrom.package} v${bot.installedFrom.version}`
                : null}
            </span>
          </div>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {ws && onOpenInBotsView ? (
            <Button3
              title={`Open in ${ws.name}'s Bots view`}
              size="sm"
              onClick={() => onOpenInBotsView(ws, bot.id)}
            />
          ) : null}
          {/* A lead, or a bot on no dashboard, is talked to in the lead
              workspace (lead-workspace release 2). */}
          {isLead || !hasDashboard ? (
            <Button title="Open conversation" size="sm" onClick={talk} />
          ) : null}
          {isRunning && c.stop ? (
            <Button3 title="Stop" size="sm" onClick={() => c.stop(bot.id)} />
          ) : null}
          {isLead ? null : (
            <Button3
              title="Run now"
              size="sm"
              disabled={isRunning || isOver}
              onClick={runNow}
            />
          )}
          {isLead || !c.setBotPaused ? null : (
            <Button3
              title={isPaused ? "Turn on" : "Pause"}
              size="sm"
              onClick={async () => {
                await setPaused(!isPaused);
                setRunStatus(null);
              }}
            />
          )}
          {actions}
          {onClose ? (
            <ButtonIcon3 icon="xmark" ariaLabel="Close" onClick={close} />
          ) : null}
        </div>
      </div>
      {below}
      {runStatus ? (
        <span
          className={`flex-shrink-0 px-5 pt-2 text-xs ${muted}`}
          data-testid="bot-page-run-status"
        >
          {runStatus}
        </span>
      ) : null}

      {/* Waiting approvals — the conversation shows them inline instead. */}
      {tab !== "conversation" && approvals.length ? (
        <div className="flex-shrink-0 flex flex-col gap-2 px-5 pt-3">
          {approvals.map((a) => (
            <div
              key={a.id}
              className={`flex flex-row flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${statusTokens.warning.bg} ${statusTokens.warning.border}`}
            >
              <span
                className={`flex flex-row items-center gap-2 text-sm ${statusTokens.warning.text}`}
              >
                {approvalText(a)}
              </span>
              <span className="flex flex-row gap-2">
                <Button
                  title="Allow"
                  size="sm"
                  onClick={() => c.approve(a.id, { allow: true })}
                />
                <Button3
                  title="Deny"
                  size="sm"
                  onClick={() => c.approve(a.id, { allow: false })}
                />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex-shrink-0 px-5 py-3">
        <SegmentedControl
          ariaLabel="Show"
          value={tab}
          onChange={go}
          options={BOT_PAGE_TABS}
        />
      </div>

      <div
        className="flex flex-col flex-1 min-h-0"
        data-testid={`bot-page-${tab}`}
      >
        {tab === "conversation" ? (
          <BotChat
            bot={bot}
            isLead={isLead}
            approvals={approvals}
            onApprove={c.approve || null}
            nameOf={nameOf}
            onOpenSettings={onOpenSettings}
            onChangeModel={toSettings}
            paused={isPaused}
            onResume={c.setBotPaused ? () => setPaused(false) : null}
            overBudget={isOver ? budgetLimitText(budget) : null}
            onKeepRunning={c.keepRunning ? () => c.keepRunning(bot.id) : null}
            queuedEvents={(c.queued || {})[bot.id] || 0}
            {...(chatProps || {})}
          />
        ) : null}
        {tab === "activity" ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
            <BotRunHistory
              bot={bot}
              isLead={isLead}
              nameOf={nameOf}
              onOpenSettings={onOpenSettings}
              onChangeModel={toSettings}
            />
          </div>
        ) : null}
        {tab === "log" ? (
          <div className="flex flex-col flex-1 min-h-0 px-5">
            <AuditLogView bots={bots} botIds={logBotIds} hideBotFilter />
          </div>
        ) : null}
        {tab === "spending" ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
            <BotSpending bot={bot} />
          </div>
        ) : null}
        {tab === "settings" ? (
          <div className="flex flex-col flex-1 min-h-0 px-5 pb-4">
            <BotDetail
              key={`${bot.id}-${formKey}`}
              bot={bot}
              providers={appContext.providers || {}}
              workspaces={workspaces}
              getWidgetConfig={getWidgetConfig}
              bots={bots}
              onSave={save}
              onCancel={() => setFormKey((k) => k + 1)}
              onDelete={() => setConfirmDelete(true)}
              onDirtyChange={setDirty}
              onDiscard={() => {
                setDirty(false);
                setFormKey((k) => k + 1);
              }}
              showBudget={false}
            />
          </div>
        ) : null}
      </div>

      <ConfirmationModal
        isOpen={!!leaveTo}
        setIsOpen={() => setLeaveTo(null)}
        title="Discard unsaved changes?"
        message={`Your changes to ${bot.name || "this bot"} haven't been saved.`}
        confirmLabel="Discard"
        variant="danger"
        onConfirm={discardAndLeave}
        onCancel={() => setLeaveTo(null)}
      />
      <ConfirmationModal
        isOpen={confirmDelete}
        setIsOpen={() => setConfirmDelete(false)}
        title="Delete bot?"
        message="This removes the bot, its run history, and its working directory."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={deleteBot}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};

export default BotPage;
