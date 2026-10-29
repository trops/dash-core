import React, { useContext, useEffect, useState } from "react";
import {
  ConfirmationModal,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { BotPage } from "./BotPage";
import { DashTeamPage } from "./DashTeamPage";

const EMPTY = [];

/**
 * BotPageModal — the bot page (BotPage) in a large modal, opened from the
 * Bots panel or a notification (app-navigation NAV-016 AC5): the same tabs
 * and actions as Manage › Bots, without leaving where you are.
 *
 * Unsaved Settings edits are never thrown away silently: while there are
 * some, clicking outside or pressing Escape does nothing (the page's own ×
 * asks first), and a request for another bot or tab asks first too.
 *
 * The Dash team's page (DashTeamPage, Phase 4a) shows here too:
 * `{ dashTeam: true, tab }` — its Activity and Settings; the team is talked
 * to in the Dash Lead's conversations (lead-workspace release 6b).
 *
 * @param {{ botId?: string, dashTeam?: boolean, tab?: string }|null} request
 *   the bot (or the Dash team) to show
 * @param {() => void} onClose
 * @param {object[]} [workspaces]
 * @param {(workspace, botId) => void} [onOpenInBotsView]
 * @param {(section: string) => void} [onOpenSettings]  the app's settings
 */
export const BotPageModal = ({
  request = null,
  onClose,
  workspaces = EMPTY,
  onOpenInBotsView = null,
  onOpenSettings = null,
}) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  // What's on screen, and a newer request waiting on "Discard unsaved changes?".
  const [shown, setShown] = useState(request);
  const [pending, setPending] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (request === shown) return;
    if (request && dirty) {
      setPending(request);
      return;
    }
    setDirty(false);
    setShown(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!shown || !(shown.botId || shown.dashTeam)) return null;

  const close = () => {
    setDirty(false);
    setPending(null);
    setShown(null);
    onClose();
  };
  const showPending = () => {
    setDirty(false);
    setShown(pending);
    setPending(null);
  };

  return (
    <Modal
      isOpen
      setIsOpen={(open) => {
        if (!open && !dirty) close();
      }}
      width="w-11/12 max-w-5xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
        data-testid="bot-page-modal"
      >
        {shown.dashTeam ? (
          <DashTeamPage
            key={`dash-team-${shown.tab || "settings"}`}
            initialTab={shown.tab || "settings"}
            workspaces={workspaces}
            onClose={close}
            onDirtyChange={setDirty}
          />
        ) : (
          <BotPage
            key={`${shown.botId}-${shown.tab || "activity"}`}
            botId={shown.botId}
            initialTab={shown.tab || "activity"}
            workspaces={workspaces}
            onOpenInBotsView={
              onOpenInBotsView
                ? (ws, botId) => {
                    close();
                    onOpenInBotsView(ws, botId);
                  }
                : null
            }
            onOpenSettings={
              onOpenSettings
                ? (section) => {
                    close();
                    onOpenSettings(section);
                  }
                : null
            }
            onClose={close}
            onDeleted={close}
            onDirtyChange={setDirty}
          />
        )}
        {/* Mounted only while asking: a dialog's layer is placed when it
            mounts, and one mounted with this modal would sit beneath it. */}
        {pending ? (
          <ConfirmationModal
            isOpen
            setIsOpen={() => setPending(null)}
            title="Discard unsaved changes?"
            message="Your changes to this bot haven't been saved."
            confirmLabel="Discard"
            variant="danger"
            onConfirm={showPending}
            onCancel={() => setPending(null)}
          />
        ) : null}
      </div>
    </Modal>
  );
};

export default BotPageModal;
