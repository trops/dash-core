import React, { useEffect, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ChatMessage,
  ConfirmationModal,
  FontAwesomeIcon,
  Tag,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  isDone,
  normalizeType,
  providerLabel,
  removePiece,
} from "../Create/planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
} from "../Create/PlanChecklistDialogs";
import { CellPreview } from "../Create/CellPreview";
import { ChooseProviderDialog } from "../Create/ProviderPick";
import { RemoveSummary, TryBots } from "./BuildParts";
import { ModelTag, RanOn } from "./ModelInfo";
import { OutputCard } from "./PlanViews";
import { TextLink } from "./WidgetWizard/TextLink";
import { AnswerPart, WizardAnswer } from "./WidgetWizard/WizardAnswer";
import { usePlanBuild } from "./usePlanBuild";
import {
  buildChat,
  buildLogHead,
  buildLogSteps,
  buildPlanLine,
  buildStory,
  needsTold,
  waitingFor,
  stopTold,
  isBuilding,
  logDuration,
  checkLine,
  checkRows,
  heldRows,
  pieceKey,
  withRuns,
} from "./workspaceBuild";

/**
 * A plan built in its conversation (lead-workspace release 3b, frames 3, 4,
 * 7, 8, 31, 33): Yes, build it's walk through what's left to review, the
 * build in the chat (its step, card, the lead's words and the reply
 * choices), and its outputs — the Build log, the Check report and a new
 * widget's live preview.
 */

const CARD_ICON = {
  dashboard: "table-cells-large",
  widget: "puzzle-piece",
  bot: "robot",
  theme: "palette",
};

/**
 * Yes, build it: what's left to review before it builds (installs and the
 * Planner's approvals), one window at a time, as Create does. Providers
 * aren't asked for here — what needs one waits for it during the build.
 * `onReady(checks)` once nothing's left; `onCancel()` if a window is closed.
 */
