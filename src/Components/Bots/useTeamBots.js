import { useCallback, useEffect, useMemo, useState } from "react";
import { sameWorkspace } from "./teamUtils";
import { botStatus, attentionCount } from "./botConversation";

/**
 * useTeamBots — a dashboard's team, live (bot-teams PRD TEAM-011).
 *
 * Loads the dashboard's lead and members, who's running, pause state,
 * pending approvals and each bot's last run, and keeps them current from the
 * main process (onRunActive, onApprovalPending, onStream). Shared by the
 * dashboard header's Bots switch (its attention badge) and the Bots view.
 *
 * @param {string|number|null} workspaceId
 */
const EMPTY = [];
const NOT_PAUSED = { global: false, bots: EMPTY };

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// Runs read back to find the last work that passed its checks.
const RUNS_BACK = 10;

/**
 * A bot's last run as the views show it. A bot with checks (bot-checks
 * PRD): work still being checked, or that didn't pass, isn't shown — its
 * last passed work is, with `checking` set while newer work is checked.
 */
export function lastShownRun(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const last = list.length ? list[list.length - 1] : null;
  if (!last || !last.checks || last.checks.state === "passed") return last;
  const shown = [...list]
    .reverse()
    .find((r) => r && (!r.checks || r.checks.state === "passed"));
  return {
    ...last,
    output: shown ? shown.output : null,
    shownAt: shown ? shown.endedAt || shown.startedAt || null : null,
    checking: last.checks.state === "checking",
  };
}

export function useTeamBots(workspaceId) {
  const [bots, setBots] = useState(EMPTY);
  const [running, setRunning] = useState(EMPTY);
  const [paused, setPaused] = useState(NOT_PAUSED);
  const [approvals, setApprovals] = useState(EMPTY);
  const [lastRunByBot, setLastRunByBot] = useState({});
  const [loading, setLoading] = useState(true);
  const active = workspaceId !== null && workspaceId !== undefined;

  const loadLastRun = useCallback(async (botId) => {
    const bots_ = api();
    if (!bots_ || !bots_.getRuns) return;
    try {
      const runs = await bots_.getRuns(botId, RUNS_BACK);
      const last = lastShownRun(runs);
      setLastRunByBot((prev) => ({ ...prev, [botId]: last }));
    } catch (_e) {
      // keep the previous value
    }
  }, []);

  const refresh = useCallback(async () => {
    const bots_ = api();
    if (!active || !bots_) {
      setLoading(false);
      return;
    }
    try {
      const [list, run, pause, pending] = await Promise.all([
        bots_.list(),
        bots_.listRunning ? bots_.listRunning() : EMPTY,
        bots_.getPauseState ? bots_.getPauseState() : NOT_PAUSED,
        bots_.listApprovals ? bots_.listApprovals() : EMPTY,
      ]);
      const team = (list || []).filter((b) =>
        sameWorkspace(b.workspaceId, workspaceId),
      );
      setBots(team);
      setRunning((run || []).map((r) => (r && r.id) || r));
      setPaused(pause || NOT_PAUSED);
      setApprovals(pending || EMPTY);
      await Promise.all(team.map((b) => loadLastRun(b.id)));
    } catch (_e) {
      // keep the last good view on a transient IPC error
    } finally {
      setLoading(false);
    }
  }, [active, workspaceId, loadLastRun]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates from the main process.
  useEffect(() => {
    const bots_ = api();
    if (!active || !bots_) return undefined;
    const ids = [];
    if (bots_.onRunActive) {
      ids.push(
        bots_.onRunActive((payload) =>
          setRunning((payload && payload.running) || EMPTY),
        ),
      );
    }
    // The whole queue after any change (answered anywhere, denied, timed
    // out) — replaces this copy, so answered approvals disappear here too.
    if (bots_.onApprovalsChanged) {
      ids.push(
        bots_.onApprovalsChanged((p) =>
          setApprovals((p && p.approvals) || EMPTY),
        ),
      );
    }
    if (bots_.onApprovalPending) {
      ids.push(
        bots_.onApprovalPending((approval) =>
          setApprovals((prev) =>
            prev.some((a) => a.id === approval.id) ? prev : [...prev, approval],
          ),
        ),
      );
    }
    if (bots_.onStream) {
      ids.push(
        bots_.onStream(({ botId, event }) => {
          const t = event && event.type;
          // "checked": its work moved in its checks (bot-checks PRD).
          if (
            t === "done" ||
            t === "error" ||
            t === "skipped" ||
            t === "checked"
          ) {
            loadLastRun(botId);
          }
        }),
      );
    }
    // A bot was created, edited or deleted anywhere — reload the team.
    if (bots_.onListChanged) {
      ids.push(bots_.onListChanged(() => refresh()));
    }
    return () => {
      for (const id of ids) if (bots_.removeListener) bots_.removeListener(id);
    };
  }, [active, loadLastRun, refresh]);

  const approve = useCallback(async (approvalId, decision) => {
    const bots_ = api();
    if (bots_ && bots_.approve) await bots_.approve(approvalId, decision);
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  }, []);

  return useMemo(() => {
    const lead = bots.find((b) => b.role === "lead") || null;
    const members = bots.filter((b) => b.role !== "lead");
    const statusOf = (botId) =>
      botStatus({
        botId,
        running,
        paused,
        approvals,
        lastRun: lastRunByBot[botId] || null,
      });
    const approvalsFor = (botId) =>
      approvals.filter((a) => a && a.request && a.request.botId === botId);
    return {
      loading,
      lead,
      members,
      bots,
      running,
      approvals,
      lastRunByBot,
      statusOf,
      approvalsFor,
      attention: attentionCount({
        botIds: bots.map((b) => b.id),
        approvals,
        lastRunByBot,
      }),
      approve,
      refresh,
      reloadRuns: loadLastRun,
    };
  }, [
    bots,
    running,
    paused,
    approvals,
    lastRunByBot,
    loading,
    approve,
    refresh,
    loadLastRun,
  ]);
}
