import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Button2,
  Button3,
  ButtonIcon3,
  EmptyState,
  FontAwesomeIcon,
  ListRow,
  Panel,
  SelectInput,
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
import { ApprovalPreview } from "../../Components/Bots/ApprovalPreview";
import { scheduleLabel } from "../../Components/Create/planChecklist";
import { shortToolName } from "../../utils/toolNames";
import { actionState, answerShape } from "./answerShape";

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

/** "Today, 7:00 AM" / "Yesterday, 7:00 AM" / "Nov 11, 7:00 AM". */
export function dayTime(iso, now = new Date()) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** "every day at 7:00 AM" — the bot's first schedule, in words. */
function scheduleOf(bot) {
  const s = ((bot && bot.schedules) || []).find((x) => x && x.cron);
  return s ? scheduleLabel(s.cron) : "";
}

// The badge for each state (approved mockup "Bot widgets that look like Dash").
function badgeOf(status, run) {
  if (status === "Needs approval") return ["warning", "Needs you"];
  if (status === "Running") return ["info", "Running"];
  if (status === "Paused") return ["neutral", "Paused"];
  if (status === "Failed" || (run && run.status === "failed"))
    return ["error", "Failed"];
  if (run && run.status === "completed") return ["success", "Done"];
  return ["neutral", "Idle"];
}

// Narrower than this, the widget shows its compact face.
const COMPACT_PX = 380;

/**
 * The widget's width, kept current — for its compact face in a small cell.
 * Returns [narrow, ref]: put `ref` on the face (it mounts once its bot is
 * known, so it's watched from then on).
 */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  const [el, setEl] = useState(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0] && entries[0].contentRect.width;
      if (w) setNarrow(w < COMPACT_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [narrow, setEl];
}

/** What a running bot is doing now: its latest tool call, from the stream. */
function useCurrentStep(botId, running) {
  const [step, setStep] = useState(null);
  useEffect(() => {
    if (!running) setStep(null);
  }, [running]);
  useEffect(() => {
    const b = api();
    if (!botId || !b || !b.onStream) return undefined;
    const id = b.onStream(({ botId: who, event } = {}) => {
      if (who !== botId || !event) return;
      if (event.type === "tool_call" && event.name) {
        setStep(shortToolName(event.name));
      } else if (["done", "error", "skipped"].includes(event.type)) {
        setStep(null);
      }
    });
    return () => b.removeListener && b.removeListener(id);
  }, [botId]);
  return step;
}

/** A callout in a state's colours: the approval, the failure, the run. */
const Callout = ({ tone, children, testId }) => {
  const s = useStatusTokens()[tone] || {};
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border px-4 py-3 ${s.bg || ""} ${s.border || ""}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
};

