import React, { useContext, useLayoutEffect, useRef, useState } from "react";
import { Button3, Panel, SelectInput, ThemeContext } from "@trops/dash-react";
import { Widget } from "../../Widget";
import { useTeamBots } from "../../Components/Bots/useTeamBots";
import { STATUS_DOT } from "../../Components/Bots/teamUtils";
import {
  readableError,
  toPlainText,
  triggerLabel,
} from "../../Components/Bots/botConversation";

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** Ask the dashboard to open its Bots view on a bot (DashboardStage listens). */
export function openBotsView(workspaceId, botId, tab = "conversation") {
  window.dispatchEvent(
    new CustomEvent("dash:open-bots-view", {
      detail: { workspaceId, botId, tab },
    }),
  );
}

function when(run) {
  const t = run && (run.endedAt || run.startedAt);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

/**
 * BotResultsContent — one bot's latest result on the dashboard (bot-teams
 * TEAM-012): status, when it ran and what triggered it, its answer as plain
 * text (or a failed run's readable error), approvals waiting, Run now and
 * Open in Bots view. Unlinked (or linked to a bot that left the team), it
 * offers this dashboard's bots and saves the pick in the widget's settings.
 *
 * @param {string} [botId]      the linked bot (widget setting)
 * @param {string|number} dashboardId
 * @param {string|number} widgetId  this widget's layout id
 * @param {object} team         useTeamBots(dashboardId)
 */
export const BotResultsContent = ({ botId, dashboardId, widgetId, team }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const [linked, setLinked] = useState(botId || null);
  const [busy, setBusy] = useState(false);
  // Answers open with the bot's narration; the result comes last, so the
  // answer starts scrolled to the end (like the conversation view).
  const scrollRef = useRef(null);

  const bots = (team && team.bots) || [];
  const bot = bots.find((b) => b.id === linked) || null;
  const lastOutput =
    (bot && ((team.lastRunByBot || {})[bot.id] || {}).output) || null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastOutput]);

  const link = async (id) => {
    setLinked(id);
    const b = api();
    if (b && b.bindBotWidget) await b.bindBotWidget(dashboardId, widgetId, id);
  };

  if (!bot) {
    return (
      <div className="flex flex-col gap-2 p-1">
        <span className={`text-sm ${muted}`}>
          {linked
            ? "The bot this widget showed isn't on this dashboard any more. Pick another:"
            : "Pick a bot from this dashboard to show its results:"}
        </span>
        <SelectInput
          label="Bot"
          value=""
          placeholder="Choose a bot…"
          onChange={(v) => v && link(v)}
          options={bots.map((b) => ({ value: b.id, label: b.name }))}
        />
      </div>
    );
  }

  const isLead = bot.role === "lead";
  const status = team.statusOf ? team.statusOf(bot.id) : "Idle";
  const statusDot = STATUS_DOT[status] || STATUS_DOT.Idle;
  const run = (team.lastRunByBot || {})[bot.id] || null;
  const approvals = team.approvalsFor ? team.approvalsFor(bot.id) : [];
  const nameOf = (id) => (bots.find((b) => b.id === id) || {}).name || id;
  const trigger = run ? triggerLabel(run, nameOf) : null;
  const answer =
    run && run.status === "failed"
      ? null
      : run && run.output
        ? toPlainText(run.output)
        : null;

  const runNow = async () => {
    const b = api();
    if (!b || !b.run) return;
    setBusy(true);
    try {
      await b.run(bot.id, "", false);
    } finally {
      setBusy(false);
      if (team.refresh) team.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex flex-row items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">{bot.name}</span>
          <span
            className={`flex flex-row items-center gap-1.5 text-xs ${muted}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusDot}`} />
            {status}
          </span>
        </div>
      </div>
      {run ? (
        <span className={`text-xs ${muted}`}>
          {[when(run) ? `Last run ${when(run)}` : null, trigger]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}

      <div
        ref={scrollRef}
        data-testid="bot-results-scroll"
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {!run ? (
          <span className={`text-sm ${muted}`}>
            {`${bot.name} hasn't run yet.`}
          </span>
        ) : run.status === "failed" ? (
          <span className="text-sm text-red-400">
            {readableError(run.error) || "The last run failed."}
          </span>
        ) : (
          <div
            data-testid="bot-results-answer"
            className="text-sm whitespace-pre-wrap"
          >
            {answer || (
              <span className={muted}>The last run gave no answer.</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-row flex-wrap items-center gap-2">
        {approvals.length ? (
          <Button3
            title={`${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting`}
            size="xs"
            onClick={() => openBotsView(dashboardId, bot.id, "conversation")}
          />
        ) : null}
        <div className="flex-1" />
        {!isLead ? (
          <Button3
            title={busy || status === "Running" ? "Running…" : "Run now"}
            size="xs"
            disabled={busy || status === "Running"}
            onClick={runNow}
          />
        ) : null}
        <Button3
          title="Open in Bots view"
          size="xs"
          onClick={() => openBotsView(dashboardId, bot.id, "conversation")}
        />
      </div>
    </div>
  );
};

/** The widget: a bot's latest result (TEAM-012). Settings: botId. */
export const BotResultsWidget = (props) => {
  const team = useTeamBots(props.dashboardId ?? null);
  return (
    <Widget {...props} width="w-full" height="h-full">
      <Panel>
        <BotResultsContent
          botId={props.botId}
          dashboardId={props.dashboardId}
          widgetId={props.id}
          team={team}
        />
      </Panel>
    </Widget>
  );
};
