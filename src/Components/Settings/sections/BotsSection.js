import React, { useContext, useEffect, useState, useCallback } from "react";
import {
  EmptyState,
  FontAwesomeIcon,
  ConfirmationModal,
  Tag,
  SectionLabel,
  Checkbox,
} from "@trops/dash-react";
import { groupBotsByTeam } from "../../Bots/teamUtils";
import { SectionLayout } from "../SectionLayout";
import { BotDetail } from "../details/BotDetail";
import { AppContext } from "../../../Context/App/AppContext";
import { ComponentManager } from "../../../ComponentManager";

// Widget config (declared `events`) by component name — feeds the bot form's
// "Run on events" picker.
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

/**
 * BotsSection — Settings → Bots. List-and-detail management for Bot Factory
 * bots, mirroring ProvidersSection. Data comes from the main process over
 * dashApi.bots.* (promise-based IPC bridge, exposed by dash-electron's
 * preload); the provider dropdown reads configured providers from AppContext.
 *
 * Watching runs / approvals lives in the Activity panel (a later slice); this
 * surface is create / configure / delete.
 */
export const BotsSection = ({
  workspaces = [],
  dashApi = null,
  createRequested = false,
  onCreateAcknowledged,
}) => {
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const botsApi = dashApi && dashApi.bots;

  const [bots, setBots] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Global switch: give every dashboard an idle team lead (TEAM-002).
  const [autoLeads, setAutoLeads] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!botsApi || typeof botsApi.getSettings !== "function") return undefined;
    Promise.resolve(botsApi.getSettings())
      .then((s) => {
        if (alive) setAutoLeads(!(s && s.autoLeads === false));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botsApi]);

  const toggleAutoLeads = async (next) => {
    setAutoLeads(next);
    try {
      await botsApi.setSettings({ autoLeads: next });
    } catch (_e) {
      setAutoLeads(!next);
    }
  };

  const refresh = useCallback(async () => {
    if (!botsApi) return;
    try {
      const list = await botsApi.list();
      setBots(Array.isArray(list) ? list : []);
    } catch (e) {
      // Leave the list as-is; a transient IPC error shouldn't blank the UI.
    }
  }, [botsApi]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Header "+ New Bot" button flips createRequested; open a blank form.
  useEffect(() => {
    if (createRequested) {
      setIsCreating(true);
      setSelectedId(null);
      if (onCreateAcknowledged) onCreateAcknowledged();
    }
  }, [createRequested, onCreateAcknowledged]);

  const selected = bots.find((b) => b.id === selectedId) || null;

  const handleSave = async (definition) => {
    const saved = await botsApi.save(definition);
    await refresh();
    setIsCreating(false);
    if (saved && saved.id) setSelectedId(saved.id);
    return saved;
  };

  const handleDelete = async (botId) => {
    try {
      await botsApi.delete(botId);
      await refresh();
      if (selectedId === botId) setSelectedId(null);
    } finally {
      setDeleteTarget(null);
    }
  };

  const listContent = (
    <div className="flex flex-col">
      {autoLeads !== null ? (
        <div className="px-4 pt-4 pb-2 border-b">
          <Checkbox
            label="Create team leads automatically"
            checked={autoLeads}
            onChange={toggleAutoLeads}
          />
          <span className="text-xs opacity-50">
            Every dashboard gets an idle lead you can ask about its bots.
          </span>
        </div>
      ) : null}
      {bots.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={
              <FontAwesomeIcon icon="robot" className="h-8 w-8 opacity-50" />
            }
            title="No bots yet"
            description="Create a bot to delegate recurring work."
          />
        </div>
      ) : (
        // Grouped by team (the dashboard each bot works for), Unassigned last.
        groupBotsByTeam(bots, workspaces).map((group) => (
          <div key={group.workspaceId || "unassigned"}>
            <div className="px-4 pt-4 pb-1" data-testid="bot-team-heading">
              <SectionLabel text={group.label} />
            </div>
            {group.bots.map((bot) => {
              const isActive = !isCreating && bot.id === selectedId;
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setSelectedId(bot.id);
                  }}
                  className={`w-full flex flex-col items-start gap-1 p-4 text-left border-b ${
                    isActive ? "bg-gray-700" : ""
                  }`}
                >
                  <span className="text-sm font-medium truncate">
                    {bot.name}
                  </span>
                  <div className="flex flex-row items-center gap-2">
                    <Tag text={bot.provider || "default"} />
                    {bot.schedules && bot.schedules.length > 0 ? (
                      <span className="text-xs opacity-50">scheduled</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );

  let detailContent = null;
  if (isCreating) {
    detailContent = (
      <BotDetail
        key="new"
        isCreating
        providers={providers}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        bots={bots}
        onSave={handleSave}
        onCancel={() => setIsCreating(false)}
      />
    );
  } else if (selected) {
    detailContent = (
      <BotDetail
        key={selected.id}
        bot={selected}
        providers={providers}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        bots={bots}
        onSave={handleSave}
        onDelete={() => setDeleteTarget(selected.id)}
      />
    );
  }

  return (
    <>
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a bot to view details"
      />
      {deleteTarget ? (
        <ConfirmationModal
          title="Delete bot?"
          message="This removes the bot, its run history, and its working directory."
          confirmText="Delete"
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  );
};
