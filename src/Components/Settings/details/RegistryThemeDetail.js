import React, { useState, useContext } from "react";
import {
  ThemeContext,
  Button,
  SubHeading3,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { RegistryAuthModal } from "../../Registry/RegistryAuthModal";

import { toDisplayColor } from "../../../utils/colorUtils";

/**
 * Darken/lighten a hex color by a percentage (-1 to 1).
 * Negative = darker, positive = lighter.
 */
function adjustColor(hex, amount) {
  if (!hex || !hex.startsWith("#")) return hex;
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(
    255,
    Math.max(0, ((num >> 16) & 0xff) + Math.round(255 * amount)),
  );
  const g = Math.min(
    255,
    Math.max(0, ((num >> 8) & 0xff) + Math.round(255 * amount)),
  );
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(255 * amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * ThemePreviewMockup — renders a mini dashboard mockup using theme colors.
 */
const ThemePreviewMockup = ({ colors }) => {
  const { primary, secondary, tertiary, neutral } = colors;
  const bg = neutral || adjustColor(primary, -0.6);
  const sidebar = adjustColor(primary, -0.5);
  const header = adjustColor(primary, -0.4);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold opacity-50">PREVIEW</span>
      <div
        className="rounded-lg overflow-hidden border border-white/10"
        style={{ backgroundColor: bg, minHeight: 160 }}
      >
        <div className="flex flex-row h-full" style={{ minHeight: 160 }}>
          {/* Sidebar */}
          <div
            className="flex flex-col gap-1.5 p-2 w-24 flex-shrink-0"
            style={{ backgroundColor: sidebar }}
          >
            <div
              className="h-2 w-12 rounded-sm opacity-60"
              style={{ backgroundColor: primary }}
            />
            <div
              className="h-2 w-16 rounded-sm opacity-30"
              style={{ backgroundColor: secondary }}
            />
            <div
              className="h-2 w-10 rounded-sm opacity-30"
              style={{ backgroundColor: secondary }}
            />
            <div
              className="h-2 w-14 rounded-sm opacity-30"
              style={{ backgroundColor: secondary }}
            />
          </div>
          {/* Main area */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Header bar */}
            <div
              className="flex items-center gap-2 px-3 py-2"
              style={{ backgroundColor: header }}
            >
              <div
                className="h-2 w-20 rounded-sm opacity-70"
                style={{ backgroundColor: primary }}
              />
              <div className="flex-1" />
              <div
                className="h-2 w-8 rounded-sm opacity-40"
                style={{ backgroundColor: tertiary || secondary }}
              />
            </div>
            {/* Content grid */}
            <div className="grid grid-cols-3 gap-2 p-3 flex-1">
              {/* Widget card 1 */}
              <div
                className="rounded p-2 flex flex-col gap-1.5"
                style={{ backgroundColor: adjustColor(primary, -0.35) }}
              >
                <div
                  className="h-1.5 w-10 rounded-sm"
                  style={{ backgroundColor: primary, opacity: 0.7 }}
                />
                <div
                  className="h-8 w-full rounded-sm"
                  style={{ backgroundColor: secondary, opacity: 0.3 }}
                />
                <div
                  className="h-1.5 w-12 rounded-sm"
                  style={{
                    backgroundColor: tertiary || secondary,
                    opacity: 0.4,
                  }}
                />
              </div>
              {/* Widget card 2 */}
              <div
                className="rounded p-2 flex flex-col gap-1.5"
                style={{ backgroundColor: adjustColor(primary, -0.35) }}
              >
                <div
                  className="h-1.5 w-8 rounded-sm"
                  style={{ backgroundColor: secondary, opacity: 0.7 }}
                />
                <div className="flex flex-row gap-1 flex-1">
                  <div
                    className="flex-1 rounded-sm"
                    style={{ backgroundColor: primary, opacity: 0.25 }}
                  />
                  <div
                    className="flex-1 rounded-sm"
                    style={{
                      backgroundColor: tertiary || secondary,
                      opacity: 0.25,
                    }}
                  />
                </div>
              </div>
              {/* Widget card 3 */}
              <div
                className="rounded p-2 flex flex-col gap-1.5"
                style={{ backgroundColor: adjustColor(primary, -0.35) }}
              >
                <div
                  className="h-1.5 w-12 rounded-sm"
                  style={{ backgroundColor: tertiary || primary, opacity: 0.7 }}
                />
                <div
                  className="h-4 w-full rounded-sm"
                  style={{ backgroundColor: primary, opacity: 0.2 }}
                />
                <div
                  className="h-4 w-full rounded-sm"
                  style={{ backgroundColor: secondary, opacity: 0.2 }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const { currentTheme, changeThemesForApplication } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState(null);

  const pkg = themePackage;
  if (!pkg) return null;

  const rawColors = pkg.colors || {};
  // Also check top-level fields for themes that store colors directly
  const colors = {
    primary: toDisplayColor(rawColors.primary || pkg.primary || ""),
    secondary: toDisplayColor(rawColors.secondary || pkg.secondary || ""),
    tertiary: toDisplayColor(rawColors.tertiary || pkg.tertiary || ""),
    neutral: toDisplayColor(rawColors.neutral || pkg.neutral || ""),
  };

  async function handleInstall() {
    if (!appId || !pkg.name) return;
    setIsInstalling(true);
    setInstallResult(null);
    try {
      // Send scoped name (scope/name) for unambiguous package lookup;
      // fall back to bare name if scope is missing
      const installName = pkg.scope
        ? `${pkg.scope.replace(/^@/, "")}/${pkg.name}`
        : pkg.name;
      const result = await window.mainApi.themes.installThemeFromRegistry(
        appId,
        installName,
      );
      if (result?.authRequired) {
        // Auth needed — show inline auth prompt
        setIsInstalling(false);
        setInstallResult({
          status: "auth",
          message: result.error || "Sign in to install this theme.",
        });
        return;
      }
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

        <hr className={currentTheme["border-primary-medium"]} />

        {/* Theme Preview Mockup */}
        {colorEntries.length > 0 && <ThemePreviewMockup colors={colors} />}

        {/* Color Swatches */}
        {colorEntries.length > 0 && (
          <div className="flex flex-row gap-3">
            {colorEntries.map(({ label, value }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1 flex-1"
              >
                <div
                  className="h-8 w-8 rounded border-2 border-white/20"
                  style={{ backgroundColor: value }}
                />
                <span className="text-[10px] opacity-50">{label}</span>
                <span className="text-[10px] opacity-30 font-mono">
                  {value}
                </span>
              </div>
            ))}
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

      {/* Auth Modal */}
      <RegistryAuthModal
        isOpen={installResult?.status === "auth"}
        setIsOpen={(open) => {
          if (!open) setInstallResult(null);
        }}
        onAuthenticated={() => {
          setInstallResult(null);
          handleInstall();
        }}
        onCancel={() => setInstallResult(null)}
        message={installResult?.message || "Sign in to install this theme."}
      />
    </div>
  );
};
