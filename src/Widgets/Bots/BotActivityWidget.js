import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  EmptyState,
  FontAwesomeIcon,
  Panel,
  StatusBadge,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { Widget } from "../../Widget";
import { useTeamBots } from "../../Components/Bots/useTeamBots";
import {
  readableError,
  toPlainText,
  triggerLabel,
} from "../../Components/Bots/botConversation";
import { dayTime, openBotsView } from "./BotResultsWidget";

const STATUS_TEXT = {
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  running: "Running",
};

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// A run's conclusion: its last non-empty line (answers open with narration).
function summaryLine(run) {
  if (run.status === "failed") return readableError(run.error) || "Failed";
  const lines = toPlainText(run.output || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

/**
 * BotActivityContent — the latest runs of THIS dashboard's bots, newest
 * first, with waiting approvals on top (bot-teams TEAM-012). A row opens its
 * bot in the Bots view.
 *
 * @param {string|number} dashboardId
 * @param {object} team  useTeamBots(dashboardId)
 */
export const BotActivityContent = ({ dashboardId, team }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = `${currentTheme["text-neutral-medium"] || "text-gray-400"} dr-role-muted`;
  const hairline = `${currentTheme["border-neutral-dark"] || "border-gray-700"} dr-role-hairline`;
  const strong = `${currentTheme["text-neutral-light"] || ""} dr-role-text`;
  const statusTokens = useStatusTokens();
  const [rows, setRows] = useState(null);

  const teamIds = ((team && team.bots) || []).map((b) => b.id);
  const teamKey = teamIds.join(",");
  const nameOf = (id) =>
    ((team && team.bots) || []).find((b) => b.id === id)?.name || id;

  const load = useCallback(async () => {
    const b = api();
    if (!b || !b.listRecentRuns) return;
    const all = (await b.listRecentRuns(50)) || [];
    setRows(
      all
        .filter((r) => String(r.workspaceId) === String(dashboardId))
        .slice(0, 15),
    );
  }, [dashboardId]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when one of this team's bots finishes a run.
  useEffect(() => {
    const b = api();
    if (!b || !b.onStream) return undefined;
    const id = b.onStream(({ botId, event } = {}) => {
      const ids = teamKey ? teamKey.split(",") : [];
      if (!ids.includes(botId)) return;
      const t = event && event.type;
      if (t === "done" || t === "error" || t === "skipped") load();
    });
    return () => b.removeListener && b.removeListener(id);
  }, [teamKey, load]);

  const approvals = ((team && team.approvals) || []).filter(
    (a) => a && a.request && teamIds.includes(a.request.botId),
  );

  // Runs by day: Today, Yesterday, then the date (approved mockup).
  const dayOf = (iso) => {
    const at = dayTime(iso);
    return at ? at.split(",")[0] : "Earlier";
  };
  const groups = [];
  for (const r of rows || []) {
    const day = dayOf(r.run.endedAt || r.run.startedAt);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  const tone = (status) =>
    status === "completed"
      ? ["success", "check"]
      : status === "failed"
        ? ["error", "exclamation"]
        : status === "running"
          ? ["info", "spinner"]
          : ["neutral", "circle-stop"];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={`flex flex-row items-center gap-3 pb-3 border-b ${hairline}`}
      >
        <span
          className={`dr-chat-card flex flex-shrink-0 items-center justify-center h-8 w-8 rounded-lg border ${hairline}`}
        >
          <FontAwesomeIcon icon="bolt" className={`h-3.5 w-3.5 ${muted}`} />
        </span>
        <span className={`flex-1 text-sm font-semibold ${strong}`}>
          Bot activity
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pt-3">
        {approvals.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() =>
              openBotsView(dashboardId, a.request.botId, "conversation")
            }
            className={`text-left flex flex-row items-center gap-3 rounded-xl border px-3 py-2 ${statusTokens.warning.bg || ""} ${statusTokens.warning.border || ""}`}
          >
            <FontAwesomeIcon
              icon="hand"
              className={`h-3.5 w-3.5 ${statusTokens.warning.icon || ""}`}
            />
            <span className={`flex-1 text-xs font-semibold ${strong}`}>
              {`${nameOf(a.request.botId)} wants to use ${a.request.toolName}${a.request.serverName ? ` on ${a.request.serverName}` : ""}`}
            </span>
            <StatusBadge state="warning" label="Needs you" />
          </button>
        ))}
        {rows && !rows.length ? (
          <EmptyState
            icon={<FontAwesomeIcon icon="bolt" className="h-5 w-5" />}
            title="No bot runs yet"
            description="No bot runs on this dashboard yet — each run shows here as it happens."
          />
        ) : null}
        {groups.map((g) => (
          <div key={g.day} className="flex flex-col">
            <span
              className={`text-xs font-semibold uppercase tracking-wider pt-2 pb-1 ${muted}`}
            >
              {g.day}
            </span>
            {g.rows.map((r, i) => {
              const trigger = triggerLabel(r.run, nameOf);
              const t = r.run.endedAt || r.run.startedAt;
              const [state, icon] = tone(r.run.status);
              const s = statusTokens[state] || {};
              const time = t
                ? new Date(t).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : null;
              return (
                <button
                  key={`${r.botId}-${t}-${i}`}
                  type="button"
                  data-testid="bot-activity-row"
                  onClick={() => openBotsView(dashboardId, r.botId, "activity")}
                  className={`dr-clickable text-left flex flex-row items-start gap-3 rounded-lg px-1 py-2 ${i ? `border-t ${hairline}` : ""}`}
                >
                  <span
                    className={`flex flex-shrink-0 items-center justify-center h-6 w-6 rounded-full ${s.bg || ""}`}
                    aria-label={STATUS_TEXT[r.run.status] || r.run.status}
                  >
                    <FontAwesomeIcon
                      icon={icon}
                      className={`h-3 w-3 ${s.icon || muted} ${r.run.status === "running" ? "animate-spin" : ""}`}
                    />
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="flex flex-row items-baseline gap-2">
                      <span className={`text-sm font-semibold ${strong}`}>
                        {r.botName}
                      </span>
                      <span className={`text-xs ${muted}`}>
                        {[time, trigger].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span
                      className={`text-xs truncate ${r.run.status === "failed" ? statusTokens.error.icon || "" : muted}`}
                    >
                      {summaryLine(r.run)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The widget: this dashboard's bot activity (TEAM-012). */
export const BotActivityWidget = (props) => {
  const team = useTeamBots(props.dashboardId ?? null);
  return (
    <Widget {...props} width="w-full" height="h-full">
      <Panel>
        <BotActivityContent dashboardId={props.dashboardId} team={team} />
      </Panel>
    </Widget>
  );
};
