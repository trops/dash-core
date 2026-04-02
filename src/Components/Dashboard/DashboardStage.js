import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useMemo,
  useCallback,
  Profiler,
} from "react";
import { LayoutContainer } from "../../Components/Layout";
import { LayoutBuilder } from "../../Components/Layout";
import {
  DashboardContext,
  DashboardWrapper,
  DashboardThemeProvider,
} from "../../Context";
import {
  deepCopy,
  FontAwesomeIcon,
  ThemeContext,
  EmptyState,
  ButtonIcon,
} from "@trops/dash-react";
import { LayoutModel, DashboardModel } from "../../Models";
import { ThemeManagerModal } from "../../Components/Theme";
import { AppSettingsModal } from "../../Components/Settings";

import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { DashboardHeader } from "../../Components/Dashboard";
import { WorkspaceModel, MenuItemModel } from "../../Models";

import { DashboardLoaderModal } from "./Modal/DashboardLoaderModal";
import { LayoutManagerModal } from "../Layout/LayoutManager";
import { DashboardWizardModal } from "../Layout/DashboardWizard";

import { DashCommandPalette } from "../Navigation/DashCommandPalette";
import { DashTabBar } from "../Navigation/DashTabBar";
import { PageTabBar } from "../Navigation/PageTabBar";
import { PinnedSidebar } from "./PinnedSidebar";
import { DashSidebar } from "../Navigation/DashSidebar";
import { WidgetSidebar } from "../Navigation/WidgetSidebar";

import { AppContext } from "../../Context/App/AppContext";
import { useMissingWidgets } from "../../hooks/useMissingWidgets";
import { MissingWidgetsModal } from "../../Widget/MissingWidgetsModal";

/**
 * DashboardStage - Main application wrapper component
 *
 * This component manages the overall dashboard application stage, including:
 * - Workspace (dashboard) selection and management
 * - Tab-based multi-dashboard navigation
 * - CommandPalette for quick access to all features
 * - Preview/edit mode toggling
 * - Menu items and navigation
 * - Modal management (settings, theme, loaders)
 *
 * Note: This is the application-level wrapper, not an individual user dashboard.
 * User dashboards are called "workspaces" in the backend API.
 */
export const DashboardStage = ({
  dashApi,
  credentials,
  workspace = null,
  preview = true,
  backgroundColor = null,
  popout = false,
  popoutWorkspaceId = null,
  showWelcomePrompt = false,
  onAcceptWelcome = null,
  onDismissWelcome = null,
}) => {
  return (
    <Profiler id="myapp" onRender={() => {}}>
      <DashboardWrapper
        dashApi={dashApi}
        credentials={credentials}
        backgroundColor={backgroundColor}
      >
        <DashboardStageInner
          dashApi={dashApi}
          credentials={credentials}
          workspace={workspace}
          preview={preview}
          backgroundColor={backgroundColor}
          popout={popout}
          popoutWorkspaceId={popoutWorkspaceId}
        />
      </DashboardWrapper>
    </Profiler>
  );
};

/**
 * PageLayoutBuilder — memoized wrapper for LayoutBuilder within a page.
 * Prevents the parent re-render from creating a new workspace object on every
 * render, which would trigger LayoutBuilder's useEffect normalization cycle.
 */
const PageLayoutBuilder = React.memo(function PageLayoutBuilder({
  page,
  workspaceItem,
  previewMode,
  editMode,
  onPageWorkspaceChange,
  onProviderSelect,
  onTogglePreview,
  workspaceRef,
  onWidgetPopout,
}) {
  const pageWorkspace = useMemo(
    () => ({
      ...workspaceItem,
      layout: page.layout || [],
    }),
    // Only recompute when the page layout actually changes (by reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceItem.id, page.layout],
  );

  const handleChange = useCallback(
    (ws) => onPageWorkspaceChange(ws, page.id),
    [onPageWorkspaceChange, page.id],
  );

  return (
    <LayoutBuilder
      dashboardId={workspaceItem["id"]}
      preview={previewMode}
      workspace={pageWorkspace}
      onWorkspaceChange={handleChange}
      onProviderSelect={onProviderSelect}
      onTogglePreview={onTogglePreview}
      key={`LayoutBuilder-${workspaceItem["id"]}-${page.id}`}
      editMode={editMode}
      workspaceRef={workspaceRef}
      onWidgetPopout={onWidgetPopout}
    />
  );
});

