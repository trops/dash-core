import React, { useState, useEffect, useContext, useMemo } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Button2,
  Button3,
  InputText,
  SelectInput,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { TeamSettingsForm, emptySettings } from "../../Bots/TeamSettingsForm";
import {
  BotSettingsInstall,
  botsWaiting,
  withBotInstallValues,
} from "../../Bots/BotSettings";
import { installButtons, installWaitingText } from "./dashboardBots";

/**
 * DashboardInstallOptionsModal
 *
 * Shown BEFORE a registry dashboard install fires. Lets the user
 * choose where to file the dashboard and (optionally) rename it.
 *
 * Why this modal exists:
 * Pre-fix, registry installs blindly applied the publisher's
 * `menuId`. Two issues followed —
 *
 *   1. The publisher's menuId is meaningless on the user's machine
 *      (their folders have different ids). Best case it lands in
 *      the wrong folder; worst case it collides with an existing
 *      local folder id, creating a duplicate menu record (the
 *      original menuItems-controller bug fixed in v0.1.444).
 *   2. The user has no chance to rename the dashboard at install
 *      time. If they install two versions of the same dashboard
 *      (e.g. for testing), they collide on display name.
 *
 * UX:
 *   - Name input — defaults to the publisher's display name.
 *     Note: renaming does NOT change the published scope/package id.
 *   - Folder selector — dropdown of existing local folders + an
 *     inline "+ New folder" action. New folders are created via
 *     `saveMenuItem` (now upserts) BEFORE the install fires, so the
 *     install can reference the new folder's id immediately.
 *
 * @param {boolean} isOpen
 * @param {(open: boolean) => void} setIsOpen
 * @param {{ name: string, displayName?: string, menuId?: any }} pkg
 *   Registry package metadata. `displayName || name` becomes the
 *   default name; `menuId` (if present) is shown as the publisher's
 *   suggested folder but doesn't auto-select.
 * @param {Array<{id, name, icon?}>} menuItems  Existing local folders.
 * @param {(menuItem: object) => Promise<{success, menuItems}>} onCreateFolder
 *   Called when the user creates a new folder inline. Should persist
 *   via the existing `saveMenuItem` IPC. Returns the saved record so
 *   the modal can pick its id.
 * @param {({ name: string, menuId: any, teamValues?: object,
 *            openSetup?: boolean }) => void} onConfirm
 *   Called with the user's choices when they click Install. With a team
 *   (DASH-130), `openSetup` says which button: true for "Install and open
 *   Set up", false for "Install, fill in later". Required settings may be
 *   left empty: the dialog says the team won't take work until they're
 *   filled in, and the team's Set up shows what's left.
 * @param {object[]} [teamSettings]  the settings its team declares
 *   (DASH-57): filled in here, used by its bots as {name}.
 * @param {Array<{role, name, settings}>} [teamBots]  its bots that declare
 *   settings of their own (DASH-136): one section per bot; their values go
 *   in teamValues["@bots"][role].
 */
