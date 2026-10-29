import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button3,
  ButtonIcon3,
  ChatComposer,
  ConfirmationModal,
  EmptyState,
  FontAwesomeIcon,
  ListRow,
  PanelHeader,
  SegmentedControl,
  SelectInput,
  StatusBadge,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotDetail } from "../Settings/details/BotDetail";
import { DashTeamPanel } from "../AppPages/DashTeamPanel";
import { useAllBots } from "../AppPages/useAllBots";
import { AskStep } from "../Create/AskStep";
import { questionThreads } from "../Create/recentRows";
import { modelLabel } from "../../utils/runCostLabel";
import { shortTime } from "./contactsList";
import { BotAvatar } from "./BotAvatar";
import { DASH_TEAM_CONTACT } from "./dashTeamContact";
import { DashTeamApprovals } from "./DashTeamApprovals";

const TABS = [
  { value: "conversation", label: "Conversation" },
  { value: "settings", label: "Settings" },
];

const ROLE_ORDER = ["dashlead", "planner", "scout", "builder", "checker"];

const EMPTY = [];

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

const TICK_MS = 60000;

/** The questions in Recent, live; their ages kept current. */
function useThreads() {
  const [entries, setEntries] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const b = botsApi();
    const load = () => {
      if (!b || !b.listCreateRecent) {
        setLoaded(true);
        return;
      }
      Promise.resolve(b.listCreateRecent())
        .then((l) => {
          if (!alive) return;
          setEntries(Array.isArray(l) ? l : EMPTY);
          setNow(Date.now());
          setLoaded(true);
        })
        .catch(() => alive && setLoaded(true));
    };
    load();
    const id = b && b.onCreateRecent ? b.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, []);
  const threads = useMemo(() => questionThreads(entries, now), [entries, now]);
  return { threads, loaded };
}

// What each role is for, under the To: picker.
const ROLE_HINT = {
  dashlead:
    "Your contact for the team: passes your question to the right role and sums up the answer.",
  planner: "Answers questions and plans new things for you to approve.",
  scout: "Finds widgets and bots you have, or can get from the registry.",
  builder:
    "Answers questions about building widgets. It builds only in a plan you approve.",
  checker: "Answers questions about checking widgets before they're used.",
};

const pickRole = (role) => (ROLE_ORDER.includes(role) ? role : "planner");
// "builder" → "Builder", while the team's names are still loading.
const roleWord = (role) => `${role.charAt(0).toUpperCase()}${role.slice(1)}`;

