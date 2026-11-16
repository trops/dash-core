import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  ConfirmationModal,
  EmptyState,
  FontAwesomeIcon,
  InputText,
  ListRow,
  SearchInput,
  SectionLabel,
  Sidebar,
  SelectInput,
  StatusBadge,
  ThemeContext,
  deepCopy,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useProfiles } from "../../hooks/useProfiles";
import { useGoals } from "../../hooks/useGoals";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useTeamBots } from "../Bots/useTeamBots";
import { STATUS_DOT } from "../Bots/teamUtils";
import { relativeTime } from "../Bots/BotMonitor";
import { ThemeColorDots } from "../Theme/ThemeColorDots";
import { ListGroupLabel, ManageLayout, OverflowMenu } from "./ManageLayout";
import { StarRating } from "../Settings/details/StarRating";
import { PublishDashboardModal } from "../Settings/details/PublishDashboardModal";
import { dashboardSummary } from "./dashboardSummary";
import { useApprovalsByDashboard } from "./useApprovalsByDashboard";
import { exportedText } from "./exportedText";
import { saveErrorText } from "../../utils/saveErrorText";
import { dashboardCopy } from "../../utils/dashboardCopy";
import {
  ALL_DASHBOARDS,
  NOT_IN_A_FOLDER,
  dashboardsIn,
  folderIcon,
  folderOf,
  newestFirst,
  sameId,
  sortedFolders,
  withFolder,
} from "../../utils/dashboardFolders";
import { FolderPanel } from "./FolderPanel";

// What a dragged dashboard row carries (its id).
const DRAG_TYPE = "application/x-dash-dashboard";
// Empty, so it takes the select's placeholder place ("No folder" once).
const NO_FOLDER = "";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;
const getWidgetRequirements = (name) =>
  (name && ComponentManager.config(name)?.providers) || [];

/** "1 provider needs setup · 1 bot needs approval" — or "" when all clear. */
function attentionText(unresolved, approvals) {
  const parts = [];
  if (unresolved > 0) {
    parts.push(
      `${plural(unresolved, "provider")} need${unresolved === 1 ? "s" : ""} setup`,
    );
  }
  if (approvals > 0) {
    parts.push(
      `${plural(approvals, "bot")} need${approvals === 1 ? "s" : ""} approval`,
    );
  }
  return parts.join(" · ");
}

// Layout cleaned of runtime-only widgetConfig before saving (as Settings did).
function forSave(ws) {
  const copy = deepCopy(ws);
  copy.layout = (copy.layout || []).map((item) => {
    const cleaned = { ...item };
    delete cleaned.widgetConfig;
    return cleaned;
  });
  return copy;
}

/** "updated 3 h ago" when the dashboard carries a timestamp, else "". */
function updatedText(ws) {
  const raw = ws && (ws.updatedAt || ws.lastModified);
  if (!raw) return "";
  const iso =
    typeof raw === "number" ? new Date(raw).toISOString() : String(raw);
  const age = relativeTime(iso);
  return age ? `updated ${age}` : "";
}

/** A page's grid as a small preview, drawn with theme tokens. */
const LayoutPreview = ({ grid, hairline, selectedBg }) => {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  // Cells sit on a raised surface with a visible edge, so the grid reads
  // against the recessed frame in both modes.
  const cellSurface = currentTheme["bg-neutral-dark"] || "";
  const cellEdge = currentTheme["border-neutral-medium"] || hairline;
  if (!grid || !grid.cells || !grid.cells.length) {
    return (
      <div className={`rounded-lg border ${hairline} ${selectedBg}`}>
        <EmptyState
          icon={
            <FontAwesomeIcon icon="table-cells-large" className="h-6 w-6" />
          }
          title="No layout yet"
          description="This page has no grid. Open the dashboard to lay out its widgets."
          testId="layout-empty"
        />
      </div>
    );
  }
  return (
    <div
      className={`h-48 rounded-lg border p-2 ${hairline} ${selectedBg}`}
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
        gap: "6px",
      }}
    >
      {grid.cells.map((cell) => (
        <div
          key={`${cell.row}.${cell.col}`}
          data-testid="layout-cell"
          className={`rounded-md border ${cellEdge} ${cellSurface}`}
          style={{
            gridColumn: cell.colSpan ? `span ${cell.colSpan}` : undefined,
            gridRow: cell.rowSpan ? `span ${cell.rowSpan}` : undefined,
          }}
        />
      ))}
    </div>
  );
};