export const BuildWalk = ({ wp, onReady, onCancel }) => {
  const [checks, setChecks] = useState(wp.checks || {});
  const next = (wp.checklist || []).find(
    (it) => it.kind !== "connect" && !isDone(it, checks, wp.have),
  );
  useEffect(() => {
    if (!next) onReady(checks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next ? next.id : null]);
  if (!next) return null;
  const finish = (status) => {
    wp.setCheck(next, status);
    setChecks((c) => ({ ...c, [next.id]: status }));
  };
  if (next.kind === "choose") {
    // Chosen: the plan names it, the item is gone, the walk goes on.
    return (
      <ChooseProviderDialog
        key={next.id}
        plan={wp.plan}
        index={next.pieceIndex}
        onEdit={wp.edit}
        picked={wp.picked || []}
        onPicked={wp.notePicked || null}
        onDone={() => {}}
        onClose={onCancel}
      />
    );
  }
  if (next.kind === "install") {
    return (
      <InstallReviewDialog
        item={next}
        onApprove={() => finish("approved")}
        onSkip={() => {
          // Taken out of the plan: the plan changed, so it waits for another yes.
          const piece = (wp.plan.pieces || [])[next.pieceIndex];
          wp.edit(
            removePiece(wp.plan, next.pieceIndex),
            `removed ${piece ? piece.name : next.package}`,
          );
          onCancel();
        }}
        onClose={onCancel}
      />
    );
  }
  return (
    <ConfirmationModal
      isOpen
      setIsOpen={(v) => !v && onCancel()}
      title="Before building"
      message={next.label}
      confirmLabel="OK"
      onConfirm={() => finish("done")}
      onCancel={onCancel}
    />
  );
};

/** A quiet line in the chat for the build ("Builder is building 2 widgets"). */
const BuildStepLine = ({ step, onLink = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  // Which model ran it (withRuns): a role's run opens to its details.
  const [open, setOpen] = useState(false);
  const run = step.run || null;
  const canOpen = !!(run && run.model);
  const icon =
    step.status === "asking"
      ? "spinner"
      : step.status === "failed"
        ? "circle-exclamation"
        : step.status === "stopped"
          ? "circle-stop"
          : "check";
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex flex-row items-center gap-2 text-sm ${muted}`}
        data-testid="workspace-build-step"
      >
        <FontAwesomeIcon
          icon={icon}
          className={`h-3 w-3 ${step.status === "asking" ? "animate-spin" : ""}`}
        />
        <span className={`font-medium ${strong}`}>{step.label}</span>
        <ModelTag run={run} />
        {canOpen ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide which model ran it" : "Which model ran it"}
            className={muted}
          >
            <FontAwesomeIcon
              icon={open ? "chevron-down" : "chevron-right"}
              className="h-2.5 w-2.5"
            />
          </button>
        ) : null}
        {step.link === "check" && onLink ? (
          <TextLink title="See the check" onClick={onLink} />
        ) : null}
      </div>
      {open && canOpen ? (
        <div className={`ml-5 border-l pl-3 ${hairline}`}>
          <RanOn run={run} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * What doesn't match what the user chose (held to your choices): one row
 * each — what the widget does, and what they chose.
 */
export const OffRows = ({ off = [] }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  if (!off.length) return null;
  return (
    <div
      className={`dr-chat-card self-start w-full flex flex-col rounded-xl border overflow-hidden ${hairline}`}
      data-testid="workspace-build-off"
    >
      {off.map((o, i) => (
        <div
          key={i}
          className={`flex flex-row items-start gap-3 px-4 py-3 text-sm ${i ? `border-t ${hairline}` : ""}`}
        >
          <span role="img" aria-label="Doesn't match">
            <FontAwesomeIcon
              icon="xmark"
              className={`h-3 w-3 mt-1 ${statusTokens.error.icon}`}
            />
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className={strong}>{o.main}</span>
            {o.chose ? (
              <span className={`text-xs ${muted}`}>You chose: {o.chose}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * The end of the line: no try can make it match — the closest that works,
 * when there is one, or stop here (nothing is installed).
 */
const EndOfLine = ({ chat, build, actions }) => {
  const { muted } = useConfigTokens();
  const step = chat.failed;
  return (
    <WizardAnswer
      testId="workspace-build-end"
      actions={
        <>
          {chat.closest && actions.fix ? (
            <Button
              title="Build it that way"
              onClick={() => actions.fix(step)}
            />
          ) : null}
          {actions.leaveOff ? (
            <Button2
              title="Stop here"
              onClick={() => actions.leaveOff(build.buildId, pieceKey(step))}
            />
          ) : null}
        </>
      }
    >
      <AnswerPart first title="End of the line — what now?">
        {chat.closest ? (
          <span className="text-sm">
            The closest that works: {chat.closest}. Everything else stays as you
            chose.
          </span>
        ) : null}
        <span className={`text-xs ${muted}`}>
          Stop here and nothing is installed — your answers stay in this
          conversation.
        </span>
      </AnswerPart>
    </WizardAnswer>
  );
};

/**
 * The build, told in the chat as it goes (DASH-21 frame 2): the lead's
 * line with the steps up front, each try sent back and why and each step
 * done — with their times — and, while it runs, the step it's on, for how
 * long, and the Build log a click away.
 */
/**
 * When it can't finish (DASH-21 frame 3): what happened, why, that nothing
 * changed, and what the user can do — each choice explained, its button
 * right there.
 */
const StopCard = ({ told, chat, build, actions }) => {
  const { muted } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const step = chat.failed;
  const run = {
    retry: () => actions.retry(step),
    fix: () => actions.fix(step),
    closest: () => actions.fix(step),
    plan: actions.changePlan || null,
    leave: () => actions.leaveOff(build.buildId, pieceKey(step)),
    carry: actions.carryOn || null,
  };
  const offered = told.options.filter(
    (o) =>
      (o.key === "plan" ? !!actions.changePlan : true) &&
      (o.key === "carry" ? !!actions.carryOn : true) &&
      (o.key !== "leave" || !!actions.leaveOff),
  );
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 text-sm ${statusTokens.error.bg} ${statusTokens.error.border} ${statusTokens.error.text}`}
      data-testid="workspace-build-stopped"
    >
      <span className={`font-semibold ${statusTokens.error.strongText}`}>
        {told.title}
      </span>
      {told.reason ? <span>{told.reason}</span> : null}
      {told.closest ? <span>{told.closest}</span> : null}
      {/* What didn't match what the user chose; a bare reason is said above. */}
      {(chat.off || []).some((o) => o && o.chose) ? (
        <OffRows off={chat.off.filter((o) => o && o.chose)} />
      ) : null}
      <span className="font-semibold">{told.unchanged}</span>
      {told.waiting ? <span>{told.waiting}</span> : null}
      <div className="flex flex-col gap-1">
        <span className="font-semibold">What you can do</span>
        <ul className="flex flex-col gap-1">
          {offered.map((o) => (
            <li key={o.key} data-testid="workspace-build-stopped-option">
              <span className="font-semibold">{o.label}</span> — {o.explain}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="flex flex-row flex-wrap items-center gap-2"
        data-testid="workspace-build-choices"
      >
        {offered.map((o, i) =>
          i === 0 ? (
            <Button key={o.key} title={o.label} onClick={run[o.key]} />
          ) : (
            <Button2 key={o.key} title={o.label} onClick={run[o.key]} />
          ),
        )}
      </div>
      {step && step.detail ? (
        <span className={`text-xs ${muted}`}>
          The Builder&apos;s own words are in the Build log.
        </span>
      ) : null}
    </div>
  );
};

const BuildStory = ({ story, leadName, live, onLog }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [tick, setTick] = useState(Date.now());
  const running = live && story.now;
  // One timer while it runs — not a new one each time the chat redraws.
  const ticking = !!running;
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const since = running && story.now.since ? Date.parse(story.now.since) : NaN;
  return (
    <div className="flex flex-col gap-2" data-testid="workspace-build-story">
      <ChatMessage role="reply" label={leadName} testId="workspace-build-intro">
        <span className="whitespace-pre-wrap">{story.intro}</span>
      </ChatMessage>
      {story.events.map((e, i) => (
        <div
          key={i}
          className="flex flex-row items-start gap-3 text-sm"
          data-testid="workspace-build-event"
          data-tone={e.tone}
        >
          <span
            className={`flex-shrink-0 w-10 pt-2 font-mono text-xs ${muted}`}
          >
            {e.time}
          </span>
          <span
            className={`min-w-0 rounded-xl border px-3 py-2 ${
              e.tone === "warn"
                ? `${statusTokens.warning.bg} ${statusTokens.warning.border} ${statusTokens.warning.text}`
                : `${hairline} ${strong}`
            }`}
          >
            {e.text}
          </span>
        </div>
      ))}
      {running ? (
        <div
          className={`flex flex-row flex-wrap items-center gap-2 text-sm ${strong}`}
          data-testid="workspace-build-now"
        >
          <FontAwesomeIcon icon="spinner" className="h-3 w-3 animate-spin" />
          <span>{story.now.text}</span>
          {Number.isNaN(since) ? null : (
            <span className={muted}>· {logDuration(tick - since)}</span>
          )}
          {onLog ? (
            <span className="ml-auto">
              <TextLink title="Build log ›" onClick={onLog} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * The build in the chat, after the message it started from: "Yes, build
 * it", the build's step line, its card, the lead's words, and — the latest
 * build of the conversation's plan — the reply choices.
 *
 * @param {object} build   { buildId, kind, leftOff } (useWorkspacePlan)
 * @param {object|null} state  the build's state
 * @param {string} leadName
 * @param {boolean} current  the conversation's plan's build: choices show
 * @param {object} actions   { fix, retry, leaveOff, approve, carryOn,
 *   openDashboard, openThemeEditor, open, placeInCell } —
 *   openThemeEditor(themeKey): a theme it made (theme round);
 *   publishTheme({ key, name, visibility }): a theme it changed (theme
 *   change round); open("buildlog" | "check" |
 *   "preview"); placeInCell: a cell build put in its cell again (6c);
 *   swapInPlace: a new widget put in the changed one's place (6c)
 * @param {string|null} actionError
 * @param {number} fix   shown under the user's fix (the fix's number): no
 *   yes, and the step line and words say it's a fix to the widget
 * @param {boolean} earlier  a fix came after: only what was built then
 */
export const BuildInChat = ({
  build,
  state,
  leadName = "Dash Lead",
  current = false,
  actions = {},
  actionError = null,
  // What the user said yes with: Yes, build it — or Yes, make the changes.
  yes = "Yes, build it",
  // A cell build (release 6c): { dashboardName, placed }.
  cell = null,
  // A change to one widget (release 6c): see buildChat.
  change = null,
  // Nothing runs it now (usePlanBuild's restored): Carry on building.
  restored = false,
  fix = 0,
  earlier = false,
}) => {
  const { muted } = useConfigTokens();
  // Each step line with the model that ran it.
  const chat = withRuns(
    fixChat(
      chatOf(build, state, { actions, cell, change, restored }),
      state,
      fix,
    ),
    state,
  );
  const card = chat.card;
  // The build told as it goes (DASH-21 frame 2) — its first round only:
  // a fix after it tells its own.
  const story = !earlier && !fix ? buildStory(state) : null;
  const telling = !!story && isBuilding(state);
  // A provider it waits for, asked here as it's needed (DASH-21 frame 6).
  const needs =
    current && state
      ? needsTold(
          state,
          waitingFor(state)
            .map(normalizeType)
            .filter((t) => t && !(actions.have && actions.have.has(t))),
        )
      : [];
  // It couldn't finish: said in full, with its choices (DASH-21 frame 3).
  // Reopened after Dash closed, it's still told — what needs the build
  // running becomes Carry on building.
  const told =
    current && state
      ? stopTold(
          restored
            ? chatOf(build, state, { actions, cell, change, restored: false })
            : chat,
          state,
          { edit: !!change, restored },
        )
      : null;
  // A fix came after it: what was built, as it was then — the rest is
  // under the fix.
  if (earlier) {
    const name = previewName(state);
    return (
      <div className="flex flex-col gap-3" data-testid="workspace-build">
        <ChatMessage role="you">{yes}</ChatMessage>
        <BuildStepLine
          step={{
            label: name ? `Builder built ${name}` : "Builder built it",
            status: "done",
          }}
        />
      </div>
    );
  }
  const openCard = () => {
    // A theme it made opens in the theme editor (theme round).
    if (card && card.kind === "theme") {
      if (actions.openThemeEditor && state && state.madeTheme)
        actions.openThemeEditor(state.madeTheme.key);
      return;
    }
    if (!actions.open || !card) return;
    actions.open(
      card.kind === "dashboard"
        ? (state.steps || []).some((s) => s.kind === "check")
          ? "check"
          : "buildlog"
        : chat.choices === "preview" || chat.choices === "testbot"
          ? "preview"
          : "buildlog",
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="workspace-build">
      {fix ? null : <ChatMessage role="you">{yes}</ChatMessage>}
      {story ? (
        <BuildStory
          story={story}
          leadName={leadName}
          live={current}
          onLog={actions.open ? () => actions.open("buildlog") : null}
        />
      ) : null}
      {needs.length ? (
        <BuildNeedsYou told={needs} onConnected={actions.onConnected} />
      ) : null}
      {state ? (
        <>
          {/* While it's told, the step line only when it links to the check
              (what didn't match is being fixed). */}
          {told || (telling && !(chat.step && chat.step.link)) ? null : (
            <BuildStepLine
              step={chat.step}
              onLink={actions.open ? () => actions.open("check") : null}
            />
          )}
          {(told || (telling && !(chat.step && chat.step.link))
            ? []
            : chat.lines || []
          ).map((l, i) => (
            <BuildStepLine
              key={i}
              step={l}
              onLink={actions.open ? () => actions.open("check") : null}
            />
          ))}
          {card ? (
            <div className="self-start w-full max-w-md">
              <OutputCard
                testId="workspace-build-card"
                icon={CARD_ICON[card.kind] || CARD_ICON.dashboard}
                title={card.title}
                sub={card.sub}
                // A card to open, as the mockup: an edge, a fill, and
                // what a click does.
                go={
                  chat.choices === "preview"
                    ? "Open preview"
                    : chat.choices === "testbot"
                      ? "Test it"
                      : "Open"
                }
                onClick={openCard}
              />
            </div>
          ) : null}
          {/* While it's told as it goes, "I'll tell you when it's done" says
              nothing more — anything else (a provider to connect) stays. */}
          {told ? (
            <StopCard told={told} chat={chat} build={build} actions={actions} />
          ) : null}
          {told || (telling && !(chat.off && chat.off.length)) ? null : (
            <ChatMessage
              role="reply"
              label={leadName}
              testId="workspace-build-reply"
              footer={
                (chat.off && chat.off.length) ||
                (current && chat.choices === "endofline") ? (
                  <div className="flex flex-col gap-3">
                    <OffRows off={chat.off || []} />
                    {current && chat.choices === "endofline" ? (
                      <EndOfLine chat={chat} build={build} actions={actions} />
                    ) : null}
                  </div>
                ) : null
              }
            >
              <span className="whitespace-pre-wrap">{chat.reply}</span>
            </ChatMessage>
          )}
          {current && !told ? (
            <BuildChoices
              chat={chat}
              state={state}
              build={build}
              actions={actions}
            />
          ) : null}
          {current && actionError ? (
            <span
              className={`text-xs ${muted}`}
              data-testid="workspace-build-error"
            >
              {actionError}
            </span>
          ) : null}
        </>
      ) : (
        <BuildStepLine
          step={{ label: "Starting the build", status: "asking" }}
        />
      )}
    </div>
  );
};

/** The widget the build's preview shows ("Preview Shopping Lite"). */
function previewName(state) {
  const at = ((state && state.steps) || []).find((s) => s.kind === "preview");
  return at ? String(at.label).replace(/^Preview /, "") : "";
}

/**
 * Under the user's fix: the Builder changing the widget, then the widget
 * changed — said as a fix, never as a new build.
 */
export function fixChat(chat, state, fix) {
  if (!fix || !state) return chat;
  const name = previewName(state) || "it";
  const steps = state.steps || [];
  const at = steps.find((s) => s.kind === "preview");
  // Changing: its build or check isn't done yet (after Looks good they are,
  // and installing says so in its own words).
  const changing =
    !!at &&
    steps.some(
      (s) =>
        (s.id === `build:${at.piece}` || s.id === `check:${at.piece}`) &&
        s.status !== "done",
    );
  if (state.status === "running" && changing) {
    return {
      ...chat,
      step: {
        label: `Sent to the Builder as a fix · changing ${name}`,
        status: "asking",
      },
      card: null,
      reply:
        "The Builder is changing only what you asked — the rest stays as it is.",
    };
  }
  if (state.status === "waiting-for-you") {
    return {
      ...chat,
      step: { label: `Builder changed ${name} · fix ${fix}`, status: "done" },
      card: {
        ...(chat.card || { kind: "widget" }),
        title: name,
        sub: "Widget · changed · preview ready",
      },
      reply: `Done — have a look on the right. Only what you asked changed; the rest of ${name} is as it was. Tell me if anything else should change.`,
    };
  }
  return chat;
}

/** An earlier fix, under the user's words: what the Builder did. */
export const PastFix = ({ state, n }) => (
  <BuildStepLine
    step={{
      label: `Builder changed ${previewName(state) || "it"} · fix ${n}`,
      status: "done",
    }}
  />
);

/** What the chat says about a build (buildChat), as BuildInChat shows it. */
function chatOf(build, state, { actions = {}, cell, change, restored }) {
  return buildChat(state, {
    kind: build.kind,
    leftOff: build.leftOff || [],
    cell,
    change,
    restored,
    // The app's theme now (theme change leftovers).
    ...(actions.appThemeKey !== undefined
      ? { appThemeKey: actions.appThemeKey }
      : {}),
  });
}

/** The reply choices under the lead's words about the build. */
const BuildChoices = ({ chat, state, build, actions }) => {
  const { muted } = useConfigTokens();
  // Use the remix for the app, once clicked (theme change leftovers).
  const [usedForApp, setUsedForApp] = useState(false);
  // A cell build (release 6c): not in its cell — put it in; in it — put
  // it back if the edits were cancelled (only an empty cell is filled).
  if (chat.choices === "place" && actions.placeInCell) {
    return (
      <div data-testid="workspace-build-choices">
        <Button title="Put it in the cell" onClick={actions.placeInCell} />
      </div>
    );
  }
  // A new widget made from one on a dashboard: into its place (6c).
  if (chat.choices === "swap" && actions.swapInPlace) {
    return (
      <div data-testid="workspace-build-choices">
        <Button title="Put it in its place" onClick={actions.swapInPlace} />
      </div>
    );
  }
  if (chat.choices === "open" && state.dashboard && actions.openDashboard) {
    return (
      <div data-testid="workspace-build-choices">
        <Button
          title={`Open ${state.dashboard.name}`}
          onClick={() => actions.openDashboard(state.dashboard.id)}
        />
      </div>
    );
  }
  // A theme it changed (theme change round, frames 51-52): publish it,
  // or small changes by hand.
  if (chat.choices === "themechange" && state.changedTheme) {
    const ch = state.changedTheme;
    // The app's theme switches to a remix only when the user clicks.
    const appUses =
      actions.appThemeKey !== undefined && ch.of && ch.of.key
        ? actions.appThemeKey === ch.of.key
        : !!ch.appUsesOriginal;
    const forApp =
      ch.remix && appUses && !!actions.useThemeForApp && !usedForApp;
    const publish = ch.remix
      ? ch.allowRemix === false
        ? null
        : "Publish your remix…"
      : ch.published
        ? "Publish the update"
        : "Publish it…";
    return (
      <div
        className="flex flex-col gap-1"
        data-testid="workspace-build-choices"
      >
        <div className="flex flex-row flex-wrap items-center gap-2">
          {forApp ? (
            <Button
              title="Use the remix for the app"
              onClick={() => {
                actions.useThemeForApp(ch.key);
                setUsedForApp(true);
              }}
            />
          ) : null}
          {publish && actions.publishTheme && forApp ? (
            <Button2
              title={publish}
              onClick={() =>
                actions.publishTheme({
                  key: ch.key,
                  name: ch.name,
                  visibility: null,
                })
              }
            />
          ) : publish && actions.publishTheme ? (
            <Button
              title={publish}
              onClick={() =>
                actions.publishTheme({
                  key: ch.key,
                  name: ch.name,
                  // An update stays as public or private as it is —
                  // private when the registry couldn't say.
                  visibility: ch.published
                    ? ch.published.visibility || "private"
                    : null,
                })
              }
            />
          ) : null}
          {actions.openThemeEditor ? (
            forApp || (publish && actions.publishTheme) ? (
              <Button2
                title="Open in the theme editor"
                onClick={() => actions.openThemeEditor(ch.key)}
              />
            ) : (
              <Button
                title="Open in the theme editor"
                onClick={() => actions.openThemeEditor(ch.key)}
              />
            )
          ) : null}
        </div>
        {usedForApp ? (
          <span
            className={`text-sm ${muted}`}
            data-testid="workspace-theme-for-app"
          >
            The app uses {ch.name} now.
          </span>
        ) : null}
        <span className={`text-xs ${muted}`}>
          The theme editor is for small changes by hand — a color, a font, a
          corner.
        </span>
      </div>
    );
  }
  // A theme it made (theme round, frame 47): use it for the app (plan →
  // build, frame 7), or small changes by hand.
  if (chat.choices === "theme" && state.madeTheme && actions.openThemeEditor) {
    const key = state.madeTheme.key;
    const forApp =
      !!actions.useThemeForApp &&
      !usedForApp &&
      !(actions.appThemeKey && actions.appThemeKey === key);
    return (
      <div
        className="flex flex-col gap-1"
        data-testid="workspace-build-choices"
      >
        <div className="flex flex-row flex-wrap items-center gap-2">
          {forApp ? (
            <Button
              title="Use it for the app"
              onClick={() => {
                actions.useThemeForApp(key);
                setUsedForApp(true);
              }}
            />
          ) : null}
          <Button2
            title="Open in the theme editor"
            onClick={() => actions.openThemeEditor(key)}
          />
        </div>
        {usedForApp ? (
          <span
            className={`text-sm ${muted}`}
            data-testid="workspace-theme-for-app"
          >
            The app uses {state.madeTheme.name || "it"} now.
          </span>
        ) : null}
        <span className={`text-xs ${muted}`}>
          For small changes by hand — a color, a font, a corner.
        </span>
      </div>
    );
  }
  if (chat.choices === "failed" && chat.failed) {
    const step = chat.failed;
    return (
      <div
        className="flex flex-col gap-2"
        data-testid="workspace-build-choices"
      >
        <div className="flex flex-row flex-wrap items-center gap-2">
          {step.canRetry ? (
            <Button title="Try again" onClick={() => actions.retry(step)} />
          ) : null}
          {step.canFix ? (
            step.canRetry ? (
              <Button2
                title="Let the Builder fix it"
                onClick={() => actions.fix(step)}
              />
            ) : (
              <Button
                title="Let the Builder fix it"
                onClick={() => actions.fix(step)}
              />
            )
          ) : null}
          <Button2
            title={chat.leave || "Leave it out"}
            onClick={() => actions.leaveOff(build.buildId, pieceKey(step))}
          />
        </div>
        {step.canFix && step.fixesLeft === 1 ? (
          <span className={`text-xs ${muted}`}>
            The Builder&apos;s last try.
          </span>
        ) : step.fixesUsedUp ? (
          <span className={`text-xs ${muted}`}>
            {`The Builder tried everything it could — say what to change, or ${(
              chat.leave || "Leave it out"
            ).toLowerCase()}.`}
          </span>
        ) : null}
      </div>
    );
  }
  // Saved, tested, paused (TST-003): turn it on here.
  if (chat.choices === "turnon") {
    return <TryBots bots={Object.values((state && state.bots) || {})} />;
  }
  // A bot to test before it's saved (TST-003): its test is on the right.
  if (chat.choices === "testbot") {
    return (
      <div
        className="flex flex-row flex-wrap items-center gap-2"
        data-testid="workspace-build-choices"
      >
        <Button title="Test it" onClick={() => actions.open("preview")} />
      </div>
    );
  }
  if (chat.choices === "preview") {
    const at = (state.steps || []).find((s) => s.status === "needs-you");
    return (
      <div
        className="flex flex-row flex-wrap items-center gap-2"
        data-testid="workspace-build-choices"
      >
        <Button
          title="Looks good"
          onClick={() => at && actions.approve(at.id, {})}
        />
        <Button2
          title="Change something"
          onClick={() => actions.open("preview")}
        />
        {actions.changePlan ? (
          <span className={`text-xs ${muted}`}>
            Something bigger, like a different provider?{" "}
            <TextLink
              title="Change the plan instead"
              onClick={actions.changePlan}
            />
          </span>
        ) : null}
      </div>
    );
  }
  if (chat.choices === "continue" && actions.carryOn) {
    return (
      <div data-testid="workspace-build-choices">
        <Button
          title={chat.continueLabel || "Carry on building"}
          onClick={actions.carryOn}
        />
      </div>
    );
  }
  // Removed: build it again from the plan.
  if (chat.choices === "again" && actions.buildAgain) {
    return (
      <div data-testid="workspace-build-choices">
        <Button2 title="Build it again" onClick={actions.buildAgain} />
      </div>
    );
  }
  return null;
};

/** An earlier build in the conversation (a plan changed since): as it ended. */
export const PastBuild = ({ build, leadName, onOpen }) => {
  // As it last ended — the main process keeps only the latest build.
  const { state } = usePlanBuild(build.buildId, build.last || null);
  return (
    <BuildInChat
      build={build}
      state={state}
      leadName={leadName}
      actions={{ open: onOpen }}
    />
  );
};

/** An opened output's heading: who made it, its title and line. */
const OutputHead = ({ from, title, sub }) => {
  const { muted, strong } = useConfigTokens();
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-xs ${muted}`}>{from}</span>
      <span className={`text-lg font-semibold ${strong}`}>{title}</span>
      {sub ? <span className={`text-sm ${muted}`}>{sub}</span> : null}
    </div>
  );
};

/**
 * A Build log step's mark: done, running, stopped on it, waiting on the
 * user, or to come (a dashed ring for one that won't start this time).
 */
const StepMark = ({ state, tone, ring }) => {
  if (state === "next" || state === "off")
    return (
      <span className="w-4 flex-shrink-0 pt-1">
        <span
          className={`block w-3.5 h-3.5 rounded-full border-2 ${state === "off" ? "border-dashed" : ""} ${ring}`}
        />
      </span>
    );
  const [name, color] = {
    done: ["circle-check", tone.ok],
    running: ["circle-notch", tone.running],
    bad: ["circle-exclamation", tone.bad],
    warn: ["circle-pause", tone.warn],
    you: ["circle-user", tone.warn],
  }[state] || ["circle", tone.idle];
  return (
    <span className="w-4 flex-shrink-0 pt-0.5">
      <FontAwesomeIcon
        icon={name}
        spin={state === "running"}
        className={color}
      />
    </span>
  );
};

/** What the step's role did, with times — its earlier tries first. */
const LogActivity = ({ activity, muted, strong, hairline, live, warn }) =>
  activity.length ? (
    <div className={`flex flex-col gap-1 border-l-2 pl-3 ${hairline}`}>
      {activity.map((a, i) => (
        <span
          key={i}
          className={`font-mono text-xs ${a.tone === "warn" ? warn : live && i === activity.length - 1 ? strong : muted}`}
          data-testid={
            a.tone === "warn"
              ? "workspace-build-log-try"
              : "workspace-build-log-activity"
          }
        >
          {a.time ? `${a.time} · ` : ""}
          {a.text}
        </span>
      ))}
    </div>
  ) : null;

/**
 * The Build log, opened (DASH-20): every step from the start — the running
 * one with who's on it, what it did lately and its earlier tries; the ones
 * to come with who does them; a finished one opens to how it went. Then the
 * bots it saved to try, and Remove what was built.
 */
export const BuildLogOutput = ({
  build,
  state,
  title = null,
  onRemoved = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const [opened, setOpened] = useState(null);
  const [said, setSaid] = useState(null);
  const building = isBuilding(state);
  // The running step's time counts up while it builds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!building) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [building]);
  const leftOff = build.leftOff || [];
  const edit = build.kind === "edit" || build.kind === "settings";
  const rows = buildLogSteps(state, leftOff, { now, edit });
  const head = buildLogHead(state, leftOff, { now });
  const status = state && state.status;
  const finished = status && status !== "waiting" && status !== "running";
  const built = (state && state.built) || {};
  const targeted = !!(built.dashboard && built.dashboard.targeted);
  const anythingBuilt = !!(
    (built.dashboard && !targeted) ||
    (built.placed || []).length ||
    built.theme ||
    built.changedTheme ||
    (built.bots || []).length ||
    (built.widgets || []).length
  );
  const bots = Object.values((state && state.bots) || {}).filter(
    (b) => b && b.id,
  );
  const tone = {
    ok: statusTokens.success.icon,
    bad: statusTokens.error.icon,
    warn: statusTokens.warning.icon,
    running: statusTokens.info.icon,
    idle: muted,
  };
  const headTone =
    { running: tone.running, bad: tone.bad, warn: tone.warn, ok: tone.ok }[
      head.tone
    ] || strong;
  const sideTone = (r) =>
    r.state === "you" ? tone.warn : r.state === "bad" ? tone.bad : muted;
  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await window.mainApi.bots.removePlanBuild(build.buildId);
      setConfirm(false);
      if (res && res.error) setError(res.error);
      else if (onRemoved) onRemoved(res);
    } catch (err) {
      setError((err && err.message) || "It couldn't be removed.");
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div
      // Full height in its scrolling column: a long log scrolls, never squeezed.
      className="flex flex-col gap-4 flex-shrink-0"
      data-testid="workspace-build-log"
    >
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${muted}`}>Builder · build log</span>
        <span className={`text-lg font-semibold ${strong}`}>
          {title || "Build log"}
        </span>
        <span className="text-sm" data-testid="workspace-build-log-head">
          <span className={`font-semibold ${headTone}`}>{head.lead}</span>
          {head.rest ? (
            <span className={muted}>{` · ${head.rest}`}</span>
          ) : null}
        </span>
      </div>
      {rows.length ? (
        <div
          className={`dr-chat-card flex flex-col flex-shrink-0 rounded-xl border overflow-hidden ${hairline}`}
        >
          {rows.map((r, i) => {
            const live = r.state === "running";
            const failed = r.state === "bad";
            const more =
              !live &&
              !failed &&
              (r.tries.length || r.activity.length || r.detail);
            const isOpen = opened === r.id;
            const saidOpen = said === r.id;
            const body = live || failed || isOpen;
            const dim = r.state === "next" || r.state === "off";
            return (
              <div
                key={r.id || i}
                className={`flex flex-row items-start gap-3 px-4 py-3 ${i ? `border-t ${hairline}` : ""} ${live || failed ? selectedBg : ""}`}
                data-testid="workspace-build-log-row"
                data-state={r.state}
              >
                <StepMark state={r.state} tone={tone} ring={hairline} />
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <div className="flex flex-row items-center gap-2 flex-wrap">
                    {more ? (
                      <button
                        type="button"
                        onClick={() => setOpened(isOpen ? null : r.id)}
                        aria-expanded={isOpen}
                        className={`text-left text-sm ${strong}`}
                      >
                        {r.label}
                        <FontAwesomeIcon
                          icon={isOpen ? "chevron-down" : "chevron-right"}
                          className={`ml-2 text-xs ${muted}`}
                        />
                      </button>
                    ) : (
                      <span
                        className={`text-sm ${live || failed ? "font-semibold" : ""} ${dim ? muted : strong}`}
                      >
                        {r.label}
                      </span>
                    )}
                    {r.badge && (live || failed) ? (
                      <Tag
                        text={r.badge}
                        padding="px-2 py-0.5"
                        textSize="text-xs"
                        rounded="rounded-full"
                        className={tone.warn}
                      />
                    ) : null}
                    <span className="flex-1" />
                    <span
                      className={`text-xs ${live || failed || r.state === "done" ? "font-mono" : ""} ${sideTone(r)}`}
                    >
                      {r.side}
                    </span>
                  </div>
                  {body ? (
                    <>
                      {r.now ? (
                        <span className={`text-sm ${strong}`}>{r.now}</span>
                      ) : null}
                      {r.note ? (
                        <span className={`text-sm ${tone.bad}`}>{r.note}</span>
                      ) : null}
                      <LogActivity
                        activity={r.activity}
                        muted={muted}
                        strong={strong}
                        hairline={hairline}
                        live={live}
                        warn={tone.warn}
                      />
                      {/* The Builder's own answer: folded — the line above
                          already says why; open it to read the rest. */}
                      {r.detail ? (
                        <button
                          type="button"
                          onClick={() => setSaid(saidOpen ? null : r.id)}
                          aria-expanded={saidOpen}
                          className={`text-left text-xs ${muted}`}
                        >
                          {`What the ${r.who || "bot"} said`}
                          <FontAwesomeIcon
                            icon={saidOpen ? "chevron-down" : "chevron-right"}
                            className="ml-2"
                          />
                        </button>
                      ) : null}
                      {saidOpen && r.detail ? (
                        <span
                          className={`whitespace-pre-wrap text-xs ${muted}`}
                        >
                          {r.detail}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span className={`text-sm ${muted}`}>Nothing has started yet.</span>
      )}
      {finished && status !== "removed" && bots.length ? (
        <TryBots bots={bots} />
      ) : null}
      {error ? <span className={`text-xs ${muted}`}>{error}</span> : null}
      {finished && status !== "removed" && anythingBuilt ? (
        <div>
          <Button3
            size="sm"
            title={targeted ? "Undo the changes" : "Remove what was built"}
            onClick={() => setConfirm(true)}
          />
        </div>
      ) : null}
      {confirm ? (
        <ConfirmationModal
          isOpen
          setIsOpen={(v) => !v && setConfirm(false)}
          title={
            targeted
              ? `Undo the changes to ${built.dashboard.name}?`
              : "Remove what was built?"
          }
          confirmLabel={
            removing
              ? targeted
                ? "Undoing…"
                : "Removing…"
              : targeted
                ? "Undo changes"
                : "Remove"
          }
          variant="danger"
          onConfirm={remove}
          onCancel={() => setConfirm(false)}
        >
          <RemoveSummary built={built} muted={muted} strong={strong} />
        </ConfirmationModal>
      ) : null}
    </div>
  );
};

/** The Check report, opened (frame 7): each widget the Checker looked at. */
export const CheckReportOutput = ({ state }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const rows = checkRows(state);
  const chose = heldRows(state);
  const tick = (ok) =>
    ok === null ? (
      <span
        role="img"
        aria-label="Not checked"
        className={`inline-block flex-shrink-0 h-2.5 w-2.5 mt-1 rounded-full border ${hairline}`}
      />
    ) : (
      <span role="img" aria-label={ok ? "Passed" : "Didn't pass"}>
        <FontAwesomeIcon
          icon={ok ? "check" : "xmark"}
          className={`h-3 w-3 mt-1 ${ok ? statusTokens.success.icon : statusTokens.error.icon}`}
        />
      </span>
    );
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-check-report">
      <OutputHead
        from="Checker · report"
        title="Check report"
        sub={checkLine(state)}
      />
      {chose.length ? (
        <div
          className="flex flex-col gap-2"
          data-testid="workspace-held-report"
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
          >
            What you chose
          </span>
          <div
            className={`dr-chat-card flex flex-col rounded-xl border overflow-hidden ${hairline}`}
          >
            {chose.map((r, i) => (
              <div
                key={i}
                className={`flex flex-row items-start gap-3 px-4 py-3 text-sm ${i ? `border-t ${hairline}` : ""}`}
                data-testid="workspace-held-row"
              >
                {tick(r.ok)}
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className={strong}>{r.main}</span>
                  {r.sub ? (
                    <span className={`text-xs ${muted}`}>{r.sub}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <span className={`text-xs ${muted}`}>
            Dash checks these in the code itself, every time.
          </span>
          <span
            className={`text-xs font-semibold uppercase tracking-wider pt-2 ${muted}`}
          >
            The Checker
          </span>
        </div>
      ) : null}
      {rows.length ? (
        <div
          className={`dr-chat-card flex flex-col rounded-xl border overflow-hidden ${hairline}`}
        >
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex flex-row items-start gap-3 px-4 py-3 text-sm ${i ? `border-t ${hairline}` : ""}`}
              data-testid="workspace-check-row"
            >
              {r.ok === null ? (
                <span
                  role="img"
                  aria-label="Not checked"
                  className={`inline-block flex-shrink-0 h-2.5 w-2.5 mt-1 rounded-full border ${hairline}`}
                />
              ) : (
                <span role="img" aria-label={r.ok ? "Passed" : "Didn't pass"}>
                  <FontAwesomeIcon
                    icon={r.ok ? "check" : "xmark"}
                    className={`h-3 w-3 mt-1 ${r.ok ? statusTokens.success.icon : statusTokens.error.icon}`}
                  />
                </span>
              )}
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={strong}>{r.main}</span>
                {r.sub ? (
                  <span className={`text-xs ${muted}`}>{r.sub}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className={`text-sm ${muted}`}>
          Nothing needed checking — no new widgets were built.
        </span>
      )}
    </div>
  );
};

/**
 * A new widget, running, before it goes into your widgets (frame 31): the
 * build waits on it — Looks good, or Change something (back to the
 * Builder).
 */
export const PreviewOutput = ({ state, pb, wire = null }) => {
  const [deciding, setDeciding] = useState(false);
  const steps = (state && state.steps) || [];
  const at = steps.find(
    (s) => s.kind === "preview" && s.status === "needs-you",
  );
  if (!at) return null;
  const name = String(at.label).replace(/^Preview /, "");
  const decide = async (call) => {
    setDeciding(true);
    await call();
    setDeciding(false);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-preview">
      <OutputHead
        from="Builder · live preview"
        title={name}
        sub="New widget · not in your widgets yet"
      />
      <CellPreview
        made={(state.made || {})[at.piece] || {}}
        name={name}
        cellLabel="your widgets"
        approveLabel="Looks good — add it to my widgets"
        inputsNote="Only for trying it here."
        wire={wire}
        deciding={deciding}
        checked={steps.some(
          (x) => x.id === `check:${at.piece}` && x.status === "done",
        )}
        onApprove={(inputs) => decide(() => pb.approve(at.id, inputs))}
        onRevise={
          steps.some((x) => x.id === `build:${at.piece}`)
            ? (note, marks) => decide(() => pb.revise(at.id, note, marks))
            : null
        }
      />
    </div>
  );
};

/**
 * A provider the build waits for, asked in the chat as it's needed (DASH-21
 * frame 6): what needs it, that the rest keeps building, Connect right
 * there — or Later, and what needs it waits.
 */
export const BuildNeedsYou = ({ told = [], onConnected }) => {
  const statusTokens = useStatusTokens();
  const [connecting, setConnecting] = useState(null);
  const [later, setLater] = useState([]);
  const shown = told.filter((n) => !later.includes(n.type));
  if (!shown.length) return null;
  return (
    <>
      {shown.map((n) => {
        const list = n.what.length ? n.what.join(", ") : "What needs it";
        const what = list.charAt(0).toUpperCase() + list.slice(1);
        return (
          <div
            key={n.type}
            className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm ${statusTokens.warning.bg} ${statusTokens.warning.border} ${statusTokens.warning.text}`}
            data-testid="workspace-build-needs"
          >
            <span
              className={`font-semibold ${statusTokens.warning.strongText}`}
            >
              {`${what} ${n.what.length > 1 ? "need" : "needs"} ${n.label} before ${n.what.length > 1 ? "they" : "it"} can work.`}
            </span>
            <span>
              Connect it here — everything else keeps building meanwhile.
            </span>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <Button
                title={`Connect ${n.label}`}
                onClick={() => setConnecting(n.type)}
              />
              <Button2
                title={`Later — ${n.what.length > 1 ? "they wait" : "it waits"}`}
                onClick={() => setLater((l) => [...l, n.type])}
              />
            </div>
          </div>
        );
      })}
      {connecting ? (
        <ConnectDialog
          item={{
            id: `connect:${connecting}`,
            kind: "connect",
            label: `Connect ${providerLabel(connecting)}`,
            providerType: connecting,
          }}
          onClose={() => {
            setConnecting(null);
            if (onConnected) onConnected();
          }}
        />
      ) : null}
    </>
  );
};