const Conversation = ({ team, role, onRoleChange, onTurnOn, onOpenPlan }) => {
  const { muted, hairline } = useConfigTokens();
  const { threads } = useThreads();
  // What's open on the right: a thread ({ recentId }), a new question just
  // sent ({ question, recipient }), or nothing yet (the composer). `key`
  // stays put for a new question, so the thread isn't restarted once it's
  // saved.
  const [open, setOpen] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState("");
  // Who a new question goes to: the Planner unless another role is picked.
  const [to, setToState] = useState(() => pickRole(role));
  const setTo = (next) => {
    setToState(next);
    if (onRoleChange) onRoleChange(next);
  };
  // The host picked another role (the Bots page's list): a new question to it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setToState(pickRole(role));
    setOpen(null);
    setSelectedId(null);
  }, [role]);
  const toBot = team.find((b) => b.role === to) || null;
  const toName = (toBot && toBot.name) || roleWord(to);

  const startNew = () => {
    setOpen(null);
    setSelectedId(null);
  };
  const ask = () => {
    const q = draft.trim();
    if (!q) return;
    setDraft("");
    setOpen({
      key: `new:${Date.now()}`,
      question: q,
      recipient: to === "planner" ? null : { role: to, roleName: toName },
    });
  };
  const paused = !!(toBot && toBot.paused);
  const picker =
    team.length > 1 ? (
      <div className="flex flex-col gap-1" data-testid="dash-team-to">
        <div className="w-56">
          <SelectInput
            label="To"
            value={to}
            onChange={(v) => setTo(v)}
            options={team.map((b) => ({ value: b.role, label: b.name }))}
          />
        </div>
        <span className={`text-xs ${muted}`}>{ROLE_HINT[to] || ""}</span>
      </div>
    ) : null;

  return (
    <div className="flex flex-row flex-1 min-h-0 gap-4 px-5 pb-5">
      <div
        className={`flex flex-col w-64 flex-shrink-0 min-h-0 rounded-lg border ${hairline}`}
        data-testid="dash-team-threads"
      >
        <div className="flex-shrink-0 p-2">
          <Button3
            size="sm"
            onClick={startNew}
            disabled={!open}
            ariaLabel="New conversation"
          >
            <span className="inline-flex items-center gap-2">
              <FontAwesomeIcon icon="plus" className="h-3 w-3" />
              New conversation
            </span>
          </Button3>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
          {threads.length ? (
            threads.map((t) => (
              <ListRow
                key={t.id}
                testId="dash-team-thread"
                title={t.title}
                meta={t.sub}
                selected={t.id === selectedId}
                onClick={() => {
                  // Already open (maybe still answering): leave it be — a
                  // remount would drop the answer on its way.
                  if (open && t.id === selectedId) return;
                  setSelectedId(t.id);
                  setOpen({ key: t.id, recentId: t.id });
                }}
              />
            ))
          ) : (
            <p className={`px-2 py-3 text-xs ${muted}`}>
              Your questions show up here.
            </p>
          )}
        </div>
      </div>

      <div
        className={`flex flex-col flex-1 min-w-0 min-h-0 rounded-lg border ${hairline}`}
        data-testid="dash-team-chat"
      >
        {open ? (
          <AskStep
            key={open.key}
            question={open.question || ""}
            recentId={open.recentId || null}
            recipient={open.recipient || null}
            onOpenPlan={onOpenPlan}
            onStarted={setSelectedId}
          />
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              <EmptyState
                testId="dash-team-start"
                className="my-auto"
                icon={
                  <FontAwesomeIcon icon="people-group" className="h-6 w-6" />
                }
                title={
                  paused
                    ? to === "planner"
                      ? "The Dash team is paused"
                      : `The ${toName} is paused`
                    : "Ask the Dash team"
                }
                description={
                  paused
                    ? `Turn the ${toName} on to ask it questions${
                        to === "planner"
                          ? " about your dashboards and bots, or to plan something new"
                          : ""
                      }.`
                    : "Ask about your dashboards and bots, or ask for something new. If it plans something, you review the plan before anything is made."
                }
              >
                {paused && onTurnOn ? (
                  <Button3
                    size="sm"
                    title="Turn on"
                    onClick={() => onTurnOn(toBot)}
                  />
                ) : null}
              </EmptyState>
            </div>
            {paused ? (
              picker ? (
                <div className="flex-shrink-0 px-3 pb-3">{picker}</div>
              ) : null
            ) : (
              <ChatComposer
                ariaLabel="Ask the Dash team"
                value={draft}
                onChange={(v) => setDraft(v)}
                onSend={ask}
                placeholder={
                  to === "planner" ? "Ask the Dash team…" : `Ask the ${toName}…`
                }
                sendLabel="Ask"
                above={picker}
                className="flex-shrink-0"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** "When it plans · Opus · last ran 3h ago" — a role's row, under its name. */
export function roleLine(bot, lastRun, now = Date.now()) {
  const model = modelLabel(bot.model || bot.runsOn);
  const at = lastRun && (lastRun.endedAt || lastRun.at || lastRun.startedAt);
  const when = at ? shortTime(at, now) : "";
  // shortTime: "now" · "4m" · "3h" · "Tue" · "Sep 30".
  const ago =
    when === "now"
      ? "just now"
      : /^\d+[mh]$/.test(when)
        ? `${when} ago`
        : when
          ? `on ${when}`
          : "";
  return [bot.summary || null, model, ago ? `last ran ${ago}` : null]
    .filter(Boolean)
    .join(" · ");
}

const Settings = ({ all, workspaces, setDirty, guard }) => {
  const { muted } = useConfigTokens();
  const appContext = useContext(AppContext) || {};
  const [roleId, setRoleId] = useState(null);
  const [editing, setEditing] = useState(false);
  const team = ROLE_ORDER.map((r) =>
    all.dashTeam.find((b) => b && b.role === r),
  ).filter(Boolean);
  const role = team.find((b) => b.id === roleId) || null;
  const stopEditing = () => {
    setDirty(false);
    setEditing(false);
  };

  if (role && editing) {
    // BotDetail names the bot; the header is only the way back.
    return (
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-2">
        <PanelHeader
          title="Edit"
          onBack={() => guard(stopEditing)}
          backLabel={`Back to ${role.name}`}
        />
        <BotDetail
          key={role.id}
          bot={role}
          providers={appContext.providers || {}}
          workspaces={workspaces}
          getWidgetConfig={getWidgetConfig}
          bots={all.bots}
          onDirtyChange={setDirty}
          onSave={async (definition) => {
            const b = botsApi();
            const saved = b && b.save ? await b.save(definition) : null;
            await all.refresh();
            stopEditing();
            return saved;
          }}
          onCancel={stopEditing}
        />
      </div>
    );
  }
  if (role) {
    // DashTeamPanel names the role; the header is only the way back.
    return (
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-3 overflow-y-auto">
        <PanelHeader
          title="All roles"
          onBack={() => setRoleId(null)}
          backLabel="Back to all roles"
        />
        <DashTeamPanel
          bot={role}
          status={all.statusOf(role.id)}
          lastRun={all.lastRunOf(role.id)}
          onChanged={all.refresh}
          onEdit={() => setEditing(true)}
        />
      </div>
    );
  }
  return (
    <div
      className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-2 overflow-y-auto"
      data-testid="dash-team-roles"
    >
      {team.length ? (
        team.map((b) => (
          <ListRow
            key={b.id}
            testId="dash-team-role"
            icon={<BotAvatar bot={b} />}
            // The badge sits in the title: ListRow's trailing slot only
            // shows on hover.
            title={
              <span className="flex flex-row items-center gap-1.5 min-w-0">
                <span className="truncate">{b.name}</span>
                <StatusBadge
                  state={b.paused ? "warning" : "neutral"}
                  label={b.paused ? "Paused" : "On"}
                  compact
                />
              </span>
            }
            ariaLabel={`${b.name}, ${b.paused ? "paused" : "on"}: ${roleLine(b, all.lastRunOf(b.id))}`}
            meta={roleLine(b, all.lastRunOf(b.id))}
            onClick={() => setRoleId(b.id)}
          />
        ))
      ) : (
        <p className={`text-sm ${muted}`}>
          {all.loading ? "Loading the team…" : "The Dash team isn't set up."}
        </p>
      )}
      <span className={`text-xs ${muted}`}>
        Pick a role to pause it, change its model or edit it.
      </span>
    </div>
  );
};

/**
 * DashTeamPage — the Dash team as one contact (consolidation Phase 4a,
 * app-navigation NAV-016 AC7), opened from the Bots panel's pinned row.
 *
 * Conversation: your questions to the team, one thread each (AskStep — the
 * Planner answers; an answer that plans something has Open as a plan). The
 * threads are the questions kept in Create's Recent, including ones asked
 * of a team lead, so nothing asked before is lost. Plans and builds the
 * team runs in Create aren't threads here.
 *
 * Settings: the four roles; pick one for its panel (pause, model, last run)
 * and Edit for its form — what Manage › Bots › Dash team shows.
 *
 * @param {"conversation"|"settings"} [initialTab]
 * @param {string} [role]  who a new question goes to ("planner", "scout",
 *   "builder", "checker"); a new value opens a new question to it
 * @param {(role: string) => void} [onRoleChange]  the To: picker changed
 * @param {object[]} [workspaces]
 * Unsaved role edits are never dropped silently: leaving them (another
 * tab, back, close) asks first, and `onDirtyChange` tells the host (the
 * modal keeps outside clicks from closing it).
 *
 * @param {(seed) => void} [onOpenPlan]  Open as a plan
 * @param {() => void} [onClose]
 * @param {(dirty: boolean) => void} [onDirtyChange]
 */
export const DashTeamPage = ({
  initialTab = "conversation",
  role = "planner",
  onRoleChange = null,
  workspaces = EMPTY,
  onOpenPlan = null,
  onClose = null,
  onDirtyChange = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [tab, setTab] = useState(
    initialTab === "settings" ? "settings" : "conversation",
  );
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (v) => {
    setDirtyState(!!v);
    if (onDirtyChange) onDirtyChange(!!v);
  };
  // Another role picked by the host (it asked about unsaved edits first):
  // its conversation.
  const roleSeen = useRef(role);
  useEffect(() => {
    if (roleSeen.current === role) return;
    roleSeen.current = role;
    setDirty(false);
    setTab("conversation");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);
  // A way out waiting on "Discard unsaved changes?".
  const [leaveTo, setLeaveTo] = useState(null);
  const guard = (leave) => {
    if (dirty) setLeaveTo(() => leave);
    else leave();
  };
  const all = useAllBots();
  const team = ROLE_ORDER.map((r) =>
    all.dashTeam.find((b) => b && b.role === r),
  ).filter(Boolean);
  const turnOn = async (role) => {
    const b = botsApi();
    if (!role || !b || !b.resumeBot) return;
    try {
      await b.resumeBot(role.id);
    } finally {
      await all.refresh();
    }
  };

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${strong}`}
      data-testid="dash-team-page"
    >
      <div
        className={`flex-shrink-0 flex flex-row items-start justify-between gap-3 px-5 pt-4 pb-3 border-b ${hairline}`}
      >
        <div className="flex flex-row items-center gap-3 min-w-0">
          <BotAvatar bot={DASH_TEAM_CONTACT} icon="people-group" large />
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className="text-lg font-semibold truncate">Dash team</h3>
            <span className={`text-xs ${muted}`}>
              Dash Lead · Planner · Scout · Builder · Checker
            </span>
          </div>
        </div>
        {onClose ? (
          <ButtonIcon3
            icon="xmark"
            ariaLabel="Close"
            onClick={() => guard(onClose)}
          />
        ) : null}
      </div>
      <div className="flex-shrink-0 px-5 py-3">
        <SegmentedControl
          ariaLabel="Show"
          value={tab}
          onChange={(v) =>
            guard(() => {
              setDirty(false);
              setTab(v);
            })
          }
          options={TABS}
        />
      </div>
      <div className="flex-shrink-0 px-5">
        <DashTeamApprovals compact />
      </div>
      {tab === "conversation" ? (
        <Conversation
          team={team}
          role={role}
          onRoleChange={onRoleChange}
          onTurnOn={turnOn}
          onOpenPlan={onOpenPlan}
        />
      ) : (
        <Settings
          all={all}
          workspaces={workspaces}
          setDirty={setDirty}
          guard={guard}
        />
      )}
      {leaveTo ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setLeaveTo(null)}
          title="Discard unsaved changes?"
          message="Your changes to this role haven't been saved."
          confirmLabel="Discard"
          variant="danger"
          onConfirm={() => {
            const leave = leaveTo;
            setLeaveTo(null);
            setDirty(false);
            leave();
          }}
          onCancel={() => setLeaveTo(null)}
        />
      ) : null}
    </div>
  );
};

export default DashTeamPage;