/** One dashboard's details (the right-hand panel). */
const DashboardDetailPanel = ({
  ws,
  summary,
  approvals,
  folderName,
  themeName,
  menuItems,
  themes,
  appId,
  dashApi,
  onReloadWorkspaces,
  onOpenWorkspace,
  onOpenBotsView,
  onOpenDashboardConfig,
  onRequestDelete,
  // Set when there is more than one profile: take it out of the active one.
  onRequestRemoveFromProfile = null,
  activeProfileName = null,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const team = useTeamBots(ws.id);
  const [pageIndex, setPageIndex] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(ws.name || "");
  const [publishOpen, setPublishOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);

  const page = summary.pages[pageIndex] || summary.pages[0];
  const attention = attentionText(summary.unresolvedProviders, approvals);
  const registryPackage = ws._dashboardConfig?.registryPackage;
  const isShareable = ws._dashboardConfig?.shareable !== false;
  const teamBots = [team.lead, ...(team.members || [])].filter(Boolean);

  const save = (updated) => {
    if (!dashApi || !appId) return;
    dashApi.saveWorkspace(
      appId,
      forSave(updated),
      () => onReloadWorkspaces && onReloadWorkspaces(),
      (e, err) =>
        window.dispatchEvent(
          new CustomEvent("dash:notify", {
            detail: {
              type: "error",
              title: "Couldn't save the dashboard",
              message: saveErrorText(err) || "Try again.",
              duration: 8000,
            },
          }),
        ),
    );
  };

  const saveName = () => {
    if (!name.trim()) return;
    save({ ...ws, name: name.trim() });
    setRenaming(false);
  };

  // Not the registry package it came from; still credited (dashboardCopy).
  const duplicate = () => save(dashboardCopy(ws));

  // With its bots by default (create-entry 5a): they come back wired to
  // the imported dashboard's widgets.
  async function exportZip(includeBots = true) {
    if (!appId) return;
    setExportStatus("Exporting…");
    try {
      const result = await window.mainApi.dashboardConfig.exportDashboardConfig(
        appId,
        ws.id,
        { includeBots },
      );
      setExportStatus(exportedText(result));
    } catch (err) {
      setExportStatus(err.message || "Export failed.");
    }
    setTimeout(() => setExportStatus(null), 3000);
  }

  const folderOptions = menuItems
    .map((m) => ({ label: m.name, value: String(m.id) }))
    .sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  const themeOptions = Object.entries(themes || {})
    .map(([key, t]) => ({ label: t.name || key, value: key }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          {renaming ? (
            <div className="flex flex-row items-end gap-2">
              <InputText
                label="Dashboard name"
                value={name}
                onChange={(v) => setName(v)}
              />
              <Button3 title="Save name" size="sm" onClick={saveName} />
              <Button3
                title="Cancel"
                size="sm"
                onClick={() => {
                  setRenaming(false);
                  setName(ws.name || "");
                }}
              />
            </div>
          ) : (
            <h3 className={`text-lg font-semibold truncate ${strong}`}>
              {ws.name || "Untitled"}
            </h3>
          )}
          <span className={`text-sm ${muted}`}>
            {folderName}
            {themeName ? ` · theme ${themeName}` : ""}
          </span>
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Button title="Open" size="sm" onClick={() => onOpenWorkspace(ws)} />
          <Button3
            title="Bots view"
            size="sm"
            onClick={() => onOpenBotsView(ws)}
          />
          <Button3
            title="Dashboard Config"
            size="sm"
            onClick={() => onOpenDashboardConfig(ws)}
          />
          <OverflowMenu
            items={[
              {
                label: "Rename",
                icon: "pen",
                onClick: () => setRenaming(true),
              },
              { label: "Duplicate", icon: "clone", onClick: duplicate },
              {
                label: (team.members || []).length
                  ? "Export ZIP with bots"
                  : "Export ZIP",
                icon: "file-zipper",
                onClick: () => exportZip(true),
              },
              (team.members || []).length
                ? {
                    label: "Export ZIP without bots",
                    icon: "file-zipper",
                    onClick: () => exportZip(false),
                  }
                : null,
              isShareable
                ? {
                    label: "Publish",
                    icon: "cloud-arrow-up",
                    onClick: () => setPublishOpen(true),
                  }
                : null,
              onRequestRemoveFromProfile
                ? {
                    label: `Remove from ${activeProfileName || "this profile"}`,
                    icon: "circle-minus",
                    onClick: () => onRequestRemoveFromProfile(ws),
                  }
                : null,
              {
                label: "Delete",
                icon: "trash-can",
                onClick: () => onRequestDelete(ws),
              },
            ]}
          />
        </div>
      </div>
      {exportStatus ? (
        <span className={`text-sm ${muted}`}>{exportStatus}</span>
      ) : null}
      {attention ? (
        <div>
          <StatusBadge state="warning" label={attention} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Layout + pages */}
        <div className="flex flex-col gap-2">
          <SectionLabel text={`Layout · ${page ? page.name : ""}`} />
          <LayoutPreview
            grid={page ? page.grid : null}
            hairline={hairline}
            selectedBg={selectedBg}
          />
          <div className="flex flex-row flex-wrap gap-1.5">
            {summary.pages.map((p, i) => (
              <button
                key={p.id || i}
                type="button"
                aria-pressed={p === page}
                onClick={() => setPageIndex(i)}
                className={`px-2 py-1 rounded-md border text-xs ${
                  p === page
                    ? `${selectedBg} ${hairline} ${strong}`
                    : `border-transparent ${muted}`
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Widgets */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text={`Widgets · ${summary.widgets.length}`} />
          {summary.widgets.length ? (
            <div className="flex flex-col gap-1.5">
              {summary.widgets.map((w) => (
                <div
                  key={w.id}
                  className="flex flex-row items-center justify-between gap-3 text-sm min-w-0"
                >
                  <span className="truncate">{w.name}</span>
                  {w.package ? (
                    <span className={`text-xs font-mono truncate ${muted}`}>
                      {w.package}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>No widgets yet</span>
          )}
        </div>

        {/* Bots */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Bots" />
          {teamBots.length ? (
            <div className="flex flex-col gap-1.5">
              {teamBots.map((b) => {
                const status = team.statusOf ? team.statusOf(b.id) : "Idle";
                const dot = STATUS_DOT[status] || STATUS_DOT.Idle;
                return (
                  <div
                    key={b.id}
                    className="flex flex-row items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-row items-center gap-2 min-w-0">
                      <span className="truncate">{b.name}</span>
                      {b.role === "lead" ? (
                        <StatusBadge state="neutral" label="Lead" />
                      ) : null}
                    </span>
                    <span
                      className={`flex flex-row items-center gap-1.5 text-xs flex-shrink-0 ${muted}`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${dot}`}
                      />
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>No bots yet</span>
          )}
        </div>

        {/* Providers */}
        <div className="flex flex-col gap-2 min-w-0">
          <SectionLabel text="Providers" />
          {summary.providers.length ? (
            <div className="flex flex-col gap-1.5 text-sm">
              {summary.providers.map((p) => (
                <span key={p} className="truncate">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>None</span>
          )}
          {summary.unresolvedProviders > 0 ? (
            <span className={`text-sm ${muted}`}>
              <StatusBadge
                state="warning"
                compact
                label={`${plural(summary.unresolvedProviders, "required provider")} not set`}
              />{" "}
              Fix in Dashboard Config.
            </span>
          ) : null}
        </div>
      </div>

      {/* Folder + theme */}
      <div
        className={`grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t ${hairline}`}
      >
        <SelectInput
          label="Folder"
          // A dashboard outside every folder (or in a folder that is gone)
          // shows "No folder", not a blank select.
          value={folderOf(ws, menuItems) ? String(ws.menuId) : NO_FOLDER}
          onChange={(val) =>
            save(
              withFolder(
                ws,
                (val && menuItems.find((m) => sameId(m.id, val))) || null,
              ),
            )
          }
          options={[
            { label: "Not in a folder", value: NO_FOLDER },
            ...folderOptions,
          ]}
          placeholder="Not in a folder"
        />
        <SelectInput
          label="Theme"
          value={ws.themeKey || ""}
          onChange={(val) => save({ ...ws, themeKey: val || null })}
          options={themeOptions}
          placeholder="Select a theme"
        />
      </div>

      {registryPackage ? (
        <div className="flex flex-col gap-2">
          <span className={`text-xs ${muted}`}>
            Imported from the registry:{" "}
            <span className="font-mono">{registryPackage}</span>
          </span>
          {appId ? (
            <StarRating
              appId={appId}
              packageName={registryPackage}
              interactive={true}
            />
          ) : null}
        </div>
      ) : null}

      <PublishDashboardModal
        isOpen={publishOpen}
        setIsOpen={setPublishOpen}
        appId={appId}
        workspaceId={ws.id}
        workspaceName={ws.name}
      />
    </div>
  );
};

/**
 * DashboardsPage — every dashboard as list + detail (app-navigation PRD
 * NAV-005), with a folder column (NAV-017): All dashboards, Not in a
 * folder, each folder with its icon and count, + New folder. Pick one and
 * the list shows only its dashboards, newest first. Drag a dashboard onto a
 * folder to move it (or use the Folder field in its details); a folder's
 * ⋯ has Edit folder and Delete folder. The detail shows the dashboard
 * (layout per page, widgets, bots, providers, what needs attention) or the
 * New / Edit folder panel.
 */
export const DashboardsPage = ({
  workspaces = [],
  menuItems = [],
  dashApi = null,
  credentials = null,
  onReloadWorkspaces = null,
  onReloadMenuItems = null,
  // Open on a folder / with New folder open: { folder, newFolder, nonce }.
  folderLink = null,
  onOpenWorkspace = () => {},
  onOpenBotsView = () => {},
  onOpenDashboardConfig = () => {},
}) => {
  const { muted } = useConfigTokens();
  const themeCtx = useContext(ThemeContext) || {};
  const themes = themeCtx.themes || {};
  const dropRing = (themeCtx.currentTheme || {})["border-primary-medium"] || "";
  const appContext = useContext(AppContext) || {};
  const appProviders = appContext.providers || {};
  const approvalsFor = useApprovalsByDashboard();
  const appId = credentials?.appId;

  const [query, setQuery] = useState("");
  const [folderKey, setFolderKey] = useState(ALL_DASHBOARDS);
  const [selectedId, setSelectedId] = useState(null);
  // The detail shows a folder form instead: { kind: "new" | "edit", id }.
  const [panel, setPanel] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Its goals go with it (goals-ledger PRD): the confirmation says how many.
  const { goals: deleteTargetGoals } = useGoals(
    deleteTarget ? deleteTarget.id : null,
  );
  const [deleteFolderTarget, setDeleteFolderTarget] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const profiles = useProfiles(appId);

  // A link from the left nav / Settings › Folders / New folder.
  useEffect(() => {
    if (!folderLink) return;
    if (folderLink.folder) setFolderKey(String(folderLink.folder));
    setPanel(folderLink.newFolder ? { kind: "new" } : null);
  }, [folderLink?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const summaries = useMemo(() => {
    const map = new Map();
    for (const ws of workspaces) {
      map.set(
        ws.id,
        dashboardSummary(ws, {
          getWidgetConfig,
          getWidgetRequirements,
          appProviders,
          providersLoaded: appContext.providersLoaded,
        }),
      );
    }
    return map;
  }, [workspaces, appProviders, appContext.providersLoaded]);

  const folders = sortedFolders(menuItems);
  const currentFolder =
    folderKey === ALL_DASHBOARDS || folderKey === NOT_IN_A_FOLDER
      ? null
      : folders.find((f) => sameId(f.id, folderKey)) || null;
  // A folder that was deleted elsewhere falls back to All dashboards.
  const key =
    folderKey === ALL_DASHBOARDS || folderKey === NOT_IN_A_FOLDER
      ? folderKey
      : currentFolder
        ? folderKey
        : ALL_DASHBOARDS;

  const q = query.trim().toLowerCase();
  const ordered = newestFirst(
    dashboardsIn(key, workspaces, menuItems).filter((ws) => {
      if (!q) return true;
      const s = summaries.get(ws.id);
      const haystack = [
        ws.name || "",
        ...(s ? s.widgets.map((w) => `${w.name} ${w.component || ""}`) : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    }),
  );
  const selected =
    ordered.find((ws) => ws.id === selectedId) || ordered[0] || null;

  const notify = (title, err) =>
    window.dispatchEvent(
      new CustomEvent("dash:notify", {
        detail: {
          type: "error",
          title,
          message: saveErrorText(err) || "Try again.",
          duration: 8000,
        },
      }),
    );

  const saveDashboard = (ws) =>
    new Promise((resolve, reject) => {
      if (!dashApi || !appId) return reject(new Error("Not ready"));
      dashApi.saveWorkspace(
        appId,
        forSave(ws),
        () => resolve(),
        (e, err) => reject(err || e),
      );
    });

  const saveFolder = (folder) =>
    new Promise((resolve, reject) => {
      if (!dashApi || !appId) return reject(new Error("Not ready"));
      dashApi.saveMenuItem(
        appId,
        folder,
        (e, result) =>
          result && result.error ? reject(result) : resolve(result),
        (e, err) => reject(err || e),
      );
    });

  // Drag a dashboard onto a folder (or onto Not in a folder).
  const moveTo = (wsId, targetKey) => {
    const ws = workspaces.find((w) => String(w.id) === String(wsId));
    if (!ws) return;
    const folder =
      targetKey === NOT_IN_A_FOLDER
        ? null
        : menuItems.find((m) => sameId(m.id, targetKey)) || null;
    if (targetKey !== NOT_IN_A_FOLDER && !folder) return;
    const now = folderOf(ws, menuItems);
    if ((now && folder && sameId(now.id, folder.id)) || (!now && !folder))
      return;
    saveDashboard(withFolder(ws, folder))
      .then(() => onReloadWorkspaces && onReloadWorkspaces())
      .catch((err) => notify("Couldn't move the dashboard", err));
  };

  const dropProps = (targetKey) => ({
    onDragOver: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE)) return;
      e.preventDefault();
      if (dragOver !== targetKey) setDragOver(targetKey);
    },
    onDragLeave: () => setDragOver((k) => (k === targetKey ? null : k)),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer?.getData(DRAG_TYPE);
      if (id) moveTo(id, targetKey);
    },
  });

  const pickFolder = (k) => {
    setFolderKey(k);
    setSelectedId(null);
    setPanel(null);
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !dashApi || !appId) return;
    dashApi.deleteWorkspace(
      appId,
      target.id,
      () => {
        if (selectedId === target.id) setSelectedId(null);
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => console.error("Delete dashboard error:", err),
    );
  };

  // Its dashboards stay: they're without a folder, on disk.
  const confirmDeleteFolder = () => {
    const target = deleteFolderTarget;
    setDeleteFolderTarget(null);
    if (!target || !dashApi || !appId) return;
    const failed = (err) =>
      notify(`Couldn't delete the folder "${target.name}"`, err);
    dashApi.deleteMenuItem(
      appId,
      target.id,
      (e, result) => {
        if (result && result.error) return failed(result);
        pickFolder(ALL_DASHBOARDS);
        onReloadMenuItems && onReloadMenuItems();
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => failed(err),
    );
  };

  // Out of the active profile only — it stays on this computer.
  const confirmRemove = async () => {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    const res = await profiles.removeFromActive("dashboards", target.id);
    if (!res.success) {
      window.dispatchEvent(
        new CustomEvent("dash:notify", {
          detail: {
            type: "error",
            title: "Couldn't remove the dashboard from this profile",
            message: res.error || "Try again.",
            duration: 8000,
          },
        }),
      );
      return;
    }
    if (selectedId === target.id) setSelectedId(null);
    onReloadWorkspaces && onReloadWorkspaces();
  };
  const removeElsewhere = removeTarget
    ? profiles.otherHolders("dashboards", removeTarget.id)
    : [];

  const folderCount = (k) => dashboardsIn(k, workspaces, menuItems).length;
  const deleteFolderCount = deleteFolderTarget
    ? folderCount(deleteFolderTarget.id)
    : 0;

  // ─── Folder column ───────────────────────────────────────────────
  const columnRow = (k, label, icon, droppable) => {
    const on = k === key && !panel;
    return (
      <div
        key={k}
        data-testid={`folder-${k}`}
        data-drop={dragOver === k ? "over" : undefined}
        className={`rounded-md border-2 ${
          dragOver === k ? dropRing : "border-transparent"
        }`}
        {...(droppable ? dropProps(k) : {})}
      >
        <Sidebar.Item
          icon={<FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />}
          active={on}
          onClick={() => pickFolder(k)}
          badge={String(folderCount(k))}
        >
          <span data-name>{label}</span>
        </Sidebar.Item>
      </div>
    );
  };
  const aside = (
    <>
      {columnRow(ALL_DASHBOARDS, "All dashboards", "clone", false)}
      {columnRow(NOT_IN_A_FOLDER, "Not in a folder", "inbox", true)}
      {folders.length ? <ListGroupLabel text="Folders" /> : null}
      {folders.map((f) =>
        columnRow(String(f.id), f.name || "Untitled", folderIcon(f), true),
      )}
      <div data-testid="new-folder" className="pt-2">
        <Sidebar.Item
          icon={<FontAwesomeIcon icon="folder-plus" className="h-3.5 w-3.5" />}
          active={panel?.kind === "new"}
          onClick={() => setPanel({ kind: "new" })}
        >
          <span data-name>New folder</span>
        </Sidebar.Item>
      </div>
    </>
  );

  // ─── List ────────────────────────────────────────────────────────
  const listTitle =
    key === ALL_DASHBOARDS
      ? "All dashboards"
      : key === NOT_IN_A_FOLDER
        ? "Not in a folder"
        : currentFolder.name || "Untitled";
  const list = (
    <>
      <div
        data-testid="dashboard-list-head"
        className="flex flex-row items-center gap-2 px-2 h-8"
      >
        <span className={`flex-1 text-xs font-semibold truncate ${muted}`}>
          {listTitle} · {plural(ordered.length, "dashboard")}
          {key === ALL_DASHBOARDS && ordered.length ? " · newest first" : ""}
        </span>
        {currentFolder ? (
          <OverflowMenu
            ariaLabel={`${currentFolder.name} actions`}
            items={[
              {
                label: "Edit folder",
                icon: "pen",
                onClick: () =>
                  setPanel({ kind: "edit", id: String(currentFolder.id) }),
              },
              {
                label: "Delete folder",
                icon: "trash-can",
                onClick: () => setDeleteFolderTarget(currentFolder),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {ordered.map((ws) => {
          const s = summaries.get(ws.id);
          const needs =
            (s && s.unresolvedProviders > 0) || approvalsFor(ws.id) > 0;
          const active = !panel && selected && ws.id === selected.id;
          const theme = ws.themeKey ? themes[ws.themeKey] : null;
          const inFolder =
            key === ALL_DASHBOARDS ? folderOf(ws, menuItems) : null;
          const meta = [
            s
              ? `${plural(s.pages.length, "page")} · ${plural(
                  s.widgets.length,
                  "widget",
                )}`
              : "",
            updatedText(ws),
            inFolder ? inFolder.name : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={ws.id}
              draggable
              data-testid="dashboard-row"
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, String(ws.id));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragOver(null)}
            >
              <ListRow
                icon="table-cells-large"
                selected={!!active}
                onClick={() => {
                  setSelectedId(ws.id);
                  setPanel(null);
                }}
                title={<span data-name>{ws.name || "Untitled"}</span>}
                meta={
                  <span className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{meta}</span>
                    {theme ? <ThemeColorDots theme={theme} /> : null}
                    {needs ? (
                      <span data-testid="dashboard-attention">
                        <StatusBadge
                          state="warning"
                          compact
                          label="Needs attention"
                        />
                      </span>
                    ) : null}
                  </span>
                }
              />
            </div>
          );
        })}
        {!ordered.length ? (
          <span className={`text-sm px-2 ${muted}`} data-testid="list-empty">
            {q
              ? "No dashboards match."
              : currentFolder
                ? `Nothing in ${currentFolder.name} yet. Drag a dashboard onto it, or use Edit folder to pick some.`
                : key === NOT_IN_A_FOLDER
                  ? "Every dashboard is in a folder."
                  : "No dashboards yet."}
          </span>
        ) : null}
      </div>
    </>
  );

  // ─── Detail ──────────────────────────────────────────────────────
  let detail;
  const editing =
    panel?.kind === "edit"
      ? menuItems.find((m) => sameId(m.id, panel.id)) || null
      : null;
  if (panel && (panel.kind === "new" || editing)) {
    detail = (
      <FolderPanel
        key={panel.kind === "new" ? "new" : `edit-${panel.id}`}
        folder={editing}
        workspaces={workspaces}
        menuItems={menuItems}
        saveFolder={saveFolder}
        saveDashboard={saveDashboard}
        onDone={(id) => {
          onReloadMenuItems && onReloadMenuItems();
          onReloadWorkspaces && onReloadWorkspaces();
          setPanel(null);
          setFolderKey(id);
          setSelectedId(null);
        }}
        onCancel={() => setPanel(null)}
      />
    );
  } else if (selected) {
    const theme = selected.themeKey ? themes[selected.themeKey] : null;
    const inFolder = folderOf(selected, menuItems);
    detail = (
      <DashboardDetailPanel
        key={selected.id}
        ws={selected}
        summary={summaries.get(selected.id)}
        approvals={approvalsFor(selected.id)}
        folderName={inFolder ? inFolder.name : "Not in a folder"}
        themeName={theme ? theme.name || selected.themeKey : null}
        menuItems={menuItems}
        themes={themes}
        appId={appId}
        dashApi={dashApi}
        onReloadWorkspaces={onReloadWorkspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotsView={onOpenBotsView}
        onOpenDashboardConfig={onOpenDashboardConfig}
        onRequestDelete={setDeleteTarget}
        onRequestRemoveFromProfile={
          profiles.hasProfiles ? setRemoveTarget : null
        }
        activeProfileName={profiles.active?.name}
      />
    );
  } else {
    detail = (
      <span className={`text-sm ${muted}`}>
        {q
          ? "No dashboards match."
          : workspaces.length
            ? "Pick a dashboard to see its details."
            : "No dashboards yet."}
      </span>
    );
  }

  return (
    <ManageLayout
      testId="dashboards-page"
      aside={aside}
      asideLabel="Folders"
      listLabel="Dashboards"
      detailTestId="dashboard-detail"
      // The folder form scrolls itself and keeps its save bar in view.
      detailFlush={!!(panel && (panel.kind === "new" || editing))}
      toolbar={
        <div className="w-72">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search dashboards or widgets…"
          />
        </div>
      }
      list={list}
      detail={detail}
    >
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete dashboard"
        message={`Delete "${deleteTarget?.name || "Untitled"}"${
          profiles.hasProfiles ? " from this computer and every profile" : ""
        }? This can't be undone.${
          deleteTargetGoals.length
            ? ` Its ${deleteTargetGoals.length === 1 ? "goal" : `${deleteTargetGoals.length} goals`}, with their tasks, runs and proof, ${deleteTargetGoals.length === 1 ? "is" : "are"} deleted too.`
            : ""
        }`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmationModal
        isOpen={!!deleteFolderTarget}
        setIsOpen={() => setDeleteFolderTarget(null)}
        title={`Delete folder "${deleteFolderTarget?.name || ""}"`}
        message={
          deleteFolderCount
            ? deleteFolderCount === 1
              ? "Its 1 dashboard stays — it moves to Not in a folder."
              : `Its ${deleteFolderCount} dashboards stay — they move to Not in a folder.`
            : "It's empty. Nothing else changes."
        }
        confirmLabel="Delete folder"
        variant="danger"
        onConfirm={confirmDeleteFolder}
        onCancel={() => setDeleteFolderTarget(null)}
      />
      <ConfirmationModal
        isOpen={!!removeTarget}
        setIsOpen={() => setRemoveTarget(null)}
        title={`Remove "${removeTarget?.name || "Untitled"}" from ${
          profiles.active?.name || "this profile"
        }`}
        message={
          removeElsewhere.length
            ? `"${removeTarget?.name || "Untitled"}" won't show in ${profiles.active?.name || "this profile"}. It stays in ${removeElsewhere.join(", ")}.`
            : `"${removeTarget?.name || "Untitled"}" isn't in any other profile, so it won't show anywhere. It stays on this computer — add it back in Settings › Profiles.`
        }
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </ManageLayout>
  );
};

export default DashboardsPage;
