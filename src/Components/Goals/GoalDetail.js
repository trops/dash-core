import React, { useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ConfirmationModal,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { whenLongText, whenText } from "../Issues/issueText";
import { FlowGoalDetail } from "./FlowGoalDetail";
import {
  goalLabel,
  goalState,
  recordBy,
  roundLines,
  sourceLink,
  sourceText,
  taskLabel,
  taskState,
} from "./goalText";

const goalsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.goals) ||
  null;

const SectionLabel = ({ children }) => {
  const { muted } = useConfigTokens();
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>
      {children}
    </span>
  );
};

/** One done record: who, what, the proof — labelled "said by the bot". */
const RecordLine = ({ record, now }) => {
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
  return (
    <div className="flex flex-col gap-1" data-testid="goal-record">
      <div className="flex flex-row items-center gap-2 min-w-0">
        <span className={`text-sm font-semibold ${strong}`}>
          {recordBy(record)}
        </span>
        <StatusBadge state={state} label={label} />
        <span className={`text-xs ${muted}`}>{`round ${record.round}`}</span>
        {record.said === "bot" ? (
          <span
            className={`text-xs ${muted}`}
            title="Nothing has checked this yet: it's what the bot reported."
          >
            said by the bot
          </span>
        ) : null}
        <span className="flex-1" />
        <span className={`text-xs flex-shrink-0 ${muted}`}>
          {whenText(record.at, now)}
        </span>
      </div>
      {record.summary ? (
        <span className={`text-sm ${strong}`}>{record.summary}</span>
      ) : null}
      {(record.evidence || []).length ? (
        <div
          className={`flex flex-col gap-0.5 px-3 py-2 rounded font-mono text-xs ${fieldBg} ${muted}`}
        >
          {record.evidence.map((e, n) => (
            <span key={n} className="break-all">
              {e.label ? `${e.label}: ` : ""}
              {e.value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

/** A task waiting for the user: why, its rounds, and what to do next. */
const WaitingForYou = ({ task, onAction, busy }) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const history = task.history || [];
  const last = history[history.length - 1];
  const stopped = !!(last && last.stopped);
  const rounds = roundLines(task);
  return (
    <div
      data-testid="goal-waiting"
      className={`flex flex-col gap-2 p-4 rounded-lg border ${status.warning.border || ""} ${status.warning.bg}`}
    >
      <span className={`text-sm font-semibold ${status.warning.text}`}>
        {stopped
          ? `“${task.title}” stopped after ${last.round} ${last.round === 1 ? "round" : "rounds"}`
          : `“${task.title}” is waiting for you`}
      </span>
      {last && last.summary ? (
        <span className={`text-sm ${strong}`}>{last.summary}</span>
      ) : null}
      {stopped && rounds.length > 1 ? (
        <div className="flex flex-col gap-0.5">
          {rounds.map((r) => (
            <span key={r.round} className={`text-xs ${muted}`}>
              {`Round ${r.round}: ${r.text}`}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-row flex-wrap gap-2 pt-1">
        <Button2
          title="Give it one more round"
          size="sm"
          disabled={busy}
          onClick={() => onAction(task.id, "one-more-round")}
        />
        <Button3
          title="Close this task"
          size="sm"
          disabled={busy}
          onClick={() => onAction(task.id, "close")}
        />
      </div>
    </div>
  );
};

/** One task: its status, round, who holds it, and its done records. */
const TaskCard = ({ task, onAction, busy, canAct = true, now }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const history = task.history || [];
  return (
    <div
      data-testid="goal-task"
      className={`flex flex-col gap-3 p-3 rounded-lg border ${hairline}`}
    >
      <div className="flex flex-row items-center gap-2 min-w-0">
        <span className={`text-sm font-semibold truncate flex-1 ${strong}`}>
          {task.title}
        </span>
        <StatusBadge
          state={taskState(task.status)}
          label={taskLabel(task.status)}
        />
        <span className={`text-xs flex-shrink-0 ${muted}`}>
          {`Round ${task.round || 1} of ${task.maxRounds || 3}`}
        </span>
      </div>
      {task.body ? (
        <span className={`text-xs ${muted}`}>{task.body}</span>
      ) : null}
      {task.holder ? (
        <span className={`text-xs ${muted}`}>
          {`${task.holder.botName || "A bot"} is working on it`}
        </span>
      ) : null}
      {canAct && task.status === "ready" ? (
        <div className="flex flex-row items-center gap-2">
          <Button
            title="Mark done"
            size="sm"
            disabled={busy}
            onClick={() => onAction(task.id, "done")}
          />
          <span className={`text-xs ${muted}`}>
            Every step passed. Mark it done when you're happy with it.
          </span>
        </div>
      ) : null}
      {history.length ? (
        <div className="flex flex-col gap-3">
          {[...history].reverse().map((r, n) => (
            <RecordLine key={`${r.at}-${n}`} record={r} now={now} />
          ))}
        </div>
      ) : (
        <span className={`text-xs ${muted}`}>No done records yet.</span>
      )}
    </div>
  );
};

/**
 * GoalDetail — one goal opened beside the list (goals-ledger PRD, frames 2
 * and 4): where it came from, anything waiting for you, each task with its
 * done records, and Close / Delete with what's kept for it.
 */
export const GoalDetail = ({ goal, now, onDeleted = null }) => {
  const { muted, strong, hairline, accent } = useConfigTokens();
  const status = useStatusTokens();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!goal) return null;

  const tasks = goal.tasks || [];
  const waiting = tasks.filter((t) => t.status === "needs-you");
  const finished = goal.status === "done" || goal.status === "closed";
  const runs = goal.runs || [];
  const link = sourceLink(goal);
  const busyBot = tasks.some((t) => !!t.holder);

  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (r && r.error) setError(r.error);
      return r;
    } catch (e) {
      setError((e && e.message) || "That didn't work.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const onAction = (taskId, action) =>
    act(() => goalsApi().taskAction(taskId, action));

  // "Take it over in a conversation" (frame 4): the dashboard lead's
  // conversation, where the goal can be talked through and restarted.
  const takeOver = async () => {
    const m = window.mainApi;
    let lead = null;
    try {
      const list = m && m.bots ? await m.bots.list() : [];
      lead = (Array.isArray(list) ? list : []).find(
        (b) =>
          b &&
          b.role === "lead" &&
          String(b.workspaceId) === String(goal.workspaceId),
      );
    } catch (_e) {
      lead = null;
    }
    window.dispatchEvent(
      new CustomEvent("dash:open-bots-view", {
        detail: {
          workspaceId: goal.workspaceId,
          botId: lead ? lead.id : null,
          tab: "conversation",
        },
      }),
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="goal-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-row items-center gap-2 min-w-0">
          <StatusBadge
            state={goalState(goal.status)}
            label={goalLabel(goal.status)}
          />
          <span className={`text-base font-semibold truncate ${strong}`}>
            {goal.title}
          </span>
        </div>
        <span className={`text-xs ${muted}`}>
          {"From "}
          {link ? (
            <button
              type="button"
              className={`underline ${accent}`}
              onClick={() => window.mainApi?.shell?.openExternal(link)}
            >
              {sourceText(goal)}
            </button>
          ) : (
            sourceText(goal)
          )}
          {` · started ${whenLongText(goal.createdAt, now)} · ${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
        </span>
        {goal.body ? (
          <span className={`text-sm pt-1 ${strong}`}>{goal.body}</span>
        ) : null}
      </div>

      {error ? (
        <span className={`text-sm ${status.error.text}`} role="alert">
          {error}
        </span>
      ) : null}

      {goal.flow ? (
        // A goal in a flow: its steps, criteria and checks (flows PRD).
        <FlowGoalDetail
          goal={goal}
          now={now}
          busy={busy}
          act={act}
          onAction={(taskId, action) =>
            finished ? null : onAction(taskId, action)
          }
          onTakeOver={finished ? null : takeOver}
        />
      ) : (
        <>
          {/* A closed goal's tasks can't be picked up again: no moves offered. */}
          {finished
            ? null
            : waiting.map((t) => (
                <WaitingForYou
                  key={t.id}
                  task={t}
                  onAction={onAction}
                  busy={busy}
                />
              ))}

          <div className="flex flex-col gap-2">
            <SectionLabel>Tasks</SectionLabel>
            {tasks.length ? (
              tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onAction={onAction}
                  busy={busy}
                  canAct={!finished}
                  now={now}
                />
              ))
            ) : (
              <span className={`text-sm ${muted}`}>
                No tasks yet. The bot that started this goal adds them.
              </span>
            )}
          </div>
        </>
      )}

      <div
        className={`flex flex-row flex-wrap items-center gap-2 pt-3 border-t ${hairline}`}
      >
        {!finished ? (
          <Button3
            title="Close the goal"
            size="sm"
            disabled={busy}
            onClick={() => act(() => goalsApi().close(goal.id))}
          />
        ) : null}
        <Button3
          title="Delete goal"
          size="sm"
          disabled={busy || busyBot}
          onClick={() => setConfirmDelete(true)}
        />
        <span className="flex-1" />
        <span className={`text-xs ${muted}`}>
          {`Kept for this goal: ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} · ${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
        </span>
      </div>
      {busyBot ? (
        <span className={`text-xs ${muted}`}>
          A bot is working on it, so it can't be deleted until that run ends.
        </span>
      ) : null}

      {confirmDelete ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirmDelete(false)}
          title="Delete this goal?"
          confirmLabel="Delete"
          variant="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            const r = await act(() => goalsApi().delete([goal.id]));
            if (r && (r.deleted || []).includes(goal.id) && onDeleted) {
              onDeleted(goal.id);
            }
          }}
        >
          <div
            className="flex flex-col gap-2"
            data-testid="goal-delete-confirm"
          >
            <span className={`text-sm ${muted}`}>
              {`Its ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}, ${runs.length} ${runs.length === 1 ? "run" : "runs"}, proof and work files are removed from this computer. What it made elsewhere (a pull request, a sent message) stays.`}
            </span>
          </div>
        </ConfirmationModal>
      ) : null}
    </div>
  );
};

export default GoalDetail;
