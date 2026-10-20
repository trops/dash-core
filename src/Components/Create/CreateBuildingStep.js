import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  SectionLabel,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { formatTokens, modelLabel } from "../../utils/runCostLabel";
import { normalizeType, providerLabel } from "./planChecklist";
import { ConnectDialog } from "./PlanChecklistDialogs";
import { CellPreview } from "./CellPreview";
import {
  useRegistryAuthGate,
  isRegistryAuthError,
} from "../../hooks/useRegistryAuthGate";

/**
 * CreateBuildingStep — building an approved plan (create-entry PRD CRE-004
 * AC1/AC3/AC6, CRE-012 AC3; phase 4d-1). Each step shows who did it (the
 * Builder, the Checker, or Dash itself with no AI), its model and tokens; a
 * running total sits against the estimate. Stop halts after the current
 * step and keeps what's built; when it's done, Go to dashboard opens it.
 * Saved bots are offered as Run <bot> now — never run on their own (4d-2).
 *
 * When a step fails (4d-3, CRE-004 AC4): Let Builder fix it (at most twice
 * per widget) or Try again on the step, and Edit plan / Remove what was
 * built for the whole build; finished steps are kept. Steps that need a
 * provider the user skipped wait for it (AC5) with Connect <provider>.
 *
 * A cell build (consolidation Phase 2b, `cell`): after the Checker the
 * build waits on the Preview step — CellPreview, where the user picks its
 * connection and settings, runs it, and decides (Looks good / Change
 * something / Discard). When it's done, onCellDone(made) hands the widget
 * and the picks to the editor; nothing here touches the dashboard.
 */

const ROLE = {
  builder: "Builder",
  checker: "Checker",
  dash: "Dash",
  you: "You",
};
// How many times the Builder fixes one widget by itself (planBuild MAX_FIXES).
const MAX_FIXES = 2;
const tries = (n) => (n === 1 ? "1 try" : `${n} tries`);
const MARK = {
  waiting: "·",
  running: "…",
  done: "✓",
  failed: "✗",
  skipped: "–",
  stopped: "■",
  "needs-provider": "○",
  "needs-you": "→",
};
const HEAD = {
  waiting: "Getting ready…",
  running: "Building…",
  done: "Built",
  "finished-with-problems": "Built, with problems",
  stopped: "Stopped — what's built is kept",
  removed: "Removed",
  // The app closed while it was building (4e-1): finished steps are kept.
  interrupted: "Interrupted — the app closed while it was building",
  // A cell build's preview (Phase 2b).
  "waiting-for-you": "Ready for you to look at",
};

