import React, { useEffect, useState } from "react";
import { Button, Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { formatTokens, modelLabel } from "../../utils/runCostLabel";

/**
 * CreateBuildingStep — building an approved plan (create-entry PRD CRE-004
 * AC1/AC3/AC6, CRE-012 AC3; phase 4d-1). Each step shows who did it (the
 * Builder, the Checker, or Dash itself with no AI), its model and tokens; a
 * running total sits against the estimate. Stop halts after the current
 * step and keeps what's built; when it's done, Go to dashboard opens it.
 */

const ROLE = { builder: "Builder", checker: "Checker", dash: "Dash" };
const MARK = {
  waiting: "·",
  running: "…",
  done: "✓",
  failed: "✗",
  skipped: "–",
  stopped: "■",
};
const HEAD = {
  waiting: "Getting ready…",
  running: "Building…",
  done: "Built",
  "finished-with-problems": "Built, with problems",
  stopped: "Stopped — what's built is kept",
};

export const CreateBuildingStep = ({
  buildId,
  initialState = null,
  estimate = null,
  onOpenDashboard = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [state, setState] = useState(initialState);
  const [stopping, setStopping] = useState(false);

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
  const running = status === "waiting" || status === "running";
  const totals = (state && state.totals) || { tokens: 0, includedInPlan: true };
  const finished = !running;

  const stop = async () => {
    setStopping(true);
    try {
      await window.mainApi.bots.stopPlanBuild(buildId);
    } catch (_e) {
      setStopping(false);
    }
  };

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      data-testid="create-building"
    >
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-5 px-6 py-8">
        <div className="flex flex-row items-center justify-between gap-3">
          <span
            className={`text-lg font-semibold ${strong}`}
            data-testid="building-status"
          >
            {stopping && running
              ? "Stopping after this step…"
              : HEAD[status] || status}
          </span>
          {running ? (
            <Button3 title="Stop" onClick={stop} disabled={stopping} />
          ) : null}
        </div>

        <div className="flex flex-col gap-2" data-testid="building-steps">
          <SectionLabel text="Steps · who did what" />
          {steps.map((s) => (
            <div
              key={s.id}
              data-testid="building-step"
              className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${hairline}`}
            >
              <div className="flex flex-row items-center gap-3 text-sm">
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
                <span className={`text-xs flex-shrink-0 ${muted}`}>
                  {s.role === "dash"
                    ? "no AI"
                    : s.tokens
                      ? `${modelLabel(s.model) || ""} · ${formatTokens(s.tokens)} tokens`
                      : ""}
                </span>
              </div>
              {s.error ? (
                <span
                  className="text-xs ml-7"
                  data-testid="building-step-error"
                >
                  {s.error}
                </span>
              ) : s.status === "done" && s.detail && s.kind !== "check" ? (
                <span className={`text-xs ml-7 ${muted}`}>{s.detail}</span>
              ) : null}
              {s.kind === "check" && s.status === "failed" && s.detail ? (
                <pre
                  className={`text-xs ml-7 whitespace-pre-wrap font-mono ${muted}`}
                  style={{ maxHeight: "10rem", overflowY: "auto" }}
                >
                  {s.detail}
                </pre>
              ) : null}
            </div>
          ))}
        </div>

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

        {finished && state && state.dashboard && onOpenDashboard ? (
          <div className="flex flex-row items-center gap-3">
            <Button
              title="Go to dashboard"
              onClick={() => onOpenDashboard(state.dashboard.id)}
            />
            <span className={`text-xs ${muted}`}>{state.dashboard.name}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CreateBuildingStep;
