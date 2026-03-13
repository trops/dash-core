import React, { useState, useContext } from "react";
import {
  ThemeContext,
  Button,
  SubHeading3,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

/**
 * RegistryThemeDetail — detail panel for a registry theme package.
 *
 * Shows package header, color preview swatches, description, tags, and install button.
 */
export const RegistryThemeDetail = ({
  themePackage,
  appId,
  onInstallComplete,
}) => {
  const { currentTheme, changeThemesForApplication } =
    useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState(null);

  const pkg = themePackage;
  if (!pkg) return null;

  const colors = pkg.colors || {};

  async function handleInstall() {
    if (!appId || !pkg.name) return;
    setIsInstalling(true);
    setInstallResult(null);
    try {
      const result = await window.mainApi.themes.installThemeFromRegistry(
        appId,
        pkg.name,
      );
      setInstallResult({
        status: result?.success ? "success" : "error",
        message: result?.success
          ? `Theme "${result.themeKey || pkg.displayName || pkg.name}" installed successfully.`
          : result?.error || "Installation failed.",
      });
      if (result?.success) {
        // Refresh ThemeContext with updated themes
        if (result.themes) {
          changeThemesForApplication(result.themes);
        }
        if (onInstallComplete) {
          onInstallComplete(result);
        }
      }
    } catch (err) {
      console.error("[RegistryThemeDetail] Install error:", err);
      setInstallResult({
        status: "error",
        message: err.message || "Failed to install theme.",
      });
    } finally {
      setIsInstalling(false);
    }
  }

  const colorEntries = [
    { label: "Primary", value: colors.primary },
    { label: "Secondary", value: colors.secondary },
    { label: "Tertiary", value: colors.tertiary },
    { label: "Neutral", value: colors.neutral },
  ].filter((c) => c.value);

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
            <FontAwesomeIcon icon="palette" className="h-5 w-5" />
          </div>
          <div>
            <SubHeading3
              title={pkg.displayName || pkg.name}
              padding={false}
            />
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

        <hr className={currentTheme["border-primary-medium"]} />

        {/* Color Preview */}
        {colorEntries.length > 0 && (
          <div>
            <span className="text-xs font-semibold opacity-50 mb-2 block">
              COLORS
            </span>
            <div className="flex flex-row gap-3">
              {colorEntries.map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div
                    className="h-10 w-10 rounded-full border-2 border-white/20"
                    style={{ backgroundColor: value }}
                  />
                  <span className="text-[10px] opacity-50">{label}</span>
                  <span className="text-[10px] opacity-30 font-mono">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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
            title={isInstalling ? "Installing..." : "Install Theme"}
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
