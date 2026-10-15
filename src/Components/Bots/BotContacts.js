import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon3,
  EmptyState,
  FontAwesomeIcon,
  ListRow,
  PanelHeader,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  StatusBadge,
  Switch,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { BotAvatar } from "./BotAvatar";
import { BotChat } from "./BotChat";
import { BotRunHistory } from "./BotRunHistory";
import { STATUS_DOT } from "./teamUtils";
import {
  budgetLimitText,
  contactSections,
  needsYouItems,
  shortTime,
} from "./contactsList";

/**
 * BotContacts — the Bots dock panel (bot-teams PRD TEAM-015): your bots as a
 * contacts list, like a chat app. Grouped by dashboard (or one list), newest
 * activity first or A–Z, each row saying what the bot last did. Pick a bot to
 * chat with it, or switch to its Activity; open it in the Bots view from
 * there. Approvals waiting on you stay at the top ("Needs you") and inside
 * the bot's chat.
 *
 * @param {object} contacts  useBotContacts()
 * @param {object[]} workspaces  all dashboards (group names)
 * @param {(workspaceId, botId, tab) => void} [onOpenBotsView]
 * @param {(botId: string) => void} [onOpenSettings]  bots on no dashboard
 * @param {() => void} [onCollapse]
 */
const EMPTY = [];
const NO_RUNS = {};
const NOBODY = new Set();
const TICK_MS = 30000;
const SORT_KEY = "dash:bot-contacts:sort";
const TEAM_KEY = "dash:bot-contacts:by-team";

function readPref(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (_e) {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_e) {
    // a convenience only
  }
}

const ContactAvatar = ({ bot, status }) => {
  // Over budget waits on you, like an approval.
  const dot =
    STATUS_DOT[status === "Over budget" ? "Needs approval" : status] ||
    STATUS_DOT.Idle;
  return (
    <span className="relative inline-flex" aria-hidden="true">
      <BotAvatar bot={bot} />
      <span
        className={`absolute h-2.5 w-2.5 rounded-full ${dot}`}
        style={{ right: -2, bottom: -2 }}
      />
    </span>
  );
};

