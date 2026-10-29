import React, { useEffect, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ChatMessage,
  ConfirmationModal,
  FontAwesomeIcon,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { isDone, providerLabel, removePiece } from "../Create/planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
} from "../Create/PlanChecklistDialogs";
import { CellPreview } from "../Create/CellPreview";
import { RemoveSummary, TryBots } from "../Create/CreateBuildingStep";
import { OutputCard } from "./PlanViews";
import { usePlanBuild } from "./usePlanBuild";
import {
  buildChat,
  buildLogLine,
  buildLogRows,
  checkLine,
  checkRows,
  pieceKey,
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
const BuildStepLine = ({ step }) => {
  const { muted, strong } = useConfigTokens();
  const icon =
    step.status === "asking"
      ? "spinner"
      : step.status === "failed"
        ? "circle-exclamation"
        : step.status === "stopped"
          ? "circle-stop"
          : "check";
  return (
    <div
      className={`flex flex-row items-center gap-2 text-sm ${muted}`}
      data-testid="workspace-build-step"
    >
      <FontAwesomeIcon
        icon={icon}
        className={`h-3 w-3 ${step.status === "asking" ? "animate-spin" : ""}`}
      />
      <span className={`font-medium ${strong}`}>{step.label}</span>
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
 *   openDashboard, open, placeInCell } — open("buildlog" | "check" |
 *   "preview"); placeInCell: a cell build put in its cell again (6c);
 *   swapInPlace: a new widget put in the changed one's place (6c)
 * @param {string|null} actionError
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
}) => {
  const { muted } = useConfigTokens();
  const chat = buildChat(state, {
    kind: build.kind,
    leftOff: build.leftOff || [],
    cell,
    change,
  });
  const card = chat.card;
  const openCard = () => {
    if (!actions.open || !card) return;
    actions.open(
      card.kind === "dashboard"
        ? (state.steps || []).some((s) => s.kind === "check")
          ? "check"
          : "buildlog"
        : chat.choices === "preview"
          ? "preview"
          : "buildlog",
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="workspace-build">
      <ChatMessage role="you">{yes}</ChatMessage>
      {state ? (
        <>
          <BuildStepLine step={chat.step} />
          {card ? (
            <div className="self-start w-full max-w-md">
              <OutputCard
                testId="workspace-build-card"
                icon={CARD_ICON[card.kind] || CARD_ICON.dashboard}
                title={card.title}
                sub={card.sub}
                bordered={false}
                onClick={openCard}
              />
            </div>
          ) : null}
          <ChatMessage
            role="reply"
            label={leadName}
            testId="workspace-build-reply"
          >
            <span className="whitespace-pre-wrap">{chat.reply}</span>
          </ChatMessage>
          {current ? (
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

/** The reply choices under the lead's words about the build. */
const BuildChoices = ({ chat, state, build, actions }) => {
  const { muted } = useConfigTokens();
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
  if (chat.choices === "place-again" && actions.placeInCell) {
    return (
      <div data-testid="workspace-build-choices">
        <Button2 title="Put it in again" onClick={actions.placeInCell} />
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
            title="Leave it off"
            onClick={() => actions.leaveOff(build.buildId, pieceKey(step))}
          />
        </div>
        {step.canFix && step.fixesLeft === 1 ? (
          <span className={`text-xs ${muted}`}>
            The Builder&apos;s last try.
          </span>
        ) : step.fixesUsedUp ? (
          <span className={`text-xs ${muted}`}>
            The Builder tried twice — leave it off, or say what to change.
          </span>
        ) : null}
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
 * The Build log, opened (frame 4): a row per step — its time and what
 * happened — then the bots it saved to try, and Remove what was built.
 */
export const BuildLogOutput = ({ build, state, onRemoved = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const leftOff = build.leftOff || [];
  const rows = buildLogRows(state, leftOff);
  const status = state && state.status;
  const finished = status && status !== "waiting" && status !== "running";
  const built = (state && state.built) || {};
  const targeted = !!(built.dashboard && built.dashboard.targeted);
  const anythingBuilt = !!(
    (built.dashboard && !targeted) ||
    (built.placed || []).length ||
    built.theme ||
    (built.bots || []).length ||
    (built.widgets || []).length
  );
  const bots = Object.values((state && state.bots) || {}).filter(
    (b) => b && b.id,
  );
  const tone = {
    bad: statusTokens.error.icon,
    warn: statusTokens.warning.icon,
  };
  const toneOf = (t) =>
    t === "bad" ? tone.bad : t === "warn" ? tone.warn : muted;
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
    <div className="flex flex-col gap-4" data-testid="workspace-build-log">
      <OutputHead
        from="Builder · build log"
        title="Build log"
        sub={buildLogLine(state, leftOff)}
      />
      {rows.length ? (
        <div
          className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
        >
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex flex-row items-start gap-3 px-4 py-2.5 font-mono text-xs ${i ? `border-t ${hairline}` : ""}`}
              data-testid="workspace-build-log-row"
            >
              <span className={`w-10 flex-shrink-0 ${toneOf(r.tone)}`}>
                {r.time}
              </span>
              <span
                className={`flex-1 min-w-0 ${r.tone === "bad" ? tone.bad : strong}`}
              >
                {r.text}
              </span>
            </div>
          ))}
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
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-check-report">
      <OutputHead
        from="Checker · report"
        title="Check report"
        sub={checkLine(state)}
      />
      {rows.length ? (
        <div
          className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
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
export const PreviewOutput = ({ state, pb }) => {
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
        deciding={deciding}
        checked={steps.some(
          (x) => x.id === `check:${at.piece}` && x.status === "done",
        )}
        onApprove={(inputs) => decide(() => pb.approve(at.id, inputs))}
        onRevise={
          steps.some((x) => x.id === `build:${at.piece}`)
            ? (note) => decide(() => pb.revise(at.id, note))
            : null
        }
      />
    </div>
  );
};

/**
 * Needs you, during a build (frames 3, 33): a provider the build waits for —
 * Connect (or Reconnect); what needs it carries on once it's there.
 */
export const BuildNeedsYou = ({ types = [], onConnected }) => {
  const { muted, strong } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [connecting, setConnecting] = useState(null);
  if (!types.length) return null;
  return (
    <>
      {types.map((t) => (
        <div
          key={t}
          className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${statusTokens.warning.accentBorder}`}
          data-testid="workspace-build-needs"
        >
          <span className={`text-xs ${muted}`}>Builder · Dash team</span>
          <span className={`text-sm font-semibold ${strong}`}>
            Needs you: connect {providerLabel(t)}
          </span>
          <span className={`text-sm ${muted}`}>
            What uses it waits for it. The rest keeps building.
          </span>
          <div>
            <Button2
              size="sm"
              title="Connect"
              onClick={() => setConnecting(t)}
            />
          </div>
        </div>
      ))}
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
