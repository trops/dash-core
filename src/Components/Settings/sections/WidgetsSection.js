import React, { useState, useMemo, useRef, useEffect, useContext } from "react";
import {
  ConfirmationModal,
  FontAwesomeIcon,
  SearchInput,
  Sidebar,
  Paragraph,
  Tag3,
  Tabs3,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { SectionLayout } from "../SectionLayout";
import { InstalledWidgetDetail } from "../details/InstalledWidgetDetail";
import { InstallWidgetPicker } from "../details/InstallWidgetPicker";
import { DiscoverWidgetsDetail } from "../details/DiscoverWidgetsDetail";
import { InstallProgressModal } from "../details/InstallProgressModal";
import { RegistryAuthModal } from "../../Registry/RegistryAuthModal";
import {
  useInstalledWidgets,
  findWidgetUsage,
} from "../../../hooks/useInstalledWidgets";
import { useWidgetUpdates } from "../../../hooks/useWidgetUpdates";
import { resolveIcon } from "../../../utils/resolveIcon";
import { getUserConfigurableProviders } from "../../../utils/providerUtils";

/**
 * WidgetsSection — unified widgets tab in AppSettingsModal.
 *
 * Left column: installed widgets list with search, source tabs, author/provider
 * filters, and grouped display.
 * Detail panel: widget detail, install picker, registry browser, or
 * install result depending on state.
 */
export const WidgetsSection = ({
  workspaces = [],
  credentials = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const { widgets, isLoading, error, uninstallWidget, refresh } =
    useInstalledWidgets();
  const {
    updates,
    isChecking,
    updateWidget,
    isUpdating,
    needsAuth,
    clearNeedsAuth,
    updateError,
  } = useWidgetUpdates(widgets, refresh);

  const [selectedWidgetName, setSelectedWidgetName] = useState(null);
  // null | "picker" | "discover" | "zip-result" | "folder-result"
  const [installMode, setInstallMode] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteUsage, setDeleteUsage] = useState([]);
  const [installResult, setInstallResult] = useState(null);

  // Install progress modal state
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressWidgets, setProgressWidgets] = useState([]);
  const [progressComplete, setProgressComplete] = useState(false);

  // ── Filter state ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource, setFilterSource] = useState("all"); // "all" | "builtin" | "installed"
  const [filterAuthor, setFilterAuthor] = useState("all");
  const [filterProvider, setFilterProvider] = useState("all");

  // ── Derived filter options ──────────────────────────────────────────
  const uniqueAuthors = useMemo(
    () =>
      [...new Set(widgets.map((w) => w.package || w.author || "Other"))].sort(),
    [widgets],
  );

  const uniqueProviders = useMemo(
    () =>
      [
        ...new Set(
          widgets.flatMap((w) =>
            getUserConfigurableProviders(w.providers || []).map((p) => p.type),
          ),
        ),
      ].sort(),
    [widgets],
  );

  // ── Filtered + grouped widgets ──────────────────────────────────────
  const { filteredGrouped, filteredCount, totalCount } = useMemo(() => {
    const filtered = widgets.filter((w) => {
      // Search: match name, displayName, or description
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          (w.displayName || "").toLowerCase().includes(q) ||
          (w.name || "").toLowerCase().includes(q) ||
          (w.description || "").toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      // Source filter
      if (filterSource !== "all" && w.source !== filterSource) return false;
      // Author/package filter
      if (filterAuthor !== "all") {
        if ((w.package || w.author || "Other") !== filterAuthor) return false;
      }
      // Provider filter
      if (filterProvider !== "all") {
        if (filterProvider === "none") {
          if (getUserConfigurableProviders(w.providers).length > 0)
            return false;
        } else {
          if (
            !getUserConfigurableProviders(w.providers).some(
              (p) => p.type === filterProvider,
            )
          )
            return false;
        }
      }
      return true;
    });

    // Group by package > author > "Other"
    const groups = {};
    filtered.forEach((w) => {
      const group = w.package || w.author || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(w);
    });

    return {
      filteredGrouped: groups,
      filteredCount: filtered.length,
      totalCount: widgets.length,
    };
  }, [widgets, searchQuery, filterSource, filterAuthor, filterProvider]);

  const hasActiveFilters =
    searchQuery ||
    filterSource !== "all" ||
    filterAuthor !== "all" ||
    filterProvider !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setFilterSource("all");
    setFilterAuthor("all");
    setFilterProvider("all");
  };

  const selectClassName = `w-full px-2 py-1 rounded text-xs bg-transparent border ${
    currentTheme["border-primary-medium"] || "border-gray-700"
  } ${
    currentTheme["text-primary-light"] || "text-gray-300"
  } focus:outline-none appearance-none cursor-pointer`;

  // Respond to external create trigger from header button
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      setSelectedWidgetName(null);
      setInstallMode("picker");
      setInstallResult(null);
    }
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  const selectedWidget = selectedWidgetName
    ? widgets.find((w) => w.name === selectedWidgetName)
    : null;

  // ── Uninstall with usage check ──────────────────────────────────────

  function handleDeleteRequest(widget) {
    // Find all sibling widgets in the same package (uninstall is package-level)
    const siblings =
      widget.packageId && widget.source === "installed"
        ? widgets.filter(
            (w) => w.packageId === widget.packageId && w.name !== widget.name,
          )
        : [];
    const allComponentNames = [
      ...widget.componentNames,
      ...siblings.flatMap((s) => s.componentNames),
    ];
    const usage = findWidgetUsage(allComponentNames, workspaces);
    setDeleteUsage(usage);
    setDeleteTarget({ ...widget, _siblings: siblings });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await uninstallWidget(deleteTarget.name);
      // Clear selection if it was the target or any sibling
      const allNames = [
        deleteTarget.name,
        ...(deleteTarget._siblings || []).map((s) => s.name),
      ];
      if (allNames.includes(selectedWidgetName)) {
        setSelectedWidgetName(null);
      }
    } catch (err) {
      console.error("[WidgetsSection] Uninstall error:", err);
    }
    setDeleteTarget(null);
    setDeleteUsage([]);
  }

  async function handleInstallFromZip() {
    if (!window.mainApi?.dialog) return;
    try {
      const filepath = await window.mainApi.dialog.chooseFile(true, ["zip"]);
      if (!filepath) return;

      // Extract widget name from filename (e.g., "weather.zip" -> "weather")
      const filename = filepath.split("/").pop() || filepath;
      const widgetName = filename.replace(/\.zip$/i, "");

      setInstallMode("zip-result");

      // Show progress modal
      setProgressWidgets([
        {
          packageName: widgetName,
          displayName: widgetName,
          status: "downloading",
        },
      ]);
      setProgressComplete(false);
      setShowProgressModal(true);

      await window.mainApi.widgets.installLocal(widgetName, filepath);
      await refresh();

      setProgressWidgets([
        {
          packageName: widgetName,
          displayName: widgetName,
          status: "installed",
        },
      ]);
      setProgressComplete(true);

      setInstallResult({
        status: "success",
        message: `Widget "${widgetName}" installed successfully.`,
      });
    } catch (err) {
      console.error("[WidgetsSection] ZIP install error:", err);
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "failed", error: err.message })),
      );
      setProgressComplete(true);

      setInstallResult({
        status: "error",
        message: err.message || "Failed to install widget from ZIP.",
      });
    }
  }

  async function handleLoadFolder() {
    if (!window.mainApi?.dialog) return;
    try {
      const folderPath = await window.mainApi.dialog.chooseFile(false);
      if (!folderPath) return;

      setInstallMode("folder-result");

      // Show progress modal with initial item
      setProgressWidgets([
        {
          packageName: "folder",
          displayName: "Loading folder...",
          status: "downloading",
        },
      ]);
      setProgressComplete(false);
      setShowProgressModal(true);

      const results = await window.mainApi.widgets.loadFolder(folderPath);
      await refresh();

      const count = Array.isArray(results) ? results.length : 0;
      const isSingle = count === 1 && results[0]?.mode === "single";
      const skipped = results?.skipped || 0;

      // Rebuild progress items from actual results
      if (count > 0) {
        setProgressWidgets(
          results.map((r) => ({
            packageName: r.name || "widget",
            displayName: r.displayName || r.name || "Widget",
            status: "installed",
          })),
        );
      } else {
        setProgressWidgets([
          {
            packageName: "folder",
            displayName: "No widgets found",
            status: "failed",
            error: "No widget directories found in folder.",
          },
        ]);
      }
      setProgressComplete(true);

      let message;
      if (isSingle) {
        message = `Installed widget "${results[0].name}" from folder.`;
      } else if (count > 0) {
        message = `Loaded ${count} widget${
          count !== 1 ? "s" : ""
        } from folder.`;
        if (skipped > 0) {
          message += ` (${skipped} non-widget folder${
            skipped !== 1 ? "s" : ""
          } skipped)`;
        }
      } else {
        message =
          "No widgets found in the selected folder. Expected a folder containing widget subdirectories, each with a package.json or widgets/ directory.";
      }

      setInstallResult({
        status: count > 0 ? "success" : "error",
        message,
        details: count > 0 ? results : null,
      });
    } catch (err) {
      console.error("[WidgetsSection] Folder load error:", err);
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "failed", error: err.message })),
      );
      setProgressComplete(true);

      setInstallResult({
        status: "error",
        message: err.message || "Failed to load widgets from folder.",
      });
    }
  }

  function handleProgressDone() {
    setShowProgressModal(false);
    setProgressWidgets([]);
    setProgressComplete(false);
  }

  function handlePickerSelect(option) {
    if (option === "discover") {
      setInstallMode("discover");
    } else if (option === "zip") {
      handleInstallFromZip();
    } else if (option === "folder") {
      handleLoadFolder();
    }
  }

  // ── List content (left column) ──────────────────────────────────────

  let listBody;

  if (isLoading) {
    listBody = (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-3"></div>
          <Paragraph className="text-sm opacity-50">
            Loading widgets...
          </Paragraph>
        </div>
      </div>
    );
  } else if (error) {
    listBody = (
      <span className="text-sm text-red-400 py-8 text-center block px-4">
        {error}
      </span>
    );
  } else if (widgets.length === 0) {
    listBody = (
      <span className="text-sm opacity-40 py-8 text-center block">
        No widgets available
      </span>
    );
  } else if (filteredCount === 0) {
    listBody = (
      <span className="text-sm opacity-40 py-8 text-center block">
        No widgets match filters
      </span>
    );
  } else {
    const groupKeys = Object.keys(filteredGrouped).sort();
    const showGroupHeaders = groupKeys.length > 1;

    listBody = groupKeys.map((group) => {
      const groupWidgets = filteredGrouped[group];
      const items = groupWidgets.map((widget) => {
        const isSelected = selectedWidgetName === widget.name && !installMode;
        return (
          <Sidebar.Item
            key={widget.name}
            icon={
              <FontAwesomeIcon
                icon={resolveIcon(widget.icon)}
                className="h-3.5 w-3.5"
              />
            }
            active={isSelected}
            onClick={() => {
              setSelectedWidgetName(widget.name);
              setInstallMode(null);
              setInstallResult(null);
            }}
            className={isSelected ? "bg-white/10 opacity-100" : ""}
          >
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                {widget.displayName || widget.name}
                {widget.source === "builtin" && <Tag3 text="Built-in" />}
                {updates.has(widget.name) && (
                  <span className="text-[10px] text-blue-400 font-medium">
                    Update
                  </span>
                )}
              </span>
              {(widget.scopedId || widget.name) && (
                <span className="text-[10px] opacity-40 truncate">
                  {widget.scopedId || widget.name}
                </span>
              )}
            </span>
          </Sidebar.Item>
        );
      });

      if (showGroupHeaders) {
        const groupHasUpdate = groupWidgets.some((w) => updates.has(w.name));
        return (
          <Sidebar.Group
            key={group}
            label={
              groupHasUpdate ? (
                <span className="flex items-center gap-2">
                  {group}
                  <span className="text-[10px] text-blue-400 font-medium">
                    Update
                  </span>
                </span>
              ) : (
                group
              )
            }
          >
            {items}
          </Sidebar.Group>
        );
      }
      return items;
    });
  }

  const listContent = (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      {!isLoading && !error && widgets.length > 0 && (
        <div className="flex flex-col gap-2 px-3 py-2 flex-shrink-0 border-b border-white/10">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search widgets..."
            inputClassName="py-1.5 text-xs"
          />

          {/* Source tabs */}
          <Tabs3
            value={filterSource}
            onValueChange={setFilterSource}
            backgroundColor="bg-transparent"
            spacing="p-0"
          >
            <Tabs3.List className="w-full flex" spacing="p-0.5">
              <Tabs3.Trigger value="all" className="flex-1">
                All
              </Tabs3.Trigger>
              <Tabs3.Trigger value="builtin" className="flex-1">
                Built-in
              </Tabs3.Trigger>
              <Tabs3.Trigger value="installed" className="flex-1">
                Installed
              </Tabs3.Trigger>
            </Tabs3.List>
          </Tabs3>

          {/* Package + Provider dropdowns */}
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={filterAuthor}
              onChange={(e) => setFilterAuthor(e.target.value)}
              className={selectClassName}
            >
              <option value="all">All Packages</option>
              {uniqueAuthors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className={selectClassName}
            >
              <option value="all">All Providers</option>
              <option value="none">No Providers</option>
              {uniqueProviders.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Result count + clear */}
          <div className="flex items-center justify-between text-[10px] px-0.5">
            <span className="opacity-50">
              {hasActiveFilters
                ? `${filteredCount} of ${totalCount} widgets`
                : `${totalCount} widgets`}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="opacity-60 hover:opacity-100 transition-opacity text-gray-300 hover:bg-white/10 px-1.5 py-0.5 rounded"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <Sidebar.Content>{listBody}</Sidebar.Content>

      {/* Summary footer */}
      {!isLoading && !error && widgets.length > 0 && (
        <div className="px-3 py-2 text-[10px] opacity-40 flex-shrink-0 border-t border-white/10">
          {(() => {
            const builtinCount = widgets.filter(
              (w) => w.source === "builtin",
            ).length;
            const installedCount = widgets.filter(
              (w) => w.source === "installed",
            ).length;
            const parts = [];
            if (builtinCount > 0) parts.push(`${builtinCount} built-in`);
            if (installedCount > 0) parts.push(`${installedCount} installed`);
            return parts.join(", ");
          })()}
          {updates.size > 0 && (
            <span className="text-blue-400 ml-1">
              {" \u00B7 "}
              {updates.size} update{updates.size !== 1 ? "s" : ""} available
            </span>
          )}
        </div>
      )}
    </div>
  );

  // ── Detail content (right column) ───────────────────────────────────

  let detailContent = null;

  if (installMode === "picker") {
    detailContent = <InstallWidgetPicker onSelect={handlePickerSelect} />;
  } else if (installMode === "discover") {
    detailContent = (
      <DiscoverWidgetsDetail onBack={() => setInstallMode("picker")} />
    );
  } else if (installMode === "zip-result" || installMode === "folder-result") {
    detailContent = (
      <div
        className={`flex flex-col flex-1 min-h-0 p-6 space-y-4 ${
          panelStyles.textColor || "text-gray-200"
        }`}
      >
        {installResult?.status === "loading" && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            <span className="text-sm opacity-70">{installResult.message}</span>
          </div>
        )}
        {installResult?.status === "success" && (
          <div className="flex flex-col space-y-3">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon
                icon="circle-check"
                className="h-4 w-4 text-green-400"
              />
              <span className="text-sm">{installResult.message}</span>
            </div>
            {installResult.details && installResult.details.length > 0 && (
              <div className="space-y-1 pl-6">
                {installResult.details.map((w, i) => (
                  <div key={i} className="text-xs opacity-60">
                    {w.displayName || w.name || w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {installResult?.status === "error" && (
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon="circle-xmark"
              className="h-4 w-4 text-red-400"
            />
            <span className="text-sm text-red-400">
              {installResult.message}
            </span>
          </div>
        )}
      </div>
    );
  } else if (selectedWidget) {
    detailContent = (
      <InstalledWidgetDetail
        widget={selectedWidget}
        appId={credentials?.appId}
        onDelete={(w) => handleDeleteRequest(w)}
        updateInfo={updates.get(selectedWidget?.name) || null}
        onUpdate={updateWidget}
        isUpdating={isUpdating === selectedWidget?.name}
        updateError={updateError}
      />
    );
  }

  // ── Uninstall confirmation ──────────────────────────────────────────

  const paragraphStyles = getStylesForItem(
    themeObjects.PARAGRAPH,
    currentTheme,
  );

  const deleteWidgetLabel =
    deleteTarget?.displayName || deleteTarget?.name || "";
  const deleteSiblings = deleteTarget?._siblings || [];
  const deletePackageLabel = deleteTarget?.packageId
    ? deleteTarget.packageId.replace(/^@[^/]+\//, "")
    : "";
  const hasPackageSiblings = deleteSiblings.length > 0;

  return (
    <>
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a widget to view details"
      />
      <InstallProgressModal
        isOpen={showProgressModal}
        setIsOpen={setShowProgressModal}
        widgets={progressWidgets}
        isComplete={progressComplete}
        onDone={handleProgressDone}
      />
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => {
          setDeleteTarget(null);
          setDeleteUsage([]);
        }}
        title={hasPackageSiblings ? "Uninstall Package" : "Uninstall Widget"}
        {...(!hasPackageSiblings && deleteUsage.length === 0
          ? {
              message: `Are you sure you want to uninstall "${deleteWidgetLabel}"?`,
            }
          : {})}
        confirmLabel="Uninstall"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteUsage([]);
        }}
      >
        {(hasPackageSiblings || deleteUsage.length > 0) && (
          <div className={paragraphStyles.textColor || ""}>
            {hasPackageSiblings && (
              <>
                <p className="text-sm leading-relaxed">
                  "{deleteWidgetLabel}" is part of the{" "}
                  <span className="font-semibold">{deletePackageLabel}</span>{" "}
                  package. Uninstalling will remove all{" "}
                  {deleteSiblings.length + 1} widgets in this package:
                </p>
                <div className="mt-2 mb-2 space-y-1">
                  {[deleteTarget, ...deleteSiblings].map((w) => (
                    <div
                      key={w.name}
                      className="text-xs opacity-60 flex items-center gap-1.5 pl-2"
                    >
                      <FontAwesomeIcon
                        icon="puzzle-piece"
                        className="h-3 w-3"
                      />
                      {w.displayName || w.name}
                    </div>
                  ))}
                </div>
              </>
            )}
            {deleteUsage.length > 0 && (
              <>
                <p className="text-sm leading-relaxed">
                  {hasPackageSiblings
                    ? "These widgets are"
                    : `"${deleteWidgetLabel}" is`}{" "}
                  currently used in {deleteUsage.length} dashboard
                  {deleteUsage.length !== 1 ? "s" : ""}. Uninstalling will leave
                  orphaned layout items on these dashboards.
                </p>
                <div className="mt-2 space-y-1">
                  <span className="text-xs font-semibold opacity-70">
                    Affected dashboards:
                  </span>
                  {deleteUsage.map((u) => (
                    <div
                      key={u.workspaceId}
                      className="text-xs opacity-60 flex items-center gap-1.5 pl-2"
                    >
                      <FontAwesomeIcon
                        icon="triangle-exclamation"
                        className="h-3 w-3 text-yellow-500"
                      />
                      {u.workspaceName}{" "}
                      <span className="opacity-50">
                        ({u.count} instance{u.count !== 1 ? "s" : ""})
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </ConfirmationModal>
      <RegistryAuthModal
        isOpen={needsAuth}
        setIsOpen={(open) => {
          if (!open) clearNeedsAuth();
        }}
        onAuthenticated={() => {
          clearNeedsAuth();
          if (selectedWidget?.name) updateWidget(selectedWidget.name);
        }}
      />
    </>
  );
};
