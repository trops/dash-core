import React, { useEffect, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  FontAwesomeIcon,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { whenText } from "../Issues/issueText";
import { diagramWidgets, widgetEdges } from "../Bots/widgetDiagram";
import { handsOnTargets } from "../Bots/checksView";
import { CheckOutput } from "./JobCheckRows";
import {
  durationText,
  eventText,
  jobBot,
  jobTimeline,
  nextText,
} from "./jobTimeline";

/** The dashboard's bots (for who's next and the lead's name). */
function useDashboardBots(workspaceId) {
  const [bots, setBots] = useState([]);
  useEffect(() => {
    let live = true;
    const api = typeof window !== "undefined" && window.mainApi;
    if (!api || !api.bots || typeof api.bots.list !== "function") {
      return undefined;
    }
    Promise.resolve(api.bots.list())
      .then((list) => {
        if (!live) return;
        setBots(
          (Array.isArray(list) ? list : []).filter(
            (b) => b && String(b.workspaceId) === String(workspaceId),
          ),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return bots;
}

/**
 * Whether all bots are paused, read again whenever the job changes — then
 * a started job's next try waits until they're resumed (DASH-12; a bot
 * paused on its own still finishes it). `resume()` resumes them all.
 */
function useBotPaused(botId, job) {
  const [pause, setPause] = useState(null);
  const api = typeof window !== "undefined" && window.mainApi;
  const bots = api && api.bots;
  const load = () => {
    if (!bots || typeof bots.getPauseState !== "function") return;
    Promise.resolve(bots.getPauseState())
      .then((p) => setPause(p || null))
      .catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [botId, job]);
  // Only Pause all holds a started job: a bot paused on its own still
  // finishes it (DASH-12).
  const all = !!(pause && pause.global);
  const paused = all;
  const resume = async () => {
    if (!bots) return;
    if (all && bots.resumeAll) await bots.resumeAll();
    else if (bots.resumeBot) await bots.resumeBot(botId);
    load();
    // The Bots tab reads pause state again (useTeamBots).
    window.dispatchEvent(new CustomEvent("dash:bots-pause-changed"));
  };
  return { paused, all, resume };
}

const YOU_TEXT = {
  "send-back": "You sent it back",
  done: "You approved it",
  close: "You closed it",
  "one-more-round": "You gave it one more try",
};

/** One row: an icon on the line, then what happened. */
const Row = ({ icon, iconClass, testId, children, last = false }) => {
  const { hairline } = useConfigTokens();
  return (
    <div className="flex flex-row gap-3" data-testid={testId}>
      <div className="flex flex-col items-center flex-shrink-0 w-6">
        <span
          className={`h-6 w-6 rounded-full border flex items-center justify-center text-xs ${hairline} ${iconClass || ""}`}
        >
          <FontAwesomeIcon icon={icon} />
        </span>
        {last ? null : <span className={`flex-1 w-px border-l ${hairline}`} />}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1 pb-4">{children}</div>
    </div>
  );
};

/** The work being approved, with Approve and Send back (with a reason). */
const Waiting = ({ row, task, bot, busy, onAction, now }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const status = useStatusTokens();
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div
      data-testid="job-waiting"
      className={`flex flex-col gap-3 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
    >
      <span className={`text-sm font-semibold ${status.warning.strongText}`}>
        {`Waiting for you to approve · since ${whenText(row.since, now)}`}
      </span>
      {sending ? (
        <TextArea
          label={`Why? ${bot} gets this with its next try.`}
          rows={2}
          value={reason}
          onChange={(v) => setReason(v)}
        />
      ) : (
        <div
          data-testid="job-work"
          className={`max-h-72 overflow-y-auto p-3 rounded-md border text-sm whitespace-pre-wrap ${hairline} ${fieldBg} ${strong}`}
        >
          {row.work || <span className={muted}>Its answer was empty.</span>}
        </div>
      )}
      <div className="flex flex-row items-center justify-end gap-2">
        {sending ? (
          <>
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => {
                setSending(false);
                setReason("");
              }}
            />
            <Button2
              title="Send back"
              size="sm"
              danger
              disabled={busy || !reason.trim()}
              onClick={() =>
                onAction(task.id, { type: "send-back", reason: reason.trim() })
              }
            />
          </>
        ) : (
          <>
            <Button3
              title="Send back…"
              size="sm"
              disabled={busy}
              onClick={() => setSending(true)}
            />
            <Button
              title="Approve"
              size="sm"
              disabled={busy}
              onClick={() => onAction(task.id, "done")}
            />
          </>
        )}
      </div>
    </div>
  );
};

/**
 * BotJobDetail — a bot's job in Jobs (bot-checks PRD CHK-003, frame 4),
 * read top to bottom like a pull request: who asked, each try with its
 * work, what its checks said, your moves, the work waiting for you with
 * Approve / Send back, and where it goes next.
 */
export const BotJobDetail = ({
  goal,
  workspace = null,
  now,
  busy = false,
  onAction,
}) => {
  const { muted, strong, fieldBg, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const [openTry, setOpenTry] = useState(null);
  const bots = useDashboardBots(goal && goal.workspaceId);
  const pause = useBotPaused(jobBot(goal).id, goal);
  if (!goal) return null;
  const nameOf = (id) => (bots.find((b) => b.id === id) || {}).name || null;
  const rows = jobTimeline(goal, { nameOf });
  const task = (goal.tasks || [])[0] || null;
  const bot = jobBot(goal);
  const nowRow = rows[rows.length - 1];
  const tries = rows.filter((r) => r.type === "try").length;
  const self = bots.find((b) => b.id === bot.id) || { id: bot.id };
  const widgets = workspace ? diagramWidgets(workspace) : [];
  const wEdges = widgetEdges(widgets, bots);
  const targets = handsOnTargets(self, bots, widgets, wEdges);
  // Who listens for its failures (DASH-12).
  const onFailed = handsOnTargets(self, bots, widgets, wEdges, "failed");

  const seeChecks = () =>
    window.dispatchEvent(
      new CustomEvent("dash:open-bots-view", {
        detail: { workspaceId: goal.workspaceId, botId: bot.id, tab: "checks" },
      }),
    );

  const body = (r, i) => {
    switch (r.type) {
      case "asked":
        return (
          <Row key={i} icon="comment" testId="job-asked">
            <span className={`text-sm ${strong}`}>
              <span className="font-semibold">{r.who}</span>
              {r.kind === "schedule" || r.kind === "event"
                ? ` started ${bot.name}`
                : ` asked ${bot.name}`}
              <span className={muted}>{` · ${whenText(r.at, now)}`}</span>
            </span>
            {r.text ? (
              <span className={`text-sm italic ${muted}`}>{`"${r.text}"`}</span>
            ) : null}
          </Row>
        );
      case "try":
        return (
          <Row key={i} icon="robot" testId="job-try">
            <span className="flex flex-row flex-wrap items-center gap-2">
              <span className={`text-sm ${strong}`}>
                <span className="font-semibold">{bot.name}</span>
                {` finished, try ${r.n} of ${r.of}`}
                <span className={muted}>
                  {` · ${whenText(r.at, now)}${durationText(r.ms) ? ` · ${durationText(r.ms)}` : ""}`}
                </span>
              </span>
              {r.answer ? (
                <Button3
                  title={openTry === r.n ? "Hide its work" : "View its work"}
                  size="sm"
                  onClick={() => setOpenTry(openTry === r.n ? null : r.n)}
                />
              ) : null}
            </span>
            {openTry === r.n ? (
              <div
                data-testid="job-try-work"
                className={`max-h-72 overflow-y-auto p-3 rounded-md border text-sm whitespace-pre-wrap ${hairline} ${fieldBg} ${strong}`}
              >
                {r.answer}
              </div>
            ) : null}
          </Row>
        );
      case "failed":
        return (
          <Row
            key={i}
            icon="xmark"
            iconClass={status.error.icon}
            testId="job-failed"
          >
            <span className={`text-sm ${strong}`}>
              <span className="font-semibold">{r.name}</span>
              <span className={status.error.text}> failed</span>
              {r.reviewer ? (
                <span className={muted}>{` · reviewer ${r.reviewer}`}</span>
              ) : null}
            </span>
            {r.reason ? (
              <span className={`text-sm ${muted}`}>{r.reason}</span>
            ) : null}
            <CheckOutput output={r.output} exitCode={r.exitCode} />
            <span className={`text-xs ${muted}`}>
              {r.then === "back"
                ? `Sent back to ${bot.name} with that.`
                : r.then === "stop"
                  ? "It failed: nothing was handed on."
                  : "It came to you."}
            </span>
          </Row>
        );
      case "passed":
        return (
          <Row
            key={i}
            icon="check"
            iconClass={status.success.icon}
            testId="job-passed"
          >
            <span className={`text-sm font-semibold ${strong}`}>
              {r.names.length === 1
                ? `${r.names[0].name} passed`
                : `${r.names.length} checks passed`}
            </span>
            {r.names.length > 1 || r.names[0].said ? (
              <span className={`text-sm ${muted}`}>
                {r.names
                  .map((n) =>
                    n.reviewer && n.said
                      ? `${n.name} (${n.reviewer}: "${n.said}")`
                      : n.name,
                  )
                  .join(" · ")}
              </span>
            ) : null}
            {r.names
              .filter((n) => n.output)
              .map((n, j) => (
                <CheckOutput
                  key={j}
                  output={n.output}
                  label={r.names.length > 1 ? n.name : null}
                />
              ))}
          </Row>
        );
      case "you":
        return (
          <Row key={i} icon="user" testId="job-you">
            <span className={`text-sm ${strong}`}>
              <span className="font-semibold">
                {YOU_TEXT[r.action] || "You moved it"}
              </span>
              <span className={muted}>{` · ${whenText(r.at, now)}`}</span>
            </span>
            {r.reason ? (
              <span className={`text-sm ${muted}`}>{`"${r.reason}"`}</span>
            ) : null}
          </Row>
        );
      case "came":
        return (
          <Row
            key={i}
            icon="hand"
            iconClass={status.warning.icon}
            testId="job-came"
          >
            <span className={`text-sm font-semibold ${strong}`}>
              It came to you
            </span>
            {r.reason ? (
              <span className={`text-sm ${muted}`}>{r.reason}</span>
            ) : null}
          </Row>
        );
      default:
        return null;
    }
  };

  const current = (() => {
    const r = nowRow;
    if (r.state === "waiting" && task) {
      return (
        <Row icon="user-check" iconClass={status.warning.icon} testId="job-now">
          <Waiting
            row={r}
            task={task}
            bot={bot.name}
            busy={busy}
            onAction={onAction}
            now={now}
          />
        </Row>
      );
    }
    if (r.state === "needs-you" && task) {
      return (
        <Row icon="hand" iconClass={status.warning.icon} testId="job-now">
          <div
            className={`flex flex-col gap-2 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
          >
            <span
              className={`text-sm font-semibold ${status.warning.strongText}`}
            >
              {r.failed
                ? `Waiting for you · it didn't pass on try ${Math.max(1, tries)}`
                : "Waiting for you"}
            </span>
            <div className="flex flex-row flex-wrap gap-2">
              <Button2
                title={`Send it back to ${bot.name}`}
                size="sm"
                disabled={busy}
                onClick={() => onAction(task.id, "one-more-round")}
              />
              <Button3
                title="Close it (it fails)"
                size="sm"
                disabled={busy}
                onClick={() => onAction(task.id, "close")}
              />
            </div>
          </div>
        </Row>
      );
    }
    // Sent back to a paused bot: its next try waits for it to be resumed.
    if (r.state === "working" && pause.paused) {
      return (
        <Row
          icon="pause"
          iconClass={status.warning.icon}
          testId="job-now"
          last={false}
        >
          <div className="flex flex-col gap-2">
            <span className={`text-sm font-semibold ${strong}`}>
              {`Waiting: ${
                pause.all ? "all bots are" : `${bot.name} is`
              } paused, so try ${tries + 1} hasn't started`}
            </span>
            <div>
              <Button2
                title={pause.all ? "Resume all bots" : `Resume ${bot.name}`}
                size="sm"
                onClick={() => pause.resume()}
              />
            </div>
          </div>
        </Row>
      );
    }
    const text = {
      working: `${bot.name} is trying again (try ${tries + 1})`,
      checking: `Checking try ${Math.max(1, tries)}…`,
      done: r.approved ? "Approved and handed on" : "Passed and handed on",
      closed: r.failedOut
        ? `Failed after try ${Math.max(1, r.tries)}: nothing was handed on`
        : "Closed: nothing was handed on",
    }[r.state];
    return (
      <Row
        icon={
          r.state === "done"
            ? "check-double"
            : r.state === "closed"
              ? "circle-stop"
              : "spinner"
        }
        iconClass={
          r.state === "done"
            ? status.success.icon
            : r.state === "closed"
              ? muted
              : status.info.icon
        }
        testId="job-now"
        last={false}
      >
        <span className={`text-sm font-semibold ${strong}`}>{text}</span>
      </Row>
    );
  })();

  return (
    <div className="flex flex-col gap-4" data-testid="job-timeline">
      <div className="flex flex-row flex-wrap items-center gap-2">
        <span className={`text-xs ${muted}`}>
          {`${bot.name}'s checks · try ${
            nowRow.state === "working" ? tries + 1 : Math.max(1, tries)
          } of ${nowRow.maxRounds}`}
        </span>
        <Button3
          title={`See ${bot.name}'s checks`}
          size="sm"
          onClick={seeChecks}
        />
      </div>
      <div className="flex flex-col">
        {rows.slice(0, -1).map(body)}
        {current}
        {(nowRow.state === "closed" && nowRow.failedSent) ||
        nowRow.state === "done" ? (
          // The event it sent, and who listens for it — shown even when
          // nothing does, so you know it's there (DASH-12).
          <Row icon="bolt" testId="job-event" last>
            <span className={`text-sm ${muted}`}>
              {nowRow.state === "done"
                ? eventText(bot.name, "completed", targets)
                : eventText(bot.name, "failed", onFailed)}
            </span>
          </Row>
        ) : nowRow.state === "closed" ? null : (
          <Row icon="arrow-right" testId="job-next" last>
            <span className={`text-sm ${muted}`}>
              {nextText(goal, nowRow.state, targets, nameOf)}
            </span>
          </Row>
        )}
      </div>
    </div>
  );
};

export default BotJobDetail;
