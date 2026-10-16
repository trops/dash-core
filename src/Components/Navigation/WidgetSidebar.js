import React, {
  useState,
  useMemo,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useDrag } from "react-dnd";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  SearchInput,
  SegmentedControl,
  Sidebar,
  StatusBadge,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { ComponentManager } from "../../ComponentManager";
import { SIDEBAR_WIDGET_TYPE } from "../../utils/dragTypes";
import { matchesSource } from "./widgetSource";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { bareComponentName } from "../../utils/scopedComponentId";
import { useWidgetRegistryVersion } from "../../hooks/useWidgetRegistryVersion";
import { useRegistrySearch } from "../../hooks/useRegistrySearch";
import { RegistryAuthModal } from "../Registry/RegistryAuthModal";
import { InstallProgressModal } from "../Settings/details/InstallProgressModal";
import { isDraftPackage } from "../../utils/draftPackage";

// ComponentConfigModel's fallback `name` for a config that sets none — it
// isn't the widget's name, so it never titles a row.
const DEFAULT_CONFIG_NAME = "My Workspace";

// "ComposedWidget3" → "Composed Widget 3", "MCPServer" → "MCP Server".
const splitWords = (s) =>
  String(s)
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");

/**
 * The sidebar's widgets: every widget component, by key — not Widget Builder
 * drafts, which live in Manage › Widgets.
 */
export function sidebarWidgets(componentMap) {
  const map = componentMap || {};
  return Object.keys(map)
    .sort()
    .filter(
      (key) =>
        map[key] &&
        map[key].type === "widget" &&
        !isDraftPackage(map[key]._sourcePackage),
    )
    .map((key) => ({ key, widget: map[key] }));
}

/**
 * The title for a widget row: its displayName, else its own name (unless
 * that's the model default), else its component name as words.
 */
export function widgetTitle(widgetKey, widget = {}) {
  if (widget && widget.displayName) return widget.displayName;
  if (widget && widget.name && widget.name !== DEFAULT_CONFIG_NAME)
    return widget.name;
  const bare = bareComponentName(widgetKey);
  return bare ? splitWords(bare) : widgetKey || "Widget";
}

// Theme tokens shared by the sidebar's rows and controls (light + dark).
function useSidebarTokens() {
  const currentTheme = (useContext(ThemeContext) || {}).currentTheme || {};
  return {
    muted: currentTheme["text-neutral-medium"] || "",
    strong: currentTheme["text-neutral-light"] || "",
    hairline: currentTheme["border-neutral-dark"] || "",
    field: currentTheme["bg-neutral-very-dark"] || "",
    hoverBg: currentTheme["hover-bg-neutral-very-dark"] || "",
  };
}

