import React, { useContext, useEffect, useState } from "react";
import {
  Modal,
  ThemeContext,
  FontAwesomeIcon,
  ButtonIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { BotDetail } from "../Settings/details/BotDetail";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";

/**
 * BotEditorModal — the bot form (BotDetail) in a modal, so a bot can be
 * created or edited from wherever the user is: Dashboard Config › Bots, the
 * Bot Activity panel, … (bot-teams PRD TEAM-001). Settings › Bots keeps its
 * inline list-and-detail; every surface shares the one form.
 *
 * Loads what the form needs itself (configured providers from AppContext,
 * the other bots for "Another bot" events, widget configs for the event
 * picker) and saves through window.mainApi.bots.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {object|null} bot            edit this bot; omit to create one
 * @param {string|number|null} workspaceId  a new bot joins this dashboard's team
 * @param {Array<object>} workspaces   dashboards (Team field + event picker)
 * @param {(saved: object) => void} [onSaved]
 */

// Widget config (declared `events`) by component name.
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

const EMPTY = [];

export const BotEditorModal = ({
  isOpen,
  onClose,
  bot = null,
  workspaceId = null,
  workspaces = EMPTY,
  onSaved = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const [bots, setBots] = useState(EMPTY);

  // Other bots → "Another bot" events in the picker.
  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.bots?.list) return undefined;
    Promise.resolve(api.bots.list())
      .then((list) => {
        if (alive && Array.isArray(list)) setBots(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (definition) => {
    const api = window.mainApi;
    const saved = await api.bots.save(definition);
    if (typeof onSaved === "function") onSaved(saved);
    onClose();
    return saved;
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={onClose}
      width="w-11/12 max-w-3xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div className="flex-shrink-0 flex flex-row items-center justify-between px-6 pt-4">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon="robot" className="h-4 w-4 opacity-70" />
            <span className="text-lg font-semibold">
              {bot ? bot.name || "Edit bot" : "New bot"}
            </span>
          </div>
          <ButtonIcon icon="xmark" onClick={onClose} ariaLabel="Close" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <BotDetail
            key={bot ? bot.id : "new"}
            bot={bot}
            isCreating={!bot}
            defaultWorkspaceId={workspaceId}
            providers={providers}
            workspaces={workspaces}
            getWidgetConfig={getWidgetConfig}
            bots={bots}
            onSave={handleSave}
            onCancel={onClose}
          />
        </div>
      </div>
    </Modal>
  );
};
