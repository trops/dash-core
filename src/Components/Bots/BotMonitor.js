import React, { useContext, useEffect, useState } from "react";
import { Button, Button3, ThemeContext } from "@trops/dash-react";
import { toPlainText } from "./botConversation";

/**
 * BotMonitor — the Bot Activity side panel's body (bot-teams PRD TEAM-011
 * AC9): every dashboard's bots at a glance. Three sections — Needs you
 * (pending approvals), Running now, Recent — each item labelled
 * "Bot · Dashboard" with a way into the Bots view. Watching only: bots are
 * started from the Bots view or Settings › Bots.
 *
 * @param {object} monitor        useBotMonitor()
 * @param {object[]} workspaces   all dashboards (for names)
 * @param {(workspaceId: string, botId: string, tab: "conversation"|"activity") => void} [onOpenBotsView]
 * @param {(botId: string) => void} [onOpenSettings]  bots on no dashboard
 */
const EMPTY = [];
const STATUS_DOT = {
  completed: "bg-green-400",
  failed: "bg-red-400",
  running: "bg-indigo-400",
};
const TICK_MS = 30000;

export function relativeTime(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function runningFor(iso, now) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "Running";
  const min = Math.floor((now - t) / 60000);
  return min < 1 ? "Running · just started" : `Running · ${min} min`;
}

function statusLabel(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

function firstLine(run) {
  if (run.status === "failed" && run.error) return run.error;
  if (run.outputUnavailable) return "Answer unavailable";
  return toPlainText(run.output || "").split("\n")[0];
}

export const BotMonitor = ({
  monitor,
  workspaces = EMPTY,
  onOpenBotsView = null,
  onOpenSettings = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const strong = currentTheme["text-neutral-light"] || "text-gray-200";
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";

  // Re-render periodically so "5 min ago" / "Running · 3 min" stay true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  if (!monitor) return null;
  const { approvals = EMPTY, running = EMPTY, recent = EMPTY } = monitor;

  const dashboardName = (workspaceId) => {
    if (workspaceId === null || workspaceId === undefined) {
      return "No dashboard";
    }
    const ws = workspaces.find((w) => String(w.id) === String(workspaceId));
    return ws ? ws.name : "Unknown dashboard";
  };

  const workspaceOf = (botId, fallback) => {
    const bot = monitor.botById ? monitor.botById(botId) : null;
    const id = bot ? bot.workspaceId : fallback;
    return id === null || id === undefined ? null : String(id);
  };

  const label = (botId, name, workspaceId) =>
    `${name} · ${dashboardName(workspaceId)}`;

  const openAction = (botId, workspaceId, tab) => {
    if (workspaceId !== null && onOpenBotsView) {
      return (
        <Button3
          title="Open in Bots view"
          size="xs"
          onClick={() => onOpenBotsView(workspaceId, botId, tab)}
        />
      );
    }
    if (workspaceId === null && onOpenSettings) {
      return (
        <Button3
          title="Open in Settings"
          size="xs"
          onClick={() => onOpenSettings(botId)}
        />
      );
    }
    return null;
  };

  const sectionHeader = (text, count) => (
    <div className={`text-xs uppercase tracking-wider font-semibold ${muted}`}>
      {text}
      {count ? ` · ${count}` : ""}
    </div>
  );

  const nothing = !approvals.length && !running.length && !recent.length;

  return (
    <div className={`flex flex-col gap-5 p-4 ${strong}`}>
      {nothing && !monitor.loading ? (
        <div className={`text-sm ${muted}`}>
          All quiet — no approvals waiting, nothing running, no runs yet. Start
          a bot from a dashboard&apos;s Bots view.
        </div>
      ) : null}

      {approvals.length ? (
        <section aria-label="Needs you" className="flex flex-col gap-2">
          {sectionHeader("Needs you", approvals.length)}
          {approvals.map((a) => {
            const req = a.request || {};
            const bot = monitor.botById ? monitor.botById(req.botId) : null;
            const ws = workspaceOf(req.botId, null);
            return (
              <div
                key={a.id}
                className="rounded-lg border border-amber-700 px-3 py-2.5 flex flex-col gap-2"
              >
                <span className="text-sm font-medium">
                  {label(req.botId, bot ? bot.name : "A bot", ws)}
                </span>
                <span className={`text-xs ${muted}`}>
                  Wants to use{" "}
                  <span className="font-mono">{req.toolName || "a tool"}</span>
                  {req.serverName ? ` on ${req.serverName}` : " (built-in)"}
                </span>
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <Button3
                    title="Allow once"
                    size="xs"
                    onClick={() => monitor.approve(a.id, { allow: true })}
                  />
                  {req.serverName ? (
                    <Button
                      title="Always allow"
                      size="xs"
                      onClick={() =>
                        monitor.approve(a.id, { allow: true, remember: true })
                      }
                    />
                  ) : null}
                  <Button3
                    title="Deny"
                    size="xs"
                    onClick={() => monitor.approve(a.id, { allow: false })}
                  />
                  <div className="flex-1" />
                  {openAction(req.botId, ws, "conversation")}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {running.length ? (
        <section aria-label="Running now" className="flex flex-col gap-2">
          {sectionHeader("Running now", running.length)}
          {running.map((r) => {
            const ws = workspaceOf(r.id, r.workspaceId);
            return (
              <div
                key={r.id}
                className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${hairline}`}
              >
                <div className="flex flex-row items-center gap-2">
                  <span className="h-2 w-2 rounded-full flex-shrink-0 bg-indigo-400" />
                  <span className="text-sm font-medium truncate">
                    {label(r.id, r.name, ws)}
                  </span>
                </div>
                <div className="flex flex-row items-center gap-2">
                  <span className={`text-xs ${muted}`}>
                    {runningFor(r.startedAt, now)}
                  </span>
                  <div className="flex-1" />
                  <Button3
                    title="Stop"
                    size="xs"
                    onClick={() => monitor.stop(r.id)}
                  />
                  {openAction(r.id, ws, "conversation")}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {recent.length ? (
        <section aria-label="Recent" className="flex flex-col gap-1">
          {sectionHeader("Recent")}
          {recent.map((item, i) => {
            const ws = workspaceOf(item.botId, item.workspaceId);
            const run = item.run || {};
            const dot = STATUS_DOT[run.status] || "bg-gray-500";
            const canOpen =
              (ws !== null && onOpenBotsView) ||
              (ws === null && onOpenSettings);
            const open = () => {
              if (ws !== null && onOpenBotsView) {
                onOpenBotsView(ws, item.botId, "activity");
              } else if (ws === null && onOpenSettings) {
                onOpenSettings(item.botId);
              }
            };
            return (
              <button
                key={`${item.botId}-${i}`}
                type="button"
                onClick={open}
                disabled={!canOpen}
                className={`w-full text-left flex flex-col gap-0.5 py-2 border-b ${hairline}`}
              >
                <span className="flex flex-row items-center gap-2 text-sm">
                  <span
                    role="img"
                    aria-label={statusLabel(run.status)}
                    title={statusLabel(run.status)}
                    className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`}
                  />
                  <span className="truncate font-medium">
                    {label(item.botId, item.botName, ws)}
                  </span>
                  <span className={`ml-auto text-xs flex-shrink-0 ${muted}`}>
                    {relativeTime(run.endedAt || run.at, now)}
                  </span>
                </span>
                <span className={`text-xs truncate ${muted}`}>
                  {firstLine(run)}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
    </div>
  );
};
