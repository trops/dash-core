import React, { useMemo, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  InputText,
  SearchInput,
  SectionLabel,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { IconPicker } from "../Settings/details/IconPicker";
import {
  folderIcon,
  folderOf,
  newestFirst,
  sameId,
  withFolder,
} from "../../utils/dashboardFolders";

/** "Home, with Smart Home and Shopping List." / "Home, with 5 dashboards." */
export function folderSummary(name, pickedNames) {
  const n = pickedNames.length;
  if (!n) return `${name}, empty for now.`;
  if (n > 3) return `${name}, with ${n} dashboards.`;
  const list =
    n === 1
      ? pickedNames[0]
      : `${pickedNames.slice(0, -1).join(", ")} and ${pickedNames[n - 1]}`;
  return `${name}, with ${list}.`;
}

/**
 * FolderPanel — the Dashboards page's New folder / Edit folder (frame 3·6):
 * a name, the app's icon picker, and the dashboards in it, ticked (many at
 * once). The page owns saving: saveFolder(folder) and saveDashboard(ws)
 * return promises.
 */
export const FolderPanel = ({
  folder = null,
  workspaces = [],
  menuItems = [],
  saveFolder,
  saveDashboard,
  onDone,
  onCancel,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const [name, setName] = useState(folder ? folder.name || "" : "");
  const [icon, setIcon] = useState(folder ? folderIcon(folder) : "folder");
  const [picked, setPicked] = useState(
    () =>
      new Set(
        folder
          ? workspaces
              .filter((ws) => sameId(ws.menuId, folder.id))
              .map((ws) => String(ws.id))
          : [],
      ),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // A new folder once it's saved: trying Save again updates it, not a second one.
  const [created, setCreated] = useState(null);

  const all = useMemo(() => newestFirst(workspaces), [workspaces]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? all.filter((ws) => (ws.name || "").toLowerCase().includes(q))
    : all;
  const pickedNames = all
    .filter((ws) => picked.has(String(ws.id)))
    .map((ws) => ws.name || "Untitled");
  const allShownPicked =
    shown.length > 0 && shown.every((ws) => picked.has(String(ws.id)));

  const toggle = (ws, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(String(ws.id));
      else next.delete(String(ws.id));
      return next;
    });
  const toggleShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      shown.forEach((ws) =>
        allShownPicked ? next.delete(String(ws.id)) : next.add(String(ws.id)),
      );
      return next;
    });

  async function save() {
    if (!name.trim()) {
      setError("Give the folder a name.");
      return;
    }
    setSaving(true);
    setError(null);
    // Older folders keep their icon in `folder`; it's saved as `icon` now.
    const base = folder || created;
    const { folder: _oldIcon, ...kept } = base || {};
    const saved = base
      ? { ...kept, name: name.trim(), icon }
      : { id: Date.now(), name: name.trim(), icon };
    try {
      await saveFolder(saved);
      if (!folder) setCreated(saved);
    } catch (err) {
      setSaving(false);
      setError("Couldn't save the folder. Try again.");
      return;
    }
    // Only the dashboards whose folder changes are saved.
    const moves = workspaces
      .map((ws) => {
        const nowIn = picked.has(String(ws.id));
        const wasIn = sameId(ws.menuId, saved.id);
        if (nowIn && !wasIn) return withFolder(ws, saved);
        if (!nowIn && wasIn) return withFolder(ws, null);
        return null;
      })
      .filter(Boolean);
    let failed = 0;
    for (const ws of moves) {
      try {
        await saveDashboard(ws);
      } catch (err) {
        failed += 1;
      }
    }
    setSaving(false);
    if (failed) {
      setError(
        `Saved the folder, but ${failed} dashboard${
          failed === 1 ? "" : "s"
        } didn't move. Try Save again.`,
      );
      return;
    }
    onDone && onDone(String(saved.id));
  }

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="folder-panel">
      <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-5">
        <h3 className={`text-lg font-semibold ${strong}`}>
          {folder ? `Edit ${folder.name || "folder"}` : "New folder"}
        </h3>
        <div className="w-72">
          <InputText
            label="Name"
            value={name}
            onChange={(v) => setName(v)}
            placeholder="Folder name"
            autoFocus={!folder}
          />
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel text="Icon" />
          <IconPicker
            selectedIcon={icon}
            onSelectIcon={setIcon}
            allWhenSearching
            suggestedLimit={24}
            gridClassName="grid grid-cols-12 gap-2"
          />
          <span className={`text-xs ${muted}`}>
            Picked: {icon}. It shows beside the folder here and in the left nav.
          </span>
        </div>

        <div className={`flex flex-col gap-2 pt-4 border-t ${hairline}`}>
          <div className="flex flex-row items-center gap-3">
            <div className="flex-1">
              <SectionLabel
                text={
                  folder
                    ? "Dashboards in it"
                    : "Put dashboards in it (you can do this later)"
                }
              />
            </div>
            <span className={`text-xs ${muted}`}>{picked.size} picked</span>
            <Button3
              title={allShownPicked ? "Clear" : "Select all"}
              size="sm"
              onClick={toggleShown}
            />
          </div>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Find a dashboard…"
          />
          <div
            className="flex flex-col gap-1 max-h-48 overflow-y-auto"
            data-testid="folder-picks"
          >
            {shown.map((ws) => {
              const where = folderOf(ws, menuItems);
              return (
                <div
                  key={ws.id}
                  className="flex flex-row items-center justify-between gap-3 px-1"
                >
                  <Checkbox
                    label={ws.name || "Untitled"}
                    checked={picked.has(String(ws.id))}
                    onChange={(on) => toggle(ws, on)}
                  />
                  <span className={`text-xs truncate ${muted}`}>
                    {where ? where.name : "Not in a folder"}
                  </span>
                </div>
              );
            })}
            {!shown.length ? (
              <span className={`text-sm ${muted}`}>No dashboards match.</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* The save bar stays in view. */}
      <div
        className={`flex-shrink-0 flex flex-row flex-wrap items-center gap-2 px-5 py-3 border-t ${hairline}`}
      >
        <span
          className={`flex-1 text-sm ${error ? status.error.icon : muted}`}
          role={error ? "alert" : undefined}
        >
          {error || folderSummary(name.trim() || "This folder", pickedNames)}
        </span>
        <Button3 title="Cancel" size="sm" onClick={onCancel} />
        <Button
          title={saving ? "Saving…" : folder ? "Save folder" : "Create folder"}
          size="sm"
          disabled={saving}
          onClick={save}
        />
      </div>
    </div>
  );
};

export default FolderPanel;