export const BotContacts = ({
  contacts,
  workspaces = EMPTY,
  onOpenBotsView = null,
  onOpenSettings = null,
  onCollapse = null,
}) => {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const muted = currentTheme["text-neutral-medium"] || "";
  const strong = currentTheme["text-neutral-light"] || "";
  const hairline = currentTheme["border-neutral-dark"] || "";
  const statusTokens = useStatusTokens();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(() =>
    readPref(SORT_KEY, "recent") === "az" ? "az" : "recent",
  );
  const [byTeam, setByTeam] = useState(
    () => readPref(TEAM_KEY, "true") !== "false",
  );
  // The open bot, and which of its views.
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("conversation");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const c = contacts || {};
  const bots = c.bots || EMPTY;
  const approvals = c.approvals || EMPTY;
  const running = c.running || EMPTY;
  const paused = c.paused || NOBODY;
  const lastRuns = c.lastRuns || NO_RUNS;
  const budgets = c.budgets || NO_RUNS;
  const queued = c.queued || NO_RUNS;

  const sections = useMemo(
    () =>
      contactSections({
        bots,
        workspaces,
        lastRuns,
        running,
        approvals,
        paused,
        budgets,
        queued,
        sort,
        byTeam,
        query,
        now,
      }),
    [
      bots,
      workspaces,
      lastRuns,
      running,
      approvals,
      paused,
      budgets,
      queued,
      sort,
      byTeam,
      query,
      now,
    ],
  );

  const open = openId ? bots.find((b) => b.id === openId) || null : null;
  // A bot deleted while open: back to the list.
  useEffect(() => {
    if (openId && !c.loading && !open) setOpenId(null);
  }, [openId, c.loading, open]);

  const nameOf = (id) => {
    const b = bots.find((x) => x.id === id);
    return b ? b.name : id;
  };
  const dashboardName = (workspaceId) => {
    if (workspaceId === null || workspaceId === undefined) return null;
    const ws = workspaces.find((w) => String(w.id) === String(workspaceId));
    return ws ? ws.name : null;
  };

  const openBot = (id) => {
    setOpenId(id);
    setView("conversation");
  };

  if (open) {
    const wsId =
      open.workspaceId === null || open.workspaceId === undefined
        ? null
        : String(open.workspaceId);
    const isLead = open.role === "lead";
    const isPaused = paused.has(open.id);
    const budget = budgets[open.id] || null;
    const isOver = !!(budget && budget.over);
    const isRunning = running.some((r) => r.id === open.id);
    const canOpen = wsId !== null ? !!onOpenBotsView : !!onOpenSettings;
    const toBotsView = (tab) => {
      if (wsId !== null && onOpenBotsView) onOpenBotsView(wsId, open.id, tab);
      else if (onOpenSettings) onOpenSettings(open.id);
    };
    const toSettings = canOpen ? () => toBotsView("settings") : null;
    return (
      <div className="flex flex-col flex-1 min-h-0" data-testid="bot-contact">
        <PanelHeader
          onBack={() => setOpenId(null)}
          backLabel="All bots"
          title={
            <span className="flex flex-col min-w-0">
              <span className="truncate">{open.name}</span>
              <span
                className={`text-xs font-normal truncate ${muted}`}
                data-testid="bot-contact-subtitle"
              >
                {[
                  isLead ? "Lead" : null,
                  dashboardName(wsId) || "No dashboard",
                  isPaused
                    ? "paused"
                    : isOver
                      ? "over budget"
                      : isRunning
                        ? "running"
                        : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          }
          actions={
            <>
              {isRunning && c.stop ? (
                <ButtonIcon3
                  icon="stop"
                  ariaLabel={`Stop ${open.name}`}
                  onClick={() => c.stop(open.id)}
                />
              ) : null}
              {canOpen ? (
                <ButtonIcon3
                  icon={wsId !== null ? "arrow-up-right-from-square" : "gear"}
                  ariaLabel={
                    wsId !== null ? "Open in Bots view" : "Open in Settings"
                  }
                  onClick={() => toBotsView(view)}
                />
              ) : null}
            </>
          }
        />
        <div className={`flex-shrink-0 px-4 py-2.5 border-b ${hairline}`}>
          <SegmentedControl
            ariaLabel="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "conversation", label: "Conversation" },
              { value: "activity", label: "Activity" },
            ]}
          />
        </div>
        {view === "conversation" ? (
          <BotChat
            bot={open}
            isLead={isLead}
            approvals={approvals.filter(
              (a) => a && a.request && a.request.botId === open.id,
            )}
            onApprove={c.approve || null}
            nameOf={nameOf}
            onOpenSettings={toSettings}
            onChangeModel={toSettings}
            paused={isPaused}
            onResume={
              c.setBotPaused ? () => c.setBotPaused(open.id, false) : null
            }
            overBudget={isOver ? budgetLimitText(budget) : null}
            onKeepRunning={c.keepRunning ? () => c.keepRunning(open.id) : null}
            queuedEvents={queued[open.id] || 0}
          />
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <BotRunHistory
                bot={open}
                isLead={isLead}
                nameOf={nameOf}
                onOpenSettings={toSettings}
                onChangeModel={toSettings}
                compact
              />
            </div>
            <div
              className={`flex-shrink-0 border-t px-4 py-3 flex flex-row gap-2 ${hairline}`}
            >
              <Button
                title="Run now"
                size="sm"
                disabled={isPaused || isRunning || isOver}
                onClick={() => {
                  const b = window.mainApi && window.mainApi.bots;
                  if (b && b.run) b.run(open.id, "", false);
                }}
              />
              {c.setBotPaused ? (
                <Button3
                  title={isPaused ? "Resume" : "Pause"}
                  size="sm"
                  onClick={() => c.setBotPaused(open.id, !isPaused)}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Waiting on you: approvals, and bots stopped for budget (US-019).
  const needs = needsYouItems(approvals, bots, budgets);
  const waitingId = needs.botIds[0] || null;
  const waiting = needs.approvals;
  const waitingBots = needs.botIds.length;
  const needsLine =
    waitingBots === 1
      ? waiting.length === 1
        ? `Wants to use ${waiting[0].request.toolName || "a tool"}`
        : waiting.length
          ? `${waiting.length} approvals waiting`
          : `Over ${budgetLimitText(budgets[waitingId])}`
      : [
          waiting.length
            ? `${waiting.length} approval${waiting.length === 1 ? "" : "s"}`
            : null,
          needs.overBudget.length
            ? `${needs.overBudget.length} over budget`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="bot-contacts">
      <PanelHeader
        title="Bots"
        glyph="robot"
        actions={
          onCollapse ? (
            <ButtonIcon3
              icon="chevron-right"
              ariaLabel="Collapse"
              onClick={onCollapse}
            />
          ) : null
        }
      />
      <div className="flex-shrink-0 flex flex-col gap-2.5 px-4 pt-3 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search bots"
          ariaLabel="Search bots"
        />
        <div className="flex flex-row items-center gap-3">
          <SegmentedControl
            ariaLabel="Sort"
            value={sort}
            onChange={(v) => {
              setSort(v);
              writePref(SORT_KEY, v);
            }}
            options={[
              { value: "recent", label: "Recent" },
              { value: "az", label: "A–Z" },
            ]}
          />
          <span className="flex-1" />
          <Switch
            label="By team"
            checked={byTeam}
            onChange={(v) => {
              setByTeam(v);
              writePref(TEAM_KEY, v ? "true" : "false");
            }}
          />
        </div>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto px-2 pb-4 ${strong}`}>
        {waitingId ? (
          <div
            className={`mx-2 mt-1 mb-2 rounded-lg border px-3 py-2.5 flex flex-row items-center gap-3 ${statusTokens.warning.bg} ${statusTokens.warning.border}`}
            data-testid="bot-contacts-needs-you"
          >
            <FontAwesomeIcon
              icon="triangle-exclamation"
              className={`h-3.5 w-3.5 ${statusTokens.warning.text}`}
            />
            <span className="flex-1 min-w-0 flex flex-col">
              <span
                className={`text-sm font-medium ${statusTokens.warning.text}`}
              >
                {waitingBots === 1
                  ? `${nameOf(waitingId)} needs you`
                  : `${waitingBots} bots need you`}
              </span>
              <span className={`text-xs ${muted}`}>{needsLine}</span>
            </span>
            <Button3
              title="Review"
              size="sm"
              onClick={() => openBot(waitingId)}
            />
          </div>
        ) : null}

        {!c.loading && !bots.length ? (
          <EmptyState
            icon={<FontAwesomeIcon icon="robot" className="h-6 w-6" />}
            title="No bots yet"
            description="Make one in Create, or from a dashboard's Bots view. They show up here to chat with."
            className="my-10"
          />
        ) : null}
        {bots.length && !sections.length ? (
          <p className={`px-3 py-6 text-sm ${muted}`}>
            No bots match &ldquo;{query}&rdquo;.
          </p>
        ) : null}

        {sections.map((s) => (
          <div
            key={s.key}
            className="flex flex-col"
            data-testid="bot-contacts-section"
          >
            {byTeam ? (
              <div className="px-2 pt-3 pb-1">
                <SectionLabel text={s.label} />
              </div>
            ) : null}
            {s.contacts.map((ct) => {
              const when = shortTime(ct.at, now);
              return (
                <ListRow
                  key={ct.id}
                  testId="bot-contact-row"
                  icon={<ContactAvatar bot={ct.bot} status={ct.status} />}
                  ariaLabel={`${ct.name}${ct.isLead ? ", lead" : ""}: ${ct.line}`}
                  title={
                    <span className="flex flex-row items-center gap-1.5 min-w-0">
                      <span className="truncate">{ct.name}</span>
                      {ct.isLead ? (
                        <StatusBadge state="neutral" label="Lead" compact />
                      ) : null}
                      {ct.approvals ? (
                        <StatusBadge
                          state="warning"
                          label={`${ct.approvals} to approve`}
                          compact
                        />
                      ) : null}
                      {ct.budget === "over" ? (
                        <StatusBadge
                          state="warning"
                          label="Over budget"
                          compact
                        />
                      ) : ct.budget === "warn" ? (
                        <StatusBadge
                          state="neutral"
                          label="80% of budget"
                          compact
                        />
                      ) : null}
                    </span>
                  }
                  meta={
                    <span className="flex flex-row gap-1 min-w-0">
                      <span className="truncate">{ct.line}</span>
                      {when ? (
                        <span className="flex-shrink-0">· {when}</span>
                      ) : null}
                    </span>
                  }
                  onClick={() => openBot(ct.id)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BotContacts;
