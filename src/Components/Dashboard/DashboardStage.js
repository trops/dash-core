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
  ConfirmationModal,
  AlertBanner,
  Button2,
  ButtonIcon3,
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
import {
  layoutTemplates,
  createLayoutFromTemplate,
} from "../Layout/LayoutManager/layoutTemplates";
import { CreateModal } from "../Create/CreateModal";
import { OnboardingModal } from "./OnboardingModal";

import { DashCommandPalette } from "../Navigation/DashCommandPalette";
import { DashTabBar } from "../Navigation/DashTabBar";
import { PageTabBar } from "../Navigation/PageTabBar";
import { PinnedSidebar } from "./PinnedSidebar";
import { DashSidebar } from "../Navigation/DashSidebar";
import { EditPanel } from "./EditPanel";
import { WidgetPanel } from "./WidgetPanel";
import {
  PendingSettingsContext,
  createPendingSettings,
} from "./pendingSettings";
import { ownerLabel, changeBlockedText } from "./widgetPanelText";
import { BotConfigPanel } from "./BotConfigPanel";
import { keepLatest } from "../Settings/details/botFormMerge";
import { EditBotsRow } from "./EditBotsRow";
import {
  EditSelectionContext,
  findWidgetCell,
  relatedTo,
  widgetsOf,
} from "./editSelection";
import { findWidgetForHandOff } from "./configHandOff";

