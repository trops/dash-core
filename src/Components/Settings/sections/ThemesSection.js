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
import { generateRandomTheme } from "../../../utils/themeGenerator";
import {
  ThemeQuickCreate,
  PresetGallery,
  ColorHarmonyPicker,
  GENERATE_MODES,
} from "../../Theme/Wizard";

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
  const [generateMode, setGenerateMode] = useState(GENERATE_MODES.NONE);
  const [wizardName, setWizardName] = useState("");
  const [wizardMethod, setWizardMethod] = useState(null);
  const [wizardTheme, setWizardTheme] = useState(null);
  // null | "marketplace"
  const [installMode, setInstallMode] = useState(null);

  const themeEntries = themes ? Object.entries(themes) : [];
  const appId = credentials?.appId;

  const rowStyles = getStylesForItem(themeObjects.PANEL_HEADER, currentTheme, {
    grow: false,
  });

  // Handle create request from parent — enter wizard mode
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      setGenerateMode(GENERATE_MODES.WIZARD);
      setWizardName("");
      setWizardMethod(null);
      setWizardTheme(null);
      setSelectedThemeKey(null);
      setInstallMode(null);
    }
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  function handleCreateFromPreset(preset) {
    if (!dashApi || !appId) return;
    const key = preset.id || `theme-${Date.now()}`;
    preset.id = key;
    saveAndSelectTheme(key, preset);
    setGenerateMode(GENERATE_MODES.NONE);
  }

  function handleCreateFromRandom() {
    if (!dashApi || !appId) return;
    const theme = generateRandomTheme();
    const key = theme.id;
    saveAndSelectTheme(key, theme);
  }

  function handleCreateFromHarmony(theme) {
    if (!dashApi || !appId) return;
    const key = theme.id;
    saveAndSelectTheme(key, theme);
    setGenerateMode(GENERATE_MODES.NONE);
  }

  function handleWizardComplete() {
    if (!wizardTheme || !wizardName.trim()) return;
    if (!dashApi || !appId) return;
    const key = wizardTheme.id || `theme-${Date.now()}`;
    const finalTheme = { ...wizardTheme, id: key, name: wizardName.trim() };
    saveAndSelectTheme(key, finalTheme);
  }

  function saveAndSelectTheme(key, rawTheme) {
    dashApi.saveTheme(
      appId,
      key,
      rawTheme,
      (e, message) => {
        if (message && message.themes) {
          changeThemesForApplication(message.themes);
        }
        setSelectedThemeKey(key);
        setGenerateMode(GENERATE_MODES.NONE);
      },
      (e, err) => {
        console.error("Error saving theme:", err);
      },
    );
  }

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
      {/* Variant toggle + tabs header */}
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
        <div className="flex bg-white/5 rounded-md p-0.5">
          {[
            { key: "themes", label: "My Themes" },
            { key: "marketplace", label: "Marketplace" },
          ].map((tab) => {
            const currentTab =
              installMode === "marketplace" ? "marketplace" : "themes";
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  if (tab.key === "marketplace") {
                    setInstallMode("marketplace");
                    setSelectedThemeKey(null);
                    setGenerateMode(GENERATE_MODES.NONE);
                  } else {
                    setInstallMode(null);
                  }
                }}
                className={`flex-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
                  currentTab === tab.key
                    ? "bg-white/10 font-medium opacity-90"
                    : "opacity-50 hover:opacity-70"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <Sidebar.Content>
          {themeEntries.map(([key, theme]) => {
            const isActive = key === currentThemeKey;
            const isSelected =
              selectedThemeKey === key &&
              generateMode === GENERATE_MODES.NONE &&
              installMode !== "marketplace";
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
                  setGenerateMode(GENERATE_MODES.NONE);
                  setInstallMode(null);
                }}
                badge={isActive ? "active" : null}
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
  } else if (generateMode === GENERATE_MODES.WIZARD) {
    detailContent = (
      <ThemeQuickCreate
        wizardName={wizardName}
        setWizardName={setWizardName}
        wizardMethod={wizardMethod}
        setWizardMethod={setWizardMethod}
        wizardTheme={wizardTheme}
        setWizardTheme={setWizardTheme}
        onComplete={handleWizardComplete}
      />
    );
  } else if (generateMode === GENERATE_MODES.PRESETS) {
    detailContent = <PresetGallery onSelect={handleCreateFromPreset} />;
  } else if (generateMode === GENERATE_MODES.COLOR) {
    detailContent = <ColorHarmonyPicker onGenerate={handleCreateFromHarmony} />;
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
    <SectionLayout
      listContent={listContent}
      detailContent={detailContent}
      emptyDetailMessage="Select a theme to view details"
    />
  );
};
