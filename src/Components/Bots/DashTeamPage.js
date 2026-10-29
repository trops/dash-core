import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  ButtonIcon3,
  ConfirmationModal,
  ListRow,
  PanelHeader,
  SegmentedControl,
  StatusBadge,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotDetail } from "../Settings/details/BotDetail";
import { DashTeamPanel } from "../AppPages/DashTeamPanel";
import { useAllBots } from "../AppPages/useAllBots";
import { modelLabel } from "../../utils/runCostLabel";
import { shortTime } from "./contactsList";
import { BotAvatar } from "./BotAvatar";
import { DASH_TEAM_CONTACT } from "./dashTeamContact";
import { DashTeamApprovals } from "./DashTeamApprovals";
import { BotRunHistory } from "./BotRunHistory";

// Managing only (lead-workspace releases 5, 6b): the role's runs and the
// team's settings; the team is talked to in the Dash Lead's conversations.
const TABS = [
  { value: "activity", label: "Activity" },
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
 * DashTeamPage — the Dash team on the Bots page (lead-workspace releases 5
 * and 6b): a role's Activity, and the team's Settings — the four roles; pick
 * one for its panel (pause, model, last run) and Edit for its form. The team
 * is talked to through the Dash Lead (Open conversation), not here.
 *
 * @param {"activity"|"settings"} [initialTab]
 * @param {string|null} [role]  the role whose Activity shows; none for the
 *   team's own header (its Settings)
 * @param {object[]} [workspaces]
 * Unsaved role edits are never dropped silently: leaving them (another
 * tab, back, close) asks first, and `onDirtyChange` tells the host (the
 * modal keeps outside clicks from closing it).
 *
 * @param {() => void} [onClose]
 * @param {(dirty: boolean) => void} [onDirtyChange]
 */
export const DashTeamPage = ({
  initialTab = "activity",
  role = null,
  workspaces = EMPTY,
  onClose = null,
  onDirtyChange = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const [tab, setTab] = useState(
    initialTab === "settings" ? "settings" : "activity",
  );
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (v) => {
    setDirtyState(!!v);
    if (onDirtyChange) onDirtyChange(!!v);
  };
  // Another role picked by the host (it asked about unsaved edits first):
  // its Activity.
  const roleSeen = useRef(role);
  useEffect(() => {
    if (roleSeen.current === role) return;
    roleSeen.current = role;
    setDirty(false);
    setTab("activity");
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
  const roleBot = team.find((b) => b.role === role) || null;
  // A working role (not the Dash Lead) is talked to through the Dash Lead.
  const member = !!roleBot && role !== "dashlead";
  // No role picked: the team's Settings (there's no Activity to show).
  const shownTab = roleBot ? tab : "settings";

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${strong}`}
      data-testid="dash-team-page"
    >
      <div
        className={`flex-shrink-0 flex flex-row items-start justify-between gap-3 px-5 pt-4 pb-3 border-b ${hairline}`}
      >
        <div className="flex flex-row items-center gap-3 min-w-0">
          <BotAvatar
            bot={roleBot || DASH_TEAM_CONTACT}
            icon={roleBot ? "robot" : "people-group"}
            large
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className="text-lg font-semibold truncate">
              {roleBot ? roleBot.name : "Dash team"}
            </h3>
            <span className={`text-xs ${muted}`}>
              {roleBot
                ? `On the Dash team${roleBot.summary ? ` · ${roleBot.summary}` : ""}`
                : "Dash Lead · Planner · Scout · Builder · Checker"}
            </span>
          </div>
        </div>
        <div className="flex flex-row items-center gap-2 flex-shrink-0">
          {member ? null : (
            <Button
              // Only the Dash Lead has a conversation (frame 14).
              title="Open conversation"
              size="sm"
              // Unsaved role edits are asked about first.
              onClick={() =>
                guard(() =>
                  window.dispatchEvent(
                    new CustomEvent("dash:open-workspace", {
                      detail: { key: "role:dashlead" },
                    }),
                  ),
                )
              }
            />
          )}
          {onClose ? (
            <ButtonIcon3
              icon="xmark"
              ariaLabel="Close"
              onClick={() => guard(onClose)}
            />
          ) : null}
        </div>
      </div>
      <div className="flex-shrink-0 px-5 py-3">
        <SegmentedControl
          ariaLabel="Show"
          value={shownTab}
          onChange={(v) =>
            guard(() => {
              setDirty(false);
              setTab(v);
            })
          }
          options={roleBot ? TABS : TABS.filter((t) => t.value === "settings")}
        />
      </div>
      {member ? (
        <div className="flex-shrink-0 px-5 pb-2">
          <div
            data-testid="dash-team-member-note"
            className={`rounded-lg px-4 py-3 text-sm ${muted} ${selectedBg}`}
          >
            You talk to the Dash team through the Dash Lead.
          </div>
        </div>
      ) : null}
      <div className="flex-shrink-0 px-5">
        <DashTeamApprovals compact />
      </div>
      {shownTab === "activity" ? (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          <BotRunHistory bot={roleBot} />
        </div>
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