const DashboardStageInner = ({
  dashApi,
  credentials,
  workspace = null,
  preview = true,
  backgroundColor = null,
  popout = false,
  popoutWorkspaceId = null,
}) => {
  const { pub } = useContext(DashboardContext);
  const appContext = useContext(AppContext);

  // Stable callback refs for props passed to memoized children.
  // The ref wrapper keeps a stable function identity while the
  // implementation stays current (avoids useCallback dependency lists).
  const stableProviderSelectRef = useRef(null);
  const stableTogglePreviewRef = useRef(null);
  const stableWidgetPopoutRef = useRef(null);
  const stableProviderSelect = useCallback(
    (...args) => stableProviderSelectRef.current?.(...args),
    [],
  );
  const stableTogglePreview = useCallback(
    (...args) => stableTogglePreviewRef.current?.(...args),
    [],
  );
  const stableWidgetPopout = useCallback(
    (...args) => stableWidgetPopoutRef.current?.(...args),
    [],
  );

  /**
   * ThemeContext — consumed here, inside DashboardWrapper/ThemeWrapper
   */
  const {
    changeCurrentTheme,
    themeVariant,
    changeThemeVariant,
    themes,
    themeKey,
  } = useContext(ThemeContext);

  // ─── Tab State ────────────────────────────────────────────────────
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [widgetSidebarCollapsed, setWidgetSidebarCollapsed] = useState(true);

  // ─── Recents + Session ──────────────────────────────────────────
  const [recentDashboards, setRecentDashboards] = useState([]);
  const sessionRestored = useRef(false);

  // ─── Registry Auth (for sidebar) ────────────────────────────────
  const [authStatus, setAuthStatus] = useState("loading");
  const [authProfile, setAuthProfile] = useState(null);

  // Derive workspaceSelected from active tab
  const workspaceSelected = activeTabId
    ? (openTabs.find((tab) => tab.id === activeTabId)?.workspace ?? null)
    : null;

  /**
   * @param {Boolean} previewMode this is a toggle telling the dash we are editing
   */
  const [previewMode, setPreviewMode] = useState(preview);

  /**
   * @param {String["layout", "workspace", "widget"]} editMode this is the actual mode we are in
   */
  const [editMode] = useState("all"); // for the time being use "all" as our "old" way

  // Workspace Management (loading)
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingMenuItems, setIsLoadingMenuItems] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [workspaceConfig, setWorkspaceConfig] = useState([]);

  // Modal state
  const [isThemeManagerOpen, setIsThemeManagerOpen] = useState(false);
  const [isDashboardLoaderOpen, setIsDashboardLoaderOpen] = useState(false);
  const [isLayoutPickerOpen, setIsLayoutPickerOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // Missing widgets detection
  const { missingComponents, hasMissing } =
    useMissingWidgets(workspaceSelected);
  const [isMissingWidgetsModalOpen, setIsMissingWidgetsModalOpen] =
    useState(false);
  const [dismissedMissingForWorkspace, setDismissedMissingForWorkspace] =
    useState(new Set());

  // Unified App Settings Modal
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [appSettingsInitialSection, setAppSettingsInitialSection] =
    useState("dashboards");
  const [appSettingsInitialProvider, setAppSettingsInitialProvider] =
    useState(null);
  const [appSettingsCreateProvider, setAppSettingsCreateProvider] =
    useState(false);

  function openAppSettings(
    section = "general",
    providerName = null,
    createProvider = false,
  ) {
    setAppSettingsInitialSection(section);
    setAppSettingsInitialProvider(providerName);
    setAppSettingsCreateProvider(createProvider);
    setIsAppSettingsOpen(true);
  }

  async function handleProfileUpdated() {
    try {
      const profile = await window.mainApi?.registryAuth?.getProfile();
      if (profile) setAuthProfile(profile);
    } catch {
      // ignore
    }
  }

  // Ref to access LayoutBuilder's current workspace without re-render cascades
  const currentWorkspaceRef = useRef(null);

  // Snapshot of the workspace before editing — used to restore on Cancel
  const originalWorkspaceRef = useRef(null);

  useEffect(() => {
    console.log(
      "DASHBOARD ",
      menuItems,
      dashApi,
      pub,
      // settings,
      workspaceConfig,
      workspaceSelected,
      workspace,
    );
    console.log("dashboard use effect", workspaceSelected, workspace);
    isLoadingWorkspaces === false && loadWorkspaces();
    isLoadingMenuItems === false && loadMenuItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // ─── Popout: auto-load workspace by ID ──────────────────────────
  useEffect(() => {
    if (!popout || popoutWorkspaceId === null) return;
    if (workspaceConfig.length === 0) return;

    const target = workspaceConfig.find((ws) => ws.id === popoutWorkspaceId);
    if (target) {
      handleOpenTab(target);
      if (window.mainApi?.popout?.setTitle) {
        window.mainApi.popout.setTitle(
          popoutWorkspaceId,
          target.name || "Untitled",
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout, popoutWorkspaceId, workspaceConfig]);

  // ─── Listen for workspace:saved broadcasts (MCP tools, popouts) ──
  useEffect(() => {
    if (!window.mainApi?.on) return;

    const handler = () => {
      loadWorkspaces();
    };
    window.mainApi.on("workspace:saved", handler);
    return () => {
      if (window.mainApi?.removeListener) {
        window.mainApi.removeListener("workspace:saved", handler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load recents on mount ───────────────────────────────────────
  useEffect(() => {
    if (popout) return;
    window.mainApi?.session?.getRecents().then((recents) => {
      if (recents) setRecentDashboards(recents);
    });
  }, [popout]);

  // ─── Session save (continuous) ──────────────────────────────────
  useEffect(() => {
    if (popout) return;
    const tabIds = openTabs.map((t) => t.id);
    window.mainApi?.session?.saveState(tabIds, activeTabId);
  }, [openTabs, activeTabId, popout]);

  // ─── Session restore on launch ─────────────────────────────────
  useEffect(() => {
    if (popout || workspaceConfig.length === 0 || sessionRestored.current)
      return;
    sessionRestored.current = true;

    window.mainApi?.session?.getState().then((state) => {
      if (!state?.openTabIds?.length) return;
      state.openTabIds.forEach((wsId) => {
        const ws = workspaceConfig.find((w) => w.id === wsId);
        if (ws) handleOpenTab(ws);
      });
      if (state.activeTabId) setActiveTabId(state.activeTabId);
      window.mainApi?.session?.clearState();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceConfig, popout]);

  // ─── Auth status check (for sidebar) ────────────────────────────
  useEffect(() => {
    if (popout) return;
    let cancelled = false;

    async function checkAuth() {
      try {
        const status = await window.mainApi?.registryAuth?.getStatus();
        if (cancelled) return;
        if (status?.authenticated) {
          const profile = await window.mainApi?.registryAuth?.getProfile();
          if (cancelled) return;
          if (profile) {
            setAuthProfile(profile);
            setAuthStatus("authenticated");
          } else {
            setAuthStatus("unauthenticated");
          }
        } else {
          setAuthStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) setAuthStatus("unauthenticated");
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [popout]);

  // ─── Tab Handlers ─────────────────────────────────────────────────

  function handleOpenTab(workspaceItem) {
    if (!workspaceItem) return;

    const existingTab = openTabs.find((tab) => tab.id === workspaceItem.id);
    if (existingTab) {
      // Sync fresh workspace data to existing tab
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.id === existingTab.id
            ? {
                ...tab,
                name: workspaceItem.name || "Untitled",
                workspace: workspaceItem,
              }
            : tab,
        ),
      );
      setActiveTabId(existingTab.id);
    } else {
      // Open new tab
      const newTab = {
        id: workspaceItem.id,
        name: workspaceItem.name || "Untitled",
        workspace: workspaceItem,
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabId(workspaceItem.id);
    }
    setPreviewMode(true);
    setSidebarCollapsed(true);

    // Track in recents
    if (!popout) {
      window.mainApi?.session
        ?.addRecent(workspaceItem.id, workspaceItem.name || "Untitled")
        .then((updated) => {
          if (updated) setRecentDashboards(updated);
        });
    }
  }

  function handleCloseTab(tabId) {
    setOpenTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        // Switch to last remaining tab, or null
        const newActive =
          remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        setActiveTabId(newActive);
      }
      return remaining;
    });
  }

  function handleSwitchTab(tabId) {
    setActiveTabId(tabId);
    setPreviewMode(true);
  }

  // Update tab workspace reference when workspace changes
  function updateTabWorkspace(ws) {
    if (!ws) return;
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.id === ws.id
          ? { ...tab, name: ws.name || "Untitled", workspace: ws }
          : tab,
      ),
    );
  }

  // ─── New Workspace from Empty State ───────────────────────────────

  function handleClickNewFromEmpty() {
    setIsLayoutPickerOpen(true);
  }

  function handleCreateFromTemplate(
    layoutObjOrArray,
    themeKey = null,
    name = null,
  ) {
    try {
      const layout = Array.isArray(layoutObjOrArray)
        ? layoutObjOrArray
        : [layoutObjOrArray];
      const newWorkspace = WorkspaceModel({
        layout,
        themeKey,
        menuId: layout[0].menuId,
        name: name || undefined,
      });
      handleOpenTab(newWorkspace);
      setSidebarCollapsed(true);
      setPreviewMode(false);
      return { success: true, workspace: newWorkspace };
    } catch (e) {
      console.log(e);
    }
  }

  // ─── Workspace Loading ────────────────────────────────────────────

  function loadWorkspaces() {
    try {
      console.log("1. Loading Workspaces =========================");
      setIsLoadingWorkspaces(() => true);

      if (dashApi && credentials) {
        dashApi.listWorkspaces(
          credentials.appId,
          handleLoadWorkspacesComplete,
          handleLoadWorkspacesError,
        );
      }
    } catch (e) {
      console.log("failed loadWorkspaces ", e.message);
    }
  }

  function handleLoadWorkspacesComplete(e, message) {
    try {
      console.log("handleLoadWorkspacesComplete called", e, message);
      console.log("workspaces array length:", message["workspaces"]?.length);
      const workspaces = deepCopy(message["workspaces"]);
      const workspacesTemp = workspaces.map((ws) => {
        const tempLayout = ws["layout"].map((layoutOG) => {
          return LayoutModel(layoutOG, workspaces, ws["id"]);
        });
        ws["layout"] = tempLayout;
        // Normalize page layouts too
        if (ws.pages && Array.isArray(ws.pages)) {
          ws.pages = ws.pages.map((page) => {
            if (page.layout && Array.isArray(page.layout)) {
              page.layout = page.layout.map((layoutOG) =>
                LayoutModel(layoutOG, workspaces, ws["id"]),
              );
            }
            return page;
          });
        }
        // Normalize sidebar layout
        if (ws.sidebarLayout && Array.isArray(ws.sidebarLayout)) {
          ws.sidebarLayout = ws.sidebarLayout.map((layoutOG) =>
            LayoutModel(layoutOG, workspaces, ws["id"]),
          );
        }
        return WorkspaceModel(ws);
      });

      console.log(
        "Setting workspaceConfig with",
        workspacesTemp.length,
        "workspaces:",
        workspacesTemp,
      );
      setWorkspaceConfig(() => workspacesTemp);
      setIsLoadingWorkspaces(false);
    } catch (e) {
      console.log("handle load workspaces complete ERROR", e.message);
    }
  }

  function handleLoadWorkspacesError(e, message) {
    console.log("handleLoadWorkspacesError called", e, message);
    setWorkspaceConfig([]);
  }

  function handleWorkspaceChange(ws) {
    console.log(" dashboard workspace change", ws);
    if (ws) {
      const wsModel = WorkspaceModel(ws);
      setPreviewMode(() => false);

      // Update the tab's workspace reference
      if (activeTabId) {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  name: wsModel.name || "Untitled",
                  workspace: wsModel,
                }
              : tab,
          ),
        );
      }
    }
  }

  function handleProviderSelect(event) {
    /**
     * Callback from ProviderErrorBoundary when user selects a provider
     * event: { widgetId, selectedProviders: { "algolia": "Provider Name", ... } }
     *
     * Updates workspace.selectedProviders[widgetId] with the provider selections
     * and persists to dashboard config.
     *
     * Note: Credentials are stored separately in providers.json (encrypted)
     * This only stores the selected provider NAMES, not credentials.
     */
    console.log("Provider selected:", event);
    const { widgetId, selectedProviders: updatedProviders } = event;

    if (workspaceSelected && widgetId) {
      // Build widget-specific provider selections
      const currentSelections = workspaceSelected.selectedProviders || {};
      const updatedWorkspace = {
        ...workspaceSelected,
        selectedProviders: {
          ...currentSelections,
          [widgetId]: updatedProviders, // Store provider selections keyed by widgetId
        },
      };

      // Update the tab's workspace reference
      updateTabWorkspace(updatedWorkspace);

      // Persist to main app via IPC
      try {
        dashApi.saveWorkspace(
          credentials.appId,
          updatedWorkspace,
          (e, result) => {
            console.log("Workspace saved with provider selections:", result);
          },
          (e, error) => {
            console.error(
              "Failed to save workspace with provider selections:",
              error,
            );
          },
        );
      } catch (e) {
        console.error("Error saving workspace:", e);
      }
    }
  }

  // ─── Sidebar State ────────────────────────────────────────────────
  const sidebarEnabled = workspaceSelected?.sidebarEnabled || false;
  const sidebarLayout = workspaceSelected?.sidebarLayout || [];
  const sidebarWidth = workspaceSelected?.sidebarWidth || 280;
  const sidebarWorkspaceRef = useRef(null);

  function handleSidebarToggle(enabled) {
    if (!workspaceSelected) return;
    handleWorkspaceChange({
      ...workspaceSelected,
      sidebarEnabled: enabled,
    });
  }

  // ─── Page State ──────────────────────────────────────────────────
  const [activePageId, setActivePageId] = useState(null);

  const workspacePages = workspaceSelected?.pages || [];
  const hasPages = workspacePages.length > 0;

  // Memoize sorted pages so page object references stay stable across re-renders
  const sortedPagesForRender = useMemo(
    () =>
      hasPages
        ? [...workspacePages].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasPages,
      workspacePages.length,
      // Re-sort when page names/order change but not on every parent render
      workspacePages.map((p) => `${p.id}:${p.order}:${p.name}`).join(","),
    ],
  );
  const currentActivePageId =
    activePageId ||
    workspaceSelected?.activePageId ||
    (workspacePages[0]?.id ?? null);

  function handleAddPage() {
    if (!workspaceSelected) return;

    let existingPages = [...workspacePages];

    // If this is the first time adding a page to a single-page dashboard,
    // migrate the existing layout into page 1 first.
    if (existingPages.length === 0 && workspaceSelected.layout?.length > 0) {
      const page1 = {
        id: `page-${Date.now() - 1}`,
        name: workspaceSelected.name || "Page 1",
        order: 0,
        layout: workspaceSelected.layout,
      };
      existingPages = [page1];
    }

    const newPage = DashboardModel.createPage(
      `Page ${existingPages.length + 1}`,
    );
    newPage.order = existingPages.length;

    const updatedWorkspace = {
      ...workspaceSelected,
      pages: [...existingPages, newPage],
      activePageId: newPage.id,
    };
    setActivePageId(newPage.id);
    handleWorkspaceChange(updatedWorkspace);
  }

  function handleSwitchPage(pageId) {
    setActivePageId(pageId);
  }

  function handleRenamePage(pageId, newName) {
    if (!workspaceSelected) return;
    const updatedPages = workspacePages.map((p) =>
      p.id === pageId ? { ...p, name: newName } : p,
    );
    handleWorkspaceChange({ ...workspaceSelected, pages: updatedPages });
  }

  function handleDeletePage(pageId) {
    if (!workspaceSelected || workspacePages.length <= 1) return;
    const updatedPages = workspacePages.filter((p) => p.id !== pageId);
    const newActiveId =
      currentActivePageId === pageId
        ? updatedPages[0]?.id
        : currentActivePageId;
    setActivePageId(newActiveId);

    // If only one page remains, convert back to single-page mode
    if (updatedPages.length === 1) {
      handleWorkspaceChange({
        ...workspaceSelected,
        layout: updatedPages[0].layout,
        pages: [],
        activePageId: null,
      });
      setActivePageId(null);
      return;
    }

    handleWorkspaceChange({
      ...workspaceSelected,
      pages: updatedPages,
      activePageId: newActiveId,
    });
  }

  function handleReorderPages(reorderedPages) {
    if (!workspaceSelected) return;
    handleWorkspaceChange({
      ...workspaceSelected,
      pages: reorderedPages,
    });
  }

  // Track each page's current layout via per-page refs.
  // LayoutBuilder writes to workspaceRef on every internal change,
  // but in multi-page mode each page needs its own ref.
  const pageRefsMap = useRef({});

  function getPageRef(pageId) {
    if (!pageRefsMap.current[pageId]) {
      pageRefsMap.current[pageId] = { current: null };
    }
    return pageRefsMap.current[pageId];
  }

  const handlePageWorkspaceChange = useCallback((updatedWorkspace, pageId) => {
    // Store in per-page ref (used by save function)
    pageRefsMap.current[pageId] = { current: updatedWorkspace };
  }, []);

  // Keep stable callback refs current
  stableProviderSelectRef.current = handleProviderSelect;
  stableTogglePreviewRef.current = handleToggleEditMode;
  stableWidgetPopoutRef.current = handleWidgetPopout;

  // Stable callbacks for sidebar (avoids PinnedSidebar re-renders)
  const stableWorkspaceChangeRef = useRef(null);
  stableWorkspaceChangeRef.current = handleWorkspaceChange;
  const stableWorkspaceChange = useCallback(
    (...args) => stableWorkspaceChangeRef.current?.(...args),
    [],
  );
  const stableSwitchPageRef = useRef(null);
  stableSwitchPageRef.current = handleSwitchPage;
  const stableSwitchPage = useCallback(
    (...args) => stableSwitchPageRef.current?.(...args),
    [],
  );

  function renderComponent(workspaceItem) {
    try {
      if (workspaceItem === undefined) return null;

      // Multi-page mode
      if (hasPages) {
        return (
          <>
            {sortedPagesForRender.map((page) => {
              const isActive = page.id === currentActivePageId;
              return (
                <div
                  key={page.id}
                  style={{ display: isActive ? "flex" : "none" }}
                  className="flex-col w-full flex-1"
                >
                  <PageLayoutBuilder
                    page={page}
                    workspaceItem={workspaceItem}
                    previewMode={previewMode}
                    editMode={editMode}
                    onPageWorkspaceChange={handlePageWorkspaceChange}
                    onProviderSelect={stableProviderSelect}
                    onTogglePreview={stableTogglePreview}
                    workspaceRef={getPageRef(page.id)}
                    onWidgetPopout={stableWidgetPopout}
                  />
                </div>
              );
            })}
          </>
        );
      }

      // Single-page mode (backward compatible)
      return (
        <LayoutBuilder
          dashboardId={workspaceItem["id"]}
          preview={previewMode}
          workspace={workspaceItem}
          onWorkspaceChange={handleWorkspaceChange}
          onProviderSelect={handleProviderSelect}
          onTogglePreview={handleToggleEditMode}
          key={`LayoutBuilder-${workspaceItem["id"]}`}
          editMode={editMode}
          workspaceRef={currentWorkspaceRef}
          onWidgetPopout={popout ? null : handleWidgetPopout}
        />
      );
    } catch (e) {
      console.log(e);
      return null;
    }
  }

  function loadMenuItems() {
    try {
      console.log("loading menu items", credentials);
      setIsLoadingMenuItems(() => true);
      // we have to remove the widgetConfig which contains the component
      // sanitize the workspace layout remove widgetConfig items
      if (dashApi && credentials) {
        dashApi.listMenuItems(
          credentials.appId,
          handleListMenuItemComplete,
          handleListMenuItemError,
        );
      }
    } catch (e) {
      console.log("Error loading menu items", e.message);
    }
  }

  function handleListMenuItemComplete(e, message) {
    try {
      console.log("list menu items complete ", e, message);
      setMenuItems(() => message.menuItems);
      setIsLoadingMenuItems(() => false);
      if (message.menuItems.length === 0) openAppSettings("folders");
    } catch (error) {
      console.log("handle list menu items error ", error);
    }
  }

  function handleListMenuItemError(e, message) {
    setMenuItems(() => []);
    setIsLoadingMenuItems(() => false);
  }

  function handleSaveNewMenuItem(menuItem) {
    // we have to remove the widgetConfig which contains the component
    // sanitize the workspace layout remove widgetConfig items

    if (dashApi && credentials) {
      dashApi.saveMenuItem(
        credentials.appId,
        MenuItemModel(menuItem),
        handleSaveMenuItemComplete,
        handleSaveMenuItemError,
      );
    }
  }

  function handleSaveMenuItemComplete(e, message) {
    loadMenuItems();
  }

  function handleSaveMenuItemError(e, message) {
    console.log(e, message);
  }

  function handleToggleEditMode() {
    if (previewMode) {
      // Entering edit mode — snapshot the current workspace
      originalWorkspaceRef.current = deepCopy(workspaceSelected);
      setPreviewMode(false);
    } else {
      // Canceling edit mode — restore original workspace
      if (originalWorkspaceRef.current) {
        updateTabWorkspace(originalWorkspaceRef.current);
      }
      currentWorkspaceRef.current = null;
      originalWorkspaceRef.current = null;
      setPreviewMode(true);
    }
  }

  function handleWorkspaceNameChange(name) {
    console.log("workspace name change ", name);
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    tempWorkspace["name"] = name;

    // Update the tab name and workspace reference
    updateTabWorkspace(tempWorkspace);
  }

  function handleWorkspaceFolderChange(menuId) {
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    tempWorkspace["menuId"] = Number(menuId);
    updateTabWorkspace(tempWorkspace);
  }

  function handleWorkspaceThemeChange(themeKey) {
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    tempWorkspace["themeKey"] = themeKey || null;
    updateTabWorkspace(tempWorkspace);
  }

  function handleScrollableChange(enabled) {
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    // Find the root grid container layout item
    const rootItem = tempWorkspace.layout?.find((item) => item.parent === 0);
    if (rootItem) {
      rootItem.scrollable = enabled;
    }
    // Update ref immediately so getRootScrollable() reads the new value
    // before LayoutBuilder's async useEffect syncs it
    currentWorkspaceRef.current = tempWorkspace;
    updateTabWorkspace(tempWorkspace);
  }

  // Derive scrollable state from root layout item
  function getRootScrollable() {
    const ws = currentWorkspaceRef.current || workspaceSelected;
    if (!ws?.layout) return false;
    const rootItem = ws.layout.find((item) => item.parent === 0);
    return rootItem?.scrollable || false;
  }

  function handleClickSaveWorkspace() {
    try {
      console.log("dashboard clicked save workspace ", workspaceSelected);
      // we have to remove the widgetConfig which contains the component
      // sanitize the workspace layout remove widgetConfig items
      let workspaceToSave;

      if (hasPages) {
        // Multi-page: gather latest layout from each page's LayoutBuilder ref
        workspaceToSave = deepCopy(workspaceSelected);
        workspaceToSave.pages = (workspaceToSave.pages || []).map((page) => {
          const pageRef = pageRefsMap.current[page.id];
          const latestLayout = pageRef?.current?.layout || page.layout || [];
          return {
            ...page,
            layout: latestLayout.map((item) => {
              const copy = { ...item };
              delete copy.widgetConfig;
              return copy;
            }),
          };
        });
        workspaceToSave.activePageId = currentActivePageId;
        // Also sanitize the root layout (may be stale from pre-pages era)
        workspaceToSave.layout = (workspaceToSave.layout || []).map((item) => {
          const copy = { ...item };
          delete copy.widgetConfig;
          return copy;
        });
      } else {
        // Single-page: use workspaceRef as before
        workspaceToSave = deepCopy(
          currentWorkspaceRef.current || workspaceSelected,
        );
        const layout = workspaceToSave["layout"].map((layoutItem) => {
          delete layoutItem["widgetConfig"];
          return layoutItem;
        });
        workspaceToSave["layout"] = layout;
      }

      // Gather sidebar layout from its LayoutBuilder ref
      if (sidebarWorkspaceRef.current?.layout) {
        workspaceToSave.sidebarLayout = sidebarWorkspaceRef.current.layout.map(
          (item) => {
            const copy = { ...item };
            delete copy.widgetConfig;
            return copy;
          },
        );
      }

      // Clean orphaned layout items and stale listener references before save
      const dashboardForCleanup = new DashboardModel(workspaceToSave);
      dashboardForCleanup.cleanOrphanedItems();
      workspaceToSave = dashboardForCleanup.workspace();

      // lets set a version so that we can compare...
      workspaceToSave["version"] = Date.now();

      if (dashApi && credentials) {
        dashApi.saveWorkspace(
          credentials.appId,
          workspaceToSave,
          handleSaveWorkspaceComplete,
          handleSaveWorkspaceError,
        );
      }
    } catch (e) {
      console.log(e.message);
    }
  }

  function handleSaveWorkspaceComplete(e, message) {
    console.log("handle save complete ", e, message);

    // Reconstruct workspaces through LayoutModel (same as load path)
    const workspaces = deepCopy(message["workspaces"]);
    const workspacesTemp = workspaces.map((ws) => {
      const tempLayout = ws["layout"].map((layoutOG) => {
        return LayoutModel(layoutOG, workspaces, ws["id"]);
      });
      ws["layout"] = tempLayout;
      return WorkspaceModel(ws);
    });

    pub.pub("dashboard.workspaceChange", {
      workspaces: workspacesTemp,
    });
    setWorkspaceConfig(() => workspacesTemp);
    setIsLoadingWorkspaces(false);

    // Update the active tab with the fresh saved workspace (not stale closure)
    if (workspaceSelected && activeTabId) {
      const savedWs = workspacesTemp.find(
        (ws) => ws.id === workspaceSelected.id,
      );
      if (savedWs) {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  name: savedWs.name || "Untitled",
                  workspace: savedWs,
                }
              : tab,
          ),
        );
      }
    }

    // Clear edit-mode refs — edits are now persisted
    currentWorkspaceRef.current = null;
    originalWorkspaceRef.current = null;

    setPreviewMode(() => true);
  }

  function handleSaveWorkspaceError(e, message) {
    console.log(e, message);
  }

  function handleOpenThemeManager() {
    setIsThemeManagerOpen(true);
  }

  function handleSelectLoadDashboard(dashboardSelected) {
    try {
      const newLayout = dashboardSelected.layout;
      const workspaceItem = WorkspaceModel({ layout: newLayout });

      console.log("clicked load workspace item", workspaceItem);
      setPreviewMode(() => false);
      handleOpenTab(workspaceItem);
      setIsDashboardLoaderOpen(false);
    } catch (e) {
      console.log(e);
    }
  }

  function handleCloseDashboardLoader() {
    setIsDashboardLoaderOpen(false);
  }

  function handleToggleThemeVariant() {
    changeThemeVariant(themeVariant === "dark" ? "light" : "dark");
  }

  async function handleSidebarSignIn() {
    try {
      const flow = await window.mainApi.registryAuth.initiateLogin();
      if (flow.verificationUrlComplete) {
        window.mainApi.shell.openExternal(flow.verificationUrlComplete);
      }
      const interval = (flow.interval || 5) * 1000;
      const poll = setInterval(async () => {
        try {
          const result = await window.mainApi.registryAuth.pollToken(
            flow.deviceCode,
          );
          if (result.status === "authorized") {
            clearInterval(poll);
            const profile = await window.mainApi.registryAuth.getProfile();
            setAuthProfile(profile);
            setAuthStatus("authenticated");
          } else if (result.status === "expired") {
            clearInterval(poll);
          }
        } catch {
          clearInterval(poll);
        }
      }, interval);
    } catch (err) {
      console.error("[DashboardStage] Sign-in error:", err);
    }
  }

  async function handleSidebarSignOut() {
    try {
      await window.mainApi.registryAuth.logout();
      setAuthStatus("unauthenticated");
      setAuthProfile(null);
    } catch (err) {
      console.error("[DashboardStage] Sign-out error:", err);
    }
  }

  function handlePopout() {
    if (workspaceSelected && window.mainApi?.popout?.open) {
      window.mainApi.popout.open(workspaceSelected.id);
    }
  }

  function handleWidgetPopout(widgetId) {
    if (workspaceSelected && window.mainApi?.widgetPopout?.open) {
      window.mainApi.widgetPopout.open(workspaceSelected.id, widgetId);
    }
  }

  return (
    <LayoutContainer
      padding={false}
      space={false}
      height="h-full"
      width="w-full"
      direction="col"
      scrollable={false}
      grow={true}
    >
      {/* ─── Main Content Area ──────────────────────── */}
      <DndProvider backend={HTML5Backend}>
        <div className="flex flex-row flex-1 overflow-hidden">
          {!popout && (
            <DashSidebar
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
              workspaces={workspaceConfig}
              menuItems={menuItems}
              activeTabId={activeTabId}
              recentDashboards={recentDashboards}
              authStatus={authStatus}
              authProfile={authProfile}
              onOpenWorkspace={handleOpenTab}
              onNewDashboard={() => setIsLayoutPickerOpen(true)}
              onOpenSettings={() => openAppSettings("general")}
              onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
              onSignIn={handleSidebarSignIn}
              onSignOut={handleSidebarSignOut}
            />
          )}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {workspaceSelected !== null ? (
              <>
                <DashboardHeader
                  workspace={workspaceSelected}
                  preview={popout ? true : previewMode}
                  onNameChange={handleWorkspaceNameChange}
                  onClickEdit={popout ? null : handleToggleEditMode}
                  onPopout={popout ? null : handlePopout}
                  onSaveChanges={popout ? null : handleClickSaveWorkspace}
                  menuItems={menuItems}
                  themes={themes || {}}
                  onFolderChange={popout ? null : handleWorkspaceFolderChange}
                  onThemeChange={popout ? null : handleWorkspaceThemeChange}
                  scrollableEnabled={getRootScrollable()}
                  onScrollableChange={popout ? null : handleScrollableChange}
                  sidebarEnabled={sidebarEnabled}
                  onSidebarChange={popout ? null : handleSidebarToggle}
                />
                <DashboardThemeProvider themeKey={workspaceSelected?.themeKey}>
                  {/* Missing widgets banner */}
                  {hasMissing &&
                    missingComponents.length >= 2 &&
                    !dismissedMissingForWorkspace.has(
                      workspaceSelected?.id,
                    ) && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
                        <FontAwesomeIcon
                          icon="triangle-exclamation"
                          className="h-3.5 w-3.5 text-amber-400 flex-shrink-0"
                        />
                        <span className="text-xs text-amber-300/90 flex-1">
                          {missingComponents.length} widgets are missing from
                          this dashboard.
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsMissingWidgetsModalOpen(true)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDismissedMissingForWorkspace(
                              (prev) =>
                                new Set([...prev, workspaceSelected?.id]),
                            )
                          }
                          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <FontAwesomeIcon icon="xmark" className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  {(hasPages || !previewMode) && (
                    <PageTabBar
                      pages={workspacePages}
                      activePageId={currentActivePageId}
                      onSwitchPage={handleSwitchPage}
                      onAddPage={handleAddPage}
                      onRenamePage={handleRenamePage}
                      onDeletePage={handleDeletePage}
                      onReorderPages={handleReorderPages}
                      editMode={!previewMode}
                    />
                  )}
                  <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
                    {sidebarEnabled && !popout && (
                      <PinnedSidebar
                        pages={workspacePages}
                        activePageId={currentActivePageId}
                        onSwitchPage={stableSwitchPage}
                        sidebarLayout={sidebarLayout}
                        workspace={workspaceSelected}
                        width={sidebarWidth}
                        editMode={!previewMode}
                        onWorkspaceChange={stableWorkspaceChange}
                        onProviderSelect={stableProviderSelect}
                        onTogglePreview={stableTogglePreview}
                        onWidgetPopout={stableWidgetPopout}
                        sidebarRef={sidebarWorkspaceRef}
                      />
                    )}
                    <div
                      className={`flex flex-col w-full flex-1 ${
                        popout || previewMode === true
                          ? "overflow-y-auto"
                          : "overflow-clip"
                      }`}
                    >
                      {renderComponent(workspaceSelected)}
                    </div>
                  </div>
                </DashboardThemeProvider>
                {!popout && (
                  <DashTabBar
                    tabs={openTabs}
                    activeTabId={activeTabId}
                    onSwitchTab={handleSwitchTab}
                    onCloseTab={handleCloseTab}
                  />
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<FontAwesomeIcon icon="clone" className="h-12 w-12" />}
                  title={popout ? "Dashboard not found" : "No dashboards open"}
                  description={
                    popout
                      ? "The requested dashboard could not be loaded."
                      : "Press \u2318K to search dashboards, or create a new one."
                  }
                >
                  {!popout && (
                    <div className="flex flex-row gap-2">
                      <ButtonIcon
                        icon="magnifying-glass"
                        text="Search"
                        onClick={() => setIsCommandPaletteOpen(true)}
                        size="sm"
                      />
                      <ButtonIcon
                        icon="plus"
                        text="New Dashboard"
                        onClick={handleClickNewFromEmpty}
                        size="sm"
                      />
                      <ButtonIcon
                        icon="wand-magic-sparkles"
                        text="Wizard"
                        onClick={() => setIsWizardOpen(true)}
                        size="sm"
                      />
                    </div>
                  )}
                </EmptyState>
              </div>
            )}
          </div>
          {!popout && !previewMode && workspaceSelected && (
            <WidgetSidebar
              collapsed={widgetSidebarCollapsed}
              onCollapsedChange={setWidgetSidebarCollapsed}
            />
          )}
        </div>

        {/* ─── Modals (hidden in popout mode) ────────── */}
        {!popout && (
          <>
            <AppSettingsModal
              isOpen={isAppSettingsOpen}
              setIsOpen={(open) => {
                setIsAppSettingsOpen(open);
                if (!open) {
                  setAppSettingsInitialProvider(null);
                  setAppSettingsCreateProvider(false);
                }
              }}
              initialSection={appSettingsInitialSection}
              initialProviderName={appSettingsInitialProvider}
              initialCreateProvider={appSettingsCreateProvider}
              workspaces={workspaceConfig}
              menuItems={menuItems}
              dashApi={dashApi}
              credentials={credentials}
              onReloadWorkspaces={loadWorkspaces}
              onReloadMenuItems={loadMenuItems}
              onOpenWorkspace={(ws) => {
                handleOpenTab(ws);
                setIsAppSettingsOpen(false);
              }}
              onOpenThemeEditor={() => {
                setIsAppSettingsOpen(false);
                setIsThemeManagerOpen(true);
              }}
              authStatus={authStatus}
              authProfile={authProfile}
              onSignIn={handleSidebarSignIn}
              onSignOut={handleSidebarSignOut}
              onProfileUpdated={handleProfileUpdated}
              onOpenWizard={() => setIsWizardOpen(true)}
            />

            <ThemeManagerModal
              open={isThemeManagerOpen}
              setIsOpen={() => setIsThemeManagerOpen(!isThemeManagerOpen)}
              onSave={(themeKey) => {
                changeCurrentTheme(themeKey);
                setIsThemeManagerOpen(() => false);
              }}
            />

            <DashboardLoaderModal
              open={isDashboardLoaderOpen}
              setIsOpen={setIsDashboardLoaderOpen}
              workspaces={workspaceConfig}
              onSelecDashboard={handleSelectLoadDashboard}
              onClose={() => handleCloseDashboardLoader()}
            />

            <LayoutManagerModal
              open={isLayoutPickerOpen}
              setIsOpen={setIsLayoutPickerOpen}
              onCreateWorkspace={handleCreateFromTemplate}
              menuItems={menuItems}
              onSaveMenuItem={handleSaveNewMenuItem}
              appId={credentials?.appId}
              onReloadWorkspaces={loadWorkspaces}
              onOpenWorkspace={handleOpenTab}
              onOpenWizard={() => setIsWizardOpen(true)}
            />

            <DashboardWizardModal
              open={isWizardOpen}
              setIsOpen={setIsWizardOpen}
              menuItems={menuItems}
              onSaveMenuItem={handleSaveNewMenuItem}
              onCreateWorkspace={handleCreateFromTemplate}
              onOpenDashboard={handleOpenTab}
              onReloadWorkspaces={loadWorkspaces}
              appId={credentials?.appId}
            />

            <MissingWidgetsModal
              missingComponents={missingComponents}
              isOpen={isMissingWidgetsModalOpen}
              setIsOpen={setIsMissingWidgetsModalOpen}
              onInstallComplete={() => {
                setDismissedMissingForWorkspace(
                  (prev) => new Set([...prev, workspaceSelected?.id]),
                );
              }}
            />
          </>
        )}
      </DndProvider>

      {/* ─── CommandPalette Overlay (hidden in popout mode) ── */}
      {!popout && (
        <DashCommandPalette
          isOpen={isCommandPaletteOpen}
          setIsOpen={setIsCommandPaletteOpen}
          workspaces={workspaceConfig}
          openTabs={openTabs}
          menuItems={menuItems}
          onOpenWorkspace={handleOpenTab}
          onCreateNewWorkspace={handleClickNewFromEmpty}
          onCreateNewFolder={() => openAppSettings("folders")}
          onLoadDashboard={() => setIsDashboardLoaderOpen(true)}
          providers={appContext?.providers || {}}
          onCreateNewProvider={() => openAppSettings("providers", null, true)}
          onOpenProviderDetail={(name) => openAppSettings("providers", name)}
          themes={themes || {}}
          currentThemeKey={themeKey}
          themeVariant={themeVariant}
          onChangeTheme={changeCurrentTheme}
          onOpenThemeManager={handleOpenThemeManager}
          onToggleThemeVariant={handleToggleThemeVariant}
          onOpenSettings={() => openAppSettings("general")}
          debugMode={appContext?.debugMode || false}
          onToggleDebugMode={() =>
            appContext?.changeDebugMode &&
            appContext.changeDebugMode(!appContext.debugMode)
          }
          onOpenDiscover={() => openAppSettings("widgets")}
          onOpenWizard={() => setIsWizardOpen(true)}
        />
      )}
    </LayoutContainer>
  );
};