/** The providers waiting steps need, once each: ["gmail"]. */
export function waitingProviders(steps) {
  const out = [];
  for (const s of steps || []) {
    if (s.status !== "needs-provider") continue;
    for (const p of s.waitingFor || []) {
      const t = normalizeType(p);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** "Gmail" · "Gmail and Slack" */
const andList = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0] || "";

export const CreateBuildingStep = ({
  buildId,
  initialState = null,
  estimate = null,
  onOpenDashboard = null,
  onEditPlan = null,
  onRemoved = null,
  onContinue = null,
  // The dock's narrow panel (4e-2).
  compact = false,
  // A cell build (Phase 2b): { label } — "cell 2.2 on Slack Pack"; done →
  // onCellDone(made); Discard → onDiscard().
  cell = null,
  onCellDone = null,
  onDiscard = null,
}) => {
  const app = useContext(AppContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const [state, setState] = useState(initialState);
  const [stopping, setStopping] = useState(false);
  // botId → "starting" | "started" | error text
  const [runs, setRuns] = useState({});
  // A fix / retry / resume / remove that couldn't start.
  const [actionError, setActionError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // The provider type being connected (waiting steps).
  const [connecting, setConnecting] = useState(null);
  // A registry install that failed because the user isn't signed in: sign
  // in (the Widgets page's prompt), then it's tried again.
  const { ensureAuthed, authGate } = useRegistryAuthGate();

  useEffect(() => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots) return undefined;
    const id = bots.onPlanBuild
      ? bots.onPlanBuild((payload) => {
          if (payload && payload.buildId === buildId) setState(payload.state);
        })
      : null;
    // Catch up on anything sent before we subscribed.
    if (bots.getPlanBuild) {
      Promise.resolve(bots.getPlanBuild(buildId))
        .then((res) => res && res.state && setState(res.state))
        .catch(() => {});
    }
    return () => {
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [buildId]);

  const steps = (state && state.steps) || [];
  const status = (state && state.status) || "waiting";
  // A cell build that's done: the editor places it, once.
  const handedOff = useRef(false);
  useEffect(() => {
    if (!cell || status !== "done" || handedOff.current) return;
    handedOff.current = true;
    const made = (state && state.made && state.made[0]) || {};
    if (onCellDone) onCellDone(made);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, status]);
  // Looks good / Change something on the preview.
  const [deciding, setDeciding] = useState(false);
  const decide = async (call) => {
    setDeciding(true);
    await act(call);
    setDeciding(false);
  };
  const running = status === "waiting" || status === "running";
  const totals = (state && state.totals) || { tokens: 0, includedInPlan: true };
  const finished = !running;
  const waitingFor = waitingProviders(steps);
  const built = (state && state.built) || {};
  const leftovers = (state && state.leftovers) || [];
  const hasProblems =
    status === "finished-with-problems" ||
    status === "stopped" ||
    status === "waiting-for-providers" ||
    status === "interrupted";
  // An interrupted build has no live run: it continues first (4e-1).
  const interrupted = status === "interrupted";
  // A build on a dashboard the user had (5e-2b) changes it, never owns it.
  const targeted = !!(built.dashboard && built.dashboard.targeted);
  const anythingBuilt = !!(
    (built.dashboard && !targeted) ||
    (built.placed || []).length ||
    built.theme ||
    (built.bots || []).length ||
    (built.widgets || []).length
  );

  const savedBots = Object.values((state && state.bots) || {}).filter(
    (b) => b && b.id,
  );
  // Which of them are paused — Turn on is offered only for those.
  const [pausedBots, setPausedBots] = useState([]);
  const savedIds = savedBots.map((b) => b.id).join(",");
  useEffect(() => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!savedIds || !bots || !bots.getPauseState) return undefined;
    let alive = true;
    Promise.resolve(bots.getPauseState())
      .then((p) => {
        if (alive) setPausedBots((p && p.bots) || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [savedIds]);
  // The bots a build saves start paused (Phase 1d): trying one is a test
  // run, and a pass offers Turn on.
  const runBot = async (bot) => {
    setRuns((r) => ({ ...r, [bot.id]: "starting" }));
    try {
      const res = await window.mainApi.bots.run(bot.id);
      setRuns((r) => ({
        ...r,
        [bot.id]:
          res && res.skipped
            ? `It didn't run: ${res.reason || "it was skipped"}.`
            : res && (res.error || res.status === "failed")
              ? String(res.error || "The run failed.")
              : "passed",
      }));
    } catch (err) {
      setRuns((r) => ({
        ...r,
        [bot.id]: (err && err.message) || "It couldn't start.",
      }));
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await window.mainApi.bots.stopPlanBuild(buildId);
    } catch (_e) {
      setStopping(false);
    }
  };

  // Fix / retry / resume start in the main process; progress comes back on
  // onPlanBuild like the first pass.
  const act = async (call) => {
    setActionError(null);
    setStopping(false);
    try {
      const res = await call();
      if (res && res.error) setActionError(res.error);
    } catch (err) {
      setActionError((err && err.message) || "That didn't start.");
    }
  };
  const fix = (step) =>
    act(() => window.mainApi.bots.fixPlanBuild(buildId, step.id));
  const retry = (step) =>
    act(() => window.mainApi.bots.retryPlanBuild(buildId, step.id));
  const signInAndRetry = async (step) => {
    const ok = await ensureAuthed({
      message: "Sign in to the Dash registry to install this widget.",
    });
    if (ok) retry(step);
  };

  // Connect, then the waiting steps run (only if it really got connected,
  // they'd wait again otherwise).
  const connected = async () => {
    setConnecting(null);
    if (app.refreshProviders) {
      try {
        await app.refreshProviders();
      } catch (_e) {
        // the resume below says if it's still missing
      }
    }
    act(() => window.mainApi.bots.resumePlanBuild(buildId));
  };

  const remove = async () => {
    setRemoving(true);
    setActionError(null);
    try {
      const res = await window.mainApi.bots.removePlanBuild(buildId);
      setConfirmRemove(false);
      if (res && res.error) {
        setActionError(res.error);
        return;
      }
      if (onRemoved) onRemoved(res);
    } catch (err) {
      setActionError((err && err.message) || "It couldn't be removed.");
    } finally {
      setRemoving(false);
    }
  };

  // The AI a step used — beside it full size; its own line in the dock, so
  // the step's name has the width.
  const usageOf = (s) => {
    const text =
      s.role === "dash"
        ? "no AI"
        : s.tokens
          ? `${modelLabel(s.model) || ""} · ${formatTokens(s.tokens)} tokens`
          : "";
    if (compact && !text) return null;
    return (
      <span
        className={`text-xs ${compact ? "ml-7" : "flex-shrink-0"} ${muted}`}
        data-testid="building-step-usage"
      >
        {text}
      </span>
    );
  };

  const heading =
    stopping && running
      ? "Stopping after this step…"
      : status === "waiting-for-providers"
        ? `Built — waiting for ${andList(waitingFor.map(providerLabel))}`
        : targeted && status === "done"
          ? `Changes made to ${built.dashboard.name}`
          : cell && status === "finished-with-problems"
            ? // Nothing went into the cell yet — not "built".
              "It isn't ready yet"
            : HEAD[status] || status;

  // A cell build waiting on the user: the Preview takes the screen (as the
  // mockup) — the widget running, its inputs, and what to do with it.
  const waitingPreview = cell
    ? steps.find((x) => x.kind === "preview" && x.status === "needs-you")
    : null;
  if (waitingPreview) {
    const p = waitingPreview.piece;
    const doneSoFar = steps
      .filter((x) => x.status === "done")
      .map((x) => `${x.label} ✓`)
      .join(" · ");
    return (
      <div
        className={`flex-1 min-h-0 overflow-y-auto ${strong}`}
        data-testid="create-building"
      >
        <div className="w-full flex flex-col gap-4 px-6 py-6">
          <div className="flex flex-col gap-1">
            <span
              className={`text-lg font-semibold ${strong}`}
              data-testid="building-status"
            >
              {HEAD["waiting-for-you"]}
            </span>
            {doneSoFar ? (
              <span
                className={`text-xs ${muted}`}
                data-testid="building-done-so-far"
              >
                {doneSoFar}
              </span>
            ) : null}
          </div>
          {actionError ? (
            <span className="text-xs" data-testid="building-action-error">
              {actionError}
            </span>
          ) : null}
          <CellPreview
            made={(state.made || {})[p] || {}}
            name={waitingPreview.label.replace(/^Preview /, "")}
            cellLabel={cell.label}
            deciding={deciding}
            checked={steps.some(
              (x) => x.id === `check:${p}` && x.status === "done",
            )}
            onApprove={(inputs) =>
              decide(() =>
                window.mainApi.bots.approvePlanStep(
                  buildId,
                  waitingPreview.id,
                  inputs,
                ),
              )
            }
            onRevise={
              steps.some((x) => x.id === `build:${p}`)
                ? (note) =>
                    decide(() =>
                      window.mainApi.bots.revisePlanStep(
                        buildId,
                        waitingPreview.id,
                        note,
                      ),
                    )
                : null
            }
            onDiscard={onDiscard}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto ${strong}`}
      data-testid="create-building"
    >
      <div
        className={`mx-auto w-full ${
          // A cell build's preview sits beside its inputs: more room.
          cell ? "max-w-5xl" : "max-w-3xl"
        } flex flex-col ${compact ? "gap-3 px-3 py-3" : "gap-5 px-6 py-8"}`}
      >
        <div className="flex flex-row items-center justify-between gap-3">
          <span
            className={`text-lg font-semibold ${strong}`}
            data-testid="building-status"
          >
            {heading}
          </span>
          {running ? (
            <Button3 title="Stop" onClick={stop} disabled={stopping} />
          ) : null}
        </div>
        {cell && running ? (
          // As the mockup's Build frame.
          <span className={`text-sm ${muted}`} data-testid="building-cell-note">
            {`If the Checker finds problems, nothing is installed: the Builder gets up to ${MAX_FIXES} tries to fix them. Then you see it running before it goes in.`}
          </span>
        ) : null}

        {finished && !interrupted && waitingFor.length ? (
          <div
            className="flex flex-row flex-wrap items-center gap-3"
            data-testid="building-waiting"
          >
            {waitingFor.map((t) => (
              <Button3
                key={t}
                title={`Connect ${providerLabel(t)}`}
                onClick={() => setConnecting(t)}
              />
            ))}
            <span className={`text-xs ${muted}`}>
              The steps that need it run once it's connected.
            </span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2" data-testid="building-steps">
          <SectionLabel text="Steps · who did what" />
          {steps.map((s) => (
            <div
              key={s.id}
              data-testid="building-step"
              className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${hairline}`}
            >
              <div
                className="flex flex-row items-center gap-3 text-sm"
                data-testid="building-step-head"
              >
                <span className="w-4 text-center" aria-label={s.status}>
                  {MARK[s.status] || "·"}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider w-20 flex-shrink-0">
                  {ROLE[s.role] || s.role}
                </span>
                <span
                  className={`flex-1 min-w-0 ${s.status === "waiting" ? muted : ""}`}
                >
                  {s.label}
                </span>
                {compact ? null : usageOf(s)}
              </div>
              {compact ? usageOf(s) : null}
              {s.kind === "build" && s.revision && s.status === "running" ? (
                <span
                  className={`text-xs ml-7 ${muted}`}
                  data-testid="building-step-revising"
                >
                  Changing it as you asked
                </span>
              ) : null}
              {s.kind === "build" && s.fixTry && s.status === "running" ? (
                <span
                  className={`text-xs ml-7 ${muted}`}
                  data-testid="building-step-fixing"
                >
                  Fixing what went wrong · try {s.fixTry} of {MAX_FIXES}
                </span>
              ) : null}
              {s.status === "needs-provider" ? (
                <span
                  className={`text-xs ml-7 ${muted}`}
                  data-testid="building-step-waiting"
                >
                  waiting for{" "}
                  {andList(
                    (s.waitingFor || []).map((p) => providerLabel(p) || p),
                  )}
                </span>
              ) : s.error ? (
                <span
                  className="text-xs ml-7"
                  data-testid="building-step-error"
                >
                  {s.error}
                </span>
              ) : s.status === "done" && s.detail && s.kind !== "check" ? (
                <span className={`text-xs ml-7 ${muted}`}>
                  {s.reused ? "kept from before · " : ""}
                  {s.kind === "build" && s.fixTry
                    ? `fixed by the Builder after ${tries(s.fixTry)} · `
                    : ""}
                  {s.detail}
                </span>
              ) : null}
              {(s.kind === "check" || s.kind === "build") &&
              s.status === "failed" &&
              s.detail ? (
                <pre
                  className={`text-xs ml-7 whitespace-pre-wrap font-mono ${muted}`}
                  style={{ maxHeight: "10rem", overflowY: "auto" }}
                >
                  {s.detail}
                </pre>
              ) : null}
              {finished && !interrupted && s.status === "failed" ? (
                <div
                  className="flex flex-row flex-wrap items-center gap-3 ml-7"
                  data-testid="building-step-options"
                >
                  {s.canFix ? (
                    <Button3
                      title="Let Builder fix it"
                      size="sm"
                      onClick={() => fix(s)}
                    />
                  ) : null}
                  {s.canRetry && isRegistryAuthError(s.error) ? (
                    <Button3
                      title="Sign in to the registry"
                      size="sm"
                      onClick={() => signInAndRetry(s)}
                    />
                  ) : s.canRetry ? (
                    <Button3
                      title="Try again"
                      size="sm"
                      onClick={() => retry(s)}
                    />
                  ) : null}
                  <span className={`text-xs ${muted}`}>
                    {s.canFix && s.fixesLeft === 1
                      ? "The Builder's last try."
                      : s.fixesUsedUp
                        ? "The Builder tried twice — edit the plan or remove what was built."
                        : ""}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {leftovers.length ? (
          <span className={`text-xs ${muted}`} data-testid="building-leftovers">
            Still on the dashboard from before:{" "}
            {leftovers.map((l) => l.name).join(", ")} — the edited plan doesn't
            have them. Remove them in Edit.
          </span>
        ) : null}

        <div className="flex flex-col gap-1" data-testid="building-total">
          <SectionLabel text={finished ? "Cost" : "Running total"} />
          <span className="text-sm">
            {formatTokens(totals.tokens)} tokens
            {estimate && estimate.total
              ? ` · estimate ~${formatTokens(estimate.total)}`
              : ""}
            {totals.includedInPlan
              ? " · included in your plan"
              : totals.usd
                ? ` · $${totals.usd.toFixed(2)}`
                : ""}
          </span>
        </div>

        {actionError ? (
          <span className="text-xs" data-testid="building-action-error">
            {actionError}
          </span>
        ) : null}

        {finished && hasProblems && (onEditPlan || anythingBuilt) ? (
          <div
            className="flex flex-row flex-wrap items-center gap-3"
            data-testid="building-recover"
          >
            {interrupted && onContinue ? (
              <Button title="Continue building" onClick={onContinue} />
            ) : null}
            {onEditPlan ? (
              <Button3 title="Edit plan" onClick={onEditPlan} />
            ) : null}
            {anythingBuilt ? (
              <Button3
                title="Remove what was built"
                onClick={() => setConfirmRemove(true)}
              />
            ) : null}
            <span className={`text-xs ${muted}`}>Finished steps are kept.</span>
          </div>
        ) : null}

        {finished && status !== "removed" && savedBots.length ? (
          <div className="flex flex-col gap-2" data-testid="building-run-bots">
            <SectionLabel text="Try the bots" />
            <span className={`text-xs ${muted}`}>
              New bots start paused — try one, then turn it on.
            </span>
            {savedBots.map((b) => {
              const run = runs[b.id];
              return (
                <div key={b.id} className="flex flex-row items-center gap-3">
                  <Button3
                    title={`Run ${b.name} now`}
                    onClick={() => runBot(b)}
                    disabled={run === "starting"}
                  />
                  <span className={`text-xs ${muted}`}>
                    {run === "starting"
                      ? "Running…"
                      : run === "passed"
                        ? "It worked — turn it on?"
                        : run === "on"
                          ? `${b.name} is on.`
                          : run || ""}
                  </span>
                  {pausedBots.includes(b.id) && run !== "on" ? (
                    <Button3
                      title={`Turn ${b.name} on`}
                      onClick={async () => {
                        try {
                          await window.mainApi.bots.resumeBot(b.id);
                          setRuns((r) => ({ ...r, [b.id]: "on" }));
                        } catch (err) {
                          setRuns((r) => ({
                            ...r,
                            [b.id]: `Couldn't turn it on: ${(err && err.message) || "unknown error"}`,
                          }));
                        }
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {finished &&
        status !== "removed" &&
        state &&
        state.dashboard &&
        onOpenDashboard ? (
          <div className="flex flex-row items-center gap-3">
            <Button
              title="Go to dashboard"
              onClick={() => onOpenDashboard(state.dashboard.id)}
            />
            <span className={`text-xs ${muted}`}>{state.dashboard.name}</span>
          </div>
        ) : null}
      </div>

      {confirmRemove ? (
        <ConfirmationModal
          isOpen
          setIsOpen={(v) => !v && setConfirmRemove(false)}
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
          onCancel={() => setConfirmRemove(false)}
        >
          <RemoveSummary built={built} muted={muted} strong={strong} />
        </ConfirmationModal>
      ) : null}

      {authGate}
      {connecting ? (
        <ConnectDialog
          item={{
            id: `connect:${connecting}`,
            kind: "connect",
            label: `Connect ${providerLabel(connecting)}`,
            providerType: connecting,
          }}
          onClose={connected}
        />
      ) : null}
    </div>
  );
};

/** What Remove takes away and what stays (CRE-006 AC7's rule: installs stay). */
// The modal body sets no text color, so each line takes the theme's.
export const RemoveSummary = ({ built, muted = "", strong = "" }) => {
  // A dashboard the user had stays, with its lead and what its team knows.
  const targeted = !!(built.dashboard && built.dashboard.targeted);
  const goes = [];
  if (built.dashboard && !targeted) {
    goes.push(`The "${built.dashboard.name}" dashboard`);
  }
  if (targeted && (built.placed || []).length) {
    const n = built.placed.length;
    goes.push(
      `${n === 1 ? "The widget" : `The ${n} widgets`} it put on ${built.dashboard.name}`,
    );
  }
  for (const b of built.bots || []) goes.push(`The ${b.name} bot`);
  if (built.dashboard && !targeted) {
    goes.push("The dashboard's team lead, if it has one");
  }
  for (const w of built.widgets || []) goes.push(`The ${w} widget`);
  if (targeted && built.theme) {
    goes.push(
      `The ${built.theme.name} theme — ${
        built.theme.previous
          ? `${built.theme.previousName || built.theme.previous} goes back`
          : "it goes back to the app's theme"
      }`,
    );
  }
  const stays = [
    ...(targeted
      ? [
          `The "${built.dashboard.name}" dashboard, its team lead and everything else on it`,
        ]
      : []),
    ...(built.installs || []).map((p) => `${p} — stays installed`),
    ...(built.updated || []).map((p) => `${p} — keeps its changes`),
  ];
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="remove-summary">
      <SectionLabel text="Removed" />
      {goes.map((g) => (
        <span key={g} className={strong}>
          {g}
        </span>
      ))}
      {stays.length ? (
        <>
          <SectionLabel text="Kept" />
          {stays.map((g) => (
            <span key={g} className={muted}>
              {g}
            </span>
          ))}
        </>
      ) : null}
    </div>
  );
};

export default CreateBuildingStep;
