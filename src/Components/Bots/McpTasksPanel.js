import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Button3, StatusBadge, Switch } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { approvalText } from "../AppPages/botSummary";
import { toPlainText } from "./botConversation";
import {
  approvalForTasks,
  routeRow,
  taskRow,
  taskTimesText,
} from "./mcpTaskText";

/**
 * Tasks via MCP on a lead's Activity (bot-teams TEAM-016).
 *
 * McpTasksPanel — a dashboard's team: the "Takes tasks via MCP" switch (off
 * by default) and the tasks agents gave it, newest first. A row opens in
 * place: its times, the task, and the team's whole answer — or, when it
 * needs the user, the approval to Allow / Deny or the bot that didn't run.
 *
 * McpRoutingLog — the Dash Lead: the tasks it routed (no team named).
 */

const EMPTY = [];

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** Reload on every task change (the main process broadcasts it). */
function useTaskChanges(load) {
  useEffect(() => {
    const bots = botsApi();
    load();
    if (!bots || !bots.onMcpTasksChanged) return undefined;
    const id = bots.onMcpTasksChanged(load);
    return () => {
      if (id !== null && id !== undefined && bots.removeListener) {
        bots.removeListener(id);
      }
    };
  }, [load]);
}

const SectionLabel = ({ children, muted }) => (
  <h4 className={`text-xs font-semibold uppercase tracking-wider ${muted}`}>
    {children}
  </h4>
);

/** One row: what, who and when, what happened, its state. */
const Row = ({
  row,
  first,
  hairline,
  muted,
  selectedBg,
  open = false,
  onToggle = null,
  children = null,
  testId,
}) => (
  <li
    className={`flex flex-col ${first ? "" : `border-t ${hairline}`} ${
      open ? selectedBg : ""
    }`}
    data-testid={testId}
  >
    <div className="flex flex-row items-start gap-3 px-4 py-3">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex flex-col gap-1 text-left"
        >
          <RowText row={row} muted={muted} open={open} />
        </button>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <RowText row={row} muted={muted} />
        </div>
      )}
      <span className="flex-shrink-0">
        <StatusBadge state={row.state} label={row.tag} />
      </span>
      {row.open && onToggle && !open ? (
        <Button3 title="Open" size="sm" onClick={onToggle} />
      ) : null}
    </div>
    {open ? children : null}
  </li>
);

const RowText = ({ row, muted, open = false }) => (
  <>
    <span className="text-sm font-semibold">{row.title}</span>
    <span className={`text-xs ${muted}`}>{row.meta}</span>
    {/* Open, the whole answer is below — not twice. */}
    {open ? null : <span className="text-sm">{row.summary}</span>}
  </>
);