export const DashboardInstallOptionsModal = ({
  isOpen,
  setIsOpen,
  pkg,
  menuItems = [],
  onCreateFolder,
  onConfirm,
  teamSettings = [],
  teamBots = [],
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const defaultName = pkg?.displayName || pkg?.name || "";
  const [name, setName] = useState(defaultName);
  const [selectedMenuId, setSelectedMenuId] = useState(
    menuItems[0]?.id != null ? String(menuItems[0].id) : "",
  );
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [teamValues, setTeamValues] = useState({});
  const [botValues, setBotValues] = useState({});

  // Reset state every time the modal opens with a new package.
  useEffect(() => {
    if (!isOpen) return;
    setName(defaultName);
    setSelectedMenuId(menuItems[0]?.id != null ? String(menuItems[0].id) : "");
    setNewFolderMode(false);
    setNewFolderName("");
    setError(null);
    setTeamValues({});
    setBotValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pkg?.name]);

  const sortedFolders = useMemo(
    () =>
      [...(menuItems || [])]
        .filter((m) => m && m.id != null)
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        ),
    [menuItems],
  );

  const hasTeam = !!(
    (teamSettings && teamSettings.length) ||
    (teamBots && teamBots.length)
  );
  const teamMissing = emptySettings(teamSettings, teamValues).filter(
    (s) => s && s.required,
  ).length;
  const waitingBots = botsWaiting(teamBots, botValues);
  const waitingText = installWaitingText({
    teamMissing,
    botsWaiting: waitingBots,
  });
  const buttons = installButtons({
    hasTeam,
    missing: !!waitingText,
  });

  async function handleConfirm(openSetup) {
    setError(null);
    let menuId = selectedMenuId ? selectedMenuId : null;

    if (newFolderMode) {
      const trimmed = (newFolderName || "").trim();
      if (!trimmed) {
        setError("New folder name is required.");
        return;
      }
      if (typeof onCreateFolder !== "function") {
        setError("Folder creation is unavailable.");
        return;
      }
      try {
        setCreating(true);
        const newId = Date.now();
        const created = await onCreateFolder({
          id: newId,
          name: trimmed,
          icon: "folder",
        });
        if (created?.error || created?.success === false) {
          setError(created?.message || "Could not create folder.");
          return;
        }
        menuId = newId;
      } catch (e) {
        setError(e?.message || "Could not create folder.");
        return;
      } finally {
        setCreating(false);
      }
    }

    onConfirm({
      name: (name || "").trim() || defaultName,
      menuId,
      ...(hasTeam
        ? { teamValues: withBotInstallValues(teamValues, botValues), openSetup }
        : {}),
    });
  }

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      width="w-full max-w-xl"
      height="h-auto"
    >
      <div
        className={`flex flex-col rounded-lg overflow-hidden border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div
          className={`flex flex-row items-center justify-between p-4 border-b ${hairline}`}
        >
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon="download" className="h-4 w-4 opacity-70" />
            <span className="text-lg font-semibold">Install dashboard</span>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
            aria-label="Close"
          >
            <FontAwesomeIcon icon="xmark" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Name</label>
            <InputText
              value={name}
              onChange={(v) => setName(v)}
              placeholder={defaultName}
            />
            <span className={`text-xs ${muted}`}>
              The local display name only. Doesn't change the published scope or
              package id.
            </span>
          </div>

          {/* Folder */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Folder</label>
            {!newFolderMode ? (
              <div className="flex flex-row gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <SelectInput
                    ariaLabel="Folder"
                    value={selectedMenuId}
                    onChange={(v) => setSelectedMenuId(v)}
                    options={
                      sortedFolders.length
                        ? sortedFolders.map((m) => ({
                            value: String(m.id),
                            label: m.name,
                          }))
                        : [{ value: "", label: "No folders yet" }]
                    }
                  />
                </div>
                <Button3
                  title="+ New folder"
                  size="sm"
                  onClick={() => setNewFolderMode(true)}
                />
              </div>
            ) : (
              <div className="flex flex-row gap-2 items-center">
                <InputText
                  value={newFolderName}
                  onChange={(v) => setNewFolderName(v)}
                  placeholder="New folder name"
                  autoFocus
                />
                <Button3
                  title="Cancel"
                  size="sm"
                  onClick={() => {
                    setNewFolderMode(false);
                    setNewFolderName("");
                    setError(null);
                  }}
                />
              </div>
            )}
          </div>

          {teamSettings && teamSettings.length ? (
            <div
              className="flex flex-col gap-2"
              data-testid="install-team-settings"
            >
              <label className="text-sm font-medium">Team settings</label>
              <span className={`text-xs ${muted}`}>
                Its bots use these in their instructions, checks and folders.
                Fill them in now or later on the team&apos;s Set up: Team setup
                in the dashboard&apos;s Bots view, or Manage › Bots.
              </span>
              <TeamSettingsForm
                settings={teamSettings}
                values={teamValues}
                onChange={(n, v) =>
                  setTeamValues((prev) => ({ ...prev, [n]: v }))
                }
              />
            </div>
          ) : null}

          <BotSettingsInstall
            bots={teamBots}
            showWaiting={false}
            values={botValues}
            onChange={(role, n, v) =>
              setBotValues((prev) => ({
                ...prev,
                [role]: { ...(prev[role] || {}), [n]: v },
              }))
            }
          />

          {waitingText ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${status.info.border} ${status.info.bg} ${status.info.text}`}
              data-testid="install-waiting"
            >
              {waitingText}
            </div>
          ) : null}

          {error && (
            <div
              role="alert"
              className={`text-xs rounded-lg border px-3 py-2 ${status.error.border} ${status.error.bg} ${status.error.text}`}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className={`flex flex-row flex-wrap justify-end gap-2 p-4 border-t ${hairline}`}
        >
          <Button3 title="Cancel" onClick={() => setIsOpen(false)} />
          {buttons.map((b) => {
            const Btn = b.primary ? Button2 : Button3;
            return (
              <Btn
                key={b.title}
                title={creating ? "Creating folder…" : b.title}
                onClick={() => handleConfirm(b.openSetup)}
                disabled={creating || !name.trim()}
              />
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default DashboardInstallOptionsModal;
