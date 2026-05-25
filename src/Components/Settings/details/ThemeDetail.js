import React, { useMemo, useState } from "react";
import {
  Button,
  SubHeading,
  colorTypes,
  themeVariants,
} from "@trops/dash-react";
import { PublishThemeModal } from "./PublishThemeModal";

// --- Color Swatch Grid ---
// Compact preview: one row per channel × 5 shade swatches.
// The bg shade IS the canonical color; text/border tokens are
// deterministic restyles and don't add new information here.
// Full per-token editing remains in the Studio (Edit button).

const ShadeSwatch = ({ tokenKey, resolvedClass, cssValue }) => {
  const tooltip = `${tokenKey} → ${cssValue || resolvedClass || "(none)"}`;
  // Prefer inline cssValue (works for any theme — hex channels
  // don't get their cssVars on :root for non-active themes).
  if (cssValue) {
    return (
      <div
        className="h-10 flex-1 rounded"
        style={{ backgroundColor: cssValue }}
        title={tooltip}
      />
    );
  }
  return (
    <div
      className={`h-10 flex-1 rounded ${resolvedClass || ""}`}
      title={tooltip}
    />
  );
};

const ColorSwatchGrid = ({ displayTheme }) => {
  const cssValueMap = displayTheme.cssValue || {};
  return (
    <div className="flex flex-col space-y-4">
      {colorTypes.map((family) => (
        <div key={family} className="flex flex-col space-y-2">
          <span className="text-xs font-semibold opacity-50 capitalize">
            {family}
          </span>
          <div className="flex flex-row gap-1.5">
            {themeVariants.map((shade) => {
              const tokenKey = `bg-${family}-${shade}`;
              return (
                <ShadeSwatch
                  key={shade}
                  tokenKey={tokenKey}
                  resolvedClass={displayTheme[tokenKey] || ""}
                  cssValue={cssValueMap[tokenKey]}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// --- Main Component ---

export const ThemeDetail = ({
  themeKey,
  themes,
  currentThemeKey,
  themeVariant,
  onActivate,
  onOpenThemeEditor,
  onDelete = null,
  appId = null,
}) => {
  const theme = themeKey && themes ? themes[themeKey] : null;
  const [publishOpen, setPublishOpen] = useState(false);
  const canPublish = theme && !theme._registryMeta;
  const displayTheme = useMemo(() => {
    return theme ? theme[themeVariant] || {} : {};
  }, [theme, themeVariant]);
  const isActive = themeKey === currentThemeKey;

  if (!theme) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {/* Header: Name */}
        <div className="flex flex-row items-center gap-3">
          <SubHeading title={theme.name || themeKey} padding={false} />
          {isActive && <span className="text-xs opacity-40">active</span>}
        </div>

        {/* Color Palette */}
        <ColorSwatchGrid displayTheme={displayTheme} />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex flex-row justify-between px-6 py-4 border-t border-white/10">
        <div className="flex flex-row gap-2">
          {!isActive && onDelete && (
            <Button
              title="Delete"
              onClick={() => onDelete(themeKey)}
              size="sm"
            />
          )}
          {canPublish && (
            <Button
              title="Publish"
              onClick={() => setPublishOpen(true)}
              size="sm"
            />
          )}
        </div>
        <div className="flex flex-row gap-2">
          {!isActive && (
            <Button
              title="Activate"
              onClick={() => onActivate(themeKey)}
              size="sm"
            />
          )}
          <Button title="Edit" onClick={onOpenThemeEditor} size="sm" />
        </div>
      </div>
      {canPublish && (
        <PublishThemeModal
          isOpen={publishOpen}
          setIsOpen={setPublishOpen}
          appId={appId}
          themeKey={themeKey}
          themeName={theme.name || themeKey}
        />
      )}
    </div>
  );
};
