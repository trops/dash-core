import React, { useState, useEffect, useContext } from "react";
import {
  ThemeContext,
  Button,
  SubHeading3,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { StarRating } from "./StarRating";

/**
 * RegistryDashboardDetail — detail panel for a registry dashboard package.
 *
 * Shows package header, description, tags, widget list with compatibility
 * status, provider requirements, event wiring summary, and install button.
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

  const pkg = dashboardPackage;
  if (!pkg) return null;

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

  async function handleInstall() {
    if (!appId || !pkg.name) return;
    setIsInstalling(true);
    setInstallResult(null);
    try {
      const result =
        await window.mainApi.dashboardConfig.installDashboardFromRegistry(
          appId,
          pkg.name,
        );
      setInstallResult({
        status: result?.success ? "success" : "error",
        message: result?.success
          ? `Dashboard "${result.workspace?.name || pkg.name}" installed successfully.`
          : result?.error || "Installation failed.",
      });
      if (result?.success && onInstallComplete) {
        onInstallComplete(result);
      }
    } catch (err) {
      console.error("[RegistryDashboardDetail] Install error:", err);
      setInstallResult({
        status: "error",
        message: err.message || "Failed to install dashboard.",
      });
    } finally {
      setIsInstalling(false);
    }
  }

  const compatibility = preview?.compatibility;
  const widgetDeps = preview?.widgets || pkg.widgets || [];
  const providers = preview?.providers || [];
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
                const status =
                  compatibility?.widgets?.[w.name || w.packageName] ||
                  "unknown";
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
        {installResult && (
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
      {installResult?.status !== "success" && (
        <div
          className={`flex items-center justify-end px-6 py-3 border-t ${currentTheme["border-primary-medium"]}`}
        >
          <Button
            title={isInstalling ? "Installing..." : "Install Dashboard"}
            bgColor="bg-blue-600"
            hoverBackgroundColor={isInstalling ? "" : "hover:bg-blue-700"}
            textSize="text-sm"
            padding="py-1.5 px-4"
            onClick={handleInstall}
            disabled={isInstalling}
          />
        </div>
      )}
    </div>
  );
};
