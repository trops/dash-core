import React, { useState, useMemo, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Button2,
  Button3,
  Card2,
  Tag,
  Switch,
  SearchInput,
  Divider,
  Caption,
  Caption2,
  Caption3,
  Code,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { ComponentManager } from "../../ComponentManager";
import {
  getAllProviderBindings,
  groupByProviderType,
} from "../../utils/providerResolution";
import {
  getEmitters,
  getReceivers,
  getCurrentWiring,
  getOrphanedListeners,
  formatEventString,
} from "../../utils/listenerResolution";
import { WidgetsTab } from "./WidgetsTab";
import { PermissionsTab } from "./PermissionsTab";

/**
 * DashboardConfigModal
 *
 * Workspace-scoped wiring panel. Lets a user assign providers to every
 * widget in the current workspace from one place instead of opening each
 * widget's settings individually. v1 ships the Providers tab; Listeners
 * tab lands in a follow-up PR (data model needs more exploration).
 *
 * Auto-opens on dashboard install when any required provider is still
 * unresolved after applying app-wide defaults. Also openable manually
 * via the dashboard toolbar's config button.
 *
 * @param {boolean} isOpen
 * @param {(open: boolean) => void} setIsOpen
 * @param {object}   workspace          Current workspace (layout/pages/sidebarLayout/selectedProviders).
 * @param {object|Array} appProviders   Either a map keyed by provider name, or an array. Each entry has
 *                                      at least { name?, type, providerClass, isDefaultForType }.
 * @param {(componentName: string) => Array} getWidgetRequirements
 *                                      Called per widget instance. Should return the `providers: [...]`
 *                                      array from the component's .dash.js. Usually backed by
 *                                      ComponentManager.componentMap().
 * @param {(componentName: string) => object | null} getWidgetConfig
 *                                      Called per widget instance. Returns the full ComponentManager
 *                                      entry (events, eventHandlers, displayName, …). Used by the
 *                                      Listeners tab to discover what each widget emits/handles.
 * @param {(changes: Array<{widgetId, providerType, providerName}>) => void} onSaveBindings
 *                                      Called with the staged provider changes on Save. The parent persists
 *                                      by forwarding to its existing `handleProviderSelect` /
 *                                      `saveWorkspace` plumbing.
 * @param {(changes: {adds: Array, removes: Array}) => void} onSaveListeners
 *                                      Called with the staged listener changes on Save. Each entry is
 *                                      `{ receiverItemId, handlerName, sourceComponent, sourceItemId, eventName }`.
 *                                      Parent uses `applyWiringChanges` + saveWorkspace.
 * @param {(changes: Array<{widgetId, key, value}>) => void} onSaveUserPrefs
 *                                      Called with the staged widget userPrefs changes on Save. Parent
 *                                      applies them to workspace + persists via saveWorkspace. Enables
 *                                      bulk-edit of fields shared across widgets (e.g. basePath).
 * @param {"providers"|"listeners"|"widgets"} initialTab  Which tab to focus when the modal opens.
 */
export const DashboardConfigModal = ({
  isOpen,
  setIsOpen,
  workspace,
  appProviders,
  getWidgetRequirements,
  getWidgetConfig = null,
  onSaveBindings,
  onSaveListeners,
  onSaveUserPrefs = null,
  onSkip = null,
  initialTab = "providers",
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  // Active tab. Defaults to whatever the parent requested via
  // `initialTab`. Resets on each open via the modal's mount cycle.
  const [activeTab, setActiveTab] = useState(initialTab);

  // Staged changes: widgetId -> { [providerType]: providerName }. Empty
  // until the user picks something; applied on Save via onSaveBindings.
  const [staged, setStaged] = useState({});

  // Staged listener changes — collected in the Listeners tab's UI and
  // committed alongside provider changes when the user clicks Save.
  // Shape: { adds: [...], removes: [...] } where each item is
  // { receiverItemId, handlerName, sourceComponent, sourceItemId, eventName, raw? }.
  const [stagedListeners, setStagedListeners] = useState({
    adds: [],
    removes: [],
  });

  // Staged widget userPrefs changes — collected in the Widgets tab.
  // Shape: { [widgetId]: { [fieldKey]: value } }. Committed alongside
  // providers + listeners when the user clicks Save.
  const [stagedPrefs, setStagedPrefs] = useState({});

  const bindings = useMemo(
    () =>
      getAllProviderBindings({
        workspace,
        appProviders,
        getWidgetRequirements,
      }),
    [workspace, appProviders, getWidgetRequirements],
  );

  // Reflect staged choice in resolution without persisting. Used to
  // render the "still unresolved after your changes" count in real time.
  const effectiveBindings = useMemo(
    () =>
      bindings.map((b) => {
        const override = staged[b.widgetId]?.[b.providerType];
        if (override !== undefined) {
          return {
            ...b,
            resolvedProviderName: override || null,
            staged: true,
          };
        }
        return b;
      }),
    [bindings, staged],
  );

  const grouped = useMemo(
    () => groupByProviderType(effectiveBindings),
    [effectiveBindings],
  );

  // Provider options per type, derived from the app's providers map.
  const providersByType = useMemo(() => {
    const byType = new Map();
    const push = (name, data) => {
      if (!data?.type) return;
      if (!byType.has(data.type)) byType.set(data.type, []);
      byType.get(data.type).push({
        name,
        isDefaultForType: !!data.isDefaultForType,
      });
    };
    if (!appProviders) return byType;
    if (Array.isArray(appProviders)) {
      for (const p of appProviders) push(p?.name, p);
    } else {
      for (const [name, data] of Object.entries(appProviders)) push(name, data);
    }
    return byType;
  }, [appProviders]);

  const unresolvedCount = effectiveBindings.filter(
    (b) => b.required && !b.resolvedProviderName,
  ).length;

  // Dependencies tab data — groups every widget instance in the
  // workspace by the package it belongs to, so the user can audit
  // which packages the dashboard actually references (and see which
  // pages/sidebar hold each instance). Matches the same derivation
  // order we use in WidgetCardHeader / LayoutBuilderConfigModal's
  // footer so the same package label shows in every surface.
  const dependencies = useMemo(() => {
    const byPackage = new Map();
    // Derive the @scope/package label from the layout item's scoped
    // component id. Layout items are always scoped post-v0.1.435
    // (LayoutModel migrates legacy bare names on load), so this is
    // the single source of truth — no config lookup, no workspace
    // fallback, no heuristics.
    const derivePackage = (item) => {
      const scopedId =
        typeof item?.component === "string" ? item.component : "";
      const parts = scopedId.split(".");
      if (parts.length === 3 && parts[0] && parts[1]) {
        // Group rows by `@scope/package` so two widgets from the same
        // package show up under one heading. The full scoped id is
        // surfaced per-row in the table (column-level identity).
        return `@${parts[0]}/${parts[1]}`;
      }
      // Defensive: an explicit packageId on the item still wins for
      // legacy items the migration couldn't auto-resolve.
      if (item?.packageId) return String(item.packageId);
      return "(unknown)";
    };

    // Tag each visit with its location so we can show users exactly
    // where in the tree a package is referenced. forEachWidget walks
    // the standard places but doesn't surface which one — so we do a
    // lightweight parallel walk and annotate.
    const annotatedWalks = [];
    if (Array.isArray(workspace?.layout)) {
      annotatedWalks.push({ location: "root", layout: workspace.layout });
    }
    if (Array.isArray(workspace?.pages)) {
      for (const page of workspace.pages) {
        if (Array.isArray(page?.layout)) {
          annotatedWalks.push({
            location: `page: ${page.name || page.id || "?"}`,
            layout: page.layout,
          });
        }
      }
    }
    if (Array.isArray(workspace?.sidebarLayout)) {
      annotatedWalks.push({
        location: "sidebar",
        layout: workspace.sidebarLayout,
      });
    }

    const visitedByLocation = new WeakSet();
    const collect = (items, location) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (item.component && !visitedByLocation.has(item)) {
          visitedByLocation.add(item);
          // Ignore layout containers — they're not widgets.
          if (
            item.component !== "Container" &&
            item.component !== "LayoutGridContainer"
          ) {
            const pkg = derivePackage(item);
            if (!byPackage.has(pkg)) {
              byPackage.set(pkg, {
                packageLabel: pkg,
                components: new Map(),
                locations: new Set(),
                total: 0,
              });
            }
            const entry = byPackage.get(pkg);
            entry.total += 1;
            entry.locations.add(location);
            const cKey = item.component;
            entry.components.set(cKey, (entry.components.get(cKey) || 0) + 1);
          }
        }
        if (Array.isArray(item.items)) collect(item.items, location);
        if (Array.isArray(item.layout)) collect(item.layout, location);
      }
    };
    for (const w of annotatedWalks) collect(w.layout, w.location);

    return Array.from(byPackage.values())
      .map((e) => ({
        ...e,
        components: Array.from(e.components.entries()).map(
          ([component, count]) => ({ component, count }),
        ),
        locations: Array.from(e.locations),
      }))
      .sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));
  }, [workspace, getWidgetConfig]);
  const dependencyCount = dependencies.length;
  // Second pass used for the badge when the user has an `(unknown)`
  // bucket — usually a sign of a stale reference they want to clean up.
  const hasUnknownDependency = dependencies.some(
    (d) => d.packageLabel === "(unknown)",
  );

  // Listeners tab data — emitter list, receiver list, current wiring,
  // orphans. All recompute when the workspace or staged delta changes
  // so the UI reflects pending edits without saving first.
  const wConfig = useMemo(
    () =>
      typeof getWidgetConfig === "function" ? getWidgetConfig : () => null,
    [getWidgetConfig],
  );
  const emitters = useMemo(
    () => getEmitters(workspace, wConfig),
    [workspace, wConfig],
  );
  const receivers = useMemo(
    () => getReceivers(workspace, wConfig),
    [workspace, wConfig],
  );
  const persistedWiring = useMemo(
    () => getCurrentWiring(workspace),
    [workspace],
  );
  const orphans = useMemo(
    () => getOrphanedListeners(workspace, wConfig),
    [workspace, wConfig],
  );
  const effectiveWiring = useMemo(() => {
    // Apply staged removes/adds to the persisted wiring for an
    // accurate "what will be there after save" view, then annotate
    // each entry with its orphan reason (if any) so HandlerCard chips
    // can render a stale-binding warning inline.
    let next = persistedWiring;
    if (stagedListeners.removes.length > 0) {
      next = next.filter(
        (w) => !stagedListeners.removes.some((r) => sameWiringEntry(r, w)),
      );
    }
    if (stagedListeners.adds.length > 0) {
      // Append; avoid duplicates against current state.
      for (const a of stagedListeners.adds) {
        if (!next.some((w) => sameWiringEntry(w, a))) {
          next = [
            ...next,
            {
              ...a,
              raw: formatEventString(
                a.sourceComponent,
                a.sourceItemId,
                a.eventName,
              ),
            },
          ];
        }
      }
    }
    if (orphans.length === 0) return next;
    const orphanIndex = new Map();
    for (const o of orphans) {
      orphanIndex.set(
        `${o.receiverItemId}|${o.handlerName}|${o.sourceComponent}|${o.sourceItemId}|${o.eventName}`,
        o.reason,
      );
    }
    return next.map((w) => {
      const key = `${w.receiverItemId}|${w.handlerName}|${w.sourceComponent}|${w.sourceItemId}|${w.eventName}`;
      const reason = orphanIndex.get(key);
      return reason ? { ...w, isOrphan: true, orphanReason: reason } : w;
    });
  }, [persistedWiring, stagedListeners, orphans]);
  // Orphans reduced by what the user has already staged for removal.
  const visibleOrphans = useMemo(
    () =>
      orphans.filter(
        (o) => !stagedListeners.removes.some((r) => sameWiringEntry(r, o)),
      ),
    [orphans, stagedListeners.removes],
  );

  const hasStagedChanges =
    Object.keys(staged).some(
      (wid) => Object.keys(staged[wid] || {}).length > 0,
    ) ||
    stagedListeners.adds.length > 0 ||
    stagedListeners.removes.length > 0 ||
    Object.keys(stagedPrefs).some(
      (wid) => Object.keys(stagedPrefs[wid] || {}).length > 0,
    );

  function stagePrefField(widgetId, key, value) {
    setStagedPrefs((prev) => ({
      ...prev,
      [widgetId]: { ...(prev[widgetId] || {}), [key]: value },
    }));
  }

  function stagePrefFieldForAll(targetWidgets, key, value) {
    setStagedPrefs((prev) => {
      const next = { ...prev };
      for (const w of targetWidgets) {
        next[w.id] = { ...(next[w.id] || {}), [key]: value };
      }
      return next;
    });
  }

  function stageBinding(widgetId, providerType, providerName) {
    setStaged((prev) => {
      const next = { ...prev };
      const wid = next[widgetId] ? { ...next[widgetId] } : {};
      wid[providerType] = providerName || "";
      next[widgetId] = wid;
      return next;
    });
  }

  // Bulk-apply: retarget every widget of this provider type to the
  // newly-chosen provider name. The header text above the dropdown
  // says "Apply one provider to every widget of this type, or adjust
  // per-widget below" — bulk is the retarget-everything action;
  // per-row overrides happen AFTER bulk if the user wants exceptions.
  //
  // Previous behavior skipped rows that already had an explicit pick,
  // which meant the dropdown was a no-op when every row already had a
  // value (the common case: every Slack widget on a dashboard inherits
  // the same Slack provider). The user changing bulk from "Slack" to
  // "Slack Dash Comms" would see zero rows update and Save stay
  // disabled. The fill-blanks-only semantics fought the UI text and
  // the user's mental model — every spreadsheet-style bulk operation
  // overrides everything, with per-row tweaks happening afterward.
  function stageBulk(providerType, providerName) {
    const affected = effectiveBindings.filter(
      (b) => b.providerType === providerType,
    );
    setStaged((prev) => {
      const next = { ...prev };
      for (const b of affected) {
        if (!b.widgetId) continue;
        next[b.widgetId] = {
          ...(next[b.widgetId] || {}),
          [providerType]: providerName || "",
        };
      }
      return next;
    });
  }

  // Listener tab staging helpers. We treat add/remove as queue
  // operations so the user can build up several edits before
  // committing. Toggling a binding that's already staged in the
  // opposite direction cancels the staged change rather than queuing
  // both — keeps the diff minimal and the save predictable.
  const stageListenerAdd = (entry) => {
    setStagedListeners((prev) => {
      const removeIdx = prev.removes.findIndex((r) =>
        sameWiringEntry(r, entry),
      );
      if (removeIdx >= 0) {
        return {
          adds: prev.adds,
          removes: prev.removes.filter((_, i) => i !== removeIdx),
        };
      }
      if (prev.adds.some((a) => sameWiringEntry(a, entry))) return prev;
      return { adds: [...prev.adds, entry], removes: prev.removes };
    });
  };
  const stageListenerRemove = (entry) => {
    setStagedListeners((prev) => {
      const addIdx = prev.adds.findIndex((a) => sameWiringEntry(a, entry));
      if (addIdx >= 0) {
        return {
          adds: prev.adds.filter((_, i) => i !== addIdx),
          removes: prev.removes,
        };
      }
      if (prev.removes.some((r) => sameWiringEntry(r, entry))) return prev;
      return { adds: prev.adds, removes: [...prev.removes, entry] };
    });
  };

  function handleSave() {
    // Provider changes
    const providerChanges = [];
    for (const [widgetId, byType] of Object.entries(staged)) {
      for (const [providerType, providerName] of Object.entries(byType)) {
        providerChanges.push({
          widgetId,
          providerType,
          providerName: providerName || null,
        });
      }
    }
    if (providerChanges.length > 0 && typeof onSaveBindings === "function") {
      onSaveBindings(providerChanges);
    }

    // Listener changes
    if (
      (stagedListeners.adds.length > 0 || stagedListeners.removes.length > 0) &&
      typeof onSaveListeners === "function"
    ) {
      onSaveListeners(stagedListeners);
    }

    // Widget userPrefs changes (Widgets tab)
    const prefChanges = [];
    for (const [widgetId, fields] of Object.entries(stagedPrefs)) {
      for (const [key, value] of Object.entries(fields)) {
        prefChanges.push({ widgetId, key, value });
      }
    }
    if (prefChanges.length > 0 && typeof onSaveUserPrefs === "function") {
      onSaveUserPrefs(prefChanges);
    }

    setStaged({});
    setStagedListeners({ adds: [], removes: [] });
    setStagedPrefs({});
    setIsOpen(false);
  }

  function handleCancel() {
    setStaged({});
    setStagedListeners({ adds: [], removes: [] });
    setStagedPrefs({});
    setIsOpen(false);
  }

  // "Skip for now" — closes the modal AND tells the parent to suppress
  // the unresolved-providers banner for the current session. Cancel
  // just closes; Skip means "I'm intentionally not dealing with this
  // right now." Without this affordance, new users who hit the
  // post-install state can feel cornered by the banner reappearing
  // every time they close the modal without resolving every provider.
  function handleSkip() {
    setStaged({});
    setStagedListeners({ adds: [], removes: [] });
    setStagedPrefs({});
    if (typeof onSkip === "function") onSkip();
    setIsOpen(false);
  }

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={handleCancel}
      width="w-11/12 max-w-5xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex flex-row items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon="sliders" className="h-4 w-4 opacity-70" />
            <span className="text-lg font-semibold">Dashboard Config</span>
            {unresolvedCount > 0 && (
              <Tag
                text={`${unresolvedCount} unresolved`}
                className="bg-amber-900/40 text-amber-200"
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <FontAwesomeIcon icon="xmark" className="h-5 w-5" />
          </button>
        </div>
        <Divider />

        {/* Tabs */}
        <div className="flex-shrink-0 flex flex-row items-center gap-2 px-4 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab("providers")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "providers"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Providers
            {unresolvedCount > 0 && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("listeners")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "listeners"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Listeners
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "notifications"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Notifications
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("widgets")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "widgets"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Widgets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("permissions")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "permissions"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Permissions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("dependencies")}
            className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${
              activeTab === "dependencies"
                ? "border-indigo-400"
                : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            Dependencies
            {dependencyCount > 0 && (
              <Caption2 className="ml-2">({dependencyCount})</Caption2>
            )}
            {hasUnknownDependency && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
            )}
          </button>
        </div>
        <Divider />

        {/* Body — flex-1 so it fills the fixed-height modal; min-h-0 so
            inner columns can own their own scroll containers. */}
        <div
          className={`flex-1 min-h-0 ${activeTab === "widgets" ? "" : "p-5"}`}
        >
          {activeTab === "listeners" && (
            <ListenersTab
              emitters={emitters}
              receivers={receivers}
              wiring={effectiveWiring}
              onAdd={stageListenerAdd}
              onRemove={stageListenerRemove}
            />
          )}
          {activeTab === "providers" && (
            <ProvidersTab
              grouped={grouped}
              providersByType={providersByType}
              onBulk={stageBulk}
              onPerWidget={stageBinding}
            />
          )}
          {activeTab === "notifications" && (
            <NotificationsTab workspace={workspace} />
          )}
          {activeTab === "widgets" && (
            <WidgetsTab
              workspace={workspace}
              getWidgetConfig={getWidgetConfig}
              stagedPrefs={stagedPrefs}
              stagePrefField={stagePrefField}
              stagePrefFieldForAll={stagePrefFieldForAll}
            />
          )}
          {activeTab === "permissions" && (
            <PermissionsTab workspace={workspace} />
          )}
          {activeTab === "dependencies" && (
            <DependenciesTab dependencies={dependencies} />
          )}
        </div>

        <Divider />
        {/* Footer */}
        <div className="flex-shrink-0 flex flex-row justify-end gap-2 p-4">
          {typeof onSkip === "function" && (
            <Button3 title="Skip for now" onClick={handleSkip} />
          )}
          <Button3 title="Cancel" onClick={handleCancel} />
          <Button2
            title={hasStagedChanges ? "Save changes" : "Save"}
            onClick={handleSave}
            disabled={!hasStagedChanges}
          />
        </div>
      </div>
    </Modal>
  );
};

