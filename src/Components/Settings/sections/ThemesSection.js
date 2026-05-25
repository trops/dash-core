import React, { useState, useContext, useEffect, useRef } from "react";
import {
  Sidebar,
  Switch,
  ThemeContext,
  ThemeFromUrlPane,
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
  ThemeNewChooser,
  PresetGallery,
  ColorHarmonyPicker,
  GENERATE_MODES,
} from "../../Theme/Wizard";
import { ThemeColorDots } from "../../Theme/ThemeColorDots";

const BackToChooser = ({ onClick, children }) => (
  <div className="flex flex-col h-full overflow-hidden">
    <div className="flex-shrink-0 px-4 pt-4">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 text-sm opacity-60 hover:opacity-100 transition-opacity"
      >
        <FontAwesomeIcon icon="arrow-left" className="h-3 w-3" />
        <span>Back</span>
      </button>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
  </div>
);

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
  const [enteredViaChooser, setEnteredViaChooser] = useState(false);
  const [initialMethod, setInitialMethod] = useState(null);

  const themeEntries = themes ? Object.entries(themes) : [];
  const appId = credentials?.appId;

  const rowStyles = getStylesForItem(themeObjects.PANEL_HEADER, currentTheme, {
    grow: false,
  });

  // Handle create request from parent — enter wizard mode
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      setGenerateMode(GENERATE_MODES.CHOOSER);
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

  async function handleUrlExtract(url) {
    return new Promise((resolve, reject) => {
      dashApi.extractThemeFromUrl(
        url,
        (e, result) => resolve(result),
        (e, err) => reject(err),
      );
    });
  }

  async function handleUrlMapToTheme(palette, roleAssignments) {
    const overrides = {};
    for (const [role, index] of Object.entries(roleAssignments)) {
      if (palette[index]) {
        overrides[role] = palette[index].hex;
      }
    }
    return new Promise((resolve, reject) => {
      dashApi.mapPaletteToTheme(
        palette,
        overrides,
        (e, result) => resolve(result?.theme || result),
        (e, err) => reject(err),
      );
    });
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
          if (enteredViaChooser) {
            setGenerateMode(GENERATE_MODES.CHOOSER);
            setEnteredViaChooser(false);
          }
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
  } else if (generateMode === GENERATE_MODES.CHOOSER) {
    detailContent = (
      <ThemeNewChooser
        onSearchThemes={() => {
          setGenerateMode(GENERATE_MODES.NONE);
          setInstallMode("marketplace");
          setEnteredViaChooser(true);
        }}
        onSelectMethod={(method) => {
          setInitialMethod(method);
          if (method === "presets") setGenerateMode(GENERATE_MODES.PRESETS);
          else if (method === "color") setGenerateMode(GENERATE_MODES.COLOR);
          else if (method === "from-url")
            setGenerateMode(GENERATE_MODES.FROM_URL);
          else setGenerateMode(GENERATE_MODES.WIZARD);
        }}
      />
    );
  } else if (generateMode === GENERATE_MODES.WIZARD) {
    detailContent = (
      <BackToChooser onClick={() => setGenerateMode(GENERATE_MODES.CHOOSER)}>
        <ThemeQuickCreate
          wizardName={wizardName}
          setWizardName={setWizardName}
          wizardMethod={wizardMethod}
          setWizardMethod={setWizardMethod}
          wizardTheme={wizardTheme}
          setWizardTheme={setWizardTheme}
          onComplete={handleWizardComplete}
          onExtract={handleUrlExtract}
          onMapToTheme={handleUrlMapToTheme}
          initialMethod={initialMethod}
        />
      </BackToChooser>
    );
  } else if (generateMode === GENERATE_MODES.PRESETS) {
    detailContent = (
      <BackToChooser onClick={() => setGenerateMode(GENERATE_MODES.CHOOSER)}>
        <PresetGallery onSelect={handleCreateFromPreset} />
      </BackToChooser>
    );
  } else if (generateMode === GENERATE_MODES.FROM_URL) {
    detailContent = (
      <BackToChooser onClick={() => setGenerateMode(GENERATE_MODES.CHOOSER)}>
        <ThemeFromUrlPane
          onExtract={handleUrlExtract}
          onMapToTheme={handleUrlMapToTheme}
          onGenerate={setWizardTheme}
        />
      </BackToChooser>
    );
  } else if (generateMode === GENERATE_MODES.COLOR) {
    detailContent = (
      <BackToChooser onClick={() => setGenerateMode(GENERATE_MODES.CHOOSER)}>
        <ColorHarmonyPicker onGenerate={handleCreateFromHarmony} />
      </BackToChooser>
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
    <SectionLayout
      listContent={listContent}
      detailContent={detailContent}
      emptyDetailMessage="Select a theme to view details"
    />
  );
};