/** The answer, as its structure (answerShape): rows, said large, or text. */
const Answer = ({
  shape,
  compact,
  muted,
  strong,
  hairline,
  full,
  onMore = null,
}) => {
  const statusTokens = useStatusTokens();
  const [whole, setWhole] = useState(false);
  const wholeLink =
    !compact && (shape.paragraphs || []).length > 1 ? (
      <button
        type="button"
        className={`text-xs font-semibold underline ${muted}`}
        onClick={() => setWhole(true)}
      >
        Show the whole answer
      </button>
    ) : null;
  if (shape.kind === "short" && !whole) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4 py-6"
        data-testid="bot-results-answer"
      >
        {compact ? null : (
          <span
            className={`flex items-center justify-center h-12 w-12 rounded-full ${statusTokens.success.bg || ""}`}
          >
            <FontAwesomeIcon
              icon="check"
              className={`h-5 w-5 ${statusTokens.success.icon || ""}`}
            />
          </span>
        )}
        <span
          className={`${compact ? "text-base" : "text-xl"} font-semibold ${strong}`}
        >
          {shape.text}
        </span>
        {wholeLink}
      </div>
    );
  }
  if (shape.kind === "list" && !whole) {
    const rows = shape.items.filter((it) => it.title);
    const items = compact ? rows.slice(0, 1) : shape.items;
    const more = rows.length - items.filter((it) => it.title).length;
    return (
      <div className="flex flex-col gap-3" data-testid="bot-results-answer">
        {shape.lead ? (
          <span className={`${compact ? "text-sm" : "text-base"} ${strong}`}>
            {shape.lead}
          </span>
        ) : null}
        <div
          className={`dr-chat-card flex flex-col rounded-xl border px-2 ${hairline}`}
        >
          {items.map((it, i) =>
            !it.title ? (
              <span
                key={i}
                className={`py-2 text-xs ${it.section ? "font-semibold uppercase tracking-wider" : ""} ${muted} ${i ? `border-t ${hairline}` : ""}`}
                data-testid="bot-results-between"
              >
                {it.section || it.note}
              </span>
            ) : (
              <div
                key={i}
                className={`flex flex-row items-start gap-3 py-2 ${i ? `border-t ${hairline}` : ""}`}
                data-testid="bot-results-item"
              >
                <div className="flex-1 min-w-0">
                  <ListRow
                    title={it.title}
                    meta={it.gist || null}
                    icon={
                      compact ? null : (
                        <span
                          className={`flex items-center justify-center h-8 w-8 rounded-full border text-sm font-semibold ${hairline} ${strong}`}
                        >
                          {it.title.charAt(0).toUpperCase()}
                        </span>
                      )
                    }
                  />
                </div>
                {it.action && !compact ? (
                  <StatusBadge
                    state={actionState(it.action)}
                    label={it.action}
                    className="flex-shrink-0 mt-2"
                  />
                ) : null}
              </div>
            ),
          )}
        </div>
        {more > 0 ? (
          onMore ? (
            <button
              type="button"
              className={`self-start text-xs font-semibold underline ${muted}`}
              onClick={onMore}
            >
              +{more} more
            </button>
          ) : (
            <span className={`text-xs ${muted}`}>+{more} more</span>
          )
        ) : null}
        {!compact ? (
          <span className={`text-xs ${muted}`}>
            {shape.tail ? `${shape.tail} · ` : ""}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setWhole(true)}
            >
              Show the whole answer
            </button>
          </span>
        ) : null}
      </div>
    );
  }
  // Text, or the whole answer asked for: as written, plain.
  return (
    <div
      className={`text-sm whitespace-pre-wrap ${strong}`}
      data-testid="bot-results-answer"
    >
      {whole ? full : (shape.paragraphs || []).join("\n\n")}
      {whole && shape.kind !== "text" ? (
        <div className="pt-2">
          <button
            type="button"
            className={`text-xs font-semibold underline ${muted}`}
            onClick={() => setWhole(false)}
          >
            {shape.kind === "short" ? "Show less" : "Show it as a list"}
          </button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * BotResultsContent — one bot's latest result on the dashboard (bot-teams
 * TEAM-012; approved mockup "Bot widgets that look like Dash"): a header
 * with its status, when it ran and its schedule, Run now and Open in Bots
 * view; then the state — an approval answered right here, a failure with
 * Try again, what a running bot is doing (Stop), or the answer read as its
 * structure (a count, one row per item with its action, or said large).
 * Unlinked (or linked to a bot that left the team), it offers this
 * dashboard's bots and saves the pick in the widget's settings.
 *
 * @param {string} [botId]      the linked bot (widget setting)
 * @param {string|number} dashboardId
 * @param {string|number} widgetId  this widget's layout id
 * @param {object} team         useTeamBots(dashboardId)
 */
export const BotResultsContent = ({ botId, dashboardId, widgetId, team }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const strong = currentTheme["text-neutral-light"] || "";
  const hairline = currentTheme["border-neutral-dark"] || "";
  const [linked, setLinked] = useState(botId || null);
  const [busy, setBusy] = useState(false);
  const [compact, rootRef] = useNarrow();
  // A long answer starts scrolled to the end, where the result is.
  const scrollRef = useRef(null);

  const bots = (team && team.bots) || [];
  const bot = bots.find((b) => b.id === linked) || null;
  const status = bot && team.statusOf ? team.statusOf(bot.id) : "Idle";
  const running =
    !!bot && (status === "Running" || (team.running || []).includes(bot.id));
  const step = useCurrentStep(bot && bot.id, running);
  const lastOutput =
    (bot && ((team.lastRunByBot || {})[bot.id] || {}).output) || null;
  const toEnd =
    !!lastOutput &&
    answerShape(toPlainText(lastOutput)).kind === "text" &&
    !(bot && team.approvalsFor && team.approvalsFor(bot.id).length);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && toEnd) el.scrollTop = el.scrollHeight;
  }, [lastOutput, toEnd]);

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
  const run = (team.lastRunByBot || {})[bot.id] || null;
  const approvals = team.approvalsFor ? team.approvalsFor(bot.id) : [];
  const nameOf = (id) => (bots.find((b) => b.id === id) || {}).name || id;
  const trigger = run ? triggerLabel(run, nameOf) : null;
  const schedule = scheduleOf(bot);
  const [badge, badgeText] = badgeOf(status, run);
  const failed = !running && run && run.status === "failed";
  const full = run && run.output ? toPlainText(run.output) : "";
  const shape = answerShape(full);
  const at = run ? dayTime(run.endedAt || run.startedAt) : null;
  const sub = [
    running ? "Running now" : at,
    trigger && trigger !== "Scheduled run" ? trigger : null,
    schedule,
  ]
    .filter(Boolean)
    .join(" · ");

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
  const stop = async () => {
    const b = api();
    if (b && b.stop) await b.stop(bot.id);
  };

  // The last answer, faded, under a run or a failure.
  const lastAnswer =
    run && running && run.status === "completed" && shape.kind !== "none" ? (
      <div className="flex flex-col gap-2 opacity-60">
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
        >
          Last result
        </span>
        <Answer
          shape={shape}
          compact={compact}
          muted={muted}
          strong={strong}
          hairline={hairline}
          full={full}
          onMore={() => openBotsView(dashboardId, bot.id, "conversation")}
        />
      </div>
    ) : null;

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      <div
        className={`flex flex-row items-center gap-3 pb-3 border-b ${hairline}`}
      >
        {compact ? null : (
          <span
            className={`dr-chat-card flex flex-shrink-0 items-center justify-center h-10 w-10 rounded-lg border ${hairline}`}
          >
            <FontAwesomeIcon icon="robot" className={`h-4 w-4 ${muted}`} />
          </span>
        )}
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className={`text-sm font-semibold truncate ${strong}`}>
            {bot.name}
          </span>
          {sub && !compact ? (
            <span className={`text-xs truncate ${muted}`}>{sub}</span>
          ) : null}
        </span>
        <StatusBadge state={badge} label={badgeText} />
        {!isLead && !compact ? (
          <ButtonIcon3
            icon="play"
            ariaLabel={busy || running ? "Running…" : "Run now"}
            disabled={busy || running}
            onClick={runNow}
          />
        ) : null}
        <ButtonIcon3
          icon="arrow-up-right-from-square"
          ariaLabel="Open in Bots view"
          onClick={() => openBotsView(dashboardId, bot.id, "conversation")}
        />
      </div>

      <div
        ref={scrollRef}
        data-testid="bot-results-scroll"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pt-4"
      >
        {approvals.map((a) => {
          const req = a.request || {};
          return (
            <Callout key={a.id} tone="warning" testId="bot-results-approval">
              <span className={`text-sm font-semibold ${strong}`}>
                Wants to use{" "}
                {req.toolName ? shortToolName(req.toolName) : "a tool"}
                {req.serverName ? ` on ${req.serverName}` : ""}
              </span>
              <span className={`text-xs ${muted}`}>
                It waits until you answer.
              </span>
              <ApprovalPreview request={req} />
              <div className="flex flex-row flex-wrap gap-2 pt-1">
                <Button
                  title="Allow once"
                  size="sm"
                  onClick={() =>
                    team.approve && team.approve(a.id, { allow: true })
                  }
                />
                {req.serverName ? (
                  <Button2
                    title="Always allow"
                    size="sm"
                    onClick={() =>
                      team.approve &&
                      team.approve(a.id, { allow: true, remember: true })
                    }
                  />
                ) : null}
                <Button3
                  title="Deny"
                  size="sm"
                  onClick={() =>
                    team.approve && team.approve(a.id, { allow: false })
                  }
                />
              </div>
            </Callout>
          );
        })}

        {running ? (
          <Callout tone="info" testId="bot-results-running">
            <div className="flex flex-row items-center gap-3">
              <FontAwesomeIcon
                icon="spinner"
                className={`h-4 w-4 animate-spin ${muted}`}
              />
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={`text-sm font-semibold ${strong}`}>
                  {step ? `Using ${step}…` : "Working on it…"}
                </span>
                {bot.mcpServers && bot.mcpServers.length && !compact ? (
                  <span className={`text-xs ${muted}`}>
                    With {bot.mcpServers.join(", ")}
                  </span>
                ) : null}
              </span>
              <Button3 title="Stop" size="sm" onClick={stop} />
            </div>
          </Callout>
        ) : null}

        {failed ? (
          <Callout tone="error" testId="bot-results-failed">
            <span className={`text-sm font-semibold ${strong}`}>
              {readableError(run.error) || "The last run failed."}
            </span>
            {at && !compact ? (
              <span className={`text-xs ${muted}`}>
                The run {at.replace(/^Today, /, "at ")} stopped before it
                finished.
              </span>
            ) : null}
            <div className="flex flex-row flex-wrap items-center gap-2 pt-1">
              {!isLead ? (
                <Button title="Try again" size="sm" onClick={runNow} />
              ) : null}
              <Button3
                title="See what went wrong"
                size="sm"
                onClick={() => openBotsView(dashboardId, bot.id, "activity")}
              />
            </div>
          </Callout>
        ) : null}

        {!run && !running && !approvals.length ? (
          <EmptyState
            icon={<FontAwesomeIcon icon="robot" className="h-6 w-6" />}
            title={`${bot.name} hasn't run yet`}
            description={
              schedule
                ? `It runs ${schedule}.`
                : "Run it now to see its first answer here."
            }
          >
            {!isLead ? <Button title="Run it now" onClick={runNow} /> : null}
          </EmptyState>
        ) : null}

        {run && !running && !failed ? (
          shape.kind === "none" ? (
            <span className={`text-sm ${muted}`}>
              The last run gave no answer.
            </span>
          ) : (
            <>
              <Answer
                shape={shape}
                compact={compact}
                muted={muted}
                strong={strong}
                hairline={hairline}
                full={full}
                onMore={() => openBotsView(dashboardId, bot.id, "conversation")}
              />
              {shape.kind === "short" && schedule && !compact ? (
                <span className={`text-xs text-center ${muted}`}>
                  Runs again {schedule}
                </span>
              ) : null}
            </>
          )
        ) : (
          lastAnswer
        )}
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
