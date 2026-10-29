import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button2,
  FontAwesomeIcon,
  SegmentedControl,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { WorkspaceContext } from "../../../Context/WorkspaceContext";
import { useBotContacts } from "../useBotContacts";
import { useTeamLeads } from "../../AiAssistant/components/RecipientPicker";
import { BotAvatar } from "../BotAvatar";
import { needsYou, whenText } from "./needsYou";
import { activityLog } from "./activityLog";

const EMPTY = [];
const RUN_LIMIT = 50;
const SEEN_KEY = "dash:botNotifications:seenAt";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** When the user last looked at the panel — a convenience, per device. */
export function readSeenAt() {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch (_e) {
    return 0;
  }
}
function writeSeenAt(at) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(at));
  } catch (_e) {
    // private window: NEW just isn't remembered
  }
}

/** Every bot's latest runs, newest first, kept current. */
function useRecentRuns() {
  const [runs, setRuns] = useState(EMPTY);
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.listRecentRuns) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.listRecentRuns(RUN_LIMIT))
        .then((r) => alive && setRuns(Array.isArray(r) ? r : EMPTY))
        .catch(() => {});
    load();
    const ids = [];
    if (b.onStream)
      ids.push(
        b.onStream(({ event } = {}) => {
          const t = event && event.type;
          if (t === "done" || t === "error") load();
        }),
      );
    return () => {
      alive = false;
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, []);
  return runs;
}

/** The Dash team's bots (for their approvals' names) — read once. */
function useDashTeam() {
  const [team, setTeam] = useState(EMPTY);
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.listDashTeam) return undefined;
    let alive = true;
    Promise.resolve(b.listDashTeam())
      .then((l) => alive && setTeam(Array.isArray(l) ? l : EMPTY))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return team;
}

/** Recent's conversations, kept current (plans waiting for a yes). */
function useRecents() {
  const [entries, setEntries] = useState(EMPTY);
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.listCreateRecent) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.listCreateRecent())
        .then((l) => alive && setEntries(Array.isArray(l) ? l : EMPTY))
        .catch(() => {});
    load();
    const id = b.onCreateRecent ? b.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, []);
  return entries;
}

/** Open a conversation ({ key, recentId? }) or, for a lone bot, its page. */
function openPlace(open) {
  if (!open || typeof window === "undefined") return;
  if (open.key) {
    window.dispatchEvent(
      new CustomEvent("dash:open-workspace", {
        detail: {
          key: open.key,
          ...(open.recentId ? { recentId: open.recentId } : {}),
        },
      }),
    );
  } else if (open.botId) {
    window.dispatchEvent(
      new CustomEvent("dash:open-bot", { detail: { botId: open.botId } }),
    );
  }
}

/**
 * BotNotificationsPanel — the right rail's bot notifications (lead-workspace
 * release 4, frames 22, 27–29): the shown dashboard's lead and Open
 * conversation; Needs you from every dashboard — Allow once / Deny, Retry or
 * Reconnect answered here, plans opened in their conversation; and Activity
 * for this dashboard or all of them. Stays mounted while collapsed so the
 * rail's dot (and the panel opening by itself) stay live.
 *
 * @param {boolean} collapsed
 * @param {() => void} onClose
 * @param {({ count, newestAt }) => void} onNeedsChange  for the rail
 * @param {{ botId }|null} openRequest  a clicked OS notification
 */
