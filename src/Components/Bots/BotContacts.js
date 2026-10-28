import React, { useContext, useEffect, useMemo, useState } from "react";
import {
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
import { WorkspaceContext } from "../../Context/WorkspaceContext";
import { BotAvatar } from "./BotAvatar";
import { STATUS_DOT } from "./teamUtils";
import {
  budgetLimitText,
  contactOf,
  contactSections,
  dashTeamMatches,
  needsYouItems,
  pinnedLeadOf,
  shortTime,
} from "./contactsList";
import { DASH_TEAM_CONTACT, openDashTeam } from "./dashTeamContact";
import { DashTeamApprovals } from "./DashTeamApprovals";

/**
 * BotContacts — the Bots dock panel (bot-teams PRD TEAM-015): your bots as a
 * contacts list, like a chat app. Grouped by dashboard (or one list), newest
 * activity first or A–Z, each row saying what the bot last did. Pick a bot to
 * open its bot page in a large modal (app-navigation NAV-016 AC5) — a
 * `dash:open-bot` event the host answers, unless `onOpenBot` is given.
 * Approvals waiting on you stay at the top ("Needs you").
 *
 * Pinned under that (consolidation Phase 4a): the open dashboard's lead (the
 * host's WorkspaceContext says which — none on a Manage page) and the Dash
 * team, which opens the team's conversations (`dash:open-dash-team`). The
 * pinned lead isn't repeated in the list below.
 *
 * @param {object} contacts  useBotContacts()
 * @param {object[]} workspaces  all dashboards (group names)
 * @param {(botId: string, tab: string) => void} [onOpenBot]
 * @param {() => void} [onCollapse]
 */
const EMPTY = [];
const NO_RUNS = {};
const NOBODY = new Set();
const TICK_MS = 30000;
const SORT_KEY = "dash:bot-contacts:sort";
const TEAM_KEY = "dash:bot-contacts:by-team";
// The last openRequest acted on (see the effect in BotContacts).
let handledRequest = null;

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
  onOpenBot = null,
  onCollapse = null,
  // { botId } — open this bot (a clicked notification, US-018 AC5). A new
  // object each time, so the same bot can be asked again.
  openRequest = null,
}) => {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  const muted = currentTheme["text-neutral-medium"] || "";
  const strong = currentTheme["text-neutral-light"] || "";
  const statusTokens = useStatusTokens();
  const { workspaceData } = useContext(WorkspaceContext) || {};
  const openDashboardId =
    workspaceData && workspaceData.id !== undefined ? workspaceData.id : null;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(() =>
    readPref(SORT_KEY, "recent") === "az" ? "az" : "recent",
  );
  const [byTeam, setByTeam] = useState(
    () => readPref(TEAM_KEY, "true") !== "false",
  );
  const openBot = (botId, tab = "conversation") => {
    if (onOpenBot) onOpenBot(botId, tab);
    else
      window.dispatchEvent(
        new CustomEvent("dash:open-bot", { detail: { botId, tab } }),
      );
  };
  // A clicked notification opens its bot — once. The host keeps the request
  // and the panel remounts on every expand, so remember it module-wide (a
  // ref dies with the panel). No bot (the tray's Open Bots panel): the list.
  useEffect(() => {
    if (!openRequest || openRequest === handledRequest) return;
    handledRequest = openRequest;
    if (openRequest.botId) openBot(openRequest.botId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

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

  const lead = pinnedLeadOf(bots, openDashboardId);
  const leadId = lead ? lead.id : null;
  const q = query.trim().toLowerCase();
  const leadShown =
    lead &&
    (!q ||
      String(lead.name || "")
        .toLowerCase()
        .includes(q))
      ? contactOf(lead, {
          last: lastRuns[lead.id] || null,
          running,
          approvals,
          paused,
          budget: budgets[lead.id] || null,
          queued: queued[lead.id] || 0,
          now,
        })
      : null;
  const teamShown = dashTeamMatches(query);

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
        exclude: leadId ? [leadId] : EMPTY,
      }),
    [
      leadId,
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

  const nameOf = (id) => {
    const b = bots.find((x) => x.id === id);
    return b ? b.name : id;
  };

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

  // One contact's row — the list's and the pinned lead's. `where` leads
  // the line ("This dashboard · …").
  const contactRow = (ct, where = null) => {
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
              <StatusBadge state="warning" label="Over budget" compact />
            ) : ct.budget === "warn" ? (
              <StatusBadge state="neutral" label="80% of budget" compact />
            ) : null}
          </span>
        }
        meta={
          <span className="flex flex-row gap-1 min-w-0">
            <span className="truncate">
              {where ? `${where} · ${ct.line}` : ct.line}
            </span>
            {when ? <span className="flex-shrink-0">· {when}</span> : null}
          </span>
        }
        onClick={() => openBot(ct.id)}
      />
    );
  };

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
        {/* The Dash team's approvals: its bots aren't in this list, but
            their runs wait on these (QA 2026-10-28). */}
        <div className="mx-2 mt-1 mb-2">
          <DashTeamApprovals compact />
        </div>
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

        {leadShown || teamShown ? (
          <div className="flex flex-col" data-testid="bot-contacts-pinned">
            <div className="px-2 pt-3 pb-1">
              <SectionLabel text="Pinned" />
            </div>
            {leadShown ? contactRow(leadShown, "This dashboard") : null}
            {teamShown ? (
              <ListRow
                testId="bot-contact-dash-team"
                icon={<BotAvatar bot={DASH_TEAM_CONTACT} icon="people-group" />}
                ariaLabel="Dash team: ask about anything, or plan something new"
                title="Dash team"
                meta="Ask about anything, or plan something new"
                onClick={() => openDashTeam()}
              />
            ) : null}
          </div>
        ) : null}

        {!c.loading && !bots.length ? (
          <EmptyState
            title="No bots yet"
            description="Your bots show up here. Ask the Dash team to make one."
            className="my-6"
          />
        ) : null}
        {q && bots.length && !sections.length && !leadShown && !teamShown ? (
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
            {/* One flat list still gets a label under Pinned. */}
            {byTeam || leadShown || teamShown ? (
              <div className="px-2 pt-3 pb-1">
                <SectionLabel text={s.label} />
              </div>
            ) : null}
            {s.contacts.map((ct) => contactRow(ct))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BotContacts;
