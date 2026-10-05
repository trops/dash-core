import React, { useCallback, useContext, useEffect, useState } from "react";
import { Panel, ThemeContext } from "@trops/dash-react";
import { Widget } from "../../Widget";
import { useTeamBots } from "../../Components/Bots/useTeamBots";
import {
  readableError,
  toPlainText,
  triggerLabel,
} from "../../Components/Bots/botConversation";
import { openBotsView } from "./BotResultsWidget";

const STATUS_TEXT = {
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  running: "Running",
};
const RUN_DOT = {
  completed: "bg-green-400",
  failed: "bg-red-400",
  stopped: "bg-gray-500",
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
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
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

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <span className="text-sm font-semibold">Bot activity</span>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
        {approvals.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() =>
              openBotsView(dashboardId, a.request.botId, "conversation")
            }
            className="text-left text-xs text-amber-400"
          >
            {`${nameOf(a.request.botId)} wants to use ${a.request.toolName}${a.request.serverName ? ` on ${a.request.serverName}` : ""}`}
          </button>
        ))}
        {rows && !rows.length ? (
          <span className={`text-sm ${muted}`}>
            No bot runs on this dashboard yet.
          </span>
        ) : null}
        {(rows || []).map((r, i) => {
          const trigger = triggerLabel(r.run, nameOf);
          const runDot = RUN_DOT[r.run.status] || "bg-gray-500";
          const t = r.run.endedAt || r.run.startedAt;
          return (
            <button
              key={`${r.botId}-${t}-${i}`}
              type="button"
              data-testid="bot-activity-row"
              onClick={() => openBotsView(dashboardId, r.botId, "activity")}
              className={`text-left rounded-md border px-2 py-1.5 flex flex-col gap-0.5 ${hairline}`}
            >
              <span className="flex flex-row items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${runDot}`} />
                <span className="font-medium">{r.botName}</span>
                <span className={muted}>
                  {[
                    STATUS_TEXT[r.run.status] || r.run.status,
                    t ? new Date(t).toLocaleTimeString() : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {trigger ? (
                <span className={`text-xs ${muted}`}>{trigger}</span>
              ) : null}
              <span className="text-xs truncate">{summaryLine(r.run)}</span>
            </button>
          );
        })}
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