export const BotNotificationsPanel = ({
  collapsed = false,
  onClose = null,
  onNeedsChange = null,
  openRequest = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const link = `${(currentTheme && currentTheme["text-primary-medium"]) || ""} dr-role-accent`;
  const statusTokens = useStatusTokens();
  const { workspaceData = null, workspaces = EMPTY } =
    useContext(WorkspaceContext) || {};
  const contacts = useBotContacts();
  const dashTeam = useDashTeam();
  const { leads } = useTeamLeads(true);
  const recents = useRecents();
  const runs = useRecentRuns();
  const [scope, setScope] = useState("here");
  // What's been answered here, for a moment, until the lists catch up.
  const [answered, setAnswered] = useState({});
  const [busy, setBusy] = useState({});

  // NEW: since the user last looked — read once when the panel opens.
  const [seenAt, setSeenAt] = useState(() => readSeenAt());
  const wasCollapsed = useRef(collapsed);
  useEffect(() => {
    if (wasCollapsed.current && !collapsed) setSeenAt(readSeenAt());
    if (!wasCollapsed.current && collapsed) writeSeenAt(Date.now());
    wasCollapsed.current = collapsed;
  }, [collapsed]);
  useEffect(
    () => () => {
      if (!wasCollapsed.current) writeSeenAt(Date.now());
    },
    [],
  );

  const current =
    workspaceData && workspaceData.id != null ? String(workspaceData.id) : null;
  const dashboards = useMemo(() => {
    const out = {};
    for (const w of workspaces || []) {
      if (w && w.id != null) out[String(w.id)] = w.name || w.label || "";
    }
    return out;
  }, [workspaces]);
  const bots = useMemo(
    () => [
      ...(contacts.bots || []),
      ...dashTeam.map((b) => ({ ...b, dashTeam: true })),
    ],
    [contacts.bots, dashTeam],
  );
  const needs = useMemo(
    () =>
      needsYou({
        approvals: contacts.approvals,
        bots,
        lastRuns: contacts.lastRuns,
        running: contacts.running,
        recents,
        leads,
        dashboards,
        current,
        seenAt,
      }).filter((n) => !answered[n.id]),
    [contacts, bots, recents, leads, dashboards, current, seenAt, answered],
  );
  const log = useMemo(
    () =>
      activityLog({
        runs,
        bots,
        dashboards,
        current,
        scope: current ? scope : "all",
      }),
    [runs, bots, dashboards, current, scope],
  );

  // The rail's dot, and the panel opening by itself for something new.
  const newestAt = needs.reduce((max, n) => Math.max(max, n.at), 0);
  useEffect(() => {
    if (onNeedsChange) onNeedsChange({ count: needs.length, newestAt });
  }, [needs.length, newestAt, onNeedsChange]);

  // A clicked OS notification about a bot: its conversation or page.
  const handled = useRef(null);
  useEffect(() => {
    if (!openRequest || !openRequest.botId || handled.current === openRequest)
      return;
    handled.current = openRequest;
    const it = needs.find((n) => String(n.botId) === String(openRequest.botId));
    openPlace(it ? it.open : { botId: openRequest.botId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  if (collapsed) return null;

  const lead = current
    ? (leads || []).find((l) => String(l.dashboardId) === current) || null
    : null;
  const act = async (item, call, done = true) => {
    setBusy((b) => ({ ...b, [item.id]: true }));
    try {
      await call();
      if (done) setAnswered((a) => ({ ...a, [item.id]: true }));
    } catch (_e) {
      // it stays; the next refresh says how it stands
    } finally {
      setBusy((b) => ({ ...b, [item.id]: false }));
    }
  };
  const reconnect = (item) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("dash:open-page", {
        detail: { page: "providers", providerName: item.provider || null },
      }),
    );
  };
  const toneOf = (t) =>
    t === "ok"
      ? statusTokens.success.icon
      : t === "bad"
        ? statusTokens.error.icon
        : muted;

  return (
    <aside
      aria-label="Bot notifications"
      className="flex flex-col gap-4 h-full min-h-0 overflow-y-auto p-4"
      data-testid="bot-notifications"
    >
      {/* Who to talk to about this dashboard's bots (frame 22). */}
      <div className="flex flex-row items-center gap-3">
        {lead ? (
          <BotAvatar bot={{ id: lead.botId, name: lead.leadName }} />
        ) : null}
        <span className="flex-1 min-w-0 flex flex-col">
          <span className={`text-sm font-semibold truncate ${strong}`}>
            {lead ? lead.leadName : "Bot notifications"}
          </span>
          <span className={`text-xs ${muted}`}>
            {lead
              ? "Your contact for this dashboard's bots"
              : "From every dashboard"}
          </span>
        </span>
        {onClose ? (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`flex items-center justify-center h-8 w-8 rounded-lg ${muted}`}
          >
            <FontAwesomeIcon icon="xmark" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {lead ? (
        <Button2
          title={`Open conversation with ${lead.leadName}`}
          onClick={() => openPlace({ key: `lead:${lead.botId}` })}
        />
      ) : null}

      {/* Needs you, from every dashboard. */}
      <section
        aria-label="Needs you"
        className="flex flex-col gap-2"
        data-testid="bot-notifications-needs"
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${statusTokens.warning.icon}`}
        >
          {needs.length ? `Needs you · ${needs.length}` : "Needs you"}
        </span>
        {needs.length ? (
          needs.map((n) => (
            <div
              key={n.id}
              className={`flex flex-col gap-2 rounded-xl border p-3 ${
                n.isNew ? statusTokens.warning.accentBorder : hairline
              } ${selectedBg} dr-role-surface`}
              data-testid="bot-notifications-item"
              data-kind={n.kind}
            >
              <span className={`text-xs ${muted}`}>{n.who}</span>
              <span className="flex flex-row items-center gap-2">
                <span
                  className={`flex-1 min-w-0 text-sm font-semibold ${strong}`}
                >
                  {n.title}
                </span>
                {n.where ? (
                  <span
                    className={`flex-shrink-0 rounded-full border px-2 text-xs ${hairline} ${muted}`}
                  >
                    {n.where}
                  </span>
                ) : null}
                {n.isNew ? (
                  <span
                    className={`flex-shrink-0 rounded-full px-1.5 text-xs font-semibold ${statusTokens.warning.solidBg}`}
                  >
                    NEW
                  </span>
                ) : null}
                <span className={`flex-shrink-0 text-xs ${muted}`}>
                  {whenText(n.at)}
                </span>
              </span>
              <span className={`text-sm ${muted}`}>{n.text}</span>
              {n.convo ? (
                <span className={`text-xs ${muted}`}>{n.convo}</span>
              ) : null}
              <div className="flex flex-row flex-wrap items-center gap-2">
                {n.kind === "approval" ? (
                  <>
                    <Button
                      size="sm"
                      title="Allow once"
                      disabled={!!busy[n.id]}
                      onClick={() =>
                        act(n, () =>
                          contacts.approve(n.approvalId, { allow: true }),
                        )
                      }
                    />
                    <Button2
                      size="sm"
                      title="Deny"
                      disabled={!!busy[n.id]}
                      onClick={() =>
                        act(n, () =>
                          contacts.approve(n.approvalId, { allow: false }),
                        )
                      }
                    />
                  </>
                ) : n.kind === "failed" ? (
                  n.reconnect ? (
                    <Button
                      size="sm"
                      title={
                        n.provider ? `Reconnect ${n.provider}` : "Reconnect"
                      }
                      onClick={() => reconnect(n)}
                    />
                  ) : (
                    <Button
                      size="sm"
                      title="Retry"
                      disabled={!!busy[n.id]}
                      onClick={() => act(n, () => botsApi().run(n.botId))}
                    />
                  )
                ) : (
                  <Button
                    size="sm"
                    title="Review in conversation"
                    onClick={() => openPlace(n.open)}
                  />
                )}
                <span className="flex-1" />
                {n.kind !== "plan" && n.open ? (
                  <button
                    type="button"
                    onClick={() => openPlace(n.open)}
                    className={`text-xs ${link}`}
                  >
                    Details
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <span
            className={`text-sm ${muted}`}
            data-testid="bot-notifications-quiet"
          >
            Nothing needs you right now.
          </span>
        )}
      </section>

      {/* What the bots did: this dashboard, or every one (frame 29). */}
      <section
        aria-label="Activity"
        className="flex flex-col gap-1 min-h-0"
        data-testid="bot-notifications-activity"
      >
        <div className="flex flex-row items-center gap-2 pb-1">
          <span
            className={`flex-1 text-xs font-semibold uppercase tracking-wider ${muted}`}
          >
            Activity
          </span>
          {current ? (
            <SegmentedControl
              ariaLabel="Show activity from"
              value={scope}
              onChange={setScope}
              options={[
                { value: "here", label: "This dashboard" },
                { value: "all", label: "All" },
              ]}
            />
          ) : null}
        </div>
        {log.length ? (
          log.map((l) => (
            <div
              key={l.id}
              className={`flex flex-row items-start gap-3 border-b py-2 text-sm ${hairline}`}
              data-testid="bot-notifications-log"
            >
              <span className={`w-16 flex-shrink-0 text-xs ${muted}`}>
                {l.time}
              </span>
              <FontAwesomeIcon
                icon="circle"
                className={`h-2 w-2 mt-1 flex-shrink-0 ${toneOf(l.tone)}`}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span>
                  <span className={`font-semibold ${strong}`}>{l.who}</span>{" "}
                  <span className={muted}>{l.text}</span>
                  {l.where ? (
                    <span className={muted}>{` · ${l.where}`}</span>
                  ) : null}
                </span>
                {l.open ? (
                  <button
                    type="button"
                    onClick={() => openPlace(l.open)}
                    className={`self-start text-xs ${link}`}
                  >
                    Open conversation
                  </button>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <span className={`py-2 text-sm ${muted}`}>
            {scope === "here" && current
              ? "This dashboard's bots haven't run yet."
              : "No bot has run yet."}
          </span>
        )}
      </section>

      <span
        className={`mt-auto flex flex-row items-center gap-1 text-xs ${muted}`}
      >
        <span>
          Bot settings are on the{" "}
          <button
            type="button"
            onClick={() =>
              typeof window !== "undefined" &&
              window.dispatchEvent(
                new CustomEvent("dash:open-page", { detail: { page: "bots" } }),
              )
            }
            className={`text-xs ${link}`}
          >
            Bots page
          </button>
          .
        </span>
      </span>
    </aside>
  );
};

export default BotNotificationsPanel;
