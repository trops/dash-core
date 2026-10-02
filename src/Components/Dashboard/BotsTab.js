import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Button3,
  Tag,
  SectionLabel,
  EmptyState,
} from "@trops/dash-react";
import { BotEditorModal } from "../Bots/BotEditorModal";
import { sameWorkspace, triggerSummary } from "../Bots/teamUtils";

/**
 * BotsTab — Dashboard Config › Bots: this dashboard's team (bot-teams PRD
 * TEAM-001). A team is the bots whose `workspaceId` is this dashboard.
 *
 * Unlike the other Dashboard Config tabs (staged, applied on Save), bot
 * changes save immediately — they go straight to the bot store over IPC.
 */

const EMPTY = [];

function statusOf(botId, running, paused) {
  if (running.includes(botId)) return "Running";
  if (paused.global || paused.bots.includes(botId)) return "Paused";
  return "Idle";
}

export const BotsTab = ({ workspace, workspaces = EMPTY }) => {
  const [bots, setBots] = useState(EMPTY);
  const [running, setRunning] = useState(EMPTY);
  const [paused, setPaused] = useState({ global: false, bots: EMPTY });
  const [loaded, setLoaded] = useState(false);
  // null = closed; { bot: null } = new bot; { bot } = edit.
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.bots?.list) {
      setLoaded(true);
      return;
    }
    try {
      const [list, run, pause] = await Promise.all([
        api.bots.list(),
        api.bots.listRunning ? api.bots.listRunning() : [],
        api.bots.getPauseState
          ? api.bots.getPauseState()
          : { global: false, bots: [] },
      ]);
      setBots(Array.isArray(list) ? list : EMPTY);
      setRunning(Array.isArray(run) ? run.map((r) => r && r.id) : EMPTY);
      setPaused({
        global: !!(pause && pause.global),
        bots: (pause && pause.bots) || EMPTY,
      });
    } catch (_e) {
      // Keep the last good view on a transient IPC error.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const team = bots.filter((b) => sameWorkspace(b.workspaceId, workspace?.id));

  const removeFromTeam = async (bot) => {
    // Unassign only — the bot keeps running from Settings › Bots.
    await window.mainApi.bots.save({ ...bot, workspaceId: null });
    refresh();
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <SectionLabel text="This dashboard's team" />
          <span className="text-xs opacity-60">
            Bots that work for this dashboard and run on its events. Changes
            here save immediately.
          </span>
        </div>
        <Button
          title="Add bot"
          size="sm"
          onClick={() => setEditing({ bot: null })}
        />
      </div>

      {loaded && !team.length ? (
        <EmptyState
          icon="robot"
          title="No bots on this dashboard yet"
          description="Add a bot here, or move an existing bot to this dashboard from its Team setting in Settings › Bots."
        />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
          {team.map((bot) => (
            <div
              key={bot.id}
              className="flex flex-row items-center justify-between gap-3 py-2 border-b"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-sm font-medium truncate">{bot.name}</span>
                <span className="text-xs opacity-60">
                  {triggerSummary(bot)}
                </span>
              </div>
              <div className="flex flex-row items-center gap-2 flex-shrink-0">
                <Tag text={statusOf(bot.id, running, paused)} />
                <Button3
                  title="Edit"
                  size="xs"
                  ariaLabel={`Edit ${bot.name}`}
                  onClick={() => setEditing({ bot })}
                />
                <Button3
                  title="Remove from team"
                  size="xs"
                  ariaLabel={`Remove ${bot.name} from team`}
                  tooltip="Unassign this bot from the dashboard. It isn't deleted."
                  onClick={() => removeFromTeam(bot)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <BotEditorModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        bot={editing ? editing.bot : null}
        workspaceId={workspace ? workspace.id : null}
        workspaces={workspaces}
        onSaved={refresh}
      />
    </div>
  );
};