/**
 * Notifications tab — dashboard-scoped view of every widget instance
 * in the current workspace that declares notifications. Bulk Enable
 * all / Disable all controls flip every notification toggle in the
 * filtered list at once. Per-widget toggles persist immediately via
 * `mainApi.notifications.setPreferences` — same path Settings →
 * Notifications uses, so the two views stay consistent.
 *
 * Toggles are uncontrolled-with-respect-to-the-server: we mirror them
 * locally for snappy UI but the IPC call is fire-and-forget. If a
 * write fails the user can re-toggle. No staging — the bulk modal
 * doesn't gate the user behind a Save button for boolean prefs.
 */
function NotificationsTab({ workspace }) {
  const [searchQuery, setSearchQuery] = useState("");
  // Local mirror of widgetUuid -> { typeKey: bool }. Seeded from the
  // main process on mount; updated optimistically on toggle.
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!window.mainApi?.notifications?.getPreferences) {
      setLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    window.mainApi.notifications.getPreferences().then((p) => {
      if (cancelled) return;
      setPrefs(p?.instances || {});
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Collect every widget instance in THIS workspace that declares
  // notifications, alphabetized by title. Mirrors the Settings →
  // Notifications collection logic but scoped to one workspace.
  const widgetInstances = useMemo(() => {
    const out = [];
    // Dedup by stable id. WorkspaceModel auto-migrates legacy
    // non-paged workspaces by aliasing pages[0].layout = workspace.layout
    // (same reference), so visiting both yields duplicate pushes for
    // every widget. Same stableId formula as providerResolution.js
    // forEachWidget so the two stay consistent.
    const seen = new Set();
    const visit = (item) => {
      if (!item) return;
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      if (item.component) {
        const idPart = item.uuidString || item.uuid || item.id;
        const stableId = idPart != null ? `${item.component}|${idPart}` : null;
        if (stableId && seen.has(stableId)) {
          // Already collected — fall through to children walk so we
          // don't accidentally drop a nested widget under this node.
        } else {
          if (stableId) seen.add(stableId);
          const config = ComponentManager.resolve(item.component, item);
          if (config?.notifications?.length > 0) {
            out.push({
              uuid: item.uuid || item.uuidString,
              title:
                item.userPrefs?.title || config.displayName || item.component,
              package: config.package || "Other",
              // Scoped component id (e.g. "trops.google.GoogleWidget")
              // — disambiguates rows when several widgets share a
              // title or display the same package label. Mirrors the
              // Listeners tab convention so the user only learns one
              // identification scheme.
              component: item.component,
              // Layout instance id — disambiguates two widgets of the
              // SAME component on the dashboard (e.g. two GitHub
              // widgets in the same workspace).
              itemId: item.id,
              notifications: config.notifications,
            });
          }
        }
      }
      if (Array.isArray(item.children)) item.children.forEach(visit);
      if (Array.isArray(item.layout)) item.layout.forEach(visit);
      if (Array.isArray(item.items)) item.items.forEach(visit);
    };
    visit(workspace?.layout);
    if (Array.isArray(workspace?.pages)) {
      workspace.pages.forEach((p) => visit(p?.layout));
    }
    visit(workspace?.sidebarLayout);
    return out.sort((a, b) =>
      String(a.title).localeCompare(String(b.title), undefined, {
        sensitivity: "base",
      }),
    );
  }, [workspace]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return widgetInstances;
    return widgetInstances.filter((wi) => {
      const hay = [
        wi.title,
        wi.package,
        wi.component,
        wi.itemId != null ? `#${wi.itemId}` : "",
        ...wi.notifications.map((n) => `${n.key} ${n.displayName || ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [widgetInstances, searchQuery]);

  const isEnabled = (uuid, typeKey, defaultEnabled) => {
    const w = prefs[uuid];
    if (w && typeof w[typeKey] === "boolean") return w[typeKey];
    return !!defaultEnabled;
  };

  const setOne = (uuid, typeKey, value) => {
    setPrefs((prev) => ({
      ...prev,
      [uuid]: { ...(prev[uuid] || {}), [typeKey]: value },
    }));
    window.mainApi?.notifications?.setPreferences(uuid, {
      [typeKey]: value,
    });
  };

  const setAllVisible = (value) => {
    // Update local state in one pass + fire one IPC per widget.
    setPrefs((prev) => {
      const next = { ...prev };
      filtered.forEach((wi) => {
        const w = { ...(next[wi.uuid] || {}) };
        wi.notifications.forEach((n) => {
          w[n.key] = value;
        });
        next[wi.uuid] = w;
      });
      return next;
    });
    filtered.forEach((wi) => {
      const update = {};
      wi.notifications.forEach((n) => {
        update[n.key] = value;
      });
      window.mainApi?.notifications?.setPreferences(wi.uuid, update);
    });
  };

  if (!loaded) {
    return <div className="p-4 text-sm opacity-50">Loading…</div>;
  }

  if (widgetInstances.length === 0) {
    return (
      <div className="p-4 text-sm opacity-50">
        No widgets in this dashboard declare notifications. Add widgets that
        declare notifications to see per-type controls here.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-2 px-2 py-2 flex-shrink-0">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search widgets..."
          inputClassName="py-1.5 text-xs"
        />
        <div className="flex flex-row items-center justify-between text-xs">
          <span className="opacity-50">
            {filtered.length} of {widgetInstances.length} widget
            {widgetInstances.length === 1 ? "" : "s"}
          </span>
          <div className="flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setAllVisible(true)}
              className="px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors"
              data-testid="bulk-notifications-enable-all"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => setAllVisible(false)}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition-colors"
              data-testid="bulk-notifications-disable-all"
            >
              Disable all
            </button>
          </div>
        </div>
      </div>
      <Divider />
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {filtered.map((wi) => (
          <div
            key={wi.uuid}
            className="border border-white/10 rounded p-3 space-y-2"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{wi.title}</span>
              <Caption className="font-mono">
                {wi.component}
                {wi.itemId != null ? ` · #${wi.itemId}` : ""}
              </Caption>
              <Caption3>{wi.package}</Caption3>
            </div>
            <div className="flex flex-row gap-2">
              <Divider orientation="vertical" />
              <div className="flex flex-col flex-1">
                {wi.notifications.map((notif) => (
                  <div
                    key={notif.key}
                    className="flex flex-row items-center justify-between gap-3 py-2 px-2 -mx-2 rounded hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs">{notif.displayName}</span>
                      {notif.description && (
                        <Caption>{notif.description}</Caption>
                      )}
                    </div>
                    <Switch
                      checked={isEnabled(
                        wi.uuid,
                        notif.key,
                        notif.defaultEnabled,
                      )}
                      onChange={(value) => setOne(wi.uuid, notif.key, value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Providers tab with a sidebar/detail layout mirroring the Listeners
 * tab. Column 1 lists provider types in this workspace (with an amber
 * dot per-type when any widget of that type is unresolved). Column 2
 * shows the selected type's bulk dropdown + per-widget dropdowns.
 */
function ProvidersTab({ grouped, providersByType, onBulk, onPerWidget }) {
  const typeEntries = useMemo(() => Array.from(grouped.entries()), [grouped]);
  const [selectedType, setSelectedType] = useState(typeEntries[0]?.[0] || null);

  // If the selected type disappears (workspace changed), fall back.
  useMemo(() => {
    if (selectedType && !grouped.has(selectedType)) {
      setSelectedType(typeEntries[0]?.[0] || null);
    }
  }, [grouped, selectedType, typeEntries]);

  if (typeEntries.length === 0) {
    return (
      <div className="text-sm opacity-60 text-center py-6">
        No widgets in this dashboard require providers.
      </div>
    );
  }

  const selectedRows = selectedType ? grouped.get(selectedType) || [] : [];
  const selectedOptions = selectedType
    ? providersByType.get(selectedType) || []
    : [];
  const allSame =
    selectedRows.length > 0 &&
    selectedRows.every(
      (r) => r.resolvedProviderName === selectedRows[0].resolvedProviderName,
    );
  const topValue = allSame ? selectedRows[0]?.resolvedProviderName || "" : "";

  return (
    <div className="flex flex-row gap-3 h-full min-h-0">
      {/* Sidebar: provider types.
       *
       * Plain div wrapper to inherit the modal's bg-primary-medium —
       * the Card2 primitive resolves to bg-secondary-very-light (a
       * contrasting card surface, see dash-react Utils/colors.js:161),
       * which reads as a washed-out fill inside a modal that's
       * already dark. Mirrors the pattern used by WidgetsTab.js plus
       * every other tab in this modal. The `border-r border-white/10`
       * divider follows the chrome's convention even though opacity-
       * modifier borders don't render in dash-electron's prebuilt
       * CSS bundle today — keeps this in sync with WidgetsTab so a
       * future safelist fix lights both up uniformly.
       */}
      <div className="w-56 flex-shrink-0 overflow-hidden flex flex-col border-r border-white/10">
        <div className="px-3 py-2 text-xs font-semibold opacity-50 uppercase tracking-wider">
          Provider Types
        </div>
        <Divider />
        <div className="overflow-y-auto flex-1">
          {typeEntries.map(([providerType, rows]) => {
            const isActive = selectedType === providerType;
            const unresolvedHere = rows.filter(
              (r) => r.required && !r.resolvedProviderName,
            ).length;
            return (
              <button
                key={providerType}
                type="button"
                onClick={() => setSelectedType(providerType)}
                className={`w-full text-left px-3 py-2 border-l-2 ${
                  isActive
                    ? "bg-indigo-900/30 border-indigo-400"
                    : "border-transparent hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {providerType}
                  </span>
                  {unresolvedHere > 0 && (
                    <span className="text-[10px] text-amber-300 flex items-center gap-1">
                      <FontAwesomeIcon
                        icon="triangle-exclamation"
                        className="h-2.5 w-2.5"
                      />
                      {unresolvedHere}
                    </span>
                  )}
                </div>
                <div className="text-xs opacity-50 mt-0.5">
                  {rows.length} widget{rows.length === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail: bulk assign + per-widget overrides for selected type.
       * Plain <div> for the same theming reason — see the sidebar
       * comment above. No right-border (this pane is the last column).
       */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {selectedType ? (
          <>
            <div className="px-4 py-3 flex-shrink-0">
              <div className="text-sm font-semibold">
                {selectedType}{" "}
                <span className="opacity-60 font-normal">provider</span>
              </div>
              <div className="text-xs opacity-60 mt-1">
                Apply one provider to every widget of this type, or adjust
                per-widget below.
              </div>
            </div>
            <Divider />
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Bulk assign */}
              <div className="flex items-center gap-3">
                <span className="text-xs opacity-60 flex-shrink-0 w-20">
                  Bulk assign
                </span>
                <select
                  value={topValue}
                  onChange={(e) => onBulk(selectedType, e.target.value)}
                  className="flex-1 bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm"
                >
                  <option value="">— Select provider —</option>
                  {selectedOptions.map((opt) => (
                    <option key={opt.name} value={opt.name}>
                      {opt.name}
                      {opt.isDefaultForType ? "  (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Per-widget overrides */}
              <div>
                <div className="text-xs font-semibold opacity-50 uppercase tracking-wider mb-2">
                  Per-widget
                </div>
                <div>
                  {selectedRows.map((row) => {
                    const hasExplicitOverride =
                      !!row.layoutItem?.selectedProviders?.[selectedType];
                    const isRequired = !!row.required;
                    const isMissing = !row.resolvedProviderName;
                    const needsAttention = isRequired && isMissing;
                    return (
                      <div
                        key={`${row.widgetId}:${row.providerType}`}
                        className={`flex flex-row items-center gap-3 py-2 px-2 rounded border-l-2 transition-colors ${
                          needsAttention
                            ? "bg-red-900 border-red-500"
                            : "border-transparent hover:bg-gray-800"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm truncate flex items-center gap-1.5 ${
                              needsAttention
                                ? "font-semibold text-red-100"
                                : "font-medium"
                            }`}
                          >
                            <span className="truncate">
                              {row.label || row.component || "widget"}
                            </span>
                            {isRequired && (
                              <span
                                className={
                                  needsAttention
                                    ? "text-red-300"
                                    : "text-indigo-300"
                                }
                                title="Required provider"
                                aria-label="required"
                              >
                                *
                              </span>
                            )}
                          </div>
                          {(row.widgetRef || row.component) && (
                            <Caption
                              block
                              className="font-mono truncate mt-0.5"
                              title={row.widgetRef || row.component}
                            >
                              {row.widgetRef || row.component}
                            </Caption>
                          )}
                          <div className="flex items-center gap-1.5 mt-1 text-xs">
                            <span
                              className={`uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${
                                needsAttention
                                  ? "bg-red-600 text-white"
                                  : isRequired
                                    ? "bg-indigo-800 text-indigo-100"
                                    : "bg-gray-700 text-gray-300"
                              }`}
                            >
                              {isRequired ? "required" : "optional"}
                            </span>
                            {hasExplicitOverride && (
                              <span className="uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold bg-indigo-900 text-indigo-200">
                                override
                              </span>
                            )}
                            <span className="opacity-40 truncate ml-1">
                              {(row.widgetId || "").slice(0, 8)}
                            </span>
                          </div>
                        </div>
                        <select
                          value={row.resolvedProviderName || ""}
                          onChange={(e) =>
                            onPerWidget(
                              row.widgetId,
                              selectedType,
                              e.target.value,
                            )
                          }
                          className={`bg-gray-800 border rounded px-2 py-1 text-xs min-w-[12rem] ${
                            needsAttention
                              ? "border-red-400"
                              : "border-gray-700"
                          }`}
                        >
                          <option value="">— none —</option>
                          {selectedOptions.map((opt) => (
                            <option key={opt.name} value={opt.name}>
                              {opt.name}
                              {opt.isDefaultForType ? "  (default)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm opacity-60">
            Pick a provider type to bulk-assign or adjust per widget.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Legacy inline provider-type card (unused by the new ProvidersTab
 * layout but kept for any callers that still embed it directly).
 */
function ProviderTypeRow({
  providerType,
  rows,
  options,
  topValue,
  unresolvedHere,
  onBulk,
  onPerWidget,
}) {
  const [expanded, setExpanded] = useState(unresolvedHere > 0);
  const widgetCount = rows.length;

  return (
    <Card2 padding="p-3" shadow="" rounded="rounded-lg" className="space-y-3">
      <div className="flex flex-row items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Code>{providerType}</Code>
            <span className="text-xs opacity-60">
              {widgetCount} widget{widgetCount === 1 ? "" : "s"}
            </span>
            {unresolvedHere > 0 && (
              <span className="text-xs text-amber-300 flex items-center gap-1">
                <FontAwesomeIcon
                  icon="triangle-exclamation"
                  className="h-3 w-3"
                />
                {unresolvedHere} unresolved
              </span>
            )}
          </div>
        </div>
        <select
          value={topValue}
          onChange={(e) => onBulk(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm min-w-[14rem]"
        >
          <option value="">— Select provider —</option>
          {options.map((opt) => (
            <option key={opt.name} value={opt.name}>
              {opt.name}
              {opt.isDefaultForType ? "  (default)" : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs opacity-60 hover:opacity-100 flex items-center gap-1"
      >
        <FontAwesomeIcon
          icon={expanded ? "chevron-down" : "chevron-right"}
          className="h-3 w-3"
        />
        {expanded ? "Hide" : "Show"} per-widget overrides
      </button>

      {expanded && (
        <div className="flex flex-row gap-3">
          <Divider orientation="vertical" />
          <div className="flex-1 space-y-2">
            {rows.map((row) => {
              const hasExplicitOverride =
                !!row.layoutItem?.selectedProviders?.[providerType];
              return (
                <div
                  key={`${row.widgetId}:${row.providerType}`}
                  className="flex flex-row items-center gap-3"
                >
                  <div className="flex-1 min-w-0 text-xs">
                    <span className="font-mono opacity-80 truncate">
                      {row.component || "widget"}
                    </span>
                    <span className="opacity-40 mx-1">·</span>
                    <span className="font-mono opacity-40 truncate">
                      {(row.widgetId || "").slice(0, 8)}
                    </span>
                    {hasExplicitOverride && (
                      <span className="ml-2 text-[10px] text-indigo-300 uppercase tracking-wide">
                        widget override
                      </span>
                    )}
                    {!row.resolvedProviderName && row.required && (
                      <span className="ml-2 text-[10px] text-amber-300 uppercase tracking-wide">
                        unresolved
                      </span>
                    )}
                  </div>
                  <select
                    value={row.resolvedProviderName || ""}
                    onChange={(e) => onPerWidget(row.widgetId, e.target.value)}
                    className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs min-w-[12rem]"
                  >
                    <option value="">— none —</option>
                    {options.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name}
                        {opt.isDefaultForType ? "  (default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card2>
  );
}

// ─── Dependencies tab ──────────────────────────────────────────────────────

/**
 * Read-only breakdown of every widget package referenced by the
 * workspace. Same source of truth as the dashboard publish plan (it
 * walks layout + pages + sidebar + nested LayoutGridContainer items),
 * surfaced earlier in the authoring flow so the user can verify which
 * packages the dashboard actually pulls in — and catch stale references
 * before hitting the Publish modal.
 *
 * `(unknown)` buckets mean a component we couldn't map back to a
 * package (no `config.id` / `config.package` / item.workspace hint).
 * Usually this is a stale layout item whose widget got uninstalled.
 */
function DependenciesTab({ dependencies }) {
  if (!dependencies || dependencies.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm opacity-60 text-center">
        <div>No widget packages referenced by this dashboard.</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto gap-3">
      <div className="text-xs opacity-60">
        Every widget instance in this workspace, grouped by the package it
        belongs to. Locations show where each package is referenced.
      </div>
      {dependencies.map((dep) => {
        const isUnknown = dep.packageLabel === "(unknown)";
        return (
          <div
            key={dep.packageLabel}
            className={`border rounded-lg px-4 py-3 ${
              isUnknown
                ? "bg-amber-900/10 border-amber-700/40"
                : "bg-white/5 border-white/10"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className={`text-sm font-semibold ${
                  isUnknown ? "text-amber-200" : ""
                }`}
              >
                {dep.packageLabel}
              </code>
              <span className="text-xs opacity-60">
                {dep.total} instance{dep.total === 1 ? "" : "s"}
              </span>
              {isUnknown && (
                <span className="text-[10px] text-amber-300 uppercase tracking-wide">
                  no package mapping
                </span>
              )}
            </div>
            <div className="mt-2 text-xs opacity-70">
              <div>
                <span className="opacity-60 mr-1">Widgets:</span>
                {dep.components
                  .map(
                    (c) => `${c.component}${c.count > 1 ? ` ×${c.count}` : ""}`,
                  )
                  .join(", ")}
              </div>
              <div className="mt-1">
                <span className="opacity-60 mr-1">Locations:</span>
                {dep.locations.join(", ")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Listeners tab ──────────────────────────────────────────────────────────

/**
 * Match two wiring entries on the four fields that uniquely identify
 * a listener binding (receiver + handler + source + event). Used to
 * dedupe stages, cancel opposite-direction stages, and detect "is
 * this binding already there".
 */
function sameWiringEntry(a, b) {
  if (!a || !b) return false;
  return (
    String(a.receiverItemId) === String(b.receiverItemId) &&
    a.handlerName === b.handlerName &&
    a.sourceComponent === b.sourceComponent &&
    String(a.sourceItemId) === String(b.sourceItemId) &&
    a.eventName === b.eventName
  );
}

const ORPHAN_REASON_LABEL = {
  "source-missing": "The emitting widget was deleted.",
  "source-component-mismatch":
    "The emitter's id is now held by a different widget.",
  "event-not-emitted": "The emitting widget no longer emits this event.",
  "handler-not-declared":
    "This widget no longer declares this handler in its code.",
};

/**
 * Receiver-centric sidebar/detail layout. Mirrors the per-widget
 * PanelEditItemHandlers pattern (handler-by-handler editing) but
 * scoped to the whole dashboard. Picking a widget on the left shows
 * its handlers + currently wired sources on the right; the user
 * adjusts wiring per handler from a single dropdown of all emitters'
 * (widget × event) pairs.
 */
function ListenersTab({ emitters, receivers, wiring, onAdd, onRemove }) {
  const [selectedReceiverKey, setSelectedReceiverKey] = useState(
    receivers[0]?.key || null,
  );
  const [selectedHandler, setSelectedHandler] = useState(null);

  // Re-anchor selection if the previously-selected widget disappeared
  // (workspace switched, widget deleted, etc.).
  useMemo(() => {
    if (
      selectedReceiverKey &&
      !receivers.some((r) => r.key === selectedReceiverKey)
    ) {
      setSelectedReceiverKey(receivers[0]?.key || null);
    }
  }, [receivers, selectedReceiverKey]);

  // Receiver lookup (by composite key) for label resolution in chips.
  const receiverByKey = useMemo(() => {
    const m = new Map();
    for (const r of receivers) m.set(r.key, r);
    return m;
  }, [receivers]);

  if (receivers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm opacity-60 text-center">
        <div>
          No widgets in this dashboard declare event handlers.
          {emitters.length > 0 && (
            <div className="mt-2">
              ({emitters.length} widget{emitters.length === 1 ? "" : "s"} emit
              events but nothing is set up to receive.)
            </div>
          )}
        </div>
      </div>
    );
  }

  const selectedReceiver = selectedReceiverKey
    ? receiverByKey.get(selectedReceiverKey) || null
    : null;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex flex-row gap-3 flex-1 min-h-0">
        {/* Sidebar: receivers. Plain <div> wrapper — Card2's
            washed-out fill clashes with the modal's dark chrome.
            Same fix as ProvidersTab + WidgetsTab. */}
        <div className="w-56 flex-shrink-0 overflow-hidden flex flex-col">
          <div className="px-3 py-2 text-xs font-semibold opacity-50 uppercase tracking-wider">
            Widgets
          </div>
          <Divider />
          <div className="overflow-y-auto flex-1">
            {receivers.map((r) => {
              const isActive = r.key === selectedReceiverKey;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSelectedReceiverKey(r.key)}
                  className={`w-full text-left px-3 py-2 border-l-2 ${
                    isActive
                      ? "bg-indigo-900/30 border-indigo-400"
                      : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <div className="text-sm font-medium truncate">{r.label}</div>
                  {r.widgetRef && (
                    <Caption
                      block
                      className="font-mono truncate mt-0.5"
                      title={r.widgetRef}
                    >
                      {r.widgetRef}
                    </Caption>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Handlers column (middle) + events column (right), mirroring
          the two-column layout from the per-widget settings panel. */}
        {selectedReceiver ? (
          <>
            <HandlersColumn
              receiver={selectedReceiver}
              myWiring={wiring.filter(
                (w) =>
                  w.receiverComponent === selectedReceiver.component &&
                  String(w.receiverItemId) === String(selectedReceiver.itemId),
              )}
              selectedHandler={
                selectedHandler &&
                selectedReceiver.eventHandlers.includes(selectedHandler)
                  ? selectedHandler
                  : null
              }
              onSelectHandler={setSelectedHandler}
            />
            <EventsColumn
              receiver={selectedReceiver}
              handlerName={
                selectedHandler &&
                selectedReceiver.eventHandlers.includes(selectedHandler)
                  ? selectedHandler
                  : null
              }
              myWiring={wiring.filter(
                (w) =>
                  w.receiverComponent === selectedReceiver.component &&
                  String(w.receiverItemId) === String(selectedReceiver.itemId),
              )}
              emitters={emitters}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          </>
        ) : (
          <div className="flex-1 min-w-0 flex items-center justify-center text-sm opacity-60">
            Pick a widget on the left to wire its handlers.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Top-of-tab banner surfacing every orphaned listener binding with a
 * bulk "Remove all" action plus per-binding removes. An orphan is a
 * saved connection to a widget/event/handler that no longer exists in
 * the current workspace. Lives above the 3-column layout so it's
 * always visible regardless of which widget the user has selected.
 */
function OrphanBanner({ orphans, receiverByKey, onRemove }) {
  const labelForReceiver = (o) => {
    const key = `${o.receiverComponent}|${o.receiverItemId}`;
    return (
      receiverByKey.get(key)?.label ||
      `${o.receiverComponent}[${o.receiverItemId}]`
    );
  };

  return (
    <div className="flex-shrink-0 bg-amber-900/20 border border-amber-700/40 rounded-lg">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-amber-700/30">
        <FontAwesomeIcon
          icon="triangle-exclamation"
          className="h-4 w-4 text-amber-300 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-100">
            {orphans.length} stale connection
            {orphans.length === 1 ? "" : "s"} found
          </div>
          <div className="text-xs text-amber-200 opacity-80">
            Saved bindings that point at widgets, events, or handlers that no
            longer exist. Removing them is always safe.
          </div>
        </div>
        <button
          type="button"
          onClick={() => orphans.forEach((o) => onRemove(o))}
          className="flex-shrink-0 text-xs bg-amber-800 hover:bg-amber-700 text-amber-100 rounded px-3 py-1.5"
        >
          Remove all
        </button>
      </div>
      <ul className="max-h-32 overflow-y-auto text-xs text-amber-100 divide-y divide-amber-700/20">
        {orphans.map((o) => (
          <li
            key={`${o.receiverComponent}|${o.receiverItemId}|${o.handlerName}|${o.sourceComponent}|${o.sourceItemId}|${o.eventName}`}
            className="flex items-center gap-2 px-4 py-1.5"
          >
            <span className="flex-1 min-w-0 truncate">
              <span className="font-medium">{labelForReceiver(o)}</span>
              <span className="opacity-70">'s </span>
              <code>{o.handlerName}</code>
              <span className="opacity-70"> ← </span>
              <code>
                {o.sourceComponent}[{o.sourceItemId}].{o.eventName}
              </code>
              <span className="opacity-70 ml-2">
                ({ORPHAN_REASON_LABEL[o.reason] || "stale"})
              </span>
            </span>
            <button
              type="button"
              onClick={() => onRemove(o)}
              className="flex-shrink-0 text-amber-300 hover:text-amber-100 underline underline-offset-2"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Second column (within ListenersTab): the selected receiver's
 * handlers with connection counts. Picking one lights up the
 * third column. Matches the left-column look from
 * PanelEditItemHandlers.
 */
function HandlersColumn({
  receiver,
  myWiring,
  selectedHandler,
  onSelectHandler,
}) {
  const countsByHandler = useMemo(() => {
    const m = new Map();
    for (const w of myWiring) {
      m.set(w.handlerName, (m.get(w.handlerName) || 0) + 1);
    }
    return m;
  }, [myWiring]);

  return (
    // Plain <div> wrapper — Card2 reads as washed-out against the
    // modal's dark chrome. See ListenersTab + ProvidersTab fix.
    <div className="w-56 flex-shrink-0 overflow-hidden flex flex-col">
      <div className="px-3 py-2 text-xs font-semibold opacity-50 uppercase tracking-wider">
        Event Handlers
      </div>
      <Divider />
      <div className="overflow-y-auto flex-1">
        {receiver.eventHandlers.length === 0 ? (
          <div className="text-xs opacity-50 text-center py-6 px-3">
            This widget declares no event handlers.
          </div>
        ) : (
          receiver.eventHandlers.map((h) => {
            const isActive = h === selectedHandler;
            const count = countsByHandler.get(h) || 0;
            return (
              <button
                key={h}
                type="button"
                onClick={() => onSelectHandler(h)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 border-l-2 ${
                  isActive
                    ? "bg-indigo-900/30 border-indigo-400"
                    : "border-transparent hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FontAwesomeIcon
                    icon="bolt"
                    className="h-3 w-3 opacity-60 flex-shrink-0"
                  />
                  <code className="truncate">{h}</code>
                </span>
                <span className="text-xs opacity-60 flex-shrink-0">
                  {count}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Third column: for the selected (receiver, handler), show every
 * emitter widget as a section with a checkbox list of its events.
 * Checked = wired; toggling commits an add/remove. Mirrors the
 * right-column UX of PanelEditItemHandlers.
 */
function EventsColumn({
  receiver,
  handlerName,
  myWiring,
  emitters,
  onAdd,
  onRemove,
}) {
  // Wired-for-this-handler: dedupe defensively (legacy workspaces
  // occasionally contain duplicate entries under the same handler).
  const wiredHere = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const w of myWiring) {
      if (w.handlerName !== handlerName) continue;
      const key = `${w.sourceComponent}|${w.sourceItemId}|${w.eventName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
    return out;
  }, [myWiring, handlerName]);

  const wiredKeys = useMemo(
    () =>
      new Set(
        wiredHere.map(
          (w) => `${w.sourceComponent}|${w.sourceItemId}|${w.eventName}`,
        ),
      ),
    [wiredHere],
  );

  // Separate orphans — these reference sources no longer in the
  // workspace, so they don't appear in the emitter sections below.
  const orphansHere = wiredHere.filter((w) => w.isOrphan);

  if (!handlerName) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center text-sm opacity-60">
        Select a handler to view available events.
      </div>
    );
  }

  function toggle(source) {
    const key = `${source.sourceComponent}|${source.sourceItemId}|${source.eventName}`;
    if (wiredKeys.has(key)) {
      const existing = wiredHere.find(
        (w) => `${w.sourceComponent}|${w.sourceItemId}|${w.eventName}` === key,
      );
      onRemove(existing);
    } else {
      onAdd({
        receiverItemId: receiver.itemId,
        receiverComponent: receiver.component,
        handlerName,
        sourceComponent: source.sourceComponent,
        sourceItemId: source.sourceItemId,
        eventName: source.eventName,
      });
    }
  }

  // Hide the selected receiver from its own emitter list — a widget
  // listening to its own events is almost always a mistake.
  const emittersForList = emitters.filter(
    (e) =>
      !(
        e.component === receiver.component &&
        String(e.itemId) === String(receiver.itemId)
      ),
  );

  return (
    // Plain <div> — Card2's washed-out fill clashes with the modal chrome.
    <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 text-xs opacity-60">
        Check an event to fire <code className="text-xs">{handlerName}</code> on{" "}
        <span className="font-medium">{receiver.label}</span>.
      </div>
      <Divider />
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {emittersForList.length === 0 ? (
          <div className="text-sm opacity-60">
            No other widgets in this dashboard emit events.
          </div>
        ) : (
          emittersForList.map((e) => (
            <div
              key={e.key || `${e.component}|${e.itemId}`}
              className="space-y-1"
            >
              <div className="flex flex-col gap-0.5 mb-1">
                <div className="text-sm font-semibold">{e.label}</div>
                {(e.widgetRef || e.component) && (
                  <Caption block className="font-mono truncate">
                    {(e.widgetRef || e.component) +
                      (e.itemId != null ? `[${e.itemId}]` : "")}
                  </Caption>
                )}
              </div>
              {e.events.map((eventName) => {
                const key = `${e.component}|${e.itemId}|${eventName}`;
                const selected = wiredKeys.has(key);
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-md cursor-pointer text-sm ${
                      selected ? "opacity-100" : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    <FontAwesomeIcon
                      icon={selected ? "square-check" : "square"}
                      className="h-4 w-4 flex-shrink-0"
                      onClick={(ev) => {
                        ev.preventDefault();
                        toggle({
                          sourceComponent: e.component,
                          sourceItemId: e.itemId,
                          eventName,
                        });
                      }}
                    />
                    <span>{eventName}</span>
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
