import React, { useState } from "react";
import {
  Button,
  Button2,
  Button3,
  FlowKindChip,
  FontAwesomeIcon,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { whenText } from "../Issues/issueText";
import { flowsApi } from "../../hooks/useFlows";
import { chainOrder } from "../Flows/flowText";
import { CriteriaEditor, PROOF_OPTIONS } from "./CriteriaEditor";
import { roundLines } from "./goalText";

const proofLabel = (p) =>
  (PROOF_OPTIONS.find((o) => o.value === p) || PROOF_OPTIONS[4]).label;
const proofState = (p) =>
  p === "none"
    ? "warning"
    : p === "reviewer"
      ? "closed"
      : p === "you"
        ? "neutral"
        : "info";

const SectionLabel = ({ children }) => {
  const { muted } = useConfigTokens();
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>
      {children}
    </span>
  );
};

/** A check's result details, as rows (rules, a tool call's answer). */
function detailRows(details) {
  if (!details) return [];
  if (Array.isArray(details)) {
    return details
      .slice(0, 12)
      .map((d) =>
        d && typeof d === "object" && "rule" in d
          ? { label: d.rule, value: `${d.pass ? "✓" : "✗"} ${d.reason || ""}` }
          : { label: "", value: typeof d === "string" ? d : JSON.stringify(d) },
      );
  }
  if (details.rules) {
    return details.rules.map((r) => ({
      label: r.pass ? "Passed" : "Failed",
      value: r.reason,
    }));
  }
  return Object.entries(details)
    .slice(0, 12)
    .map(([k, v]) => ({
      label: k,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
}

/** One record on a step: who, passed/failed, the summary, the proof. */
const StepRecord = ({ record, now }) => {
  const { muted, strong, fieldBg } = useConfigTokens();
  const state =
    record.by === "you"
      ? "neutral"
      : record.status === "passed"
        ? "success"
        : record.status === "failed"
          ? "error"
          : "warning";
  const label =
    record.by === "you"
      ? record.status === "done"
        ? "Marked done"
        : record.status === "close"
          ? "Closed"
          : "One more round"
      : record.status === "passed"
        ? "Passed"
        : record.status === "failed"
          ? "Failed"
          : "Needs you";
  const who =
    record.by === "you"
      ? "You"
      : record.by === "dash"
        ? "Dash checked"
        : record.botName || "A bot";
  const rows = record.by === "dash" ? detailRows(record.details) : [];
  return (
    <div className="flex flex-col gap-1" data-testid="step-record">
      <div className="flex flex-row items-center gap-2 min-w-0">
        <span className={`text-sm font-semibold ${strong}`}>{who}</span>
        <StatusBadge state={state} label={label} />
        <span className={`text-xs ${muted}`}>{`round ${record.round}`}</span>
        {record.said === "bot" ? (
          <span
            className={`text-xs ${muted}`}
            title="What the bot said. The check after it re-verifies the work."
          >
            said by the bot
          </span>
        ) : record.said === "dash" ? (
          <span
            className={`text-xs ${muted}`}
          >{`${record.kind ? `${record.kind} · ` : ""}no AI`}</span>
        ) : null}
        <span className="flex-1" />
        <span className={`text-xs ${muted}`}>{whenText(record.at, now)}</span>
      </div>
      {record.summary ? (
        <span className={`text-sm ${strong}`}>{record.summary}</span>
      ) : null}
      {rows.length ? (
        <div className="flex flex-col gap-0.5">
          {rows.map((r, i) => (
            <span key={i} className={`text-xs ${muted}`}>
              {r.label ? (
                <span className="font-semibold">{`${r.label}: `}</span>
              ) : null}
              {r.value}
            </span>
          ))}
        </div>
      ) : null}
      {(record.evidence || []).length ? (
        <div
          className={`flex flex-col gap-0.5 px-3 py-2 rounded font-mono text-xs ${fieldBg} ${muted}`}
        >
          {record.evidence.map((e, n) => (
            <span key={n} className="break-all whitespace-pre-wrap">
              {e.label ? `${e.label}: ` : ""}
              {e.value}
            </span>
          ))}
        </div>
      ) : null}
      {record.output !== undefined ? (
        <details>
          <summary className={`text-xs cursor-pointer ${muted}`}>
            This step's record
          </summary>
          <pre
            className={`m-0 mt-1 p-3 rounded text-xs font-mono whitespace-pre-wrap break-all ${fieldBg} ${muted}`}
          >
            {JSON.stringify(record.output, null, 1).slice(0, 4000)}
          </pre>
        </details>
      ) : null}
    </div>
  );
};

/**
 * "Builder said: passed" next to "Dash checked: failed" (frame 3): the
 * check that caught it, with its proof, and where the work went.
 */
const GateCompare = ({ flow, task, check, said }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const step = flow.steps.find((s) => s.id === check.stepId);
  const back = flow.steps.find((s) => s.id === task.stepId);
  const rows = detailRows(check.details);
  return (
    <div className="flex flex-col gap-3" data-testid="goal-gate">
      <div className="flex flex-row items-center gap-2">
        <StatusBadge state="error" label="Failed" />
        <span
          className={`text-base font-semibold ${strong}`}
        >{`${step ? step.name : "Check"} · round ${check.round}`}</span>
        <FlowKindChip kind="check" label="Code check · no AI" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div
          className={`flex flex-col gap-1 p-3 rounded-md border ${hairline}`}
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
          >
            {said ? `${said.botName || "The bot"} said` : "The bot said"}
          </span>
          <span className={`text-sm ${strong}`}>
            {said
              ? `${said.status === "passed" ? "Done." : said.status} ${said.summary || ""}`
              : "—"}
          </span>
        </div>
        <div
          className={`flex flex-col gap-1 p-3 rounded-md border ${status.error.accentBorder} ${status.error.bg}`}
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${status.error.text}`}
          >
            Dash checked
          </span>
          <span className={`text-sm ${status.error.strongText}`}>
            {check.summary}
          </span>
        </div>
      </div>
      {rows.length ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1">
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <span className={`text-sm ${muted}`}>{r.label}</span>
              <span
                className={`col-span-2 text-sm font-mono break-words ${strong}`}
              >
                {r.value}
              </span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {back && task.status !== "needs-you" ? (
        <div
          className={`p-3 rounded-md text-sm ${status.info.bg} ${status.info.text}`}
        >
          {`Sent back to ${back.name} for round ${task.round} of ${task.maxRounds}, with this failure as its fix list.`}
        </div>
      ) : null}
    </div>
  );
};

/**
 * FlowGoalDetail — a goal that follows a flow, opened (frames 2–4, 30):
 * what done means and how each criterion is proven; a goal waiting to
 * start; a check that caught the work; a stop after its rounds with four
 * ways forward; and every step's records.
 */
export const FlowGoalDetail = ({
  goal,
  now,
  busy,
  onAction,
  onTakeOver = null,
  act,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const flow = goal.flow;
  const task = (goal.tasks || [])[0] || null;
  const [criteria, setCriteria] = useState(() => goal.criteria || []);
  const [changing, setChanging] = useState(false);
  const order = chainOrder(flow);
  const history = (task && task.history) || [];
  const last = history[history.length - 1] || null;
  const stopped = task && task.status === "needs-you" && last && last.stopped;
  const lastCheckFail = [...history]
    .reverse()
    .find((r) => r.said === "dash" && r.status === "failed");
  const showGate =
    task &&
    lastCheckFail &&
    history[history.length - 1] === lastCheckFail &&
    task.status !== "done";
  const saidBefore = lastCheckFail
    ? [...history.slice(0, history.indexOf(lastCheckFail))]
        .reverse()
        .find((r) => r.said === "bot")
    : null;
  const at = task ? flow.steps.find((s) => s.id === task.stepId) : null;

  // Held before it starts (frame 30).
  if (goal.waiting) {
    const blocking = criteria.filter((c) => !c.leftOut && c.proof === "none");
    return (
      <div className="flex flex-col gap-3" data-testid="goal-waiting-start">
        <div
          className={`flex flex-col gap-1 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
        >
          <span
            className={`text-sm font-semibold ${status.warning.strongText}`}
          >
            {`Before it starts: ${blocking.length} of ${criteria.length} criteria can't be checked`}
          </span>
          <span className={`text-sm ${status.warning.text}`}>
            They came with the work. Each needs a way to be proven, or it would
            only come to you at the end.
          </span>
        </div>
        <CriteriaEditor criteria={criteria} onChange={setCriteria} />
        <div
          className={`flex flex-row items-center gap-3 pt-3 border-t ${hairline}`}
        >
          <Button
            title="Start goal"
            size="sm"
            disabled={busy || blocking.length > 0}
            onClick={() => act(() => flowsApi().startGoal(goal.id, criteria))}
          />
          <span className={`text-xs ${muted}`}>
            Starts once every criterion has a way to be proven, or you choose to
            judge it yourself.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="flow-goal-detail">
      {stopped ? (
        <div
          data-testid="goal-stopped"
          className={`flex flex-col gap-2 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
        >
          <span
            className={`text-sm font-semibold ${status.warning.strongText}`}
          >
            {`Stopped after ${last.round} ${last.round === 1 ? "round" : "rounds"}`}
          </span>
          <span className={`text-sm ${status.warning.text}`}>
            {last.summary}
          </span>
          <div className="flex flex-col gap-0.5">
            {roundLines(task).map((r) => (
              <span
                key={r.round}
                className={`text-xs ${status.warning.text}`}
              >{`Round ${r.round}: ${r.text}`}</span>
            ))}
          </div>
          <div className="flex flex-row flex-wrap gap-2 pt-1">
            <Button2
              title="One more round"
              size="sm"
              disabled={busy}
              onClick={() => onAction(task.id, "one-more-round")}
            />
            <Button3
              title="Change what done means"
              size="sm"
              onClick={() => setChanging((c) => !c)}
            />
            {onTakeOver ? (
              <Button3
                title="Take it over in a conversation"
                size="sm"
                onClick={() => onTakeOver(goal)}
              />
            ) : null}
            <Button3
              title="Close it"
              size="sm"
              disabled={busy}
              onClick={() => onAction(task.id, "close")}
            />
          </div>
        </div>
      ) : task && task.status === "needs-you" ? (
        <div
          className={`flex flex-col gap-2 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
        >
          <span
            className={`text-sm font-semibold ${status.warning.strongText}`}
          >
            {`Waiting for you at "${at ? at.name : "a step"}"`}
          </span>
          {last && last.summary ? (
            <span className={`text-sm ${status.warning.text}`}>
              {last.summary}
            </span>
          ) : null}
          <div className="flex flex-row flex-wrap gap-2">
            <Button2
              title="One more round"
              size="sm"
              disabled={busy}
              onClick={() => onAction(task.id, "one-more-round")}
            />
            {onTakeOver ? (
              <Button3
                title="Take it over in a conversation"
                size="sm"
                onClick={() => onTakeOver(goal)}
              />
            ) : null}
            <Button3
              title="Close it"
              size="sm"
              disabled={busy}
              onClick={() => onAction(task.id, "close")}
            />
          </div>
        </div>
      ) : task && task.status === "ready" && at ? (
        <div
          className={`flex flex-row items-center gap-3 p-4 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
        >
          <span className={`text-sm flex-1 ${status.warning.strongText}`}>
            {`Waiting for you: ${at.action || at.name}${at.note ? ` — ${at.note}` : ""}`}
          </span>
          <Button
            title="Mark done"
            size="sm"
            disabled={busy}
            onClick={() => onAction(task.id, "done")}
          />
        </div>
      ) : null}

      {showGate ? (
        <GateCompare
          flow={flow}
          task={task}
          check={lastCheckFail}
          said={saidBefore}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <SectionLabel>
          {changing
            ? "What done means"
            : "What done means · locked while it runs"}
        </SectionLabel>
        {changing ? (
          <>
            <CriteriaEditor criteria={criteria} onChange={setCriteria} />
            <div className="flex flex-row gap-2">
              <Button
                title="Save and give it one more round"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const r = await act(() =>
                    flowsApi().setCriteria(goal.id, criteria),
                  );
                  if (r && r.ok) {
                    setChanging(false);
                    onAction(task.id, "one-more-round");
                  }
                }}
              />
              <Button3
                title="Cancel"
                size="sm"
                onClick={() => setChanging(false)}
              />
            </div>
          </>
        ) : (goal.criteria || []).length ? (
          (goal.criteria || []).map((c) => (
            <div
              key={c.id}
              className={`flex flex-row items-center gap-2 p-3 rounded-md border ${hairline}`}
            >
              <FontAwesomeIcon
                icon={c.leftOut ? "minus" : "check"}
                className={`h-3.5 w-3.5 ${c.leftOut ? muted : status.success.icon}`}
              />
              <span className={`text-sm flex-1 ${strong}`}>{c.text}</span>
              <StatusBadge
                state={c.leftOut ? "neutral" : proofState(c.proof)}
                label={c.leftOut ? "Left out" : proofLabel(c.proof)}
              />
            </div>
          ))
        ) : (
          <span className={`text-sm ${muted}`}>
            No criteria: each step's own checks decide.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>{`Steps · ${flow.name}${flow.version ? ` v${flow.version}` : ""}`}</SectionLabel>
        {order
          .filter(
            (s) => s.kind !== "you" || history.some((r) => r.stepId === s.id),
          )
          .map((s) => {
            const records = history.filter((r) => r.stepId === s.id);
            const here = task && task.stepId === s.id && task.status !== "done";
            return (
              <div
                key={s.id}
                className={`flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
                data-testid="goal-step"
              >
                <div className="flex flex-row items-center gap-2">
                  <FlowKindChip kind={s.kind} />
                  <span className={`text-sm font-semibold flex-1 ${strong}`}>
                    {s.name}
                  </span>
                  {here ? (
                    <StatusBadge
                      state="info"
                      label={task.holder ? "Working" : "Here now"}
                    />
                  ) : null}
                </div>
                {records.length ? (
                  [...records]
                    .reverse()
                    .map((r, n) => (
                      <StepRecord key={`${r.at}-${n}`} record={r} now={now} />
                    ))
                ) : (
                  <span className={`text-xs ${muted}`}>
                    {here ? "Not finished yet." : "Not reached yet."}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default FlowGoalDetail;
