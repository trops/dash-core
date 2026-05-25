import React, { useState, useContext, useEffect, useRef } from "react";
import {
  Sidebar,
  Switch,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { SectionLayout } from "../SectionLayout";
import { ThemeDetail } from "../details/ThemeDetail";
import { DiscoverThemesDetail } from "../details/DiscoverThemesDetail";
import { ThemeManagerModal } from "../../Theme/ThemeManagerModal";
import { ThemeColorDots } from "../../Theme/ThemeColorDots";

// ─── Main Component ──────────────────────────────────────────────────────

export const ThemesSection = ({
  onOpenThemeEditor = null,
  dashApi = null,
  credentials = null,
  createRequested = false,
  onCreateAcknowledged = null,
}) => {
  const {
    themes,
    themeKey: currentThemeKey,
    themeVariant,
    changeCurrentTheme,
    changeThemeVariant,
    changeThemesForApplication,
    currentTheme,
  } = useContext(ThemeContext);

  const [selectedThemeKey, setSelectedThemeKey] = useState(currentThemeKey);
  // Theme creation lives entirely in ThemeManagerModal — opened when
  // the parent "+ New Theme" button signals via `createRequested`.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // null | "marketplace"
  const [installMode, setInstallMode] = useState(null);

  const themeEntries = themes ? Object.entries(themes) : [];
  const appId = credentials?.appId;

  const rowStyles = getStylesForItem(themeObjects.PANEL_HEADER, currentTheme, {
    grow: false,
  });

  // Handle create request from parent — open the ThemeManagerModal
  // in create mode. All five creation paths (Marketplace, Presets,
  // Colors, Random, Website) live inside the modal's wizard.
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      setCreateModalOpen(true);
      setInstallMode(null);
    }
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  function handleDeleteTheme(key) {
    if (!dashApi || !appId) return;
    if (key === currentThemeKey) {
      const otherKey = themeEntries.find(([k]) => k !== key)?.[0];
      if (otherKey) {
        changeCurrentTheme(otherKey);
      } else {
        return;
      }
    }

    dashApi.deleteTheme(
      appId,
      key,
      (e, message) => {
        if (message && message.themes) {
          changeThemesForApplication(message.themes);
        }
        if (selectedThemeKey === key) {
          setSelectedThemeKey(null);
        }
      },
      (e, err) => {
        console.error("Error deleting theme:", err);
      },
    );
  }

  function handleToggleVariant(isDark) {
    changeThemeVariant(isDark ? "dark" : "light");
  }

  function handleActivate(key) {
    changeCurrentTheme(key);
  }

  function handleEdit() {
    if (onOpenThemeEditor) onOpenThemeEditor();
  }

  const listContent = (
    <div className="flex flex-col h-full">
      {/* Variant toggle */}
      <div
        className={`flex-shrink-0 flex flex-col gap-2 px-3 py-2 ${
          rowStyles.backgroundColor || ""
        }`}
      >
        <div className="flex flex-row items-center justify-between">
          <div className="flex flex-row items-center gap-2">
            <FontAwesomeIcon icon="sun" className="h-3 w-3 opacity-50" />
            <Switch
              checked={themeVariant === "dark"}
              onChange={handleToggleVariant}
            />
            <FontAwesomeIcon icon="moon" className="h-3 w-3 opacity-50" />
          </div>
          <span className="text-xs opacity-50">
            {themeVariant === "dark" ? "Dark" : "Light"}
          </span>
        </div>
      </div>

      {/* Theme list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <Sidebar.Content>
          {themeEntries.map(([key, theme]) => {
            const isActive = key === currentThemeKey;
            const isSelected =
              selectedThemeKey === key && installMode !== "marketplace";
            return (
              <Sidebar.Item
                key={key}
                icon={
                  isActive ? (
                    <FontAwesomeIcon
                      icon="check"
                      className="h-3 w-3 text-green-500"
                    />
                  ) : (
                    <FontAwesomeIcon icon="palette" className="h-3.5 w-3.5" />
                  )
                }
                active={isSelected}
                onClick={() => {
                  setSelectedThemeKey(key);
                  setInstallMode(null);
                }}
                badge={<ThemeColorDots theme={theme} />}
                className={isSelected ? "bg-white/10 opacity-100" : ""}
              >
                {theme.name || key}
              </Sidebar.Item>
            );
          })}
          {themeEntries.length === 0 && (
            <span className="text-sm opacity-40 py-8 text-center">
              No themes available
            </span>
          )}
        </Sidebar.Content>
      </div>
    </div>
  );

  // Determine detail content based on mode
  let detailContent = null;

  if (installMode === "marketplace") {
    detailContent = (
      <DiscoverThemesDetail
        onBack={() => {
          setInstallMode(null);
        }}
        appId={appId}
        onInstallComplete={() => {
          // Refresh themes after install
          if (dashApi && appId) {
            dashApi.listThemes(appId, (e, message) => {
              if (message && message.themes) {
                changeThemesForApplication(message.themes);
              }
            });
          }
        }}
      />
    );
  } else if (selectedThemeKey && themes && themes[selectedThemeKey]) {
    detailContent = (
      <ThemeDetail
        themeKey={selectedThemeKey}
        themes={themes}
        currentThemeKey={currentThemeKey}
        themeVariant={themeVariant}
        onActivate={handleActivate}
        onOpenThemeEditor={handleEdit}
        onDelete={handleDeleteTheme}
        appId={appId}
      />
    );
  }

  return (
    <>
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a theme to view details"
      />
      <ThemeManagerModal
        open={createModalOpen}
        setIsOpen={(next) => {
          // ThemeManagerModal calls setIsOpen with a value or a
          // toggle pattern depending on call site — normalize.
          if (typeof next === "function") {
            setCreateModalOpen((prev) => next(prev));
          } else if (typeof next === "boolean") {
            setCreateModalOpen(next);
          } else {
            setCreateModalOpen(false);
          }
        }}
        startInCreate={true}
      />
    </>
  );
};