/** An opened task: its times, the task, then what the team said. */
const TaskDetail = ({ task, approval, muted, onApprove, onTalk }) => {
  const times = taskTimesText(task);
  return (
    <div
      className="flex flex-col gap-3 px-4 pb-4 text-sm"
      data-testid="mcp-task-detail"
    >
      {times ? <span className={`text-xs ${muted}`}>{times}</span> : null}
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${muted}`}>The task</span>
        <span className="whitespace-pre-wrap">{task.task}</span>
      </div>
      {approval ? (
        <div className="flex flex-row flex-wrap items-center gap-3">
          <span className="flex-1 min-w-0">{approval.text}</span>
          {onApprove ? (
            <span className="flex flex-row gap-2">
              <Button
                title="Allow"
                size="sm"
                onClick={() => onApprove(approval.id, true)}
              />
              <Button3
                title="Deny"
                size="sm"
                onClick={() => onApprove(approval.id, false)}
              />
            </span>
          ) : null}
        </div>
      ) : null}
      {task.needsYou ? <span>{task.needsYou}</span> : null}
      {task.summary ? (
        <div className="flex flex-col gap-1">
          <span className={`text-xs ${muted}`}>What the team said</span>
          <span className="whitespace-pre-wrap leading-relaxed">
            {toPlainText(task.summary)}
          </span>
        </div>
      ) : null}
      {task.error ? <span>{task.error}</span> : null}
      {onTalk ? (
        <span>
          <Button3 title="Ask the lead about it" size="sm" onClick={onTalk} />
        </span>
      ) : null}
    </div>
  );
};

export const McpTasksPanel = ({
  lead,
  workspaceId,
  bots = EMPTY,
  approvals = EMPTY,
  onApprove = null,
  onTalk = null,
}) => {
  const { muted, hairline, selectedBg } = useConfigTokens();
  const [on, setOn] = useState(false);
  const [tasks, setTasks] = useState(EMPTY);
  const [passphraseSet, setPassphraseSet] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState(null);

  // Another team: none of this team's rows or state while its own load.
  useEffect(() => {
    setOn(false);
    setTasks(EMPTY);
    setOpenId(null);
    setError(null);
  }, [workspaceId]);

  const load = useCallback(() => {
    const api = botsApi();
    if (!api || workspaceId === null || workspaceId === undefined) return;
    Promise.resolve(api.getTeamSettings && api.getTeamSettings(workspaceId))
      .then((s) => setOn(!!(s && s.takesMcpTasks)))
      .catch(() => {});
    Promise.resolve(api.listMcpTasks && api.listMcpTasks(workspaceId, 20))
      .then((l) => setTasks(Array.isArray(l) ? l : EMPTY))
      .catch(() => {});
    Promise.resolve(api.getTaskPassphraseState && api.getTaskPassphraseState())
      .then((s) => setPassphraseSet(!s || !!s.set))
      .catch(() => {});
  }, [workspaceId]);
  useTaskChanges(load);

  const toggle = async (next) => {
    const api = botsApi();
    if (!api || !api.setTakesMcpTasks) return;
    setError(null);
    setOn(next);
    try {
      await api.setTakesMcpTasks(workspaceId, next);
    } catch (err) {
      setOn(!next);
      setError((err && err.message) || "Couldn't change it. Try again.");
    }
  };

  // The newest started task shows what a bot on this team waits for.
  const approval = useMemo(() => {
    const team = new Set(
      bots
        .filter((b) => b && String(b.workspaceId) === String(workspaceId))
        .map((b) => b.id),
    );
    const nameOf = (id) => (bots.find((b) => b.id === id) || {}).name || "";
    return approvalForTasks(tasks, approvals, team, (a) => {
      const text = approvalText(a);
      const who = nameOf(a.request.botId);
      return who
        ? `${who} ${text.charAt(0).toLowerCase()}${text.slice(1)}`
        : text;
    });
  }, [tasks, approvals, bots, workspaceId]);

  if (!lead) return null;
  return (
    <section
      aria-label="Tasks via MCP"
      className="flex flex-col gap-3 pt-1 pb-4"
      data-testid="mcp-tasks-panel"
    >
      <div
        className={`flex flex-row items-center gap-4 rounded-xl border px-4 py-3 ${hairline}`}
      >
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Takes tasks via MCP</span>
          <span className={`text-xs ${muted}`}>
            {on
              ? "Agents connected to Dash, like your Home Assistant bridge, can give this team tasks. Each starts after your passphrase."
              : "Off: agents connected to Dash can't see this team or give it tasks."}
          </span>
          {on && !passphraseSet ? (
            <span
              className={`text-xs ${muted}`}
              data-testid="mcp-tasks-no-passphrase"
            >
              No task passphrase yet, so no task can start. Set one in Settings
              › MCP Server.
            </span>
          ) : null}
          {error ? <span className="text-xs">{error}</span> : null}
        </span>
        <Switch
          checked={on}
          onChange={toggle}
          ariaLabel="Takes tasks via MCP"
        />
      </div>

      <SectionLabel muted={muted}>Tasks via MCP</SectionLabel>
      {tasks.length ? (
        <ul
          className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
          data-testid="mcp-tasks-list"
        >
          {tasks.map((t, i) => {
            const mine = approval && approval.taskId === t.id ? approval : null;
            return (
              <Row
                key={t.id}
                row={taskRow(t, { approval: mine ? mine.text : null })}
                first={i === 0}
                hairline={hairline}
                muted={muted}
                selectedBg={selectedBg}
                open={openId === t.id}
                onToggle={() => setOpenId(openId === t.id ? null : t.id)}
                testId="mcp-task-row"
              >
                <TaskDetail
                  task={t}
                  approval={mine}
                  muted={muted}
                  onApprove={onApprove}
                  onTalk={onTalk}
                />
              </Row>
            );
          })}
        </ul>
      ) : (
        <p className={`text-sm ${muted}`} data-testid="mcp-tasks-empty">
          {on
            ? "No tasks via MCP yet."
            : "No tasks via MCP. With this off, agents connected to Dash can't see or give tasks to this team."}
        </p>
      )}
    </section>
  );
};

export const McpRoutingLog = () => {
  const { muted, hairline, selectedBg } = useConfigTokens();
  const [routes, setRoutes] = useState(EMPTY);
  const load = useCallback(() => {
    const api = botsApi();
    if (!api || !api.listMcpRoutes) return;
    Promise.resolve(api.listMcpRoutes(20))
      .then((l) => setRoutes(Array.isArray(l) ? l : EMPTY))
      .catch(() => {});
  }, []);
  useTaskChanges(load);

  // Nothing routed yet: the Dash Lead's Activity is as before.
  if (!routes.length) return null;
  return (
    <section
      aria-label="Routed via MCP"
      className="flex flex-col gap-3 pt-1 pb-4"
      data-testid="mcp-routing-log"
    >
      <SectionLabel muted={muted}>Routed via MCP</SectionLabel>
      <ul
        className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
      >
        {routes.map((r, i) => (
          <Row
            key={r.id}
            row={routeRow(r)}
            first={i === 0}
            hairline={hairline}
            muted={muted}
            selectedBg={selectedBg}
            testId="mcp-route-row"
          />
        ))}
      </ul>
    </section>
  );
};
