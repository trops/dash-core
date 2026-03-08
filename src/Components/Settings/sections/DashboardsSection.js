import React, { useContext, useState, useRef, useEffect } from "react";
import {
  ButtonIcon,
  ConfirmationModal,
  SearchInput,
  Sidebar,
  Tabs3,
  ThemeContext,
  deepCopy,
  getStylesForItem,
  themeObjects,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { SectionLayout } from "../SectionLayout";
import { DashboardDetail } from "../details/DashboardDetail";
import { DiscoverDashboardsDetail } from "../details/DiscoverDashboardsDetail";

export const DashboardsSection = ({
  workspaces = [],
  menuItems = [],
  dashApi = null,
  credentials = null,
  onReloadWorkspaces = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grouped");
  // null | "marketplace" | "import-result"
  const [installMode, setInstallMode] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const appId = credentials?.appId;

  const { currentTheme } = useContext(ThemeContext);
  const headerStyles = getStylesForItem(
    themeObjects.PANEL_HEADER,
    currentTheme,
    { grow: false },
  );

  // Filter by search
  const query = searchQuery.trim().toLowerCase();
  const filteredWorkspaces = query
    ? workspaces.filter((ws) =>
        (ws.name || "Untitled").toLowerCase().includes(query),
      )
    : workspaces;

  // Grouping helpers (mirrors DashSidebar.js)
  const workspacesForFolder = (folderId) =>
    filteredWorkspaces.filter((ws) => ws.menuId === folderId);
  const orphanedWorkspaces = filteredWorkspaces.filter(
    (ws) => !menuItems.some((mi) => mi.id === ws.menuId),
  );

  // Alphabetical sort
  const sortedWorkspaces = [...filteredWorkspaces].sort((a, b) =>
    (a.name || "Untitled").localeCompare(b.name || "Untitled"),
  );

  function handleStartRename(ws) {
    setEditingId(ws.id);
    setEditName(ws.name || "");
  }

  function handleSaveRename(ws) {
    if (!editName.trim() || !dashApi || !appId) return;
    const updated = deepCopy(ws);
    updated.name = editName.trim();
    // Strip widgetConfig from layout before saving
    updated.layout = (updated.layout || []).map((layoutItem) => {
      const cleaned = { ...layoutItem };
      delete cleaned.widgetConfig;
      return cleaned;
    });
    dashApi.saveWorkspace(
      appId,
      updated,
      () => {
        setEditingId(null);
        setEditName("");
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => console.error("Rename workspace error:", err),
    );
  }

  function handleDuplicate(ws) {
    if (!dashApi || !appId) return;
    const copy = deepCopy(ws);
    copy.id = Date.now();
    copy.name = (ws.name || "Dashboard") + " (Copy)";
    copy.version = Date.now();
    // Strip widgetConfig from layout before saving
    copy.layout = (copy.layout || []).map((layoutItem) => {
      const cleaned = { ...layoutItem };
      delete cleaned.widgetConfig;
      return cleaned;
    });
    dashApi.saveWorkspace(
      appId,
      copy,
      () => {
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => console.error("Duplicate workspace error:", err),
    );
  }

  function handleConfirmDelete() {
    if (!deleteTarget || !dashApi || !appId) return;
    dashApi.deleteWorkspace(
      appId,
      deleteTarget.id,
      () => {
        if (selectedId === deleteTarget.id) setSelectedId(null);
        setDeleteTarget(null);
        onReloadWorkspaces && onReloadWorkspaces();
      },
      (e, err) => {
        console.error("Delete workspace error:", err);
        setDeleteTarget(null);
      },
    );
  }

  // Respond to external create trigger from header button (marketplace)
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      setSelectedId(null);
      setInstallMode("marketplace");
      setImportResult(null);
    }
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  async function handleImport() {
    if (!appId) return;
    setInstallMode("import-result");
    setImportResult({ status: "loading", message: "Importing dashboard..." });
    try {
      const result =
        await window.mainApi.dashboardConfig.importDashboardConfig(appId);
      if (!result) {
        // User cancelled the file picker
        setInstallMode(null);
        setImportResult(null);
        return;
      }
      if (result.success) {
        setImportResult({
          status: "success",
          message: `Dashboard "${result.workspace?.name || "Untitled"}" imported successfully.`,
        });
        onReloadWorkspaces && onReloadWorkspaces();
      } else {
        setImportResult({
          status: "error",
          message: result.error || "Import failed.",
        });
      }
    } catch (err) {
      setImportResult({
        status: "error",
        message: err.message || "Failed to import dashboard.",
      });
    }
  }

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedId);

  function renderDashboardItem(ws, icon) {
    const isSelected = selectedId === ws.id;
    const widgetCount = (ws.layout || []).length;
    return (
      <Sidebar.Item
        key={ws.id}
        icon={<FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />}
        active={isSelected}
        onClick={() => setSelectedId(ws.id)}
        badge={String(widgetCount)}
        className={isSelected ? "bg-white/10 opacity-100" : ""}
      >
        {ws.name || "Untitled"}
      </Sidebar.Item>
    );
  }

  function renderGroupedView() {
    return (
      <>
        {menuItems.map((menuItem) => {
          const folderWs = workspacesForFolder(menuItem.id);
          if (folderWs.length === 0) return null;
          const folderIcon = menuItem.icon || menuItem.folder || "folder";
          return (
            <Sidebar.Group key={menuItem.id} label={menuItem.name}>
              {folderWs.map((ws) => renderDashboardItem(ws, folderIcon))}
            </Sidebar.Group>
          );
        })}
        {orphanedWorkspaces.length > 0 && (
          <Sidebar.Group label="Uncategorized">
            {orphanedWorkspaces.map((ws) => renderDashboardItem(ws, "clone"))}
          </Sidebar.Group>
        )}
      </>
    );
  }

  function renderAlphabeticalView() {
    return sortedWorkspaces.map((ws) => renderDashboardItem(ws, "clone"));
  }

  const listContent = (
    <div className="flex flex-col h-full">
      <div
        className={`flex-shrink-0 flex flex-col gap-2 px-3 pt-3 pb-2 ${
          headerStyles.backgroundColor || ""
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search dashboards..."
            />
          </div>
          <ButtonIcon
            icon="file-import"
            onClick={handleImport}
            size="sm"
            title="Import dashboard"
          />
        </div>
        <Tabs3
          value={installMode === "marketplace" ? "marketplace" : viewMode}
          onValueChange={(val) => {
            if (val === "marketplace") {
              setInstallMode("marketplace");
              setSelectedId(null);
            } else {
              setInstallMode(null);
              setImportResult(null);
              setViewMode(val);
            }
          }}
          backgroundColor="bg-transparent"
          spacing="p-0"
        >
          <Tabs3.List className="w-full flex" spacing="p-0.5">
            <Tabs3.Trigger value="grouped" className="flex-1">
              Grouped
            </Tabs3.Trigger>
            <Tabs3.Trigger value="alphabetical" className="flex-1">
              A-Z
            </Tabs3.Trigger>
            <Tabs3.Trigger value="marketplace" className="flex-1">
              Marketplace
            </Tabs3.Trigger>
          </Tabs3.List>
        </Tabs3>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <Sidebar.Content>
          {viewMode === "grouped"
            ? renderGroupedView()
            : renderAlphabeticalView()}
          {filteredWorkspaces.length === 0 && (
            <span className="text-sm opacity-40 py-8 text-center">
              {query ? "No dashboards match your search" : "No dashboards yet"}
            </span>
          )}
        </Sidebar.Content>
      </div>
    </div>
  );

  let detailContent = null;

  if (installMode === "marketplace") {
    detailContent = (
      <DiscoverDashboardsDetail
        onBack={() => {
          setInstallMode(null);
          setViewMode("grouped");
        }}
        appId={appId}
      />
    );
  } else if (installMode === "import-result") {
    detailContent = (
      <div className="flex flex-col flex-1 min-h-0 p-6 space-y-4">
        {importResult?.status === "loading" && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            <span className="text-sm opacity-70">{importResult.message}</span>
          </div>
        )}
        {importResult?.status === "success" && (
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon="circle-check"
              className="h-4 w-4 text-green-400"
            />
            <span className="text-sm">{importResult.message}</span>
          </div>
        )}
        {importResult?.status === "error" && (
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon="circle-xmark"
              className="h-4 w-4 text-red-400"
            />
            <span className="text-sm text-red-400">{importResult.message}</span>
          </div>
        )}
      </div>
    );
  } else if (selectedWorkspace) {
    detailContent = (
      <DashboardDetail
        workspace={selectedWorkspace}
        menuItems={menuItems}
        editingId={editingId}
        editName={editName}
        setEditName={setEditName}
        onStartRename={handleStartRename}
        onSaveRename={handleSaveRename}
        onCancelRename={() => {
          setEditingId(null);
          setEditName("");
        }}
        onDuplicate={handleDuplicate}
        onDelete={(ws) => setDeleteTarget(ws)}
        dashApi={dashApi}
        credentials={credentials}
        onReloadWorkspaces={onReloadWorkspaces}
      />
    );
  }

  return (
    <>
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a dashboard to view details"
      />
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete Dashboard"
        message={`Are you sure you want to delete "${
          deleteTarget?.name || "Untitled"
        }"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
};
