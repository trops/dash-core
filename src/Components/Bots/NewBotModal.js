import React, { useContext, useState } from "react";
import {
  AlertBanner,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { BotDetail } from "../Settings/details/BotDetail";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";

const EMPTY = [];

const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

/**
 * NewBotModal — the bot form for a new bot on no dashboard (making a bot in
 * Create: a blank bot or a copy, when it goes on no dashboard). A bot on a
 * dashboard gets the form in that dashboard's Bots view instead. Nothing is
 * saved until Create; unsaved edits keep the window open on a click
 * outside or Escape (Cancel closes it).
 *
 * @param {{ initial?: object, note?: string }} request  a copy's values
 *   (botCopy) and what came along, or {} for a blank bot
 * @param {() => void} onClose
 * @param {(bot) => void} [onSaved]  the saved bot (its page opens)
 * @param {object[]} [workspaces]  for the form's Team and events
 */
export const NewBotModal = ({
  request,
  onClose,
  onSaved = null,
  workspaces = EMPTY,
}) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const app = useContext(AppContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const muted =
    (currentTheme && currentTheme["text-neutral-medium"]) || "text-gray-400";
  const [dirty, setDirty] = useState(false);
  if (!request) return null;

  const save = async (definition) => {
    const bots =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.bots
        : null;
    if (!bots || !bots.save) throw new Error("Saving bots isn't available.");
    const saved = await bots.save(definition);
    onClose();
    if (saved && saved.id && onSaved) onSaved(saved);
    return saved;
  };

  return (
    <Modal
      isOpen
      setIsOpen={(open) => {
        if (!open && !dirty) onClose();
      }}
      width="w-11/12 max-w-3xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panel.backgroundColor || ""
        } ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="new-bot-modal"
      >
        <div className="flex flex-col gap-1 px-5 pt-4 pb-2">
          <h2 className="text-lg font-semibold">
            {request.initial ? "New bot — a copy" : "New bot"}
          </h2>
          <span className={`text-sm ${muted}`}>
            On no dashboard — it still runs, and you find it on the Bots page.
          </span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <BotDetail
            bot={null}
            isCreating
            initial={request.initial || null}
            header={
              request.note ? (
                <div className="px-5 pt-3" data-testid="bot-copy-note">
                  <AlertBanner
                    variant="info"
                    size="compact"
                    message={request.note}
                  />
                </div>
              ) : null
            }
            defaultWorkspaceId={null}
            providers={app.providers || {}}
            workspaces={workspaces}
            getWidgetConfig={getWidgetConfig}
            onSave={save}
            onCancel={onClose}
            onDirtyChange={setDirty}
          />
        </div>
      </div>
    </Modal>
  );
};
