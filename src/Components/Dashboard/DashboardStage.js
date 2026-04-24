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
  Toast,
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
import { DashboardConfigModal } from "./DashboardConfigModal";
import {
  forEachWidget,
  getUnresolvedProviders,
} from "../../utils/providerResolution";
import { applyWiringChanges } from "../../utils/listenerResolution";
import { reconcileWorkspaceAfterLayoutChange } from "../../utils/workspaceReconciliation";
import { moveWidgetAcrossContainers } from "../../utils/layout";
import { ComponentManager } from "../../ComponentManager";

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
  renderAiAssistant = null,
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
          renderAiAssistant={renderAiAssistant}
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
  renderAiAssistant = null,
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

  // ─── In-app toasts (driven by DashboardActionsApi.notify) ────────
  const [toasts, setToasts] = useState([]);

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

  // Dashboard Config modal — bulk provider wiring for the current
  // workspace. Auto-opens on first load of a workspace with unresolved
  // providers (tracked per session via `configModalAutoOpenedFor` so
  // switching tabs doesn't re-fire the modal).
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const configModalAutoOpenedFor = useRef(new Set());
  const [dismissedUnresolvedForWorkspace, setDismissedUnresolvedForWorkspace] =
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

  // ─── Listen for external "apply theme" requests ─────────────────
  // MCP-driven apply_theme updates settings in the main process; this
  // listener pulls the new theme into ThemeContext without a remount.
  useEffect(() => {
    const handler = (e) => {
      const themeKey = e?.detail?.themeKey;
      if (themeKey && typeof changeCurrentTheme === "function") {
        changeCurrentTheme(themeKey);
      }
    };
    window.addEventListener("dash:apply-theme", handler);
    return () => window.removeEventListener("dash:apply-theme", handler);
  }, [changeCurrentTheme]);

  // ─── Listen for external "open workspace" requests ──────────────
  // Fired by: Dash.js notification click, MCP state-changed for
  // create_dashboard, etc. Any code that wants to switch the active
  // dashboard from outside this component dispatches
  //   window.dispatchEvent(new CustomEvent("dash:navigate-workspace",
  //     { detail: { workspaceId: <number> } }))
  // We record the requested ID and open it once it appears in
  // workspaceConfig — handles the case where the workspace was just
  // created and the config reload is still in flight.
  const [pendingOpenWorkspaceId, setPendingOpenWorkspaceId] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const id = e?.detail?.workspaceId;
      if (id != null) setPendingOpenWorkspaceId(Number(id));
    };
    window.addEventListener("dash:navigate-workspace", handler);
    return () => window.removeEventListener("dash:navigate-workspace", handler);
  }, []);
  useEffect(() => {
    if (pendingOpenWorkspaceId == null) return;
    const ws = workspaceConfig.find(
      (w) => Number(w.id) === Number(pendingOpenWorkspaceId),
    );
    if (ws) {
      handleOpenTab(ws);
      setPendingOpenWorkspaceId(null);
    }
    // If not found yet, keep the pending ID and wait for the next
    // workspaceConfig update (workspace:saved triggers a reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenWorkspaceId, workspaceConfig]);

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

  // ─── Cross-container widget drag/drop ─────────────────────────────
  // Each LayoutBuilder (main dashboard + pinned sidebar) only owns one
  // bucket of the workspace. A drop across them (sidebar ↔ main grid)
  // fires a "dash:cross-container-widget-move" window CustomEvent from
  // LayoutGridContainer's drop handler. We listen here, at the level
  // that owns the full workspace, rewire both grid cells + move the
  // widget layout item between buckets via moveWidgetAcrossContainers,
  // and save once.
  useEffect(() => {
    if (popout) return;
    const handler = (e) => {
      const detail = e?.detail || {};
      if (!workspaceSelected) return;

      // CRITICAL: LayoutBuilder edits (deletes, same-container moves,
      // new widget drops) live in each LayoutBuilder's internal state
      // and propagate upward only via refs — they never write back
      // into `workspaceSelected`. So we must overlay the LIVE refs
      // before applying the cross-container move, otherwise we'd base
      // the move on stale state and clobber the user's unsaved edits
      // (they'd see deleted widgets reappear after a cross-container
      // drop). This mirrors `handleClickSaveWorkspace`'s own logic.
      let liveWorkspace = JSON.parse(JSON.stringify(workspaceSelected));
      liveWorkspace.pages = (liveWorkspace.pages || []).map((page) => {
        const pageRef = pageRefsMap.current[page.id];
        const liveLayout = pageRef?.current?.layout;
        return liveLayout ? { ...page, layout: liveLayout } : page;
      });
      if (
        sidebarWorkspaceRef.current?.layout &&
        Array.isArray(sidebarWorkspaceRef.current.layout)
      ) {
        liveWorkspace.sidebarLayout = sidebarWorkspaceRef.current.layout;
      }

      const updated = moveWidgetAcrossContainers(
        liveWorkspace,
        detail.sourceGridContainerId,
        detail.sourceCellNumber,
        detail.targetGridContainerId,
        detail.targetCellNumber,
      );
      if (!updated) {
        console.warn(
          "[DashboardStage] cross-container move failed — grid containers not found",
          detail,
        );
        return;
      }

      // Sync the refs so when LayoutBuilder's useEffect re-seeds
      // currentWorkspace from the new workspace prop below, and the
      // refs are also updated for the next save/cross-move.
      (updated.pages || []).forEach((page) => {
        if (!pageRefsMap.current[page.id]) {
          pageRefsMap.current[page.id] = { current: null };
        }
        pageRefsMap.current[page.id].current = { layout: page.layout };
      });
      if (sidebarWorkspaceRef.current) {
        sidebarWorkspaceRef.current = {
          ...(sidebarWorkspaceRef.current || {}),
          layout: updated.sidebarLayout || [],
        };
      }

      // Reconcile cross-widget state before persisting. Cross-container
      // moves can orphan listener bindings and provider entries when a
      // widget ends up outside the layout during the move.
      const reconciled = reconcileWorkspaceAfterLayoutChange(updated);
      updateTabWorkspace(reconciled);

      if (dashApi && credentials?.appId) {
        try {
          dashApi.saveWorkspace(
            credentials.appId,
            reconciled,
            () =>
              console.log(
                `[DashboardStage] Cross-container move saved (${detail.sourceScope} → ${detail.targetScope})`,
              ),
            (err) =>
              console.error(
                "[DashboardStage] Cross-container move save failed:",
                err,
              ),
          );
        } catch (err) {
          console.error(
            "[DashboardStage] Cross-container move save threw:",
            err,
          );
        }
      }
    };
    window.addEventListener("dash:cross-container-widget-move", handler);
    return () =>
      window.removeEventListener("dash:cross-container-widget-move", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout, workspaceSelected, dashApi, credentials?.appId]);

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
      // LayoutModel returns null when normalization throws (e.g. a
      // widget config that references a component the registry can't
      // resolve yet — common right after a fresh dashboard install
      // where some widgets are still downloading). Filter nulls so
      // every renderer that walks the layout sees only well-formed
      // items and never crashes on `Cannot read properties of null
      // (reading 'type')` or similar.
      const workspacesTemp = workspaces.map((ws) => {
        ws["layout"] = (ws["layout"] || [])
          .map((layoutOG) => LayoutModel(layoutOG, workspaces, ws["id"]))
          .filter((item) => item != null);
        if (ws.pages && Array.isArray(ws.pages)) {
          ws.pages = ws.pages.map((page) => {
            if (page.layout && Array.isArray(page.layout)) {
              page.layout = page.layout
                .map((layoutOG) => LayoutModel(layoutOG, workspaces, ws["id"]))
                .filter((item) => item != null);
            }
            return page;
          });
        }
        if (ws.sidebarLayout && Array.isArray(ws.sidebarLayout)) {
          ws.sidebarLayout = ws.sidebarLayout
            .map((layoutOG) => LayoutModel(layoutOG, workspaces, ws["id"]))
            .filter((item) => item != null);
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
      // Also sync fresh workspace data into any open tabs. Without this,
      // MCP-driven mutations (update_layout, add_widget, etc.) update the
      // config but the active tab keeps its stale snapshot — users only
      // see the change after closing and reopening the tab.
      setOpenTabs((prevTabs) =>
        prevTabs.map((tab) => {
          const fresh = workspacesTemp.find(
            (w) => Number(w.id) === Number(tab.id),
          );
          if (!fresh) return tab; // workspace was deleted; leave tab for handleCloseTab to reap
          return {
            ...tab,
            name: fresh.name || tab.name,
            workspace: fresh,
          };
        }),
      );
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

      // Mirror the change into the layout refs so the save path always
      // sees the same truth regardless of whether it reads from refs or
      // state. Previously a mutation that propagated via
      // onWorkspaceChange (drag-drop, swap, place, delete) would update
      // openTabs but leave sidebarWorkspaceRef/pageRefsMap stale, and
      // `handleClickSaveWorkspace` reads from those refs FIRST — so it
      // clobbered the new sidebarLayout with the stale ref contents on
      // save. Keeping everything in sync here closes that window.
      if (Array.isArray(wsModel.sidebarLayout)) {
        sidebarWorkspaceRef.current = {
          ...(sidebarWorkspaceRef.current || {}),
          layout: wsModel.sidebarLayout,
        };
      }
      if (Array.isArray(wsModel.pages)) {
        for (const page of wsModel.pages) {
          if (!page || !page.id || !Array.isArray(page.layout)) continue;
          if (!pageRefsMap.current[page.id]) {
            pageRefsMap.current[page.id] = { current: null };
          }
          pageRefsMap.current[page.id].current = {
            ...(pageRefsMap.current[page.id].current || {}),
            layout: page.layout,
          };
        }
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

      const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
      // Update the tab's workspace reference
      updateTabWorkspace(reconciled);

      // Persist to main app via IPC
      try {
        dashApi.saveWorkspace(
          credentials.appId,
          reconciled,
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

  // ─── Bulk provider binding save (Dashboard Config modal) ──────────
  // Takes [{ widgetId, providerType, providerName }] and writes the
  // updated workspace ONCE via saveWorkspace — avoids N round-trips
  // that the per-widget handleProviderSelect would produce for a
  // bulk-assign.
  function handleBulkProviderBindings(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    if (!workspaceSelected || !dashApi || !credentials?.appId) return;

    // Start from the current map, layer changes on top.
    const nextSelectedProviders = {
      ...(workspaceSelected.selectedProviders || {}),
    };
    for (const { widgetId, providerType, providerName } of changes) {
      if (!widgetId || !providerType) continue;
      const prevForWidget = nextSelectedProviders[widgetId]
        ? { ...nextSelectedProviders[widgetId] }
        : {};
      if (providerName) {
        prevForWidget[providerType] = providerName;
      } else {
        // Empty string means "clear" — remove the binding so it falls
        // back to app default (or null) on next resolve.
        delete prevForWidget[providerType];
      }
      nextSelectedProviders[widgetId] = prevForWidget;
    }

    const updatedWorkspace = {
      ...workspaceSelected,
      selectedProviders: nextSelectedProviders,
    };
    const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
    updateTabWorkspace(reconciled);

    try {
      dashApi.saveWorkspace(
        credentials.appId,
        reconciled,
        (e, result) =>
          console.log("Workspace saved with bulk provider bindings:", result),
        (e, error) =>
          console.error(
            "Failed to save workspace with bulk provider bindings:",
            error,
          ),
      );
    } catch (e) {
      console.error("Error saving workspace:", e);
    }
  }

  // ─── Bulk widget userPrefs save ───────────────────────────────────
  // Takes an array of `{ widgetId, key, value }` from the Dashboard
  // Config modal's Widgets tab and writes every change to the correct
  // widget instance's `userPrefs` in one workspace mutation. Mirrors
  // the pattern in handleBulkProviderBindings — the Widgets tab stages
  // edits in-memory so a bulk-apply across many widgets persists as a
  // single saveWorkspace round-trip instead of N.
  function handleBulkUserPrefs(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    if (!workspaceSelected || !dashApi || !credentials?.appId) return;

    // Group changes by widgetId so we can patch each item once.
    const byWidget = new Map();
    for (const { widgetId, key, value } of changes) {
      if (!widgetId || !key) continue;
      if (!byWidget.has(widgetId)) byWidget.set(widgetId, {});
      byWidget.get(widgetId)[key] = value;
    }

    // Deep-clone the workspace, then walk every item and patch
    // userPrefs in place when its uuidString/uuid/id is in byWidget.
    // Uses forEachWidget's walk under the hood by visiting each item
    // in the cloned containers.
    const updatedWorkspace = JSON.parse(JSON.stringify(workspaceSelected));
    const patchItem = (item) => {
      if (!item || !item.component) return;
      const id = item.uuidString || item.uuid || item.id;
      if (!id || !byWidget.has(id)) return;
      const patch = byWidget.get(id);
      item.userPrefs = { ...(item.userPrefs || {}), ...patch };
    };
    forEachWidget(updatedWorkspace, patchItem);

    const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
    updateTabWorkspace(reconciled);

    try {
      dashApi.saveWorkspace(
        credentials.appId,
        reconciled,
        (e, result) =>
          console.log("Workspace saved with bulk userPrefs:", result),
        (e, error) =>
          console.error("Failed to save workspace with bulk userPrefs:", error),
      );
    } catch (e) {
      console.error("Error saving workspace:", e);
    }
  }

  // ─── Bulk listener binding save ──────────────────────────────────
  // Takes { adds, removes } from the Dashboard Config modal's
  // Listeners tab and writes the updated workspace once. Applies the
  // delta via applyWiringChanges (uses item.listeners directly so the
  // existing PanelEditItemHandlers / runtime stays consistent).
  function handleBulkListenerBindings(changes) {
    if (!workspaceSelected || !dashApi || !credentials?.appId) return;
    if (
      !changes ||
      ((!changes.adds || changes.adds.length === 0) &&
        (!changes.removes || changes.removes.length === 0))
    ) {
      return;
    }

    const updatedWorkspace = applyWiringChanges(workspaceSelected, changes);
    const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
    updateTabWorkspace(reconciled);

    try {
      dashApi.saveWorkspace(
        credentials.appId,
        reconciled,
        (e, result) =>
          console.log("Workspace saved with bulk listener bindings:", result),
        (e, error) =>
          console.error(
            "Failed to save workspace with bulk listener bindings:",
            error,
          ),
      );
    } catch (e) {
      console.error("Error saving workspace:", e);
    }
  }

  // ─── Unresolved providers + listener orphans (modal + auto-open) ─
  const unresolvedProviders = useMemo(
    () =>
      getUnresolvedProviders({
        workspace: workspaceSelected,
        appProviders: appContext?.providers || {},
        getWidgetRequirements: (name) =>
          (name && ComponentManager.componentMap()[name]?.providers) || [],
      }),
    [workspaceSelected, appContext?.providers],
  );
  const unresolvedProvidersCount = unresolvedProviders.length;
  // Listener orphans are pruned in WorkspaceModel / DashboardModel at
  // load time, so the badge only counts unresolved provider bindings.
  const unresolvedCount = unresolvedProvidersCount;

  // (No auto-open.) Earlier versions popped the modal on first load
  // when anything was unresolved — turned out to be jarring,
  // especially on dashboards that had a long-standing orphan list.
  // Awareness is delivered passively now: the gear icon's amber dot
  // and the banner. The user opens the modal when they're ready.

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

  // Page history stack for goBack() — pushes the previous page id
  // whenever a navigation happens through navigateToPage().
  const pageHistoryRef = useRef([]);

  // Reset local activePageId when the active tab changes so the next
  // render falls back to the new workspace's saved activePageId
  // (or its first page). Without this, a stale activePageId from a
  // previously-active dashboard would prevent the new dashboard's
  // pages from rendering (no page matches → all hidden).
  useEffect(() => {
    setActivePageId(null);
    pageHistoryRef.current = [];
  }, [activeTabId]);

  // Wrapper that records history before switching pages.
  // Pass recordHistory=false to switch without recording (e.g. for goBack).
  const navigateToPage = useCallback(
    (pageId, recordHistory = true) => {
      if (!pageId) return;
      if (recordHistory) {
        const prevId =
          activePageId ||
          workspaceSelected?.activePageId ||
          (workspaceSelected?.pages?.[0]?.id ?? null);
        if (prevId && prevId !== pageId) {
          pageHistoryRef.current.push(prevId);
        }
      }
      setActivePageId(pageId);
    },
    [activePageId, workspaceSelected?.activePageId, workspaceSelected?.pages],
  );

  // Listen for programmatic page switches via DashboardActionsApi
  useEffect(() => {
    function onSwitchPage(e) {
      const { pageId, pageName } = e.detail || {};
      if (pageId) {
        navigateToPage(pageId);
      } else if (pageName) {
        const pages = workspaceSelected?.pages || [];
        const match = pages.find(
          (p) => p.name.toLowerCase() === pageName.toLowerCase(),
        );
        if (match) navigateToPage(match.id);
      }
    }
    window.addEventListener("dash:switch-page", onSwitchPage);
    return () => window.removeEventListener("dash:switch-page", onSwitchPage);
  }, [workspaceSelected?.pages, navigateToPage]);

  // Listen for runtime UX actions: goBack, sidebar control, notify
  useEffect(() => {
    function onGoBack() {
      const prev = pageHistoryRef.current.pop();
      if (prev) setActivePageId(prev); // bypass history recording
    }
    function onSetNavSidebar(e) {
      setSidebarCollapsed(!!e.detail?.collapsed);
    }
    function onToggleNavSidebar() {
      setSidebarCollapsed((c) => !c);
    }
    function onNotify(e) {
      const id = `${Date.now()}-${Math.random()}`;
      const toast = { id, ...(e.detail || {}) };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, toast.duration || 4000);
    }
    window.addEventListener("dash:go-back", onGoBack);
    window.addEventListener("dash:set-nav-sidebar", onSetNavSidebar);
    window.addEventListener("dash:toggle-nav-sidebar", onToggleNavSidebar);
    window.addEventListener("dash:notify", onNotify);
    return () => {
      window.removeEventListener("dash:go-back", onGoBack);
      window.removeEventListener("dash:set-nav-sidebar", onSetNavSidebar);
      window.removeEventListener("dash:toggle-nav-sidebar", onToggleNavSidebar);
      window.removeEventListener("dash:notify", onNotify);
    };
  }, []);

  const workspacePages = workspaceSelected?.pages || [];

  // Memoize sorted pages so page object references stay stable across re-renders.
  // Depend on `workspaceSelected` so the memo invalidates whenever the workspace
  // is refreshed (e.g. after an MCP-driven layout/widget change). Without this,
  // PageLayoutBuilder's React.memo would see the same page reference and skip
  // re-rendering even though the page's layout array changed underneath.
  const sortedPagesForRender = useMemo(
    () => [...workspacePages].sort((a, b) => (a.order || 0) - (b.order || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      workspaceSelected,
      workspacePages.length,
      workspacePages.map((p) => `${p.id}:${p.order}:${p.name}`).join(","),
    ],
  );
  const currentActivePageId =
    activePageId ||
    workspaceSelected?.activePageId ||
    (workspacePages[0]?.id ?? null);

  // Stable refs for tab/dashboard handlers so the open/close-dashboard
  // listener doesn't have to re-subscribe on every render.
  const handleOpenTabRef = useRef(null);
  const handleCloseTabRef = useRef(null);
  const workspaceConfigRef = useRef([]);
  const openTabsRef = useRef([]);
  const activeTabIdRef = useRef(null);
  handleOpenTabRef.current = handleOpenTab;
  handleCloseTabRef.current = handleCloseTab;
  workspaceConfigRef.current = workspaceConfig;
  openTabsRef.current = openTabs;
  activeTabIdRef.current = activeTabId;

  // Listen for open/close dashboard actions via DashboardActionsApi
  useEffect(() => {
    function onOpen(e) {
      const name = e.detail?.name;
      if (!name) return;
      const ws = (workspaceConfigRef.current || []).find(
        (w) => (w.name || "").toLowerCase() === name.toLowerCase(),
      );
      if (ws && handleOpenTabRef.current) handleOpenTabRef.current(ws);
    }
    function onClose(e) {
      const name = e.detail?.name;
      if (name) {
        const tab = (openTabsRef.current || []).find(
          (t) => (t.name || "").toLowerCase() === name.toLowerCase(),
        );
        if (tab && handleCloseTabRef.current) handleCloseTabRef.current(tab.id);
      } else if (activeTabIdRef.current && handleCloseTabRef.current) {
        handleCloseTabRef.current(activeTabIdRef.current);
      }
    }
    window.addEventListener("dash:open-dashboard", onOpen);
    window.addEventListener("dash:close-dashboard", onClose);
    return () => {
      window.removeEventListener("dash:open-dashboard", onOpen);
      window.removeEventListener("dash:close-dashboard", onClose);
    };
  }, []);

  // Maintain window.__dashState so DashboardActionsApi read methods
  // (getCurrentPageName, listPages, etc.) return up-to-date values.
  useEffect(() => {
    const activePage = workspacePages.find((p) => p.id === currentActivePageId);
    window.__dashState = {
      currentPageId: currentActivePageId,
      currentPageName: activePage?.name || null,
      currentDashboardId: workspaceSelected?.id || null,
      currentDashboardName: workspaceSelected?.name || null,
      pages: workspacePages.map((p) => ({
        id: p.id,
        name: p.name,
        order: p.order,
      })),
    };
  }, [
    currentActivePageId,
    workspacePages,
    workspaceSelected?.id,
    workspaceSelected?.name,
  ]);

  function handleAddPage() {
    if (!workspaceSelected) return;
    // Sync existing pages with their live layouts from refs so any
    // unsaved user edits to the current page are preserved when
    // adding a new page (especially relevant when going from 1 → 2
    // pages where the lone page's tab is hidden but its grid is live).
    const existingPages = workspacePages.map((p) => {
      const pageRef = pageRefsMap.current[p.id];
      const liveLayout = pageRef?.current?.layout;
      return liveLayout ? { ...p, layout: liveLayout } : p;
    });
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
    navigateToPage(pageId);
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
    if (currentWorkspaceRef.current) {
      currentWorkspaceRef.current.menuId = Number(menuId);
    }
    updateTabWorkspace(tempWorkspace);
  }

  function handleWorkspaceThemeChange(themeKey) {
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    tempWorkspace["themeKey"] = themeKey || null;
    // Sync themeKey to the LayoutBuilder ref so save picks it up
    if (currentWorkspaceRef.current) {
      currentWorkspaceRef.current.themeKey = themeKey || null;
    }
    updateTabWorkspace(tempWorkspace);
  }

  function handleScrollableChange(enabled) {
    if (!workspaceSelected) return;
    const tempWorkspace = deepCopy(
      currentWorkspaceRef.current || workspaceSelected,
    );
    // Update the active page's root layout item
    tempWorkspace.pages = (tempWorkspace.pages || []).map((page) => {
      if (page.id !== currentActivePageId) return page;
      return {
        ...page,
        layout: (page.layout || []).map((item) =>
          item.parent === 0 ? { ...item, scrollable: enabled } : item,
        ),
      };
    });
    // Update page ref immediately so getRootScrollable() reads the new value
    const pageRef = pageRefsMap.current[currentActivePageId];
    if (pageRef?.current) {
      pageRef.current.layout = (pageRef.current.layout || []).map((item) =>
        item.parent === 0 ? { ...item, scrollable: enabled } : item,
      );
    }
    currentWorkspaceRef.current = tempWorkspace;
    updateTabWorkspace(tempWorkspace);
  }

  // Derive scrollable state from the active page's root layout item
  function getRootScrollable() {
    const ws = currentWorkspaceRef.current || workspaceSelected;
    if (!ws) return false;
    const pageRef = pageRefsMap.current[currentActivePageId];
    const layout =
      pageRef?.current?.layout ||
      ws.pages?.find((p) => p.id === currentActivePageId)?.layout;
    if (!layout) return false;
    const rootItem = layout.find((item) => item.parent === 0);
    return rootItem?.scrollable || false;
  }

  function handleClickSaveWorkspace() {
    try {
      console.log("dashboard clicked save workspace ", workspaceSelected);
      // we have to remove the widgetConfig which contains the component
      // sanitize the workspace layout remove widgetConfig items
      // Gather latest layout from each page's LayoutBuilder ref
      let workspaceToSave = deepCopy(workspaceSelected);
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
      // Sync root layout from active page for backward compat
      const activePage = workspaceToSave.pages.find(
        (p) => p.id === currentActivePageId,
      );
      if (activePage) {
        workspaceToSave.layout = activePage.layout;
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

      // Final reconciliation pass: prune every surviving widget's
      // `item.listeners` of references to widgets that aren't in the
      // layout anymore, and drop `selectedProviders` entries keyed by
      // deleted widgetIds. Running this at the main-save boundary
      // guarantees the persisted workspace never carries dangling
      // cross-widget state regardless of which mutation path got us
      // here. Idempotent — no-op on a clean workspace.
      workspaceToSave = reconcileWorkspaceAfterLayoutChange(workspaceToSave);

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

    // Reconstruct workspaces through LayoutModel (same as load path).
    // Filter nulls so a partially-failed normalize doesn't poison the
    // layout array — see handleLoadWorkspacesComplete for the rationale.
    const workspaces = deepCopy(message["workspaces"]);
    const workspacesTemp = workspaces.map((ws) => {
      ws["layout"] = (ws["layout"] || [])
        .map((layoutOG) => LayoutModel(layoutOG, workspaces, ws["id"]))
        .filter((item) => item != null);
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
      {/* ─── Toast container (driven by DashboardActionsApi.notify) ── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none w-80">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <Toast
                type={t.type}
                title={t.title}
                message={t.message}
                onClose={() =>
                  setToasts((prev) => prev.filter((x) => x.id !== t.id))
                }
              />
            </div>
          ))}
        </div>
      )}

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
                  sidebarEnabled={sidebarEnabled}
                  onSidebarChange={popout ? null : handleSidebarToggle}
                  scrollableEnabled={
                    workspacePages.length <= 1 ? getRootScrollable() : undefined
                  }
                  onScrollableChange={
                    workspacePages.length <= 1 && !popout
                      ? handleScrollableChange
                      : null
                  }
                  onOpenConfig={
                    popout || previewMode
                      ? null
                      : () => setIsConfigModalOpen(true)
                  }
                  configUnresolvedCount={unresolvedCount}
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
                  {/* Unresolved-config banner — separates providers vs
                      listeners so the message is honest. Clicking
                      Configure opens the modal; X dismisses the banner
                      for the session. */}
                  {unresolvedCount > 0 &&
                    !previewMode &&
                    !dismissedUnresolvedForWorkspace.has(
                      workspaceSelected?.id,
                    ) && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
                        <FontAwesomeIcon
                          icon="triangle-exclamation"
                          className="h-3.5 w-3.5 text-amber-400 flex-shrink-0"
                        />
                        <span className="text-xs text-amber-300/90 flex-1">
                          {[
                            unresolvedProvidersCount > 0 &&
                              `${unresolvedProvidersCount} widget${unresolvedProvidersCount === 1 ? "" : "s"} need${unresolvedProvidersCount === 1 ? "s" : ""} a provider`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsConfigModalOpen(true)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
                        >
                          Configure
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDismissedUnresolvedForWorkspace(
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
                  <PageTabBar
                    pages={workspacePages}
                    activePageId={currentActivePageId}
                    onSwitchPage={handleSwitchPage}
                    onAddPage={handleAddPage}
                    onRenamePage={handleRenamePage}
                    onDeletePage={handleDeletePage}
                    onReorderPages={handleReorderPages}
                    editMode={!previewMode}
                    scrollableEnabled={getRootScrollable()}
                    onScrollableChange={popout ? null : handleScrollableChange}
                  />
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
          {!popout && renderAiAssistant}
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

            <DashboardConfigModal
              isOpen={isConfigModalOpen}
              setIsOpen={setIsConfigModalOpen}
              workspace={workspaceSelected}
              appProviders={appContext?.providers || {}}
              getWidgetRequirements={(name) =>
                (name && ComponentManager.componentMap()[name]?.providers) || []
              }
              getWidgetConfig={(name) =>
                (name && ComponentManager.componentMap()[name]) || null
              }
              onSaveBindings={handleBulkProviderBindings}
              onSaveListeners={handleBulkListenerBindings}
              onSaveUserPrefs={handleBulkUserPrefs}
              initialTab="providers"
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
