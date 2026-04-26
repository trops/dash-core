import React, { useState, useEffect, useContext, useMemo } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Button2,
  Button3,
  InputText,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

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
 * @param {({ name: string, menuId: any }) => void} onConfirm
 *   Called with the user's choices when they click Install.
 */
export const DashboardInstallOptionsModal = ({
  isOpen,
  setIsOpen,
  pkg,
  menuItems = [],
  onCreateFolder,
  onConfirm,
}) => {
  const { currentTheme } = useContext(ThemeContext);
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

  // Reset state every time the modal opens with a new package.
  useEffect(() => {
    if (!isOpen) return;
    setName(defaultName);
    setSelectedMenuId(menuItems[0]?.id != null ? String(menuItems[0].id) : "");
    setNewFolderMode(false);
    setNewFolderName("");
    setError(null);
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

  async function handleConfirm() {
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
    });
  }

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      width="w-full max-w-md"
      height="h-auto"
    >
      <div
        className={`flex flex-col rounded-lg overflow-hidden border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div className="flex flex-row items-center justify-between p-4 border-b border-white/10">
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
            <span className="text-[10px] opacity-50">
              The local display name only. Doesn't change the published scope or
              package id.
            </span>
          </div>

          {/* Folder */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Folder</label>
            {!newFolderMode ? (
              <div className="flex flex-row gap-2 items-center">
                <select
                  value={selectedMenuId}
                  onChange={(e) => setSelectedMenuId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-900 border border-white/10 rounded text-sm text-gray-200"
                >
                  {sortedFolders.length === 0 && (
                    <option value="">— No folders yet —</option>
                  )}
                  {sortedFolders.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNewFolderMode(true)}
                  className="px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                >
                  + New
                </button>
              </div>
            ) : (
              <div className="flex flex-row gap-2 items-center">
                <InputText
                  value={newFolderName}
                  onChange={(v) => setNewFolderName(v)}
                  placeholder="New folder name"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderMode(false);
                    setNewFolderName("");
                    setError(null);
                  }}
                  className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-100 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-red-300 bg-red-900/30 border border-red-700/40 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-row justify-end gap-2 p-4 border-t border-white/10">
          <Button3 title="Cancel" onClick={() => setIsOpen(false)} />
          <Button2
            title={creating ? "Creating folder…" : "Install"}
            onClick={handleConfirm}
            disabled={creating || !name.trim()}
          />
        </div>
      </div>
    </Modal>
  );
};

export default DashboardInstallOptionsModal;
