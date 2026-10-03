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

export function useTeamBots(workspaceId) {
  const [bots, setBots] = useState(EMPTY);
  const [running, setRunning] = useState(EMPTY);
  const [paused, setPaused] = useState(NOT_PAUSED);
  const [approvals, setApprovals] = useState(EMPTY);
  const [lastRunByBot, setLastRunByBot] = useState({});
  const [loading, setLoading] = useState(true);
  // Bots this dashboard's lead drafted, awaiting review (TEAM-005).
  const [drafts, setDrafts] = useState(EMPTY);
  const active = workspaceId !== null && workspaceId !== undefined;

  const loadDrafts = useCallback(async () => {
    const bots_ = api();
    if (!active || !bots_ || !bots_.listDrafts) return;
    try {
      const list = await bots_.listDrafts(String(workspaceId));
      setDrafts(Array.isArray(list) ? list : EMPTY);
    } catch (_e) {
      // keep the last good list
    }
  }, [active, workspaceId]);

  const loadLastRun = useCallback(async (botId) => {
    const bots_ = api();
    if (!bots_ || !bots_.getRuns) return;
    try {
      const runs = await bots_.getRuns(botId, 1);
      const last =
        Array.isArray(runs) && runs.length ? runs[runs.length - 1] : null;
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
      await Promise.all([...team.map((b) => loadLastRun(b.id)), loadDrafts()]);
    } catch (_e) {
      // keep the last good view on a transient IPC error
    } finally {
      setLoading(false);
    }
  }, [active, workspaceId, loadLastRun, loadDrafts]);

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
          if (t === "done" || t === "error" || t === "skipped") {
            loadLastRun(botId);
          }
        }),
      );
    }
    // A bot was created, edited or deleted anywhere — reload the team.
    if (bots_.onListChanged) {
      ids.push(bots_.onListChanged(() => refresh()));
    }
    // A lead drafted a bot, or a draft was saved/discarded.
    if (bots_.onDraftsChanged) {
      ids.push(bots_.onDraftsChanged(() => loadDrafts()));
    }
    return () => {
      for (const id of ids) if (bots_.removeListener) bots_.removeListener(id);
    };
  }, [active, loadLastRun, refresh, loadDrafts]);

  const approve = useCallback(async (approvalId, decision) => {
    const bots_ = api();
    if (bots_ && bots_.approve) await bots_.approve(approvalId, decision);
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  }, []);

  const dismissDraft = useCallback(async (draftId) => {
    const bots_ = api();
    if (bots_ && bots_.dismissDraft) await bots_.dismissDraft(draftId);
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
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
      drafts,
      dismissDraft,
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
    drafts,
    dismissDraft,
  ]);
}
