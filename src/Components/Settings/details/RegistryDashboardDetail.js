import React, {
  useState,
  useEffect,
  useContext,
  useRef,
  useCallback,
} from "react";
import {
  ThemeContext,
  Button,
  SubHeading3,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { ComponentManager } from "../../../ComponentManager";
import { StarRating } from "./StarRating";
import { InstallProgressModal } from "./InstallProgressModal";
import { RegistryAuthModal } from "../../Registry/RegistryAuthModal";
import { DashboardInstallOptionsModal } from "./DashboardInstallOptionsModal";

/**
 * RegistryDashboardDetail — detail panel for a registry dashboard package.
 *
 * Shows package header, description, tags, widget list with compatibility
 * status, provider requirements, event wiring summary, and install button.
 *
 * When install returns authRequired, shows an inline device-code auth prompt.
 * After successful auth, auto-retries the install (DASH-136).
 */
export const RegistryDashboardDetail = ({
  dashboardPackage,
  appId,
  onInstallComplete,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressWidgets, setProgressWidgets] = useState([]);
  const [progressComplete, setProgressComplete] = useState(false);
  const progressResultRef = useRef(null);
  const cleanupProgressRef = useRef(null);

  // Pre-install options modal: choose folder + rename. Lets the user
  // override the publisher's menuId (which would otherwise collide
  // with their local folder ids) and pick a friendlier display name.
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [menuItems, setMenuItems] = useState([]);

  const pkg = dashboardPackage;
  if (!pkg) return null;

  // Clean up progress listener on unmount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    return () => {
      if (cleanupProgressRef.current) cleanupProgressRef.current();
    };
  }, []);

  // Load preview data on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!pkg.name) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    setInstallResult(null);
    window.mainApi?.dashboardConfig
      ?.getDashboardPreview(pkg.name)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        console.error("[RegistryDashboardDetail] Preview error:", err);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pkg.name]);

  // Click handler on the "Install" button: load the user's existing
  // folders + open the options modal. The actual install fires from
  // the modal's onConfirm so we have the user's name/menuId choice.
  async function handleInstallClick() {
    if (!appId || !pkg.name) return;
    setInstallResult(null);
    try {
      const result = await window.mainApi?.menuItems?.listMenuItems?.(appId);
      const list = (result?.menuItems || []).filter((m) => m && m.id != null);
      setMenuItems(list);
    } catch (err) {
      console.error("[RegistryDashboardDetail] listMenuItems failed:", err);
      setMenuItems([]);
    }
    setShowOptionsModal(true);
  }

  async function handleCreateFolder(menuItem) {
    if (!appId) return { success: false, message: "No appId" };
    return window.mainApi?.menuItems?.saveMenuItem?.(appId, menuItem);
  }

  async function handleOptionsConfirm({ name, menuId }) {
    setShowOptionsModal(false);
    await runInstall({ name, menuId });
  }

  async function runInstall(installOptions = {}) {
    if (!appId || !pkg.name) return;
    setIsInstalling(true);
    setInstallResult(null);

    // Initialize progress modal from widget deps + optional theme
    const deps = widgetDeps.length > 0 ? widgetDeps : [];
    const items = deps.map((w) => ({
      packageName: w.package || w.name,
      displayName: w.displayName || w.name || w.package,
      status: "pending",
    }));

    if (pkg.theme) {
      items.push({
        packageName: pkg.theme.registryPackage || pkg.theme.key || "theme",
        displayName: pkg.theme.name || pkg.theme.key || "Bundled Theme",
        status: "pending",
        type: "theme",
      });
    }

    if (items.length > 0) {
      setProgressWidgets(items);
      setProgressComplete(false);
      setShowProgressModal(true);

      // Register progress listener
      if (cleanupProgressRef.current) cleanupProgressRef.current();
      cleanupProgressRef.current =
        window.mainApi?.dashboardConfig?.onInstallProgress?.((data) => {
          setProgressWidgets((prev) => {
            const next = [...prev];
            if (data.index >= 0 && data.index < next.length) {
              next[data.index] = {
                ...next[data.index],
                status: data.status,
                error: data.error || null,
              };
            }
            return next;
          });
        });
    }

    try {
      const result =
        await window.mainApi.dashboardConfig.installDashboardFromRegistry(
          appId,
          pkg.name,
          installOptions,
        );
      if (result?.authRequired) {
        // Auth needed — close progress modal, show inline auth prompt
        setShowProgressModal(false);
        setIsInstalling(false);
        setInstallResult({
          status: "auth",
          message: result.error || "Sign in to install this dashboard.",
        });
        if (cleanupProgressRef.current) {
          cleanupProgressRef.current();
          cleanupProgressRef.current = null;
        }
        return;
      }

      // Store result for use when modal closes
      progressResultRef.current = result;
      setProgressComplete(true);

      // If no progress modal was shown, apply result directly
      if (items.length === 0) {
        setInstallResult({
          status: result?.success ? "success" : "error",
          message: result?.success
            ? `Dashboard "${result.workspace?.name || pkg.name}" installed successfully.`
            : result?.error || "Installation failed.",
        });
        if (result?.success && onInstallComplete) {
          onInstallComplete(result);
        }
      }
    } catch (err) {
      console.error("[RegistryDashboardDetail] Install error:", err);
      setProgressComplete(true);
      if (items.length === 0) {
        setInstallResult({
          status: "error",
          message: err.message || "Failed to install dashboard.",
        });
      }
    } finally {
      setIsInstalling(false);
      if (cleanupProgressRef.current) {
        cleanupProgressRef.current();
        cleanupProgressRef.current = null;
      }
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleProgressDone = useCallback(() => {
    setShowProgressModal(false);
    const result = progressResultRef.current;
    if (result) {
      setInstallResult({
        status: result.success ? "success" : "error",
        message: result.success
          ? `Dashboard "${result.workspace?.name || pkg.name}" installed successfully.`
          : result.error || "Installation failed.",
      });
      if (result.success && onInstallComplete) {
        onInstallComplete(result);
      }
    }
  }, [pkg.name, onInstallComplete]);

  const widgetDeps = preview?.widgets || pkg.widgets || [];
  const providers = preview?.providers || [];
  // Slice 13c: aggregated MCP permissions for the dashboard, computed
  // by the publisher at publish time across every widget's local
  // package.json. Empty/missing means the dashboard either ships no
  // tool-using widgets or pre-dates the aggregation.
  const aggregatedPermissions = preview?.permissions || pkg.permissions || null;
  // Per-widget permissions live on each widget dep itself —
  // version-pinned next to the widget so the disclosure can't drift
  // from the actual installed package.
  const widgetsWithPermissions = widgetDeps.filter(
    (w) =>
      w.permissions &&
      typeof w.permissions === "object" &&
      Object.keys(w.permissions).length > 0,
  );

  // Augment compatibility: check renderer-side ComponentManager for
  // built-in widgets that the electron-side WidgetRegistry doesn't know about
  const compatibility = (() => {
    const raw = preview?.compatibility;
    if (!raw) return raw;

    const cMap = ComponentManager.componentMap();
    const augWidgets = { ...raw.widgets };
    let fixedCount = 0;

    for (const [key, status] of Object.entries(augWidgets)) {
      if (status !== "unavailable" && status !== "unknown") continue;
      // Extract bare widget name (last segment of dotted key)
      const bareName = key.includes(".") ? key.split(".").pop() : key;
      // Match by exact key, bare name, or config.name scan
      if (
        key in cMap ||
        bareName in cMap ||
        Object.values(cMap).some((c) => c.name === key || c.name === bareName)
      ) {
        augWidgets[key] = "installed";
        fixedCount++;
      }
    }

    if (fixedCount === 0) return raw;

    // Recompute summary
    let installed = 0,
      toInstall = 0,
      unavailable = 0,
      hasUnavailableRequired = false;
    for (const dep of widgetDeps) {
      const depKey =
        dep.scope && dep.packageName && dep.widgetName
          ? `${dep.scope}.${dep.packageName}.${dep.widgetName}`
          : dep.id || dep.package || dep.name;
      const s = augWidgets[depKey] || "unknown";
      if (s === "installed") installed++;
      else if (s === "available") toInstall++;
      else {
        unavailable++;
        if (dep.required !== false) hasUnavailableRequired = true;
      }
    }

    return {
      compatible: !hasUnavailableRequired,
      summary: {
        total: widgetDeps.length,
        installed,
        toInstall,
        unavailable,
      },
      widgets: augWidgets,
    };
  })();
  const wiring = preview?.wiring || [];

  function getCompatIcon(status) {
    if (status === "installed")
      return { icon: "circle-check", color: "text-green-400" };
    if (status === "available")
      return { icon: "circle-down", color: "text-blue-400" };
    return { icon: "circle-xmark", color: "text-red-400" };
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`flex-1 min-h-0 overflow-y-auto p-6 space-y-6 ${
          panelStyles.textColor || "text-gray-200"
        }`}
      >
        {/* Header */}
        <div className="flex flex-row items-center gap-3">
          <div className="h-5 w-5 flex-shrink-0 flex items-center justify-center">
            <FontAwesomeIcon icon={pkg.icon || "clone"} className="h-5 w-5" />
          </div>
          <div>
            <SubHeading3 title={pkg.displayName || pkg.name} padding={false} />
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm opacity-60">
                by {pkg.author || "Unknown"}
              </span>
              {pkg.version && (
                <span
                  className={`text-xs px-2 py-0.5 rounded ${currentTheme["bg-primary-medium"]} opacity-70`}
                >
                  v{pkg.version}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Rating */}
        {appId && (
          <StarRating
            appId={appId}
            packageName={pkg.name}
            interactive={false}
          />
        )}

        <hr className={currentTheme["border-primary-medium"]} />

        {/* Description */}
        {pkg.description && <p className="text-sm">{pkg.description}</p>}

        {/* Tags */}
        {pkg.tags && pkg.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pkg.tags.map((tag) => (
              <span
                key={tag}
                className={`text-xs px-2 py-0.5 rounded ${currentTheme["bg-primary-medium"]} opacity-60`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Bundled Theme */}
        {pkg.theme && (
          <div>
            <span className="text-xs font-semibold opacity-50 mb-1 block">
              INCLUDES THEME
            </span>
            <div
              className={`p-3 rounded ${currentTheme["bg-primary-medium"]} flex items-center gap-3`}
            >
              <FontAwesomeIcon icon="palette" className="h-4 w-4 opacity-60" />
              <div className="flex-1">
                <span className="text-sm font-medium">
                  {pkg.theme.name || pkg.theme.key || "Bundled Theme"}
                </span>
                <span className="text-xs opacity-40 ml-2">
                  Will be auto-installed
                </span>
              </div>
              {pkg.theme.colors && (
                <div className="flex items-center gap-1">
                  {[
                    pkg.theme.colors.primary,
                    pkg.theme.colors.secondary,
                    pkg.theme.colors.tertiary,
                  ]
                    .filter(Boolean)
                    .map((color, i) => (
                      <div
                        key={i}
                        className="h-4 w-4 rounded-full border border-white/20"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Widget Dependencies */}
        <div>
          <span className="text-xs font-semibold opacity-50 mb-1 block">
            REQUIRED WIDGETS
          </span>
          {previewLoading ? (
            <div className="flex items-center gap-2 py-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span className="text-xs opacity-50">
                Checking compatibility...
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {widgetDeps.map((w, idx) => {
                const depKey =
                  w.scope && w.packageName && w.widgetName
                    ? `${w.scope}.${w.packageName}.${w.widgetName}`
                    : w.id || w.package || w.name;
                const status = compatibility?.widgets?.[depKey] || "unknown";
                const compat = getCompatIcon(status);
                return (
                  <div
                    key={idx}
                    className={`p-2 rounded ${currentTheme["bg-primary-medium"]} flex items-center gap-2`}
                  >
                    <FontAwesomeIcon
                      icon={compat.icon}
                      className={`h-3.5 w-3.5 ${compat.color}`}
                    />
                    <span className="text-sm">
                      {w.displayName || w.name || w.packageName}
                    </span>
                    <span className="text-xs opacity-40 ml-auto">
                      {status === "installed"
                        ? "Installed"
                        : status === "available"
                          ? "Will install"
                          : "Unavailable"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Provider Requirements */}
        {providers.length > 0 && (
          <div>
            <span className="text-xs font-semibold opacity-50 mb-1 block">
              REQUIRED PROVIDERS
            </span>
            <div className="space-y-1">
              {providers.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">
                    {p.type}
                  </span>
                  {p.required && (
                    <span className="text-[10px] opacity-40">Required</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Required Tools — aggregated across widgets, then per-widget */}
        {(aggregatedPermissions || widgetsWithPermissions.length > 0) && (
          <div>
            <span className="text-xs font-semibold opacity-50 mb-1 block">
              REQUIRED TOOLS
            </span>
            {aggregatedPermissions &&
              Object.entries(aggregatedPermissions).map(([server, block]) => (
                <div key={server} className="mb-2">
                  <div className="text-xs font-mono uppercase tracking-wider opacity-70">
                    {server}
                  </div>
                  {Array.isArray(block.tools) && block.tools.length > 0 && (
                    <div className="text-xs opacity-80 ml-2 break-all">
                      {block.tools.join(", ")}
                    </div>
                  )}
                  {Array.isArray(block.readPaths) &&
                    block.readPaths.length > 0 && (
                      <div className="text-xs opacity-60 ml-2 break-all">
                        Read paths: {block.readPaths.join(", ")}
                      </div>
                    )}
                  {Array.isArray(block.writePaths) &&
                    block.writePaths.length > 0 && (
                      <div className="text-xs opacity-60 ml-2 break-all">
                        Write paths: {block.writePaths.join(", ")}
                      </div>
                    )}
                </div>
              ))}
            {widgetsWithPermissions.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs opacity-60 cursor-pointer">
                  Per-widget breakdown ({widgetsWithPermissions.length} widget
                  {widgetsWithPermissions.length === 1 ? "" : "s"})
                </summary>
                <div className="mt-1 space-y-2 ml-2">
                  {widgetsWithPermissions.map((w, idx) => (
                    <div key={idx} className="text-xs opacity-80">
                      <div className="font-mono break-all">
                        {w.package || w.packageName}
                        {w.version ? (
                          <span className="opacity-50"> v{w.version}</span>
                        ) : null}
                      </div>
                      {Object.entries(w.permissions).map(([server, block]) => (
                        <div key={server} className="ml-2 break-all">
                          <span className="opacity-60">{server}:</span>{" "}
                          {(block.tools || []).join(", ")}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Event Wiring */}
        {wiring.length > 0 && (
          <div>
            <span className="text-xs font-semibold opacity-50 mb-1 block">
              EVENT WIRING
            </span>
            <div className="space-y-1">
              {wiring.map((w, idx) => (
                <div
                  key={idx}
                  className={`text-xs p-2 rounded ${currentTheme["bg-primary-medium"]} opacity-70`}
                >
                  <span className="font-medium">{w.from || "Source"}</span>
                  <FontAwesomeIcon
                    icon="arrow-right"
                    className="h-2.5 w-2.5 mx-1.5 opacity-50"
                  />
                  <span className="font-medium">{w.to || "Target"}</span>
                  {w.event && (
                    <span className="opacity-50 ml-1.5">({w.event})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Install Result */}
        {installResult && installResult.status !== "auth" && (
          <div
            className={`p-2 rounded border ${
              installResult.status === "success"
                ? "bg-green-900/20 border-green-700"
                : "bg-red-900/30 border-red-700"
            }`}
          >
            <div className="flex items-center gap-2">
              <FontAwesomeIcon
                icon={
                  installResult.status === "success"
                    ? "circle-check"
                    : "circle-xmark"
                }
                className={`h-4 w-4 ${
                  installResult.status === "success"
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              />
              <span
                className={`text-sm ${
                  installResult.status === "error" ? "text-red-400" : ""
                }`}
              >
                {installResult.message}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Install Footer */}
      {installResult?.status !== "success" &&
        installResult?.status !== "auth" && (
          <div
            className={`flex items-center justify-end px-6 py-3 border-t ${currentTheme["border-primary-medium"]}`}
          >
            <Button
              title={isInstalling ? "Installing..." : "Install Dashboard"}
              bgColor="bg-blue-600"
              hoverBackgroundColor={isInstalling ? "" : "hover:bg-blue-700"}
              textSize="text-sm"
              padding="py-1.5 px-4"
              onClick={handleInstallClick}
              disabled={isInstalling}
            />
          </div>
        )}

      {/* Pre-install options: name + folder */}
      <DashboardInstallOptionsModal
        isOpen={showOptionsModal}
        setIsOpen={setShowOptionsModal}
        pkg={pkg}
        menuItems={menuItems}
        onCreateFolder={handleCreateFolder}
        onConfirm={handleOptionsConfirm}
      />

      {/* Progress Modal */}
      <InstallProgressModal
        isOpen={showProgressModal}
        setIsOpen={setShowProgressModal}
        widgets={progressWidgets}
        isComplete={progressComplete}
        onDone={handleProgressDone}
      />

      {/* Auth Modal */}
      <RegistryAuthModal
        isOpen={installResult?.status === "auth"}
        setIsOpen={(open) => {
          if (!open) setInstallResult(null);
        }}
        onAuthenticated={() => {
          setInstallResult(null);
          // Re-open the options modal so the user can confirm again
          // post-auth (cheaper than caching their first selection
          // through the auth round-trip).
          handleInstallClick();
        }}
        onCancel={() => setInstallResult(null)}
        message={installResult?.message || "Sign in to install this dashboard."}
      />
    </div>
  );
};