import { AppContext } from "../../Context/App/AppContext";
import { WorkspaceContext } from "../../Context/WorkspaceContext";
import { useMissingWidgets } from "../../hooks/useMissingWidgets";
import { MissingWidgetsModal } from "../../Widget/MissingWidgetsModal";
import { DashboardConfigModal } from "./DashboardConfigModal";
import { useTeamBots } from "../Bots/useTeamBots";
import { BotsView } from "../Bots/BotsView";
import { BotPageModal } from "../Bots/BotPageModal";
import { usePendingApprovalCount } from "../Bots/usePendingApprovalCount";
import { useProvidersNeedingSetup } from "../AppPages/useProviderStatus";
import { AppPage } from "../AppPages/AppPage";
import {
  pageForSettingsSection,
  pageKeyOf,
  pageTabId,
} from "../Navigation/appPages";
import { closeTab, openPageTab, restoreTabs } from "../Navigation/tabModel";
import {
  forEachWidget,
  getUnresolvedProviders,
} from "../../utils/providerResolution";
import { applyWiringChanges } from "../../utils/listenerResolution";
import { reconcileWorkspaceAfterLayoutChange } from "../../utils/workspaceReconciliation";
import { applyBulkUserPrefs } from "../../utils/applyBulkUserPrefs";
import { applyBulkProviderBindings } from "../../utils/applyBulkProviderBindings";
import { moveWidgetAcrossContainers } from "../../utils/layout";
import { ComponentManager } from "../../ComponentManager";
import { saveNewWorkspace, isSavedWorkspace } from "./saveNewWorkspace";
import { syncLayoutRefs } from "./editStaging";
import { describeEditChanges, withPendingSettings } from "./editChanges";
import { DiscardList } from "./DiscardList";
import { pickWidgetDisplayName } from "../../utils/widgetIdentity";
import { saveErrorText } from "../../utils/saveErrorText";

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
  // Popout opened from the Bot monitor: start in the Bots view on this bot.
  popoutView = null,
  popoutBotId = null,
  popoutBotTab = null,
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
          popoutView={popoutView}
          popoutBotId={popoutBotId}
          popoutBotTab={popoutBotTab}
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
      pageId={page.id}
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
  popoutView = null,
  popoutBotId = null,
  popoutBotTab = null,
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

  // ─── In-app toasts (driven by DashboardActionsApi.notify) ────────
  const [toasts, setToasts] = useState([]);

  // ─── Recents + Session ──────────────────────────────────────────
  const [recentDashboards, setRecentDashboards] = useState([]);
  const sessionRestored = useRef(false);

  // ─── Registry Auth (for sidebar) ────────────────────────────────
  const [authStatus, setAuthStatus] = useState("loading");
  const [authProfile, setAuthProfile] = useState(null);

  // Derive workspaceSelected from active tab. A Manage page tab
  // (`page:<key>`, app-navigation NAV-002) has no workspace, so everything
  // dashboard-only switches off while one is active.
  const workspaceSelected = activeTabId
    ? (openTabs.find((tab) => tab.id === activeTabId)?.workspace ?? null)
    : null;
  const activePageKey = pageKeyOf(activeTabId);
  // Settings deep links carried into a page: Dashboards' Folders view, and a
  // provider to select / create (a new nonce re-applies it).
  const [pageSubsection, setPageSubsection] = useState(null);
  const [providerLink, setProviderLink] = useState(null);
  // Widgets page install deep link { action, nonce } (Create screen).
  const [widgetLink, setWidgetLink] = useState(null);
  // The widget panel's "apply what's typed" — Save calls it first.
  const panelFlushRef = useRef(null);
  // Bot approvals waiting anywhere — the sidebar's Bots dot (NAV-001 AC3).
  const pendingApprovals = usePendingApprovalCount();
  // Providers that still need a credential — the Providers item's dot.
  const providersNeedingSetup = useProvidersNeedingSetup();

  /**
   * @param {Boolean} previewMode this is a toggle telling the dash we are editing
   */
  const [previewMode, setPreviewMode] = useState(preview);
  // For callbacks whose closures can be stale (memoized page handlers, the
  // cross-container move listener): are we editing right now?
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;

  /**
   * @param {String["layout", "workspace", "widget"]} editMode this is the actual mode we are in
   */
  const [editMode] = useState("all"); // for the time being use "all" as our "old" way

  // Workspace Management (loading)
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingMenuItems, setIsLoadingMenuItems] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [workspaceConfig, setWorkspaceConfig] = useState([]);

  // This dashboard's team, live — the Bots switch's attention badge and the
  // Bots view (bot-teams TEAM-011). Popouts too (B3).
  const team = useTeamBots(workspaceSelected?.id ?? null);
  const teamRefreshRef = useRef(team.refresh);
  teamRefreshRef.current = team.refresh;

  // Dashboard | Bots, per dashboard. The Bots view is a viewing mode: it
  // shows in preview and in popouts, never in edit mode. A popout opened from
  // the Bot monitor starts in it.
  const [stageModeByWorkspace, setStageModeByWorkspace] = useState(() =>
    popout && popoutView === "bots" && popoutWorkspaceId !== null
      ? { [popoutWorkspaceId]: "bots" }
      : {},
  );
  const stageMode =
    (popout || previewMode) && workspaceSelected
      ? stageModeByWorkspace[workspaceSelected.id] || "dashboard"
      : "dashboard";
  // Full-screen edit (create-entry phase 1b): while a dashboard is being
  // edited the app's left rail, open-tabs bar and assistant rail hide and
  // the EditPanel sits on the right. The dashboard column keeps its place in
  // the tree, so widgets don't remount on entering or leaving edit mode.
  const isEditingDashboard =
    !popout &&
    !previewMode &&
    stageMode === "dashboard" &&
    workspaceSelected !== null;

  // ─── Select-to-edit (create-entry phase 1c) ──────────────────────
  // What's selected in the editor: a widget, a bot, or null (the dashboard).
  const [editSelection, setEditSelection] = useState(null);
  // Bot edits made in the editor wait for the dashboard's Save, like every
  // other edit; Cancel discards them. botId → definition.
  const [pendingBotEdits, setPendingBotEdits] = useState({});
  // For each staged bot: the form's edited fields and the form as it
  // opened, so Save can merge over the latest copy (keepLatest) and not
  // put back changes made elsewhere meanwhile. botId → { edited, opened }.
  const pendingBotFormsRef = useRef({});
  // This month's spend per bot (bots.getSpend buckets), for the bots row.
  const [monthSpend, setMonthSpend] = useState(null);
  useEffect(() => {
    if (!isEditingDashboard) {
      setEditSelection(null);
      return undefined;
    }
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (api?.bots?.getSpend) {
      Promise.resolve(api.bots.getSpend())
        .then((s) => alive && setMonthSpend(s || {}))
        .catch(() => {});
    }
    // Esc goes back from a selection to the dashboard.
    const onKey = (e) => {
      if (e.key === "Escape") setEditSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [isEditingDashboard]);
  // The team as edited (staged bot edits applied) and every widget on the
  // dashboard — for what's connected to the selection.
  const editTeamBots = useMemo(
    () =>
      (team.members || []).map((b) =>
        pendingBotEdits[b.id] ? { ...b, ...pendingBotEdits[b.id] } : b,
      ),
    [team.members, pendingBotEdits],
  );
  const editWidgets = useMemo(
    () =>
      isEditingDashboard && workspaceSelected
        ? widgetsOf([
            ...(workspaceSelected.pages || []).flatMap((p) => p.layout || []),
            ...(workspaceSelected.sidebarLayout || []),
          ])
        : [],
    [isEditingDashboard, workspaceSelected],
  );
  const editRelated = useMemo(
    () =>
      relatedTo(editSelection, { widgets: editWidgets, bots: editTeamBots }),
    [editSelection, editWidgets, editTeamBots],
  );
  // Tell the builder holding the selected widget (or the visible page) to
  // act: open Configure at a section, Change with AI, Remove, + Row/Column.
  function dispatchEditAction(action, section = null, extra = null) {
    window.dispatchEvent(
      new CustomEvent("dash:edit-widget-action", {
        detail: {
          workspaceId: workspaceSelected?.id,
          pageId: currentActivePageId,
          uuid:
            editSelection?.kind === "widget" ? editSelection.uuid : undefined,
          scope:
            (editSelection?.kind === "widget" && editSelection.scope) || "main",
          action,
          section,
          ...(extra || {}),
        },
      }),
    );
    if (action === "remove") setEditSelection(null);
  }
  // The selected widget's settings, inline in the panel (CRE-006 AC5):
  // its page's layout (a page, or the pinned sidebar) and the item, prepared
  // the way the Configure dialog prepares it.
  const editConfigTarget = useMemo(() => {
    if (editSelection?.kind !== "widget" || !workspaceSelected) return null;
    const layouts = [
      ...(workspaceSelected.pages || []).map((p) => p.layout || []),
      workspaceSelected.sidebarLayout || [],
    ];
    if (!(workspaceSelected.pages || []).length) {
      layouts.unshift(workspaceSelected.layout || []);
    }
    const layout = layouts.find((l) =>
      l.some((i) => i && i.uuid === editSelection.uuid),
    );
    if (!layout) return null;
    const raw = layout.find((i) => i && i.uuid === editSelection.uuid);
    const copy = { ...raw };
    delete copy.api;
    delete copy.componentData;
    return {
      workspace: { ...workspaceSelected, layout },
      // LayoutModel recomputes uuid (dashboard-component-id); a placed
      // widget's uuid can differ. Keep the original so the change written
      // back still matches the selection.
      item: {
        ...(LayoutModel(copy, layout, workspaceSelected.id) || copy),
        uuid: raw.uuid,
      },
    };
  }, [editSelection, workspaceSelected]);
  // The selected widget's header: whose it is, whether a change can go in
  // place, and — while edits wait for Save — why Change waits
  // (consolidation Phase 3P).
  const selectedWidgetOwner = useMemo(() => {
    if (editSelection?.kind !== "widget") return "";
    const item = editConfigTarget?.item || null;
    return ownerLabel({
      component: editSelection.component,
      sourcePackage:
        (item && (item.packageId || item._sourcePackage)) ||
        ComponentManager.config(editSelection.component, item)
          ?._sourcePackage ||
        null,
      username: authProfile?.username || "",
    });
  }, [editSelection, editConfigTarget, authProfile]);
  // Which section the panel shows; a selection can ask for one (the card's
  // menu → Edit in panel, a footer badge → Listens for, …).
  const [editConfigSection, setEditConfigSection] = useState("edit");
  useEffect(() => {
    setEditConfigSection(
      (editSelection?.kind === "widget" && editSelection.section) || "edit",
    );
  }, [
    editSelection?.uuid,
    editSelection?.section,
    editSelection?.sectionRequest,
    editSelection?.kind,
  ]);
  const selectedEditBot =
    editSelection?.kind === "bot"
      ? editTeamBots.find((b) => b.id === editSelection.botId) || null
      : null;
  // Which bot the Bots view should open on ({ workspaceId, botId, tab, seq }).
  const [botsFocus, setBotsFocus] = useState(() =>
    popout && popoutView === "bots" && popoutBotId
      ? {
          workspaceId: String(popoutWorkspaceId),
          botId: popoutBotId,
          tab: popoutBotTab || "conversation",
          seq: 1,
        }
      : null,
  );
  const focusBot = useCallback((workspaceId, botId, tab) => {
    setStageModeByWorkspace((prev) => ({ ...prev, [workspaceId]: "bots" }));
    setBotsFocus((prev) => ({
      workspaceId: String(workspaceId),
      botId,
      tab: tab || "conversation",
      seq: ((prev && prev.seq) || 0) + 1,
    }));
  }, []);
  const setStageMode = useCallback(
    (mode) => {
      if (!workspaceSelected) return;
      setStageModeByWorkspace((prev) => ({
        ...prev,
        [workspaceSelected.id]: mode,
      }));
    },
    [workspaceSelected],
  );

  // Unsaved bot edits in the Bots view's Settings tab. Leaving the Bots view
  // (the header's Dashboard switch, or the edit button) asks first.
  const botsDirtyRef = useRef(false);
  const [pendingLeaveBots, setPendingLeaveBots] = useState(null);
  const leaveBotsGuarded = (action) => {
    if (stageMode === "bots" && botsDirtyRef.current) {
      setPendingLeaveBots(() => action);
      return;
    }
    action();
  };

  // The Bot monitor's "Open in Bots view": switch in place when it's the
  // dashboard you're viewing; otherwise open that dashboard as a popout in
  // the Bots view, so the dashboard you're on (and any edits) is untouched.
  const openBotsView = useCallback(
    (workspaceId, botId, tab = "conversation") => {
      if (workspaceId === null || workspaceId === undefined) return;
      if (
        workspaceSelected &&
        String(workspaceId) === String(workspaceSelected.id) &&
        previewMode
      ) {
        focusBot(workspaceSelected.id, botId, tab);
        return;
      }
      if (window.mainApi?.popout?.open) {
        window.mainApi.popout.open(workspaceId, {
          view: "bots",
          botId,
          tab,
        });
      }
    },
    [workspaceSelected, previewMode, focusBot],
  );
  // A bot widget's "Open in Bots view" (TEAM-012).
  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      if (d.workspaceId === undefined || d.workspaceId === null) return;
      openBotsView(d.workspaceId, d.botId || null, d.tab || "conversation");
    };
    window.addEventListener("dash:open-bots-view", handler);
    return () => window.removeEventListener("dash:open-bots-view", handler);
  }, [openBotsView]);
  // Open the Create screen from anywhere — Manage pages' New Widget / New Bot
  // (create-entry PRD CRE-008). detail: { type, workspaceId, recentId, seed,
  // cell, prompt, context } — prompt fills in what to ask, context is a
  // lead's hand-off note ({ note, from }); recentId opens a plan
  // conversation (Expand from the dock, 4e-2);
  // seed starts one from a plan (Open as a plan from Ask, 5e); cell is an
  // empty cell being edited ({ workspaceId, gridItemId, cellNumber, scope }):
  // Create makes one widget for it (consolidation Phase 2b).
  const activePageRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      const cell =
        d.cell && d.cell.gridItemId != null && d.cell.cellNumber
          ? {
              ...d.cell,
              scope: d.cell.scope || "main",
              // The main grid's page is the one being edited.
              pageId:
                d.cell.pageId ??
                ((d.cell.scope || "main") === "main"
                  ? activePageRef.current
                  : null),
            }
          : null;
      setCreateRequest({
        type: cell ? "widget" : d.type || "auto",
        workspaceId: cell ? cell.workspaceId : (d.workspaceId ?? null),
        recentId: d.recentId || null,
        seed: d.seed || null,
        cell,
        // What to ask, filled in (a team lead's hand-off, 2c).
        prompt: typeof d.prompt === "string" ? d.prompt : "",
        // …and its note and who it's from ({ note, from }).
        context: d.context && typeof d.context === "object" ? d.context : null,
      });
    };
    window.addEventListener("dash:open-create", handler);
    return () => window.removeEventListener("dash:open-create", handler);
  }, []);

  // Change with AI (consolidation Phase 3): every door — a widget's ⋮ menu,
  // the Edit panel, Ask AI, the error box, the Widgets page — opens Create
  // › Change <widget> on it. detail: { widgetComponentName, sourcePackage,
  // widgetId (its layout item; the Widgets page sends "<pkg>/<component>"),
  // gridItemId, workspaceId, userPrefs, selectedProviders, error }
  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      if (!d.widgetComponentName) return;
      // A widget on a dashboard (not the Widgets page): a new widget made
      // from it can take its place.
      const itemId =
        d.gridItemId != null &&
        d.widgetId != null &&
        !String(d.widgetId).includes("/")
          ? d.widgetId
          : null;
      setCreateRequest({
        type: "widget",
        workspaceId: d.workspaceId ?? null,
        edit: {
          component: String(d.widgetComponentName),
          sourcePackage: d.sourcePackage || null,
          itemId,
          workspaceId: d.workspaceId ?? null,
          // Its cell — the Widget Builder swaps a new widget into it.
          gridItemId: itemId != null ? (d.gridItemId ?? null) : null,
          cellNumber: itemId != null ? (d.cellNumber ?? null) : null,
          // Where it is: its scope, and the main grid's page.
          scope: d.scope || "main",
          pageId:
            itemId != null && (d.scope || "main") === "main"
              ? (d.pageId ?? activePageRef.current)
              : null,
          settings:
            d.userPrefs && typeof d.userPrefs === "object" ? d.userPrefs : null,
          providers:
            d.selectedProviders && typeof d.selectedProviders === "object"
              ? d.selectedProviders
              : null,
          error: typeof d.error === "string" ? d.error : "",
        },
      });
    };
    window.addEventListener("dash:edit-widget-with-ai", handler);
    return () =>
      window.removeEventListener("dash:edit-widget-with-ai", handler);
  }, []);

  // One bot's page in a large modal, from anywhere — the Bots panel, a
  // notification (app-navigation NAV-016 AC5). detail: { botId, tab }
  const [botPageRequest, setBotPageRequest] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      if (!d.botId) return;
      setBotPageRequest({ botId: d.botId, tab: d.tab || "conversation" });
    };
    // The Dash team's page, from the Bots panel's pinned row (Phase 4a).
    const onDashTeam = (e) => {
      const d = (e && e.detail) || {};
      setBotPageRequest({ dashTeam: true, tab: d.tab || "conversation" });
    };
    window.addEventListener("dash:open-bot", handler);
    window.addEventListener("dash:open-dash-team", onDashTeam);
    return () => {
      window.removeEventListener("dash:open-bot", handler);
      window.removeEventListener("dash:open-dash-team", onDashTeam);
    };
  }, []);
  const openBotSettings = useCallback((botId) => {
    if (botId) setBotPageRequest({ botId, tab: "settings" });
  }, []);

  // The assistant dock (AI Assistant + Bot Activity) renders outside any
  // Workspace, so hand it the current dashboard, the full list, and the
  // Bot monitor's hand-off actions (bot-teams TEAM-001 / TEAM-011 B3).
  const dockWorkspaceContext = useMemo(
    () => ({
      workspaceData: workspaceSelected,
      workspaces: workspaceConfig,
      openBotsView,
      openBotSettings,
    }),
    [workspaceSelected, workspaceConfig, openBotsView, openBotSettings],
  );

  // An already-open popout asked to show a bot (the Bot monitor again).
  useEffect(() => {
    if (!popout || !window.mainApi?.popout?.onShowBots) return undefined;
    const off = window.mainApi.popout.onShowBots(({ botId, tab } = {}) => {
      if (popoutWorkspaceId === null || !botId) return;
      focusBot(popoutWorkspaceId, botId, tab);
    });
    return typeof off === "function" ? off : undefined;
  }, [popout, popoutWorkspaceId, focusBot]);

  // Every dashboard gets an idle team lead the first time it's opened
  // (bot-teams TEAM-002). Idempotent; respects a lead turned off for this
  // dashboard and the global "Create team leads automatically" switch.
  // Only for saved dashboards — an unsaved one would leave an orphan lead.
  const workspaceSelectedIsSaved = isSavedWorkspace(
    workspaceConfig,
    workspaceSelected?.id,
  );
  useEffect(() => {
    if (popout || !workspaceSelected || !workspaceSelectedIsSaved) return;
    const bots = typeof window !== "undefined" && window.mainApi?.bots;
    if (!bots || typeof bots.ensureLead !== "function") return;
    Promise.resolve(
      bots.ensureLead(workspaceSelected.id, workspaceSelected.name),
    )
      .then(() => teamRefreshRef.current && teamRefreshRef.current())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout, workspaceSelected?.id, workspaceSelectedIsSaved]);

  // Modal state
  const [isThemeManagerOpen, setIsThemeManagerOpen] = useState(false);
  // The theme the editor opens on (Themes page › Edit theme); null = the
  // app theme.
  const [themeEditorKey, setThemeEditorKey] = useState(null);
  const [isDashboardLoaderOpen, setIsDashboardLoaderOpen] = useState(false);
  const [isLayoutPickerOpen, setIsLayoutPickerOpen] = useState(false);
  // The New Dashboard modal opened on a step ("import" | "registry") from
  // the Create screen's start-without-AI row.
  const [layoutInitialMethod, setLayoutInitialMethod] = useState("import");
  // Create screen (create-entry PRD CRE-001): null = closed, else
  // { type, workspaceId }.
  const [createRequest, setCreateRequest] = useState(null);
  const [themeStartInCreate, setThemeStartInCreate] = useState(false);
  // A theme Create made from a description, opened unsaved (phase 5c).
  const [themeInitial, setThemeInitial] = useState(null);

  // First-run onboarding (Phase 3A). Tri-state:
  //   null   — status not yet loaded from main; do not render anything
  //   true   — show the OnboardingModal
  //   false  — onboarding already completed (or app is not first-run)
  // The status read happens once per mount; subsequent dismiss/complete
  // flips this to false without re-fetching.
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(null);

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
    useState("general");

  // Opens Settings at a section — or, for the sections that became Manage
  // pages (Dashboards, Folders, Providers, Bots, Widgets, Themes), that
  // page's tab (app-navigation NAV-004 AC2). Provider deep links ride along:
  // providerType is the type id (e.g. "filesystem", "slack"); providerClass
  // routes the create flow ("mcp" opens the catalog detail with that type
  // pre-selected; otherwise the credential create form with formType filled).
  function openAppSettings(
    section = "general",
    providerName = null,
    createProvider = false,
    providerType = null,
    providerClass = null,
  ) {
    const page = pageForSettingsSection(section);
    if (page) {
      handleOpenPageGuarded(page.key, {
        subsection:
          section === "folders" || section === "dashboards" ? section : null,
        providerLink:
          section === "providers" &&
          (providerName || createProvider || providerType)
            ? {
                name: providerName,
                create: !!createProvider,
                type: providerType,
                providerClass,
                nonce: Date.now(),
              }
            : null,
      });
      return;
    }
    setAppSettingsInitialSection(section);
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

  // ─── Unsaved-changes guard (Phase 2B) ────────────────────────────
  // Single source of truth for "is the user mid-edit with un-saved
  // work?". A state variable — NOT a derived ref check — because the
  // useEffect that mirrors this to `globalThis.__dashboardIsDirty`
  // must re-run when the value changes, and `useRef` mutations don't
  // trigger re-renders.
  //
  // Mutations that flip it true:
  //   - LayoutBuilder.onWorkspaceChange (widget drag/drop/swap/delete)
  //     via `handleWorkspaceChange`
  //   - Header title rename via `handleWorkspaceNameChange`
  //   - Folder / theme changes via `handleWorkspaceFolderChange`,
  //     `handleWorkspaceThemeChange`
  //
  // Mutations that reset to false:
  //   - Successful save (`handleSaveWorkspaceComplete`)
  //   - Cancel/discard (`performCancelEdit` + the discard modal path)
  //   - Re-entering edit mode (`handleToggleEditMode` enter branch)
  //
  // Mirrored to `globalThis.__dashboardIsDirty` so the Electron main
  // process can poll synchronously during window close + app-quit
  // handlers without an IPC round-trip.
  //
  // A `pendingNavigation` object captures a navigation request that
  // arrived while dirty so the user can choose to discard or keep
  // editing. Shapes:
  //   { kind: "open-workspace", workspace }       — sidebar switch
  //   { kind: "cancel-edit" }                     — Cancel button
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  useEffect(() => {
    if (typeof globalThis !== "undefined") {
      globalThis.__dashboardIsDirty = isDirty;
    }
    return () => {
      if (typeof globalThis !== "undefined") {
        globalThis.__dashboardIsDirty = false;
      }
    };
  }, [isDirty]);
  // Which dashboard has the unsaved edits, so Create doesn't change it
  // mid-edit (create-entry 5e-2b: two saves would overwrite each other).
  const dirtyWorkspaceId = isDirty ? (workspaceSelected?.id ?? null) : null;
  // A widget's notifications and schedule wait for Save too (they're kept in
  // the main process, not the dashboard's file) — consolidation Phase 3P.
  const pendingSettings = useMemo(
    () =>
      createPendingSettings((count) => {
        if (count > 0) setIsDirty(true);
      }),
    [],
  );
  // Why the selected widget's Change waits: edits not saved yet (a change
  // from Create would land on top of them) — consolidation Phase 3P.
  const changeBlocked = useMemo(() => {
    if (!isEditingDashboard) return "";
    const botEdits = Object.keys(pendingBotEdits || {}).length;
    if (!isDirty && botEdits === 0) return "";
    const { discarded } = describeEditChanges({
      original: originalWorkspaceRef.current,
      current: workspaceSelected,
      pendingBotEdits,
    });
    return changeBlockedText(Math.max(discarded.length, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingDashboard, isDirty, pendingBotEdits, workspaceSelected]);
  // The editor's selection, for the grid, the cards and the widgets inside
  // them. `editing`: only while the dashboard is being edited (a crashed
  // widget's Remove); `changeBlocked`: why Change waits (the card's menu,
  // as the panel) — consolidation Phase 3P.
  const editSelectionValue = useMemo(
    () => ({
      available: true,
      editing: isEditingDashboard,
      changeBlocked,
      selection: editSelection,
      related: editRelated,
      select: setEditSelection,
    }),
    [editSelection, editRelated, isEditingDashboard, changeBlocked],
  );
  useEffect(() => {
    if (typeof globalThis !== "undefined") {
      globalThis.__dashboardDirtyId = dirtyWorkspaceId;
    }
    return () => {
      if (typeof globalThis !== "undefined") {
        globalThis.__dashboardDirtyId = null;
      }
    };
  }, [dirtyWorkspaceId]);

  // ─── First-run onboarding gate (Phase 3A) ────────────────────────
  // Decision fires exactly once per mount after the first workspaces
  // load completes. We need to wait for `isLoadingWorkspaces` to flip
  // true→false at least once; otherwise the gate reads workspaceConfig
  // at its initial empty value and would flash the modal on every
  // launch.
  //
  // Popout windows never show the modal — they're a slave to the
  // main window's onboarding decision and don't need their own gate.
  const onboardingCheckedRef = useRef(false);
  useEffect(() => {
    if (popout) {
      setIsOnboardingOpen(false);
      return;
    }
    if (onboardingCheckedRef.current) return;
    if (isLoadingWorkspaces) return;
    onboardingCheckedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const status = await window.mainApi?.onboarding?.getStatus?.();
        if (cancelled) return;
        // Defense-in-depth: even if `workspaceConfig.length === 0`
        // briefly reads true during a race between `isLoadingWorkspaces`
        // and the workspace array populating, don't show the modal
        // if the user already has a Kitchen Sink dashboard installed
        // from the registry. Same dedupe rule the modal's install
        // path applies.
        const alreadyHasKitchenSink = workspaceConfig.some((ws) => {
          const pkg = ws?._dashboardConfig?.registryPackage;
          if (typeof pkg !== "string") return false;
          const trailing = pkg.includes("/") ? pkg.split("/").pop() : pkg;
          return trailing === "kitchen-sink";
        });
        if (
          status &&
          status.completed === false &&
          workspaceConfig.length === 0 &&
          !alreadyHasKitchenSink
        ) {
          setIsOnboardingOpen(true);
        } else {
          setIsOnboardingOpen(false);
        }
      } catch (err) {
        // If the IPC is missing (older host) or fails, never show the
        // modal — silent absence is the right default for any host
        // that hasn't wired the onboarding controller yet.
        console.warn("[DashboardStage] onboarding gate skipped:", err);
        if (!cancelled) setIsOnboardingOpen(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [popout, isLoadingWorkspaces, workspaceConfig.length]);

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

  // ─── Listen for "open Settings to create a provider of type X" ──
  // Dispatched by dash-electron's Widget Builder PreviewProviderPicker
  // when the user clicks "Add new <type>" because no instances of the
  // chosen type exist yet. Detail: { type, providerClass }. The
  // Widget Builder's own listener (in dash-electron/Dash.js) handles
  // closing the builder modal — this listener only opens Settings.
  // Through a ref: this listener is registered once, but openAppSettings now
  // reads the current tab and unsaved-edit state (it opens the Providers page).
  const openAppSettingsRef = useRef(openAppSettings);
  openAppSettingsRef.current = openAppSettings;
  useEffect(() => {
    const handler = (e) => {
      const { type, providerClass } = e?.detail || {};
      if (!type) return;
      openAppSettingsRef.current(
        "providers",
        null,
        true,
        type,
        providerClass || null,
      );
    };
    window.addEventListener("dash:open-settings-create-provider", handler);
    return () =>
      window.removeEventListener("dash:open-settings-create-provider", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Only once the saved session has been read: saving the first render's
  // empty tabs used to overwrite it before restore ran (after dashboards
  // load), so nothing ever came back. `sessionReady` re-runs this then.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    if (popout || !sessionRestored.current) return;
    const tabIds = openTabs.map((t) => t.id);
    window.mainApi?.session?.saveState(tabIds, activeTabId);
  }, [openTabs, activeTabId, popout, sessionReady]);

  // ─── Session restore on launch ─────────────────────────────────
  useEffect(() => {
    if (popout || workspaceConfig.length === 0 || sessionRestored.current)
      return;
    sessionRestored.current = true;

    const done = () => setSessionReady(true);
    const session = window.mainApi?.session;
    if (!session?.getState) {
      done();
      return;
    }
    session.getState().then((state) => {
      if (!state?.openTabIds?.length) {
        done();
        return;
      }
      // Dashboards and Manage pages, in saved order; ones that no longer
      // exist are dropped (app-navigation NAV-002 AC3).
      const tabs = restoreTabs(state.openTabIds, workspaceConfig);
      if (tabs.length) {
        setOpenTabs(tabs);
        const active = tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : tabs[tabs.length - 1].id;
        setActiveTabId(active);
        setPreviewMode(true);
        if (tabs.some((t) => t.workspace)) setSidebarCollapsed(true);
      }
      window.mainApi?.session?.clearState();
      done();
    }, done);
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
      // Moves only happen while editing: stage like any other edit. (This
      // used to save the whole dashboard on the spot, committing every
      // other unsaved edit even if the user then pressed Cancel.)
      stageWorkspaceEdit(reconciled);
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

  // Guarded variant of handleOpenTab for user-driven entry points
  // (sidebar dashboard list, recents). If the user is mid-edit with
  // unsaved changes AND the request would navigate to a DIFFERENT
  // workspace than the currently active tab, surface the discard
  // confirmation modal instead of switching immediately.
  //
  // Programmatic callers (post-create auto-open, popout init, the
  // wizard's create-then-open flow) keep calling `handleOpenTab`
  // directly — they only fire after an explicit save and have no
  // dirty state to lose.
  function handleOpenTabGuarded(workspaceItem) {
    if (!workspaceItem) return;
    const switchingAway = activeTabId && activeTabId !== workspaceItem.id;
    if (isDirty && switchingAway) {
      setPendingNavigation({
        kind: "open-workspace",
        workspace: workspaceItem,
      });
      return;
    }
    // Unsaved bot edits in the Bots view ask too (never both: the Bots view
    // only shows outside edit mode).
    if (switchingAway) {
      leaveBotsGuarded(() => handleOpenTab(workspaceItem));
      return;
    }
    handleOpenTab(workspaceItem);
  }

  function handleCloseTab(tabId) {
    setOpenTabs((prev) => {
      // Closing the active tab switches to the last remaining one, or none.
      const next = closeTab(prev, tabId, activeTabId);
      if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
      return next.tabs;
    });
  }

  function handleSwitchTab(tabId) {
    setActiveTabId(tabId);
    setPreviewMode(true);
  }

  // The tab bar's switch: leaving a dashboard with unsaved edits asks first
  // (app-navigation NAV-002 AC6 — this used to switch without asking).
  function handleSwitchTabGuarded(tabId) {
    if (isDirty && tabId !== activeTabId) {
      setPendingNavigation({ kind: "switch-tab", tabId });
      return;
    }
    handleSwitchTab(tabId);
  }

  // ─── Manage pages (app-navigation NAV-002) ──────────────────────
  // A page opens as a tab beside the dashboards — one tab per page; opening
  // an open page just switches to it. `opts` carries Settings deep links.
  function handleOpenPage(key, opts = {}) {
    setOpenTabs((prev) => openPageTab(prev, key).tabs);
    setActiveTabId(pageTabId(key));
    setPreviewMode(true);
    setPageSubsection(opts.subsection || null);
    if (opts.providerLink) setProviderLink(opts.providerLink);
    if (opts.widgetLink) setWidgetLink(opts.widgetLink);
  }

  function handleOpenPageGuarded(key, opts = {}) {
    const switchingAway = activeTabId !== pageTabId(key);
    if (isDirty && switchingAway) {
      setPendingNavigation({ kind: "open-page", key, opts });
      return;
    }
    if (switchingAway) {
      leaveBotsGuarded(() => handleOpenPage(key, opts));
      return;
    }
    handleOpenPage(key, opts);
  }

  // ─── Dashboards page actions (app-navigation NAV-005 AC3) ───────
  // "Bots view": open the dashboard's tab already in its Bots view.
  function handleOpenDashboardBotsView(ws) {
    if (!ws) return;
    setStageModeByWorkspace((prev) => ({ ...prev, [ws.id]: "bots" }));
    handleOpenTabGuarded(ws);
  }

  // Bots page (NAV-006): open the bot's team in its Bots view, on that bot.
  function handleOpenBotInBotsView(ws, botId) {
    if (!ws) return;
    focusBot(ws.id, botId);
    handleOpenTabGuarded(ws);
  }

  // "Dashboard Config": open the dashboard; once it's showing (the effect
  // below), enter edit mode the usual way and open Config.
  const [pendingConfigFor, setPendingConfigFor] = useState(null);
  function handleOpenDashboardConfig(ws) {
    if (!ws) return;
    setPendingConfigFor(ws.id);
    handleOpenTabGuarded(ws);
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

  // While editing, a change made outside LayoutBuilder (provider pick,
  // Dashboard Config bulk edit, grid ↔ sidebar move) waits for Save like
  // every other edit: update the tab, mirror its layouts into the refs Save
  // reads, and mark the dashboard dirty so Cancel can undo it.
  function stageWorkspaceEdit(ws) {
    if (!ws) return;
    updateTabWorkspace(ws);
    syncLayoutRefs(ws, { pageRefsMap, sidebarWorkspaceRef });
    setIsDirty(true);
  }

  // ─── Create screen (create-entry PRD CRE-001 / CRE-008) ──────────

  // Auto by default (phase 5c): Create works out what to make. Every
  // "make" button opens it (consolidation Phase 2a).
  function openCreate(type = "auto", workspaceId = null) {
    setCreateRequest({ type, workspaceId });
  }
  // ⌘N (Mac) / Ctrl+N opens Create — like every other door, not while
  // editing a dashboard, nor over another dialog; never in a popout. On a
  // Mac, Ctrl+N stays the text fields' "next line".
  const editingRef = useRef(isEditingDashboard);
  editingRef.current = isEditingDashboard;
  useEffect(() => {
    if (popout) return undefined;
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac/i.test(navigator.platform || navigator.userAgent || "");
    const onKey = (e) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (
        !mod ||
        e.shiftKey ||
        e.altKey ||
        e.repeat ||
        (e.key !== "n" && e.key !== "N")
      ) {
        return;
      }
      if (editingRef.current) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setCreateRequest((r) => r || { type: "auto", workspaceId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popout]);

  // A blank dashboard opens in Edit on Add; rename it in the Dashboard tab.
  async function handleCreateBlankDashboard() {
    const menuId = menuItems && menuItems.length > 0 ? menuItems[0].id : 1;
    try {
      await handleCreateFromTemplate(
        createLayoutFromTemplate(layoutTemplates[0], menuId),
        themeKey || null,
        "Untitled dashboard",
      );
    } catch (e) {
      console.error("Failed to create dashboard:", e);
      window.dispatchEvent(
        new CustomEvent("dash:notify", {
          detail: {
            type: "error",
            message: "Couldn't create the dashboard. Try again.",
          },
        }),
      );
    }
  }

  const WIDGET_INSTALL_ACTIONS = {
    "browse-widgets": "discover",
    "widget-zip": "zip",
    "widget-folder": "folder",
  };

  function handleStartWithoutAi(key) {
    if (key === "blank-dashboard") {
      handleCreateBlankDashboard();
    } else if (key === "import-dashboard" || key === "browse-dashboards") {
      setLayoutInitialMethod(
        key === "import-dashboard" ? "import" : "registry",
      );
      setIsLayoutPickerOpen(true);
    } else if (key === "new-theme") {
      setThemeEditorKey(null);
      setThemeStartInCreate(true);
      setIsThemeManagerOpen(true);
    } else if (key === "widget-drafts" || key === "open-widgets") {
      // Drafts are listed (with Resume) on the Widgets page; a widget Create
      // just built is there too (Phase 3b).
      handleOpenPageGuarded("widgets");
    } else if (key === "widget-by-hand") {
      // The Widget Builder, by hand (consolidation Phase 3b).
      window.dispatchEvent(new CustomEvent("dash:open-widget-builder"));
    } else if (WIDGET_INSTALL_ACTIONS[key]) {
      handleOpenPageGuarded("widgets", {
        widgetLink: { action: WIDGET_INSTALL_ACTIONS[key], nonce: Date.now() },
      });
    }
  }

  // A dashboard a plan build made (phase 4d): open it, live (not the editor).
  async function handleOpenBuiltDashboard(workspaceId) {
    try {
      const res = await window.mainApi.workspace.listWorkspacesForApplication(
        credentials?.appId,
      );
      const list = Array.isArray(res) ? res : (res && res.workspaces) || [];
      const ws = list.find((w) => String(w.id) === String(workspaceId));
      loadWorkspaces();
      if (ws) handleOpenTab(ws);
    } catch (_e) {
      loadWorkspaces();
    }
  }

  // A widget the Scout found in Create: one of the user's → its page on the
  // Widgets page; a registry one → the registry search, to install.
  function handleOpenScoutMatch(match) {
    if (!match) return;
    if (match.source === "Registry") {
      // The registry matches a phrase: the widget's name finds it.
      handleOpenPageGuarded("widgets", {
        widgetLink: {
          action: "discover",
          query: match.name,
          nonce: Date.now(),
        },
      });
      return;
    }
    // "ai-built.x.Comp" (a component id) or "@ai-built/x" → "@ai-built/x".
    const raw = String(match.package || "");
    const parts = raw.split(".");
    const pkg =
      !raw.includes("/") && parts.length >= 3
        ? `@${parts[0]}/${parts[1]}`
        : raw;
    handleOpenPageGuarded("widgets", {
      widgetLink: { action: "select", package: pkg, nonce: Date.now() },
    });
  }

  function handleBotCreated(saved) {
    handleOpenPageGuarded("bots");
    window.dispatchEvent(
      new CustomEvent("dash:notify", {
        detail: {
          type: "success",
          message: `Created ${(saved && saved.name) || "the bot"}. It's paused until you turn it on.`,
        },
      }),
    );
  }

  // Saves the new dashboard before opening it, so it survives a reload.
  // Rejects on a failed save — the wizard shows the error.
  async function handleCreateFromTemplate(
    layoutObjOrArray,
    themeKey = null,
    name = null,
  ) {
    const layout = Array.isArray(layoutObjOrArray)
      ? layoutObjOrArray
      : [layoutObjOrArray];
    const newWorkspace = WorkspaceModel({
      layout,
      themeKey,
      menuId: layout[0].menuId,
      name: name || undefined,
    });
    await saveNewWorkspace({
      dashApi,
      appId: credentials?.appId,
      workspace: newWorkspace,
    });
    loadWorkspaces();
    handleOpenTab(newWorkspace);
    setSidebarCollapsed(true);
    // Opens in Edit: snapshot it as Edit does, or Cancel has nothing to go
    // back to and keeps every change (found live, Phase 2b).
    originalWorkspaceRef.current = deepCopy(newWorkspace);
    setIsDirty(false);
    setPendingBotEdits({});
    pendingBotFormsRef.current = {};
    setPreviewMode(false);
    return { success: true, workspace: newWorkspace };
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
      // LayoutBuilder fired a mutation (widget drag/drop/swap/delete).
      // Mark the workspace dirty so the navigation + close guards fire.
      setIsDirty(true);

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
      syncLayoutRefs(wsModel, { pageRefsMap, sidebarWorkspaceRef });
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
      // Editing: wait for Save (Cancel must be able to undo it).
      if (!previewModeRef.current) {
        stageWorkspaceEdit(reconciled);
        return;
      }
      // Not editing: a one-off pick, saved straight away.
      saveRightAway(reconciled, "provider");
    }
  }

  // Phase 1e: a change made outside Edit shows at once and is saved straight
  // away. If the save fails, the screen goes back to what's saved and the
  // user is told — it never shows a change that didn't happen.
  function saveRightAway(reconciled, what) {
    const before = workspaceSelected;
    updateTabWorkspace(reconciled);
    const failed = (_e, error) => {
      if (before) updateTabWorkspace(before);
      notifySaveError(`Couldn't save the ${what} change`, error);
    };
    try {
      dashApi.saveWorkspace(credentials.appId, reconciled, () => {}, failed);
    } catch (e) {
      failed(null, e);
    }
  }

  function notifySaveError(title, error, next = "Try again.") {
    const reason = saveErrorText(error).replace(/\.+$/, "");
    window.dispatchEvent(
      new CustomEvent("dash:notify", {
        detail: {
          type: "error",
          title,
          message: reason ? `${reason}. ${next}` : next,
          duration: 8000,
        },
      }),
    );
  }

  // ─── Bulk provider binding save (Dashboard Config modal) ──────────
  // Takes [{ widgetId, providerType, providerName }] and writes the
  // updated workspace ONCE via saveWorkspace — avoids N round-trips
  // that the per-widget handleProviderSelect would produce for a
  // bulk-assign.
  function handleBulkProviderBindings(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return;
    if (!workspaceSelected || !dashApi || !credentials?.appId) return;

    // Write through to BOTH layers — workspace.selectedProviders[id]
    // (layer 2) AND every matching layout item's selectedProviders
    // (layer 1). Without the layer-1 write, a stale per-widget
    // value silently shadows the bulk pick because resolveProviderName
    // checks layer 1 first. See `applyBulkProviderBindings` for the
    // full rationale.
    const updatedWorkspace = applyBulkProviderBindings(
      workspaceSelected,
      changes,
    );
    if (updatedWorkspace === workspaceSelected) return; // no-op
    const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
    // Editing: wait for Save (Cancel must be able to undo it).
    if (!previewModeRef.current) {
      stageWorkspaceEdit(reconciled);
      return;
    }
    saveRightAway(reconciled, "provider");
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

    // Pure utility — given the staged change set, returns a new
    // workspace with userPrefs patched on each matching widget.
    // Identity matches `WidgetsTab.widgets[].id` (uuidString → uuid
    // → id) AND tolerates string/number id mismatches that can sneak
    // in through React state serialization.
    const updatedWorkspace = applyBulkUserPrefs(workspaceSelected, changes);
    const reconciled = reconcileWorkspaceAfterLayoutChange(updatedWorkspace);
    // Editing: wait for Save (Cancel must be able to undo it).
    if (!previewModeRef.current) {
      stageWorkspaceEdit(reconciled);
      return;
    }
    saveRightAway(reconciled, "widget settings");
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
    // Editing: wait for Save (Cancel must be able to undo it).
    if (!previewModeRef.current) {
      stageWorkspaceEdit(reconciled);
      return;
    }
    saveRightAway(reconciled, "listener");
  }

  // ─── Unresolved providers + listener orphans (modal + auto-open) ─
  const unresolvedProviders = useMemo(
    () =>
      getUnresolvedProviders({
        workspace: workspaceSelected,
        appProviders: appContext?.providers || {},
        providersLoaded: appContext?.providersLoaded,
        // Use ComponentManager.config so a legacy layout referencing
        // a bare component name (`"PipelineKanban"`) still resolves
        // to its scoped registration. Direct `componentMap[name]`
        // returns undefined after the v0.1.432 scoped-IDs migration.
        getWidgetRequirements: (name) =>
          (name && ComponentManager.config(name)?.providers) || [],
      }),
    [workspaceSelected, appContext?.providers, appContext?.providersLoaded],
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
  // For Create's cell requests (registered once, above).
  activePageRef.current = currentActivePageId;

  // Stable refs for tab/dashboard handlers so the open/close-dashboard
  // listener doesn't have to re-subscribe on every render.
  const handleOpenTabRef = useRef(null);
  const handleCloseTabRef = useRef(null);
  const workspaceConfigRef = useRef([]);
  const openTabsRef = useRef([]);
  const activeTabIdRef = useRef(null);
  handleOpenTabRef.current = handleOpenTab;
  const handleOpenBuiltRef = useRef(null);
  handleOpenBuiltRef.current = handleOpenBuiltDashboard;
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
        // Dashboards only — a page tab named "Bots" isn't a dashboard.
        const tab = (openTabsRef.current || []).find(
          (t) =>
            t.workspace && (t.name || "").toLowerCase() === name.toLowerCase(),
        );
        if (tab && handleCloseTabRef.current) handleCloseTabRef.current(tab.id);
      } else if (activeTabIdRef.current && handleCloseTabRef.current) {
        handleCloseTabRef.current(activeTabIdRef.current);
      }
    }
    // A dashboard a plan build just made, by id — Go to dashboard in the
    // dock's Create panel (4e-2).
    function onOpenBuilt(e) {
      const id = e.detail?.id;
      if (id != null && handleOpenBuiltRef.current) {
        handleOpenBuiltRef.current(id);
      }
    }
    window.addEventListener("dash:open-dashboard", onOpen);
    window.addEventListener("dash:close-dashboard", onClose);
    window.addEventListener("dash:open-built-dashboard", onOpenBuilt);
    return () => {
      window.removeEventListener("dash:open-dashboard", onOpen);
      window.removeEventListener("dash:close-dashboard", onClose);
      window.removeEventListener("dash:open-built-dashboard", onOpenBuilt);
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

  const handlePageWorkspaceChange = useCallback(
    (updatedWorkspace, pageId) => {
      // Store in per-page ref (used by save function)
      pageRefsMap.current[pageId] = { current: updatedWorkspace };
      // A main-grid edit: mark dirty so Cancel and the close guard see it.
      if (!previewModeRef.current) setIsDirty(true);

      // Also update the React state so workspaceSelected (which the
      // dashboard config bulk-edit modal reads) stays in sync. Before
      // this, page-level edits only flowed into pageRefsMap and the
      // bulk modal kept rendering pre-edit data — even when the
      // PanelEditItemProviders fix correctly wrote both layers and
      // the LayoutBuilder fix correctly propagated up. The data
      // arrived; it just never reached the React state the bulk
      // modal subscribes to.
      //
      // Mirror the new page's `layout` into the active tab's matching
      // page, AND bring forward the workspace-level
      // `selectedProviders` map so layer-2 writes from per-widget
      // edits land in state the bulk modal can see.
      if (!activeTabId || !updatedWorkspace) return;
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const tabWs = tab.workspace;
          if (!tabWs) return tab;
          const nextPages = Array.isArray(tabWs.pages)
            ? tabWs.pages.map((p) =>
                p && p.id === pageId
                  ? { ...p, layout: updatedWorkspace.layout }
                  : p,
              )
            : tabWs.pages;
          return {
            ...tab,
            workspace: {
              ...tabWs,
              pages: nextPages,
              selectedProviders:
                updatedWorkspace.selectedProviders ?? tabWs.selectedProviders,
            },
          };
        }),
      );
    },
    [activeTabId],
  );

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

  // What the Discard prompt will throw away (phase 1e). Computed only while
  // the prompt is open.
  const cancelChanges = useMemo(
    () =>
      pendingNavigation
        ? withPendingSettings(
            describeEditChanges({
              original: originalWorkspaceRef.current,
              current: workspaceSelected,
              pendingBotEdits,
              nameOf: (w) =>
                pickWidgetDisplayName(
                  w,
                  ComponentManager.config(w.component, w),
                ),
            }),
            pendingSettings.size(),
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingNavigation],
  );

  // Internal: the unguarded cancel-edit operation. Called both from
  // the direct Cancel button (when nothing is dirty) and from the
  // confirmation modal's Discard action.
  function performCancelEdit() {
    if (originalWorkspaceRef.current) {
      updateTabWorkspace(originalWorkspaceRef.current);
    }
    currentWorkspaceRef.current = null;
    originalWorkspaceRef.current = null;
    setIsDirty(false);
    setPendingBotEdits({});
    pendingBotFormsRef.current = {};
    pendingSettings.clear();
    setPreviewMode(true);
  }

  // The Dashboards page asked for this dashboard's Config: now that it's the
  // one showing, enter edit mode (snapshot + clean dirty flag, so Cancel
  // works) and open the modal.
  useEffect(() => {
    if (pendingConfigFor == null || !workspaceSelected) return;
    if (String(workspaceSelected.id) !== String(pendingConfigFor)) return;
    setPendingConfigFor(null);
    if (previewMode) handleToggleEditMode();
    setIsConfigModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfigFor, workspaceSelected]);

  function handleToggleEditMode() {
    if (previewMode) {
      // Entering edit mode — snapshot the current workspace and
      // reset the dirty flag so we start from a clean slate.
      originalWorkspaceRef.current = deepCopy(workspaceSelected);
      setIsDirty(false);
      setPendingBotEdits({});
      pendingBotFormsRef.current = {};
      pendingSettings.clear();
      setPreviewMode(false);
      setStageMode("dashboard");
      return;
    }
    // Cancel path: prompt only if there are unsaved edits. The
    // `isDirty` value flips true the moment LayoutBuilder writes
    // anything into `currentWorkspaceRef`.
    if (isDirty) {
      setPendingNavigation({ kind: "cancel-edit" });
      return;
    }
    performCancelEdit();
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
    // Header rename counts as a workspace mutation; mark dirty so
    // navigation + close guards fire.
    setIsDirty(true);
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
    setIsDirty(true);
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
    setIsDirty(true);
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
    setIsDirty(true);
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

  // Save: staged bot edits first (phase 1c), then the dashboard. A failed
  // bot save stops here so nothing is half-saved silently.
  function handleClickSaveWorkspace() {
    // A setting still being typed in the widget panel applies on blur,
    // which can land after this click (or never, if the panel closes):
    // apply it now. It reaches the page refs synchronously, which is
    // what saveDashboardWorkspace reads.
    if (typeof panelFlushRef.current === "function") panelFlushRef.current();
    const staged = Object.entries(pendingBotEdits);
    if (staged.length === 0) return saveDashboardWorkspace();
    const api = window.mainApi.bots;
    // Only what the form changed goes over the latest copy (keepLatest),
    // like the bot form's own Save.
    const finalDefinition = async (id, def) => {
      const form = pendingBotFormsRef.current[id];
      if (!form || typeof api.get !== "function") return def;
      const latest = await Promise.resolve(api.get(id)).catch(() => null);
      if (!latest) return def;
      return { ...latest, ...keepLatest(form.edited, form.opened, latest) };
    };
    Promise.all(
      staged.map(async ([id, def]) => api.save(await finalDefinition(id, def))),
    )
      .then(() => saveDashboardWorkspace())
      .catch((err) => {
        const id = `${Date.now()}-bot-save`;
        setToasts((prev) => [
          ...prev,
          {
            id,
            type: "error",
            title: "Couldn't save a bot",
            message: (err && err.message) || String(err),
          },
        ]);
      });
  }

  function saveDashboardWorkspace() {
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
      handleSaveWorkspaceError(null, e);
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

    // The widgets' notifications / schedule wait for the dashboard to be
    // saved — a failed save keeps them waiting, and Cancel then drops them
    // (consolidation Phase 3P).
    const settings = pendingSettings.take();
    if (settings.length > 0) {
      Promise.all(settings.map((apply) => Promise.resolve().then(apply))).catch(
        (err) => {
          const id = `${Date.now()}-settings-save`;
          setToasts((prev) => [
            ...prev,
            {
              id,
              type: "error",
              title: "Couldn't save a widget's notifications or schedule",
              message: (err && err.message) || String(err),
            },
          ]);
        },
      );
    }

    // Clear edit-mode refs — edits are now persisted
    currentWorkspaceRef.current = null;
    originalWorkspaceRef.current = null;
    setIsDirty(false);
    setPendingBotEdits({});
    pendingBotFormsRef.current = {};

    setPreviewMode(() => true);
  }

  // A failed Save keeps Edit open with every change still there (Phase 1e).
  function handleSaveWorkspaceError(_e, error) {
    notifySaveError(
      "Couldn't save the dashboard",
      error,
      "Your changes are still here — try Save again.",
    );
  }

  function handleOpenThemeManager(themeKey = null) {
    // Also used as a click handler, so ignore anything but a key.
    setThemeEditorKey(typeof themeKey === "string" ? themeKey : null);
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
        <EditSelectionContext.Provider value={editSelectionValue}>
          <div className="flex flex-row flex-1 overflow-hidden">
            {!popout && !isEditingDashboard && (
              <DashSidebar
                collapsed={sidebarCollapsed}
                onCollapsedChange={setSidebarCollapsed}
                workspaces={workspaceConfig}
                menuItems={menuItems}
                activeTabId={activeTabId}
                recentDashboards={recentDashboards}
                authStatus={authStatus}
                authProfile={authProfile}
                onOpenWorkspace={handleOpenTabGuarded}
                onNewDashboard={() => openCreate()}
                onOpenSettings={() => openAppSettings("general")}
                onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                onSignIn={handleSidebarSignIn}
                onSignOut={handleSidebarSignOut}
                activePageKey={activePageKey}
                onOpenPage={handleOpenPageGuarded}
                pageAttention={{
                  bots: pendingApprovals,
                  providers: providersNeedingSetup,
                }}
              />
            )}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              {workspaceSelected !== null ? (
                <>
                  <DashboardHeader
                    workspace={workspaceSelected}
                    preview={popout ? true : previewMode}
                    onClickEdit={
                      popout
                        ? null
                        : () => leaveBotsGuarded(handleToggleEditMode)
                    }
                    onPopout={popout ? null : handlePopout}
                    onSaveChanges={popout ? null : handleClickSaveWorkspace}
                    selectionLabel={editSelection?.label || null}
                    selectionKind={editSelection?.kind || null}
                    onClearSelection={() => setEditSelection(null)}
                    onAddRow={() => dispatchEditAction("add-row")}
                    onAddColumn={() => dispatchEditAction("add-column")}
                    stageMode={stageMode}
                    onStageModeChange={
                      popout || previewMode
                        ? (mode) =>
                            mode === "bots"
                              ? setStageMode(mode)
                              : leaveBotsGuarded(() => setStageMode(mode))
                        : null
                    }
                    botsAttention={team.attention}
                  />
                  <DashboardThemeProvider
                    themeKey={workspaceSelected?.themeKey}
                  >
                    {/* Missing widgets banner */}
                    {hasMissing &&
                      missingComponents.length >= 2 &&
                      !dismissedMissingForWorkspace.has(
                        workspaceSelected?.id,
                      ) && (
                        <AlertBanner
                          variant="warning"
                          size="compact"
                          animate={false}
                          className="flex-shrink-0 mx-4 mt-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex-1 min-w-0">
                              {missingComponents.length} widgets are missing
                              from this dashboard.
                            </span>
                            <Button2
                              title="Resolve"
                              size="sm"
                              onClick={() => setIsMissingWidgetsModalOpen(true)}
                            />
                            <span className="dr-row-actions inline-flex">
                              <ButtonIcon3
                                icon="xmark"
                                ariaLabel="Dismiss"
                                backgroundColor="bg-transparent"
                                className="h-7 w-7"
                                onClick={() =>
                                  setDismissedMissingForWorkspace(
                                    (prev) =>
                                      new Set([...prev, workspaceSelected?.id]),
                                  )
                                }
                              />
                            </span>
                          </div>
                        </AlertBanner>
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
                        <AlertBanner
                          variant="warning"
                          size="compact"
                          animate={false}
                          className="flex-shrink-0 mx-4 mt-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex-1 min-w-0">
                              {[
                                unresolvedProvidersCount > 0 &&
                                  `${unresolvedProvidersCount} widget${unresolvedProvidersCount === 1 ? "" : "s"} need${unresolvedProvidersCount === 1 ? "s" : ""} a provider`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <Button2
                              title="Configure"
                              size="sm"
                              onClick={() => setIsConfigModalOpen(true)}
                            />
                            <span className="dr-row-actions inline-flex">
                              <ButtonIcon3
                                icon="xmark"
                                ariaLabel="Dismiss"
                                backgroundColor="bg-transparent"
                                className="h-7 w-7"
                                onClick={() =>
                                  setDismissedUnresolvedForWorkspace(
                                    (prev) =>
                                      new Set([...prev, workspaceSelected?.id]),
                                  )
                                }
                              />
                            </span>
                          </div>
                        </AlertBanner>
                      )}
                    {stageMode === "bots" ? (
                      <BotsView
                        key={workspaceSelected.id}
                        workspace={workspaceSelected}
                        workspaces={workspaceConfig}
                        team={team}
                        focus={botsFocus}
                        onDirtyChange={(d) => {
                          botsDirtyRef.current = d;
                        }}
                        onOpenSettings={(section) => openAppSettings(section)}
                      />
                    ) : (
                      <>
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
                          onScrollableChange={
                            popout ? null : handleScrollableChange
                          }
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
                        {isEditingDashboard && (
                          <EditBotsRow
                            bots={editTeamBots}
                            spend={monthSpend}
                            selection={editSelection}
                            related={editRelated}
                            onSelect={setEditSelection}
                          />
                        )}
                      </>
                    )}
                  </DashboardThemeProvider>
                </>
              ) : activePageKey ? (
                // A Manage page, full-screen, in the app theme (outside the
                // dashboard's theme) — app-navigation NAV-003.
                <AppPage
                  pageKey={activePageKey}
                  subsection={pageSubsection}
                  providerLink={providerLink}
                  widgetLink={widgetLink}
                  workspaces={workspaceConfig}
                  menuItems={menuItems}
                  dashApi={dashApi}
                  credentials={credentials}
                  onReloadWorkspaces={loadWorkspaces}
                  onReloadMenuItems={loadMenuItems}
                  onOpenWorkspace={handleOpenTabGuarded}
                  onOpenThemeEditor={handleOpenThemeManager}
                  onOpenBotsView={handleOpenDashboardBotsView}
                  onOpenDashboardConfig={handleOpenDashboardConfig}
                  onOpenBotInBotsView={handleOpenBotInBotsView}
                  onOpenAppSettings={(section) => openAppSettings(section)}
                  onOpenPrivacySettings={() =>
                    openAppSettings("privacy-security")
                  }
                />
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    icon={
                      <FontAwesomeIcon icon="clone" className="h-12 w-12" />
                    }
                    title={
                      popout ? "Dashboard not found" : "No dashboards open"
                    }
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
                          onClick={() => openCreate("dashboard")}
                          size="sm"
                        />
                      </div>
                    )}
                  </EmptyState>
                </div>
              )}
              {/* Open dashboards and Manage pages (app-navigation NAV-002).
                Leaving a dashboard with unsaved edits — layout or bot —
                asks first; re-clicking it or closing a background tab
                doesn't. */}
              {!popout && !isEditingDashboard && openTabs.length > 0 && (
                <DashTabBar
                  tabs={openTabs}
                  activeTabId={activeTabId}
                  onSwitchTab={(tabId) =>
                    tabId === activeTabId
                      ? handleSwitchTab(tabId)
                      : leaveBotsGuarded(() => handleSwitchTabGuarded(tabId))
                  }
                  onCloseTab={(tabId) =>
                    tabId === activeTabId
                      ? leaveBotsGuarded(() => handleCloseTab(tabId))
                      : handleCloseTab(tabId)
                  }
                />
              )}
            </div>
            {isEditingDashboard && (
              <PendingSettingsContext.Provider value={pendingSettings}>
                <EditPanel
                  workspace={workspaceSelected}
                  menuItems={menuItems}
                  themes={themes || {}}
                  username={authProfile?.username || ""}
                  onNameChange={handleWorkspaceNameChange}
                  onFolderChange={handleWorkspaceFolderChange}
                  onThemeChange={handleWorkspaceThemeChange}
                  scrollableEnabled={getRootScrollable()}
                  onScrollableChange={
                    workspacePages.length <= 1 ? handleScrollableChange : null
                  }
                  sidebarEnabled={sidebarEnabled}
                  onSidebarChange={handleSidebarToggle}
                  onOpenConfig={() => setIsConfigModalOpen(true)}
                  configUnresolvedCount={unresolvedCount}
                  selection={editSelection}
                  onWidgetAction={dispatchEditAction}
                  onPlaceWidget={(widgetKey) => {
                    if (editSelection?.kind !== "cell") return;
                    window.dispatchEvent(
                      new CustomEvent("dash:edit-widget-action", {
                        detail: {
                          workspaceId: workspaceSelected?.id,
                          pageId: currentActivePageId,
                          scope: editSelection.scope || "main",
                          action: "place",
                          gridItemId: editSelection.gridItemId,
                          cellNumber: editSelection.cellNumber,
                          widgetKey,
                        },
                      }),
                    );
                    setEditSelection(null);
                  }}
                  onMoveWidget={(on) =>
                    setEditSelection((sel) =>
                      sel?.kind === "widget" ? { ...sel, moving: on } : sel,
                    )
                  }
                  onBuildWithAi={() => {
                    if (editSelection?.kind !== "cell") return;
                    // Create, for this cell, through the Dash team (2b).
                    window.dispatchEvent(
                      new CustomEvent("dash:open-create", {
                        detail: {
                          cell: {
                            cellNumber: editSelection.cellNumber,
                            gridItemId: editSelection.gridItemId,
                            workspaceId: workspaceSelected?.id,
                            scope: editSelection.scope || "main",
                          },
                        },
                      }),
                    );
                  }}
                  widgetOwner={selectedWidgetOwner}
                  widgetNotYours={selectedWidgetOwner.startsWith(
                    "From the registry",
                  )}
                  canChange={selectedWidgetOwner !== "Built into Dash"}
                  changeBlocked={changeBlocked}
                  widgetConfig={
                    editConfigTarget ? (
                      <WidgetPanel
                        key={editSelection.uuid}
                        item={editConfigTarget.item}
                        workspace={editConfigTarget.workspace}
                        name={editSelection.label || editSelection.component}
                        focus={{
                          section: editConfigSection,
                          request: editSelection.sectionRequest || 0,
                        }}
                        onCommit={(ws) =>
                          dispatchEditAction("update", null, { workspace: ws })
                        }
                        flushRef={panelFlushRef}
                      />
                    ) : null
                  }
                  botEditor={
                    selectedEditBot ? (
                      <BotConfigPanel
                        key={selectedEditBot.id}
                        bot={selectedEditBot}
                        formProps={{
                          providers: appContext?.providers || {},
                          workspaces: workspaceConfig,
                          getWidgetConfig: (name) =>
                            (name && ComponentManager.config(name)) || null,
                          bots: team.bots || [],
                          defaultWorkspaceId: workspaceSelected?.id,
                        }}
                        onStage={(definition, opened) => {
                          const id = selectedEditBot.id;
                          const prevForm = pendingBotFormsRef.current[id];
                          pendingBotFormsRef.current = {
                            ...pendingBotFormsRef.current,
                            [id]: {
                              edited: definition,
                              // The form as first opened, across re-stages.
                              opened: prevForm ? prevForm.opened : opened,
                            },
                          };
                          setPendingBotEdits((prev) => ({
                            ...prev,
                            [id]: {
                              ...(prev[id] || selectedEditBot),
                              ...definition,
                            },
                          }));
                          setIsDirty(true);
                        }}
                      />
                    ) : null
                  }
                />
              </PendingSettingsContext.Provider>
            )}
            {!popout && !isEditingDashboard && (
              <WorkspaceContext.Provider value={dockWorkspaceContext}>
                {renderAiAssistant}
              </WorkspaceContext.Provider>
            )}
          </div>
        </EditSelectionContext.Provider>

        {/* ─── Modals (hidden in popout mode) ────────── */}
        {!popout && (
          <>
            <BotPageModal
              request={botPageRequest}
              onClose={() => setBotPageRequest(null)}
              workspaces={workspaceConfig}
              onOpenInBotsView={handleOpenBotInBotsView}
              onOpenSettings={(section) => openAppSettings(section)}
            />
            <AppSettingsModal
              isOpen={isAppSettingsOpen}
              setIsOpen={setIsAppSettingsOpen}
              initialSection={appSettingsInitialSection}
              workspaces={workspaceConfig}
              authStatus={authStatus}
              authProfile={authProfile}
              onSignIn={handleSidebarSignIn}
              onSignOut={handleSidebarSignOut}
              onProfileUpdated={handleProfileUpdated}
            />

            <ThemeManagerModal
              open={isThemeManagerOpen}
              initialThemeKey={themeEditorKey}
              startInCreate={themeStartInCreate}
              initialTheme={themeInitial}
              setIsOpen={() => {
                setIsThemeManagerOpen(!isThemeManagerOpen);
                setThemeStartInCreate(false);
                setThemeInitial(null);
              }}
              onSave={(themeKey) => {
                changeCurrentTheme(themeKey);
                setIsThemeManagerOpen(() => false);
                setThemeStartInCreate(false);
                setThemeInitial(null);
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
              menuItems={menuItems}
              onSaveMenuItem={handleSaveNewMenuItem}
              appId={credentials?.appId}
              onReloadWorkspaces={loadWorkspaces}
              onOpenWorkspace={handleOpenTabGuarded}
              initialMethod={layoutInitialMethod}
            />

            <CreateModal
              open={!!createRequest}
              setIsOpen={(v) => {
                if (!v) setCreateRequest(null);
              }}
              initialType={createRequest ? createRequest.type : "auto"}
              workspaceId={createRequest ? createRequest.workspaceId : null}
              workspaces={workspaceConfig}
              onStartWithoutAi={handleStartWithoutAi}
              cell={createRequest ? createRequest.cell || null : null}
              onBotCreated={handleBotCreated}
              onOpenAiSettings={() => openAppSettings("ai-assistant")}
              onOpenWidget={handleOpenScoutMatch}
              onOpenDashboard={handleOpenBuiltDashboard}
              initialRecentId={createRequest ? createRequest.recentId : null}
              initialSeed={createRequest ? createRequest.seed : null}
              initialPrompt={createRequest ? createRequest.prompt || "" : ""}
              initialContext={
                createRequest ? createRequest.context || null : null
              }
              edit={createRequest ? createRequest.edit || null : null}
              onOpenTheme={(theme) => {
                setThemeEditorKey(null);
                setThemeStartInCreate(false);
                setThemeInitial(theme);
                setIsThemeManagerOpen(true);
              }}
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
              workspaces={workspaceConfig}
              workspace={workspaceSelected}
              appProviders={appContext?.providers || {}}
              // Use ComponentManager.config so legacy bare component
              // refs in `workspaceSelected.layout` still resolve to
              // their registered scoped form (post-v0.1.432). Direct
              // `componentMap[name]` returns undefined for those.
              getWidgetRequirements={(name) =>
                (name && ComponentManager.config(name)?.providers) || []
              }
              getWidgetConfig={(name) =>
                (name && ComponentManager.config(name)) || null
              }
              onSaveBindings={handleBulkProviderBindings}
              onOpenBotsView={() => {
                // Bots view is a viewing mode: close the modal and leave
                // edit mode (which asks first if there are unsaved edits).
                setIsConfigModalOpen(false);
                if (workspaceSelected) {
                  setStageModeByWorkspace((prev) => ({
                    ...prev,
                    [workspaceSelected.id]: "bots",
                  }));
                }
                handleToggleEditMode();
              }}
              onSaveListeners={handleBulkListenerBindings}
              onSaveUserPrefs={handleBulkUserPrefs}
              // One widget is edited in the edit panel (Phase 3P): Config
              // keeps its changes as unsaved dashboard changes, closes, and
              // the widget opens in the panel — on its page, at the section.
              onEditInPanel={
                isEditingDashboard
                  ? (target) => {
                      const found = findWidgetForHandOff(
                        workspaceSelected,
                        target,
                      );
                      if (!found) return;
                      if (
                        found.pageId != null &&
                        found.pageId !== currentActivePageId
                      ) {
                        handleSwitchPage(found.pageId);
                      }
                      const cell = findWidgetCell(found.layout, found.item.id);
                      setEditSelection({
                        kind: "widget",
                        uuid: found.item.uuid,
                        id: found.item.id,
                        component: found.item.component,
                        gridItemId: cell ? cell.gridItemId : null,
                        cellNumber: cell ? cell.cellNumber : null,
                        scope: found.scope,
                        label: pickWidgetDisplayName(
                          found.item,
                          ComponentManager.config(
                            found.item.component,
                            found.item,
                          ),
                        ),
                        openTab: "widget",
                        section: (target && target.section) || "edit",
                        sectionRequest: Date.now(),
                      });
                    }
                  : null
              }
              onSkip={() => {
                // Suppress the unresolved-providers banner for this
                // workspace (session-scoped). Matches the banner's own
                // X-dismiss behavior so the user has parity between
                // "dismiss from the banner" and "dismiss from the
                // modal footer."
                if (workspaceSelected?.id != null) {
                  setDismissedUnresolvedForWorkspace(
                    (prev) => new Set([...prev, workspaceSelected.id]),
                  );
                }
              }}
              initialTab="providers"
            />

            {/* Phase 3A first-run onboarding. Gated on
                `isOnboardingOpen === true` so the modal stays hidden
                during the pre-decision tri-state window and never
                flashes on returning-user launches. */}
            <OnboardingModal
              open={isOnboardingOpen === true}
              appId={credentials?.appId}
              workspaces={workspaceConfig}
              onDismiss={() => setIsOnboardingOpen(false)}
              onComplete={() => setIsOnboardingOpen(false)}
              onOpenDashboard={(ws) => {
                setIsOnboardingOpen(false);
                // Refresh workspaces before opening so the just-
                // installed Kitchen Sink shows up in the sidebar list
                // alongside the open tab.
                loadWorkspaces();
                handleOpenTab(ws);
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
          onOpenPage={handleOpenPageGuarded}
          onOpenWorkspace={handleOpenTab}
          onCreateNewWorkspace={() => openCreate("dashboard")}
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
          onCreate={() => openCreate()}
        />
      )}

      {/* Phase 2B unsaved-changes guard. Rendered at the root so it
          sits above every other surface (sidebar, modals, popouts).
          Triggered by `pendingNavigation` — set by handleToggleEditMode
          and handleOpenTabGuarded when they intercept a destructive
          action mid-edit. Discard commits the pending navigation;
          Cancel keeps the user in edit mode with their changes. */}
      {/* Leaving the Bots view with unsaved bot settings. */}
      <ConfirmationModal
        isOpen={Boolean(pendingLeaveBots)}
        setIsOpen={(open) => {
          if (!open) setPendingLeaveBots(null);
        }}
        title="Discard unsaved changes?"
        message="This bot's settings have changes that haven't been saved. Discard them and continue?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          const action = pendingLeaveBots;
          setPendingLeaveBots(null);
          botsDirtyRef.current = false;
          if (action) action();
        }}
        onCancel={() => setPendingLeaveBots(null)}
      />
      <ConfirmationModal
        isOpen={Boolean(pendingNavigation)}
        setIsOpen={(open) => {
          if (!open) setPendingNavigation(null);
        }}
        title="Discard unsaved changes?"
        message={
          pendingNavigation?.kind === "cancel-edit"
            ? "You have edits that haven't been saved. Discard them and exit edit mode?"
            : "You have edits that haven't been saved. Discard them and leave this dashboard?"
        }
        // Phase 1e (CRE-006 AC7): list what will be discarded and kept.
        children={
          cancelChanges && cancelChanges.discarded.length > 0 ? (
            <DiscardList changes={cancelChanges} />
          ) : null
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          const pending = pendingNavigation;
          // Clear the prompt first so the modal teardown doesn't race
          // a re-trigger from the same dirty-state read.
          setPendingNavigation(null);
          if (!pending) return;
          if (pending.kind === "cancel-edit") {
            performCancelEdit();
          } else {
            // Clear edit refs + dirty flag before navigating so the
            // next view doesn't inherit dirty state.
            currentWorkspaceRef.current = null;
            originalWorkspaceRef.current = null;
            setIsDirty(false);
            setPreviewMode(true);
            if (pending.kind === "open-workspace") {
              handleOpenTab(pending.workspace);
            } else if (pending.kind === "switch-tab") {
              handleSwitchTab(pending.tabId);
            } else if (pending.kind === "open-page") {
              handleOpenPage(pending.key, pending.opts);
            }
          }
        }}
        onCancel={() => setPendingNavigation(null)}
      />
    </LayoutContainer>
  );
};
