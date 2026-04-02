import React, { useContext, useMemo, useCallback } from "react";
import { ThemeContext, FontAwesomeIcon } from "@trops/dash-react";
import { LayoutBuilder } from "../Layout";
import { LayoutModel } from "../../Models/LayoutModel";

/**
 * Default empty 1x1 grid for the sidebar drop zone.
 * Uses a high ID range (90000+) to avoid collisions with page layouts.
 */
function createEmptySidebarLayout() {
  return [
    LayoutModel({
      id: 90001,
      order: 1,
      type: "grid",
      component: "LayoutGridContainer",
      hasChildren: 1,
      scrollable: false,
      parent: 0,
      menuId: 1,
      width: "w-full",
      height: "h-full",
      grid: {
        rows: 1,
        cols: 1,
        gap: "gap-0",
        rowModes: { 1: "grow" },
        1.1: { component: null, hide: false },
      },
    }),
  ];
}

/**
 * PinnedSidebar — persistent sidebar for dashboards.
 *
 * When enabled, renders a fixed-width column on the left of the content area.
 *
 * Edit mode, no widget:
 *   - LayoutBuilder with empty drop zone (user can drop a widget)
 *   - Help text: "Or leave empty for page navigation"
 *   - Page list preview (if multi-page)
 *
 * Edit mode, has widget:
 *   - LayoutBuilder with the widget (editable)
 *
 * Preview mode, no widget:
 *   - Alphabetized page navigation list (if multi-page)
 *
 * Preview mode, has widget:
 *   - LayoutBuilder in preview mode (widget renders normally)
 */
export const PinnedSidebar = React.memo(
  ({
    pages = [],
    activePageId = null,
    onSwitchPage = null,
    sidebarLayout = [],
    workspace = null,
    width = 280,
    editMode = false,
    onWorkspaceChange = null,
    onProviderSelect = null,
    onTogglePreview = null,
    onWidgetPopout = null,
    sidebarRef = null,
  }) => {
    const { currentTheme } = useContext(ThemeContext);
    const hasWidget = sidebarLayout.some(
      (item) =>
        item.type === "widget" ||
        (item.grid &&
          Object.values(item.grid).some(
            (cell) =>
              cell?.component != null && typeof cell.component === "number",
          )),
    );
    const hasPages = pages.length > 1;

    // Stable ref for workspace so callbacks and memos don't depend on reference
    const workspaceRefInternal = React.useRef(workspace);
    workspaceRefInternal.current = workspace;

    // Build a workspace-like object for the sidebar's LayoutBuilder
    const sidebarWorkspace = useMemo(() => {
      if (!workspaceRefInternal.current) return null;
      let layout =
        sidebarLayout.length > 0
          ? [...sidebarLayout]
          : createEmptySidebarLayout();
      // Ensure sidebar grid uses grow mode for full-height rendering
      layout = layout.map((item) => {
        if (item.grid && item.parent === 0) {
          return {
            ...item,
            scrollable: false,
            height: "h-full",
            grid: {
              ...item.grid,
              rowModes: { ...item.grid.rowModes, 1: "grow" },
            },
          };
        }
        return item;
      });
      return { ...workspaceRefInternal.current, layout };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspace?.id, sidebarLayout, hasWidget]);

    const handleSidebarChange = useCallback(
      (updatedWs) => {
        if (onWorkspaceChange && workspaceRefInternal.current) {
          onWorkspaceChange({
            ...workspaceRefInternal.current,
            sidebarLayout: updatedWs.layout || [],
          });
        }
      },
      [onWorkspaceChange],
    );

    // Alphabetized page list
    const sortedPages = hasPages
      ? [...pages].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      : [];

    const renderPageList = () => (
      <div className="flex flex-col py-2">
        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Pages
        </div>
        {sortedPages.map((page) => {
          const isActive = page.id === activePageId;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onSwitchPage && onSwitchPage(page.id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                isActive
                  ? `${currentTheme["bg-primary-medium"] || "bg-white/10"} text-white font-medium`
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              {isActive && (
                <FontAwesomeIcon
                  icon="chevron-right"
                  className="h-2 w-2 text-blue-400"
                />
              )}
              <span className={isActive ? "" : "pl-4"}>
                {page.name || "Untitled"}
              </span>
            </button>
          );
        })}
      </div>
    );

    return (
      <div
        className={`flex flex-col shrink-0 border-r overflow-hidden h-full ${
          currentTheme["border-primary-dark"] || "border-gray-700"
        } ${currentTheme["bg-primary-dark"] || "bg-gray-900/50"}`}
        style={{ width: `${width}px` }}
      >
        {/* Edit mode: show LayoutBuilder (drop zone or widget) */}
        {editMode && sidebarWorkspace && (
          <>
            <div
              className={`flex flex-col overflow-y-auto ${hasWidget ? "flex-1 min-h-0" : "flex-1 basis-1/2"}`}
            >
              <LayoutBuilder
                dashboardId={workspace?.id}
                preview={false}
                workspace={sidebarWorkspace}
                onWorkspaceChange={handleSidebarChange}
                onProviderSelect={onProviderSelect}
                onTogglePreview={onTogglePreview}
                key={`sidebar-edit-${workspace?.id}-${hasWidget}`}
                editMode="all"
                workspaceRef={sidebarRef}
                onWidgetPopout={onWidgetPopout}
              />
            </div>
            {/* Help text + page list when no widget placed */}
            {!hasWidget && (
              <div className="flex flex-col flex-1 basis-1/2 border-t border-gray-700/50 overflow-y-auto">
                <div className="px-3 py-2">
                  <div className="text-[10px] text-gray-500 text-center">
                    Drop a widget above, or leave empty for page navigation
                  </div>
                </div>
                {hasPages && renderPageList()}
              </div>
            )}
          </>
        )}

        {/* Preview mode with widget */}
        {!editMode && hasWidget && sidebarWorkspace && (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <LayoutBuilder
              dashboardId={workspace?.id}
              preview={true}
              workspace={sidebarWorkspace}
              onWorkspaceChange={handleSidebarChange}
              onProviderSelect={onProviderSelect}
              onTogglePreview={onTogglePreview}
              key={`sidebar-preview-${workspace?.id}-${hasWidget}`}
              editMode="all"
              workspaceRef={sidebarRef}
              onWidgetPopout={onWidgetPopout}
            />
          </div>
        )}

        {/* Preview mode without widget: page navigation */}
        {!editMode && !hasWidget && hasPages && renderPageList()}
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison: skip re-render when only activePageId changes
    // and sidebar has a widget (page list not shown, LayoutBuilder unchanged).
    if (prev.editMode !== next.editMode) return false;
    if (prev.width !== next.width) return false;
    if (prev.sidebarLayout !== next.sidebarLayout) return false;
    if (prev.workspace?.id !== next.workspace?.id) return false;
    if (prev.sidebarRef !== next.sidebarRef) return false;
    // Page-list related: only matters when no widget in sidebar
    if (prev.activePageId !== next.activePageId) {
      // Check if sidebar has a widget — if yes, skip re-render
      const hasWidget = (prev.sidebarLayout || []).some(
        (item) =>
          item.type === "widget" ||
          (item.grid &&
            Object.keys(item.grid).some((k) => {
              const cell = item.grid[k];
              return (
                cell &&
                typeof cell === "object" &&
                cell.component != null &&
                typeof cell.component === "number"
              );
            })),
      );
      if (hasWidget) return true; // skip re-render
      return false; // re-render for page list
    }
    if (prev.pages !== next.pages) return false;
    return true;
  },
);