const DraggableWidgetItem = ({ widgetKey, widget, onPick = null }) => {
  const t = useSidebarTokens();
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: SIDEBAR_WIDGET_TYPE,
      item: { widgetKey, widget },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [widgetKey],
  );

  // Route through getUserConfigurableProviders — drops the `api`
  // class AND null/undefined entries that occasionally appear in
  // sparse `widget.providers` arrays. Without this, a single null
  // slot crashes the whole sidebar with `Cannot read properties of
  // null (reading 'type')`.
  const providerTypes = getUserConfigurableProviders(widget.providers).map(
    (p) => p.type,
  );
  const eventCount = (widget.events || []).length;
  const handlerCount = (widget.eventHandlers || []).length;
  const hasEventInfo = eventCount > 0 || handlerCount > 0;

  return (
    <div
      ref={drag}
      // Click to place in the selected empty cell (phase 1d).
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? () => onPick(widgetKey) : undefined}
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(widgetKey);
              }
            }
          : undefined
      }
      className={`flex flex-col gap-1 px-3 py-2 rounded-md text-sm cursor-grab border transition-colors select-none ${t.hairline} ${t.hoverBg}
                ${isDragging ? "opacity-30" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FontAwesomeIcon
          icon={widget.icon || "puzzle-piece"}
          className={`h-3 w-3 flex-shrink-0 ${t.muted}`}
        />
        <span className={`truncate font-medium ${t.strong}`}>
          {widgetTitle(widgetKey, widget)}
        </span>
      </div>
      {widgetKey && (
        <span
          className={`text-xs pl-5 font-mono truncate ${t.muted}`}
          title={widgetKey}
        >
          {widgetKey}
        </span>
      )}
      {(providerTypes.length > 0 || hasEventInfo) && (
        <div className="flex flex-wrap items-center gap-1 pl-5">
          {providerTypes.map((pType) => (
            <StatusBadge key={pType} state="info" label={pType} />
          ))}
          {hasEventInfo && (
            <StatusBadge state="success">
              {eventCount > 0 &&
                `${eventCount} event${eventCount > 1 ? "s" : ""}`}
              {eventCount > 0 && handlerCount > 0 && ", "}
              {handlerCount > 0 &&
                `${handlerCount} handler${handlerCount > 1 ? "s" : ""}`}
            </StatusBadge>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Discover Tab Content ─────────────────────────────────────────── */

const SidebarDiscoverContent = ({
  registry,
  onInstallSuccess,
  installedPackageNames,
}) => {
  const t = useSidebarTokens();
  const status = useStatusTokens();
  const [selectedPackageName, setSelectedPackageName] = useState(null);
  const [pendingInstallPkg, setPendingInstallPkg] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressWidgets, setProgressWidgets] = useState([]);
  const [progressComplete, setProgressComplete] = useState(false);
  const installActiveRef = useRef(false);

  // Check if a package is installed by name or scope/name
  const isPackageInstalled = useCallback(
    (pkg) => {
      // Check via WidgetRegistry (externally installed packages)
      if (
        installedPackageNames.has(pkg.name) ||
        (pkg.scope && installedPackageNames.has(`${pkg.scope}/${pkg.name}`))
      ) {
        return true;
      }
      // Check if any of this package's widgets are registered in ComponentManager
      // (covers built-in widgets loaded directly, not through the WidgetRegistry).
      // ComponentManager keys may be prefixed (e.g., "DashSamples_EventReceiverWidget")
      // so we also check if any key ends with the widget name.
      if (pkg.widgets?.length > 0) {
        const cMap = ComponentManager.componentMap();
        const cMapKeys = Object.keys(cMap);
        return pkg.widgets.some(
          (w) =>
            w.name in cMap ||
            cMapKeys.some((k) => k === w.name || k.endsWith(`_${w.name}`)),
        );
      }
      return false;
    },
    [installedPackageNames],
  );

  // Watch for install completion — avoids stale closure reads after await
  useEffect(() => {
    if (!installActiveRef.current) return;
    if (registry.isInstalling) return; // Still in progress

    // Install completed — clear the ref
    installActiveRef.current = false;

    if (registry.needsAuth) {
      // Auth needed — close modal, let inline RegistryAuthPrompt render
      setShowProgressModal(false);
      return;
    }

    if (registry.installError) {
      setProgressWidgets((prev) =>
        prev.map((w) => ({
          ...w,
          status: "failed",
          error: registry.installError,
        })),
      );
    } else {
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "installed" })),
      );
    }
    setProgressComplete(true);
  }, [registry.isInstalling, registry.needsAuth, registry.installError]);

  const selectedPackage = useMemo(() => {
    if (!selectedPackageName) return null;
    return registry.packages.find((pkg) => pkg.name === selectedPackageName);
  }, [selectedPackageName, registry.packages]);

  const handleInstall = useCallback(
    async (pkg) => {
      if (!pkg.widgets?.length) return;
      setPendingInstallPkg(pkg);

      // Build progress items from package widgets
      const items = pkg.widgets.map((w) => ({
        packageName: pkg.name,
        displayName: w.displayName || w.name,
        status: "pending",
      }));

      setProgressWidgets(items);
      setProgressComplete(false);
      setShowProgressModal(true);
      installActiveRef.current = true;

      // Transition to downloading
      setProgressWidgets((prev) =>
        prev.map((w) => ({ ...w, status: "downloading" })),
      );

      // Call existing hook install — useEffect handles the result
      const installable = {
        isRegistry: true,
        packageName: pkg.name,
        packageScope: pkg.scope || null,
        downloadUrl: pkg.downloadUrl || "",
        packageVersion: pkg.version || "",
      };

      await registry.installPackage(installable);
    },
    [registry],
  );

  const handleProgressDone = useCallback(() => {
    setShowProgressModal(false);
    setProgressWidgets([]);
    setProgressComplete(false);

    // If install was successful, trigger the success flash
    if (!registry.installError) {
      onInstallSuccess(
        pendingInstallPkg?.displayName || pendingInstallPkg?.name || "Package",
      );
      setSelectedPackageName(null);
    }
    setPendingInstallPkg(null);
  }, [onInstallSuccess, pendingInstallPkg, registry.installError]);

  // Detail view for a selected package
  if (selectedPackage) {
    const pkg = selectedPackage;
    const isInstalled = isPackageInstalled(pkg);
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {/* Back button */}
          <div className="mb-3">
            <Button3 size="sm" onClick={() => setSelectedPackageName(null)}>
              <span className="inline-flex items-center gap-1.5">
                <FontAwesomeIcon icon="arrow-left" className="h-3 w-3" />
                Back
              </span>
            </Button3>
          </div>

          {/* Package header */}
          <div className="flex items-start gap-2 mb-3">
            <FontAwesomeIcon
              icon="cube"
              className={`h-4 w-4 mt-0.5 flex-shrink-0 ${t.muted}`}
            />
            <div className="min-w-0">
              <div
                className={`flex items-center gap-1.5 font-medium text-sm ${t.strong}`}
              >
                <span className="truncate">{pkg.displayName || pkg.name}</span>
                {isInstalled && (
                  <StatusBadge
                    state="success"
                    label="Installed"
                    className="flex-shrink-0"
                  />
                )}
              </div>
              <div className={`text-xs ${t.muted}`}>
                {pkg.author && <span>{pkg.author} &middot; </span>}v
                {pkg.version || "0.0.0"}
              </div>
            </div>
          </div>

          {/* Description */}
          {pkg.description && (
            <p className={`text-xs mb-3 line-clamp-3 ${t.muted}`}>
              {pkg.description}
            </p>
          )}

          {/* Tags */}
          {pkg.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {pkg.tags.map((tag) => (
                <StatusBadge key={tag} state="neutral" label={tag} />
              ))}
            </div>
          )}

          {/* Included widgets */}
          {pkg.widgets?.length > 0 && (
            <div className="mb-3">
              <div
                className={`text-xs font-medium uppercase tracking-wider mb-1.5 ${t.muted}`}
              >
                Included Widgets
              </div>
              <div className="flex flex-col gap-1">
                {pkg.widgets.map((w) => (
                  <div
                    key={w.name}
                    className={`flex flex-col gap-1 px-2 py-1.5 rounded-md border text-xs ${t.hairline}`}
                  >
                    <span className={`font-medium ${t.strong}`}>
                      {w.displayName || w.name}
                    </span>
                    {w.providers?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {w.providers.map((p) => (
                          <StatusBadge
                            key={p.type}
                            state="info"
                            label={p.type}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Install error */}
          {registry.installError && (
            <div
              className={`text-xs rounded-md px-2 py-1.5 mb-3 whitespace-pre-wrap ${status.error.bg} ${status.error.text}`}
            >
              {registry.installError}
            </div>
          )}
        </div>

        {/* Install button pinned to bottom */}
        <div className="px-3 py-2 flex-shrink-0">
          <Button
            block
            size="sm"
            onClick={() => handleInstall(pkg)}
            disabled={registry.isInstalling || isInstalled}
            title={
              isInstalled
                ? "Installed"
                : registry.isInstalling
                  ? "Installing..."
                  : "Install Package"
            }
          />
        </div>

        <InstallProgressModal
          isOpen={showProgressModal}
          setIsOpen={setShowProgressModal}
          widgets={progressWidgets}
          isComplete={progressComplete}
          onDone={handleProgressDone}
        />

        <RegistryAuthModal
          isOpen={registry.needsAuth}
          setIsOpen={(open) => {
            if (!open) registry.clearNeedsAuth();
          }}
          onAuthenticated={() => {
            registry.clearNeedsAuth();
            if (pendingInstallPkg) handleInstall(pendingInstallPkg);
          }}
          onCancel={() => {
            registry.clearNeedsAuth();
            setPendingInstallPkg(null);
          }}
          message="Sign in to install this widget from the Dash Registry."
        />
      </div>
    );
  }

  // Loading state
  if (registry.isLoading) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-8 ${t.muted}`}
      >
        <FontAwesomeIcon icon="spinner" spin className="h-4 w-4 mb-2" />
        <span className="text-xs">Loading registry...</span>
      </div>
    );
  }

  // Error state
  if (registry.error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <span className={`text-xs mb-2 ${status.error.icon}`}>
          {registry.error}
        </span>
        <Button3 size="sm" title="Retry" onClick={registry.retry} />
      </div>
    );
  }

  // Empty state
  if (registry.packages.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-8 px-4 text-center ${t.muted}`}
      >
        <FontAwesomeIcon icon="compass" className="h-5 w-5 mb-2" />
        <span className="text-sm">No packages found</span>
        {registry.searchQuery && (
          <span className="text-xs mt-1">Try a different search term</span>
        )}
      </div>
    );
  }

  // Package list
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1 px-3 py-1">
          {registry.packages.map((pkg) => {
            const isInstalled = isPackageInstalled(pkg);
            const packageRef =
              pkg.scope && pkg.name
                ? `@${String(pkg.scope).replace(/^@/, "")}/${pkg.name}`
                : pkg.name;
            const widgetCount = pkg.widgets?.length || 0;
            return (
              <button
                key={pkg.name}
                type="button"
                onClick={() => setSelectedPackageName(pkg.name)}
                className={`flex items-start gap-2 px-3 py-2 rounded-md text-left border transition-colors w-full ${t.hairline} ${t.hoverBg}`}
              >
                <FontAwesomeIcon
                  icon="cube"
                  className={`h-3 w-3 flex-shrink-0 mt-1 ${t.muted}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium truncate flex-1 min-w-0 ${t.strong}`}
                    >
                      {pkg.displayName || pkg.name}
                    </span>
                    {isInstalled && (
                      <StatusBadge
                        state="success"
                        label="Installed"
                        compact
                        className="flex-shrink-0"
                      />
                    )}
                  </div>
                  {packageRef && (
                    <div
                      className={`text-xs font-mono truncate mt-0.5 ${t.muted}`}
                      title={packageRef}
                    >
                      {packageRef}
                    </div>
                  )}
                  <div className={`text-xs truncate mt-0.5 ${t.muted}`}>
                    {pkg.author ? `${pkg.author} · ` : ""}
                    {widgetCount} widget{widgetCount !== 1 ? "s" : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {/* Package count footer */}
      <div className="px-3 py-1.5 flex-shrink-0">
        <span className={`text-xs ${t.muted}`}>
          {registry.packages.length} package
          {registry.packages.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
};

/* ─── Main Sidebar ─────────────────────────────────────────────────── */

/**
 * @param {boolean} [embedded] shown inside the dashboard Edit panel's Add
 *   tab (phase 1b): always expanded, no collapse trigger, full width.
 * @param {string} [username] signed-in registry username, for the Mine filter.
 */
export const WidgetSidebar = ({
  collapsed: collapsedProp,
  onCollapsedChange,
  embedded = false,
  username = "",
  // Phase 1d: click a widget to place it in the selected empty cell.
  onPick = null,
}) => {
  const collapsed = embedded ? false : collapsedProp;
  const t = useSidebarTokens();
  const status = useStatusTokens();

  // Tab state
  const [activeTab, setActiveTab] = useState("installed"); // "installed" | "discover"
  const [installSuccess, setInstallSuccess] = useState(null);

  // Registry hook (only active when discover tab is shown)
  const registry = useRegistrySearch();

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAuthor, setFilterAuthor] = useState("all");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterHasEvents, setFilterHasEvents] = useState("all");
  const [filterHasHandlers, setFilterHasHandlers] = useState("all");
  // Mine / Installed / Built in (create-entry CRE-010 AC2).
  const [filterSource, setFilterSource] = useState("all");

  // Counter from the shared `dash:widgets-updated` event so the
  // sidebar re-derives whenever widgets install / update / uninstall.
  const widgetVersion = useWidgetRegistryVersion();

  // Flat list of all widgets
  const allWidgets = useMemo(
    () => sidebarWidgets(ComponentManager.map()),
    [widgetVersion],
  );

  // Set of installed package identifiers for "Installed" badge in Discover tab.
  // Stores folder names, package names, and "author/name" keys for matching.
  const [installedPackageNames, setInstalledPackageNames] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    const loadInstalled = async () => {
      try {
        const widgets = await window.mainApi.widgets.list();
        if (cancelled) return;
        const names = new Set();
        for (const w of widgets) {
          // w is a config object with name, path, author, etc.
          if (w.name) names.add(w.name);
          // Extract folder name from path (matches registry pkg.name)
          if (w.path) {
            const folderName = w.path.split("/").pop();
            if (folderName) names.add(folderName);
          }
          // Add author-scoped keys for disambiguation
          if (w.author && w.name) {
            names.add(`${w.author}/${w.name}`);
          }
          if (w.author && w.path) {
            const folderName = w.path.split("/").pop();
            if (folderName) names.add(`${w.author}/${folderName}`);
          }
        }
        setInstalledPackageNames(names);
      } catch (err) {
        console.error("[WidgetSidebar] Error loading installed widgets:", err);
      }
    };
    loadInstalled();
    return () => {
      cancelled = true;
    };
  }, [widgetVersion]);

  // Derive unique groups for dropdown (package > author > "Other")
  const uniqueAuthors = useMemo(
    () =>
      [
        ...new Set(
          allWidgets.map(
            ({ widget }) => widget.package || widget.author || "Other",
          ),
        ),
      ].sort(),
    [allWidgets],
  );

  // Derive unique provider types for the filter dropdown. Route
  // through getUserConfigurableProviders so a single null entry in
  // any widget's `providers` array doesn't crash the whole sidebar
  // (it filters non-objects AND drops the `api` provider class that
  // isn't user-configurable). Observed prod crash:
  // `TypeError: Cannot read properties of null (reading 'type')` →
  // unmounted WidgetSidebar via React error boundary.
  const uniqueProviders = useMemo(() => {
    const types = new Set();
    allWidgets.forEach(({ widget }) =>
      getUserConfigurableProviders(widget?.providers).forEach((p) =>
        types.add(p.type),
      ),
    );
    return [...types].sort();
  }, [allWidgets]);

  // Filtered + grouped widgets
  const filteredGrouped = useMemo(() => {
    const filtered = allWidgets.filter(({ key, widget }) => {
      // Search: match name, key, or description
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          (widget.name || "").toLowerCase().includes(q) ||
          key.toLowerCase().includes(q) ||
          (widget.description || "").toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      // Source filter (Mine / Installed / Built in)
      if (!matchesSource({ key, widget }, filterSource, username)) {
        return false;
      }
      // Group filter (package > author > "Other")
      if (filterAuthor !== "all") {
        if ((widget.package || widget.author || "Other") !== filterAuthor)
          return false;
      }
      // Provider filter — same null-safety as `uniqueProviders` above.
      if (filterProvider !== "all") {
        const configurable = getUserConfigurableProviders(widget?.providers);
        if (filterProvider === "none") {
          if (configurable.length > 0) return false;
        } else {
          if (!configurable.some((p) => p.type === filterProvider))
            return false;
        }
      }
      // Events filter
      if (filterHasEvents !== "all") {
        const has = widget.events?.length > 0;
        if (filterHasEvents === "yes" && !has) return false;
        if (filterHasEvents === "no" && has) return false;
      }
      // Handlers filter
      if (filterHasHandlers !== "all") {
        const has = widget.eventHandlers?.length > 0;
        if (filterHasHandlers === "yes" && !has) return false;
        if (filterHasHandlers === "no" && has) return false;
      }
      return true;
    });

    // Group by package > author > "Other"
    const groups = {};
    filtered.forEach(({ key, widget }) => {
      const group = widget.package || widget.author || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push({ key, widget });
    });
    return groups;
  }, [
    allWidgets,
    searchQuery,
    filterAuthor,
    filterProvider,
    filterHasEvents,
    filterHasHandlers,
    filterSource,
    username,
  ]);

  const filteredCount = Object.values(filteredGrouped).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalCount = allWidgets.length;
  const hasActiveFilters =
    searchQuery ||
    filterSource !== "all" ||
    filterAuthor !== "all" ||
    filterProvider !== "all" ||
    filterHasEvents !== "all" ||
    filterHasHandlers !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setFilterSource("all");
    setFilterAuthor("all");
    setFilterProvider("all");
    setFilterHasEvents("all");
    setFilterHasHandlers("all");
  };

  const authorNames = Object.keys(filteredGrouped).sort();

  // Readable 14px selects on the theme's field surface + hairline.
  const selectClassName = `w-full min-w-0 px-2 py-1.5 rounded-md text-sm border ${t.field} ${t.hairline} ${t.strong} focus:outline-none cursor-pointer`;

  // Install success handler — switch to installed tab + show flash
  const handleInstallSuccess = useCallback((packageName) => {
    setInstallSuccess(`${packageName} installed`);
    setActiveTab("installed");
    const timer = setTimeout(() => setInstallSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Sidebar
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      side="right"
      width={embedded ? "w-full" : "w-64"}
      collapsedWidth="w-12"
    >
      <Sidebar.Header>
        <div className="flex items-center justify-between">
          {embedded ? <span /> : <Sidebar.Trigger />}
          {!collapsed && (
            <SegmentedControl
              ariaLabel="Widget source"
              size="sm"
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: "installed", label: "Installed" },
                {
                  value: "discover",
                  label: embedded ? "Registry" : "Discover",
                },
              ]}
            />
          )}
        </div>
      </Sidebar.Header>

      {/* Search & Filter section — only when expanded */}
      {!collapsed && activeTab === "installed" && (
        <div className="flex flex-col gap-2 px-3 pb-2 flex-shrink-0">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search widgets..."
          />

          {/* Filters, grouped: source first, then package / provider,
              then events / handlers. */}
          <div
            role="group"
            aria-label="Filters"
            className="flex flex-col gap-1.5"
          >
            <select
              aria-label="Show"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className={selectClassName}
            >
              <option value="all">All widgets</option>
              <option value="mine">Mine</option>
              <option value="installed">Installed</option>
              <option value="builtin">Built in</option>
            </select>

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

            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={filterHasEvents}
                onChange={(e) => setFilterHasEvents(e.target.value)}
                className={selectClassName}
              >
                <option value="all">Events: Any</option>
                <option value="yes">Has Events</option>
                <option value="no">No Events</option>
              </select>

              <select
                value={filterHasHandlers}
                onChange={(e) => setFilterHasHandlers(e.target.value)}
                className={selectClassName}
              >
                <option value="all">Handlers: Any</option>
                <option value="yes">Has Handlers</option>
                <option value="no">No Handlers</option>
              </select>
            </div>
          </div>

          {/* Result count + clear */}
          <div className="flex items-center justify-between px-0.5">
            <span className={`text-xs ${t.muted}`}>
              {hasActiveFilters
                ? `${filteredCount} of ${totalCount} widgets`
                : `${totalCount} widgets`}
            </span>
            {hasActiveFilters && (
              <Button3 size="sm" title="Clear" onClick={clearFilters} />
            )}
          </div>
        </div>
      )}

      {/* Discover search bar */}
      {!collapsed && activeTab === "discover" && (
        <div className="flex flex-col gap-2 px-3 pb-2 flex-shrink-0">
          <SearchInput
            value={registry.searchQuery}
            onChange={registry.setSearchQuery}
            placeholder="Search registry..."
          />
        </div>
      )}

      <Sidebar.Content>
        {collapsed ? (
          <>
            <Sidebar.Item
              icon={
                <FontAwesomeIcon icon="puzzle-piece" className="h-3.5 w-3.5" />
              }
              onClick={() => {
                setActiveTab("installed");
                onCollapsedChange && onCollapsedChange(false);
              }}
            >
              Widgets
            </Sidebar.Item>
            <Sidebar.Item
              icon={<FontAwesomeIcon icon="compass" className="h-3.5 w-3.5" />}
              onClick={() => {
                setActiveTab("discover");
                onCollapsedChange && onCollapsedChange(false);
              }}
            >
              Discover
            </Sidebar.Item>
          </>
        ) : activeTab === "installed" ? (
          authorNames.length > 0 ? (
            authorNames.map((author) => (
              <Sidebar.Group key={author} label={author}>
                <div className="flex flex-col gap-1">
                  {filteredGrouped[author].map(({ key, widget }) => (
                    <DraggableWidgetItem
                      key={key}
                      widgetKey={key}
                      widget={widget}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </Sidebar.Group>
            ))
          ) : (
            <div
              className={`flex flex-col items-center justify-center gap-2 py-8 px-4 text-center ${t.muted}`}
            >
              <span className="text-sm">No widgets match</span>
              {hasActiveFilters && (
                <Button3
                  size="sm"
                  title="Clear filters"
                  onClick={clearFilters}
                />
              )}
            </div>
          )
        ) : (
          <SidebarDiscoverContent
            registry={registry}
            onInstallSuccess={handleInstallSuccess}
            installedPackageNames={installedPackageNames}
          />
        )}
      </Sidebar.Content>

      {/* Footer — only on installed tab, shows install success flash */}
      {!collapsed && activeTab === "installed" && installSuccess && (
        <Sidebar.Footer>
          <div
            className={`flex items-center gap-2 text-xs px-1 py-1 ${status.success.icon}`}
          >
            <FontAwesomeIcon icon="circle-check" className="h-3 w-3" />
            {installSuccess}
          </div>
        </Sidebar.Footer>
      )}
    </Sidebar>
  );
};
