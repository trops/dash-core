import React, { useEffect, useState } from "react";
import { sketchOf, widgetLabel } from "./WidgetWizard/widgetSpec";
import { ReviewSketch } from "./WidgetWizard/StepReview";
import { cellPlace } from "./workspaceStart";
import {
  Button2,
  Button3,
  FontAwesomeIcon,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { readableRequest } from "./handoffSteps";
import { OutputCard, PlanOutput } from "./PlanViews";
import { BotTestOutput } from "./BotTestOutput";
import { BuildLogOutput, CheckReportOutput, PreviewOutput } from "./BuildViews";
import {
  activityText,
  buildLogHead,
  checkRan,
  buildPlanLine,
  checkLine,
  buildStatus,
  liveActivityOf,
  logTime,
} from "./workspaceBuild";
import { planTarget } from "../../utils/teamPlan";
import {
  isThemeChangeOnly,
  isThemeOnly,
  planName,
  planStatus,
} from "./workspacePlan";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// "the Scout's answer" → "The Scout's answer" at the start of a title.
const cap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());

const norm = (name) =>
  String(name || "")
    .replace(/^the /i, "")
    .trim()
    .toLowerCase();

/**
 * What a bot is doing, line by line, while `on` — its tool calls from its
 * stream, with times (the last 12). Starts over when the bot changes.
 */
function useLiveActivity(botId, on) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    setLines([]);
    const b = botsApi();
    if (!b || !b.onStream || !botId || !on) return undefined;
    const id = b.onStream(({ botId: who, event } = {}) => {
      if (who !== botId) return;
      const a = liveActivityOf(event, new Date().toISOString());
      if (a) setLines((cur) => [...cur, a].slice(-12));
    });
    return () => {
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, [botId, on]);
  return lines;
}

/** A lone bot's latest runs, kept current as runs start and end. */
function useRuns(botId) {
  const [runs, setRuns] = useState([]);
  useEffect(() => {
    const b = botsApi();
    if (!b || !botId || !b.getRuns) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.getRuns(botId, 10))
        .then((r) => alive && setRuns(Array.isArray(r) ? r : []))
        .catch(() => {});
    load();
    const id = b.onRunActive ? b.onRunActive(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, [botId]);
  return runs;
}

const TRIGGER_WORDS = {
  schedule: "on its schedule",
  event: "on an event",
  manual: "you asked",
  reply: "you asked",
  ask: "asked",
};

function shortTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * WorkspaceSide — the workspace's right column: the conversation's outputs
 * (DASH-21 frame 4) — the plan, its Build log, the Check report, the preview,
 * what was built and the team's answers, one row each; opening one shows
 * only that one. What waits on the user before it can go on (connects,
 * approvals) sits above them until the chat asks it; everything else is
 * told in the chat. A lone bot shows its runs.
 *
 * @param {object} contact     workspaceContacts' contact
 * @param {object[]} messages  the conversation (AskStep's), with its steps
 * @param {object|null} wp    the conversation's plan (useWorkspacePlan)
 * @param {boolean} planReadOnly  the lead is answering: a new plan may come
 * @param {() => void} onBuild  Yes, build it
 * @param {string|null} open  what's opened: "plan", "plan:<step id>" (an
 *   earlier plan), a step's id, or null
 * @param {(what) => void} onOpen
 * @param {boolean} wide, onToggleWide  the column's size
 * @param {object|null} build  the plan's build (release 3b: { buildId, kind,
 *   leftOff }); its outputs open as "buildlog", "check" and "preview"
 * @param {object|null} pb     the build, live (usePlanBuild)
 * @param {object[]} dashTeam  the Dash team's working roles ({ id, name,
 *   role }): finds the bot working a step, for its live activity
 * @param {({ count, needsYou }) => void} [onSummary]  told what the column
 *   holds — the folded column's button (release 6a)
 * @param {object|null} [planActions]  PlanNext's handlers: an answer typed
 *   on the plan goes to the Planner (its choices are asked in the chat)
 */
export const WorkspaceSide = ({
  contact,
  messages = [],
  wp = null,
  planReadOnly = false,
  onBuild = null,
  open = null,
  onOpen = () => {},
  wide = false,
  onToggleWide = null,
  build = null,
  pb = null,
  dashTeam = [],
  onSummary = null,
  // A change to one widget (release 6c): in place or new; sign in.
  onWidgetMode = null,
  onSignIn = null,
  planActions = null,
  // Review & build is in the chat: its yes is the one way to build.
  reviewInChat = false,
  // A widget the user already has: its own steps, nothing to build.
  reuseInChat = false,
  // Step 4 draws the looks in the chat: no sketch beside it.
  sketchHidden = false,
  // A wizard step, checked before it's asked (askChecks.askRows).
  checkedBefore = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const runs = useRuns(
    contact && contact.kind === "bot" ? contact.botId : null,
  );
  const steps = (messages || []).filter((m) => m && m.who === "step");
  // A step opened on the right — while it works, what it's doing (DASH-20).
  const step =
    open && open !== "plan" ? steps.find((s) => s.id === open) || null : null;
  const stepBot = step
    ? [...((contact && contact.members) || []), ...(dashTeam || [])].find(
        (m) => norm(m.name) === norm(step.bot),
      ) || null
    : null;
  const stepActivity = useLiveActivity(
    stepBot ? stepBot.id : null,
    !!step && step.status === "asking",
  );
  const plan = wp && wp.plan ? wp.plan : null;
  const back = (
    <div className="flex flex-row items-center gap-2">
      <Button3 size="sm" title="← Outputs" onClick={() => onOpen(null)} />
      <span className="flex-1" />
      {onToggleWide ? (
        <Button2
          size="sm"
          title={wide ? "Shrink ⇥" : "⇤ Expand"}
          ariaLabel={wide ? "Shrink" : "Expand"}
          onClick={onToggleWide}
        />
      ) : null}
    </div>
  );
  // The plan's build (release 3b), as it stands.
  const buildState = build && pb ? pb.state : null;
  const leftOff = (build && build.leftOff) || [];

  // An answer that made nothing ("I can't build that") stays in the chat.
  const answered = steps.filter(
    (s) => s.status !== "asking" && s.answer && !s.plan && !s.nothing,
  );
  const isBot = contact && contact.kind === "bot";
  const status = buildState ? buildStatus(buildState, leftOff) : null;
  // A new widget waiting for your look (frame 31).
  const previewStep =
    status === "waiting-for-you"
      ? (buildState.steps || []).find((x) => x.status === "needs-you") || null
      : null;
  const builtDashboard =
    buildState &&
    buildState.dashboard &&
    (status === "done" || status === "waiting-for-providers")
      ? buildState.dashboard
      : null;

  // For the folded column's button (frames 35, 36): how many outputs, and
  // whether something waits on the user.
  // What's decided is asked in the chat, so only a look or an approval
  // here needs the user.
  const checkedAny = !!buildState && checkRan(buildState);
  const planShown = !!plan && !(wp && wp.waitingForPick);
  const outputCount =
    (previewStep ? 1 : 0) +
    (planShown ? 1 : 0) +
    (build ? 1 : 0) +
    (checkedAny ? 1 : 0) +
    (builtDashboard ? 1 : 0) +
    answered.length;
  const needsYou = !!previewStep;
  useEffect(() => {
    if (onSummary) onSummary({ count: outputCount, needsYou });
  }, [onSummary, outputCount, needsYou]);
  const buildLine = build
    ? buildState
      ? buildPlanLine(buildState, leftOff)
      : "Starting the build…"
    : null;
  // An opened output: ← Outputs and Expand stay put; what's opened scrolls.
  const opened = (body) => (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-shrink-0 px-5 pt-5 pb-2">{back}</div>
      <div
        // Each opened output starts at its top.
        key={String(open)}
        className="flex-1 flex flex-col gap-4 px-5 pb-5 pt-2 min-h-0 overflow-y-auto"
      >
        {body}
      </div>
    </div>
  );
  if (open === "plan" && plan) {
    return opened(
      <PlanOutput
        wp={wp}
        onReplan={planActions ? planActions.onAnswer : null}
        readOnly={planReadOnly}
        onBuild={onBuild}
        buildLine={buildLine}
        changedTheme={buildState ? buildState.changedTheme || null : null}
        leadName={contact ? contact.name : undefined}
        onWidgetMode={onWidgetMode}
        onSignIn={onSignIn}
      />,
    );
  }
  if (open === "buildlog" && build) {
    return opened(
      <BuildLogOutput
        build={build}
        state={buildState}
        title={
          plan
            ? plan.widgetChange
              ? `Change ${planName(plan)}`
              : planName(plan)
            : null
        }
        onRemoved={() => onOpen(null)}
      />,
    );
  }
  if (open === "check" && build) {
    return opened(<CheckReportOutput state={buildState} />);
  }
  // The preview, while it waits for a look — once it's past, Outputs.
  if (open === "preview" && build && pb && previewStep) {
    // A bot to test before it's saved (bot-test-run TST-003).
    if (previewStep.kind === "testbot") {
      return opened(
        <BotTestOutput
          step={previewStep}
          pb={pb}
          onChange={planActions && !planReadOnly ? planActions.onAnswer : null}
        />,
      );
    }
    return opened(
      <PreviewOutput
        state={buildState}
        pb={pb}
        // Showing what a bot sends (TD-009): previewed with its last one.
        wire={
          (wp &&
            wp.plan &&
            wp.plan.widgetChange &&
            wp.plan.widgetChange.wire) ||
          null
        }
      />,
    );
  }
  // An earlier plan, from its card in the chat.
  const earlierStep =
    typeof open === "string" && open.startsWith("plan:")
      ? steps.find((s) => s.id === open.slice(5) && s.plan) || null
      : null;
  if (earlierStep && wp) {
    return opened(<PlanOutput wp={wp} plan={earlierStep.plan} />);
  }
  if (step) {
    return opened(
      <>
        <div className="flex flex-col gap-1">
          <span className={`text-xs ${muted}`}>{step.bot} · answer</span>
          <span className={`text-lg font-semibold ${strong}`}>
            {step.label}
          </span>
        </div>
        {step.request ? (
          <div className="flex flex-col gap-1">
            <span className={`text-xs ${muted}`}>What it was asked</span>
            <span className="text-sm whitespace-pre-wrap">
              {readableRequest(step.request)}
            </span>
          </div>
        ) : null}
        <div
          className={`flex flex-col gap-1 rounded-lg border p-3 ${hairline}`}
          data-testid="workspace-output-detail"
        >
          <span className={`text-xs ${muted}`}>
            {step.status === "asking" ? "Working on it…" : "Its answer"}
          </span>
          {step.status === "asking" && stepActivity.length ? (
            // What it's doing, as it goes (DASH-20).
            <div className={`flex flex-col gap-1 border-l-2 pl-3 ${hairline}`}>
              {stepActivity.map((a, i) => (
                <span
                  key={i}
                  className={`font-mono text-xs ${i === stepActivity.length - 1 ? strong : muted}`}
                  data-testid="workspace-step-activity"
                >
                  {`${logTime(a.at)} · ${activityText(a)}`}
                </span>
              ))}
            </div>
          ) : null}
          <span className="text-sm whitespace-pre-wrap">
            {step.answer || ""}
          </span>
        </div>
      </>,
    );
  }

  const placed = buildState
    ? (buildState.steps || []).filter(
        (x) => x.kind === "place" && x.status === "done",
      ).length
    : 0;
  const hasCheck =
    !!buildState && (buildState.steps || []).some((x) => x.kind === "check");
  // The Check report, once the Checker has looked at something.
  const checked = checkedAny;
  const logHead = buildState ? buildLogHead(buildState, leftOff) : null;

  return (
    <div
      className="flex-1 flex flex-col gap-4 p-5 min-h-0 overflow-y-auto"
      data-testid="workspace-side"
    >
      <span className={`text-sm font-semibold ${strong}`}>Outputs</span>

      {/* Review & build: how the wizard's widget will look (a sketch). */}
      {reviewInChat &&
      !reuseInChat &&
      !sketchHidden &&
      wp &&
      wp.wizard &&
      wp.plan &&
      !build ? (
        <ReviewSketch
          sketch={sketchOf(wp.wizard.piece)}
          where={wp.plan.cell ? cellPlace(wp.plan.cell) : ""}
        />
      ) : null}

      {/* A wizard step, checked before it's asked: only what's real. */}
      {checkedBefore && checkedBefore.rows.length ? (
        <div
          className="flex flex-col gap-2"
          data-testid="workspace-checked-before"
        >
          <span className="flex flex-col gap-0.5">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
            >
              Checked before asking
            </span>
            <span className={`text-xs ${muted}`}>{checkedBefore.sub}</span>
          </span>
          <div
            className={`dr-chat-card flex flex-col rounded-xl border overflow-hidden ${hairline}`}
          >
            {checkedBefore.rows.map((r, i) => (
              <div
                key={i}
                className={`flex flex-row items-start gap-2 px-3 py-2 text-xs ${i ? `border-t ${hairline}` : ""}`}
                data-testid="workspace-checked-row"
              >
                {r.ok === null ? (
                  <FontAwesomeIcon
                    icon="spinner"
                    className={`h-3 w-3 mt-0.5 animate-spin ${muted}`}
                  />
                ) : (
                  <FontAwesomeIcon
                    icon={r.ok ? "check" : "xmark"}
                    className={`h-3 w-3 mt-0.5 ${r.ok ? statusTokens.success.icon : statusTokens.error.icon}`}
                  />
                )}
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className={strong}>{r.main}</span>
                  {r.sub ? <span className={muted}>{r.sub}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {previewStep && previewStep.kind === "testbot" ? (
        <OutputCard
          testId="workspace-output-test"
          icon="robot"
          title={String(previewStep.label || "New bot").replace(/^Test /, "")}
          sub="Ready to test · not saved yet"
          kind="Bot"
          onClick={() => onOpen("preview")}
        />
      ) : previewStep ? (
        <OutputCard
          testId="workspace-output-preview"
          icon="puzzle-piece"
          title={String(previewStep.label || "New widget").replace(
            /^Preview /,
            "",
          )}
          sub="Preview ready"
          kind="Widget"
          onClick={() => onOpen("preview")}
        />
      ) : null}
      {/* The conversation's outputs (DASH-21 frame 4): one row each, with
          a status line — opening one shows only that one. What to decide is
          asked in the chat, never here. */}
      {planShown ? (
        <OutputCard
          testId="workspace-output-plan"
          icon={
            isThemeOnly(plan) || isThemeChangeOnly(plan) ? "palette" : undefined
          }
          // One new widget in a cell: the widget is the plan.
          title={
            plan.cell && wp.wizard && !wp.reuse
              ? `${widgetLabel(wp.wizard.piece)} — new widget`
              : `${planName(plan)} — ${planTarget(plan) || plan.widgetChange ? "changes" : "plan"}`
          }
          sub={
            build
              ? "You said yes"
              : planStatus({ plan, check: wp.check, open: wp.open })
          }
          kind="Plan"
          onClick={() => onOpen("plan")}
        />
      ) : null}
      {build ? (
        <OutputCard
          testId="workspace-output-buildlog"
          icon="list"
          title="Build log"
          sub={
            buildState
              ? [logHead.lead, logHead.rest].filter(Boolean).join(" · ")
              : "Starting the build…"
          }
          kind="Build"
          onClick={() => onOpen("buildlog")}
        />
      ) : null}
      {checked ? (
        <OutputCard
          testId="workspace-output-check"
          icon="clipboard-check"
          title="Check report"
          sub={checkLine(buildState)}
          kind="Check"
          onClick={() => onOpen("check")}
        />
      ) : null}
      {builtDashboard ? (
        <OutputCard
          testId="workspace-output-dashboard"
          icon="table-cells-large"
          title={builtDashboard.name}
          sub={
            builtDashboard.targeted
              ? `changed · ${placed} added`
              : `${placed} ${placed === 1 ? "widget" : "widgets"}`
          }
          kind="Dashboard"
          onClick={() => onOpen(hasCheck ? "check" : "buildlog")}
        />
      ) : null}
      {answered.map((s) => (
        <OutputCard
          key={s.id}
          testId="workspace-output"
          icon="comment"
          title={`${cap(s.bot)}'s answer`}
          sub={s.result}
          kind="Answer"
          onClick={() => onOpen(s.id)}
        />
      ))}
      {!answered.length && !planShown && !build && !previewStep ? (
        <span
          className={`rounded-xl border border-dashed p-6 text-center text-sm ${hairline} ${muted}`}
        >
          {isBot
            ? "Its answers and results show here."
            : "The plan, its build log, the check report and the preview show up here as the team makes them."}
        </span>
      ) : null}

      {isBot ? (
        <div className="flex flex-col gap-2" data-testid="workspace-runs">
          <span className={`text-sm font-semibold ${strong}`}>Runs</span>
          {runs.length ? (
            [...runs]
              .reverse()
              .slice(0, 8)
              .map((r, i) => (
                <div key={i} className="flex flex-col gap-0.5 text-sm">
                  <span className={strong}>
                    {shortTime(r.endedAt || r.startedAt)} ·{" "}
                    {TRIGGER_WORDS[r.trigger] || r.trigger || "run"} ·{" "}
                    {r.status || ""}
                  </span>
                  {r.output ? (
                    <span className={`text-xs truncate ${muted}`}>
                      {String(r.output).split("\n")[0]}
                    </span>
                  ) : null}
                </div>
              ))
          ) : (
            <span className={`text-sm ${muted}`}>No runs yet.</span>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default WorkspaceSide;
