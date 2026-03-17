import React, { useState, useEffect, useContext, useCallback } from "react";
import {
  FontAwesomeIcon,
  InputText,
  ThemeContext,
  Button,
} from "@trops/dash-react";
import { AppContext } from "../../../../Context";
import {
  layoutTemplates,
  createLayoutFromTemplate,
} from "../../LayoutManager/layoutTemplates";
import { FOLDER_ICONS } from "../../../Settings/details/FolderDetail";
import { resolveIcon } from "../../../../utils/resolveIcon";

/**
 * WizardCustomizeStep
 *
 * Step 4 of the Dashboard Wizard. Combines name input, folder picker,
 * theme picker, and provider-setup summary into a single customize step.
 * Handles final creation for both pre-built (registry install) and
 * build-your-own (template + widget placement) paths.
 *
 * @param {Object} props
 * @param {Object} props.state - Wizard state from useWizardState
 * @param {Function} props.dispatch - Wizard dispatch from useWizardState
 * @param {Array} props.menuItems - Available folder/menu items
 * @param {Function} [props.onSaveMenuItem] - Callback to persist a new folder
 * @param {Function} [props.onCreateWorkspace] - Callback for build-your-own path creation
 * @param {Function} [props.onInstallDashboard] - Callback for pre-built path creation
 * @param {Function} [props.onOpenDashboard] - Callback to open the created dashboard
 * @param {string} [props.appId] - Application ID for API calls
 */
export const WizardCustomizeStep = ({
  state,
  dispatch,
  menuItems = [],
  onSaveMenuItem = null,
  onCreateWorkspace = null,
  onInstallDashboard = null,
  onOpenDashboard = null,
  appId,
}) => {
  const { themes, themeKey: appThemeKey } = useContext(ThemeContext);
  const { providers: providersMap } = useContext(AppContext);

  const [localMenuItems, setLocalMenuItems] = useState(menuItems);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderIcon, setNewFolderIcon] = useState(null);

  // Creation state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [createdDashboard, setCreatedDashboard] = useState(null);

  const isPrebuilt = state.path === "prebuilt";

  // Initialize customization defaults on mount
  useEffect(() => {
    setLocalMenuItems(menuItems);
    const updates = {};
    if (!state.customization.menuId && menuItems.length > 0) {
      updates.menuId = menuItems[0].id;
    }
    if (!state.customization.theme && themes) {
      const fallback = Object.entries(themes).sort(([, a], [, b]) =>
        (a.name || "").localeCompare(b.name || ""),
      )[0]?.[0];
      updates.theme = appThemeKey || fallback || null;
    }
    if (Object.keys(updates).length > 0) {
      dispatch({ type: "SET_CUSTOMIZATION", payload: updates });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNameChange = useCallback(
    (val) => {
      dispatch({ type: "SET_CUSTOMIZATION", payload: { name: val } });
    },
    [dispatch],
  );

  const handleMenuSelect = useCallback(
    (id) => {
      dispatch({ type: "SET_CUSTOMIZATION", payload: { menuId: id } });
      setIsCreatingFolder(false);
      setNewFolderName("");
      setNewFolderIcon(null);
    },
    [dispatch],
  );

  const handleThemeSelect = useCallback(
    (key) => {
      dispatch({ type: "SET_CUSTOMIZATION", payload: { theme: key } });
    },
    [dispatch],
  );

  function handleCancelNewFolder() {
    setIsCreatingFolder(false);
    setNewFolderName("");
    setNewFolderIcon(null);
  }

  function handleSaveNewFolder() {
    if (!newFolderName.trim() || !newFolderIcon) return;
    const newItem = {
      id: Date.now(),
      name: newFolderName.trim(),
      icon: newFolderIcon,
    };
    setLocalMenuItems((prev) => [...prev, newItem]);
    dispatch({ type: "SET_CUSTOMIZATION", payload: { menuId: newItem.id } });
    if (onSaveMenuItem) {
      onSaveMenuItem(newItem);
    }
    setIsCreatingFolder(false);
    setNewFolderName("");
    setNewFolderIcon(null);
  }

  // --- Create logic ---
  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);

    try {
      const { name, menuId, theme } = state.customization;
      let result;

      if (isPrebuilt && state.selectedDashboard) {
        // Pre-built path: install from registry then apply customizations
        if (onInstallDashboard) {
          result = await onInstallDashboard({
            dashboard: state.selectedDashboard,
            name: name.trim(),
            menuId: menuId || 1,
            themeKey: theme,
            appId,
          });
        } else if (window.mainApi?.registry?.installDashboard) {
          const installResult = await window.mainApi.registry.installDashboard(
            appId,
            state.selectedDashboard.name || state.selectedDashboard.key,
          );
          if (installResult?.workspace) {
            const updatedWorkspace = {
              ...installResult.workspace,
              name: name.trim(),
              menuId: menuId || 1,
              themeKey: theme,
            };
            await window.mainApi.workspace.saveWorkspaceForApplication(
              appId,
              updatedWorkspace,
            );
            result = { success: true, workspace: updatedWorkspace };
          }
        }
      } else {
        // Build-your-own path: create layout from template + place widgets
        const template = layoutTemplates.find(
          (t) => t.id === state.layout.templateKey,
        );
        if (!template) {
          throw new Error("No layout template selected.");
        }

        const layoutObj = createLayoutFromTemplate(template, menuId || 1);

        // Place widgets into grid cells
        const widgetOrder = state.layout.widgetOrder || [];
        const cells = template.cells.filter((c) => !c.hide);
        for (let i = 0; i < widgetOrder.length && i < cells.length; i++) {
          const widget = state.selectedWidgets.find(
            (w) => (w.name || w.key) === widgetOrder[i],
          );
          if (widget && layoutObj.grid[cells[i].key]) {
            layoutObj.grid[cells[i].key].component =
              widget.component || widget.name || widget.key;
          }
        }

        if (onCreateWorkspace) {
          result = await onCreateWorkspace(layoutObj, theme, name.trim());
        } else if (window.mainApi?.workspace?.saveWorkspaceForApplication) {
          const workspace = {
            name: name.trim(),
            menuId: menuId || 1,
            themeKey: theme,
            layout: [layoutObj],
          };
          await window.mainApi.workspace.saveWorkspaceForApplication(
            appId,
            workspace,
          );
          result = { success: true, workspace };
        }
      }

      if (result) {
        setCreatedDashboard(result.workspace || result);
      }
    } catch (err) {
      console.error("[WizardCustomizeStep] Create error:", err);
      setError(err.message || "Failed to create dashboard.");
    } finally {
      setCreating(false);
    }
  }, [state, isPrebuilt, onInstallDashboard, onCreateWorkspace, appId]);

  // --- Success state ---
  if (createdDashboard) {
    return (
      <div className="wizard-customize-step">
        <div className="wizard-success">
          <FontAwesomeIcon
            icon="circle-check"
            className="wizard-success-icon"
          />
          <h3 className="wizard-step-header">Dashboard created!</h3>
          <p className="wizard-step-description">
            Your dashboard{" "}
            <strong>
              {createdDashboard.name || state.customization.name.trim()}
            </strong>{" "}
            is ready.
          </p>
          {onOpenDashboard && (
            <Button
              onClick={() => onOpenDashboard(createdDashboard)}
              title="Open Dashboard"
              textSize="text-base"
              padding="py-2 px-6"
              backgroundColor="bg-blue-600"
              textColor="text-white"
              hoverTextColor="hover:text-white"
              hoverBackgroundColor="hover:bg-blue-500"
              icon="arrow-right"
            />
          )}
        </div>
      </div>
    );
  }

  // --- Provider setup summary ---
  const selectedProviders = (
    (state.filters && state.filters.providers) ||
    []
  ).map((provKey) => {
    const prov = providersMap?.[provKey] || {};
    return {
      key: provKey,
      name: prov.name || provKey,
      icon: prov.icon || "plug",
      configured: !!prov.configured,
    };
  });
  const configuredProviders = selectedProviders.filter((p) => p.configured);
  const needsSetupProviders = selectedProviders.filter((p) => !p.configured);

  const selectedFolder = localMenuItems.find(
    (item) => item.id === state.customization.menuId,
  );
  const selectedTheme =
    themes && state.customization.theme
      ? themes[state.customization.theme]
      : null;

  return (
    <div className="wizard-customize-step">
      <h3 className="wizard-step-header">Customize your dashboard</h3>
      <p className="wizard-step-description">
        Name your dashboard, choose a folder, and pick a theme.
      </p>

      <div className="wizard-customize-sections">
        {/* --- Name --- */}
        <div className="wizard-customize-section">
          <label className="wizard-customize-label">
            <FontAwesomeIcon
              icon="input-text"
              fixedWidth
              className="wizard-customize-label-icon"
            />
            Dashboard Name
          </label>
          <InputText
            value={state.customization.name}
            onChange={handleNameChange}
            placeholder="My Dashboard"
            autoFocus={true}
          />
        </div>

        {/* --- Folder picker --- */}
        <div className="wizard-customize-section">
          <label className="wizard-customize-label">
            <FontAwesomeIcon
              icon="folder"
              fixedWidth
              className="wizard-customize-label-icon"
            />
            Folder
          </label>
          <div className="wizard-customize-folder-list">
            {!isCreatingFolder ? (
              <button
                type="button"
                className="wizard-customize-folder-create"
                onClick={() => setIsCreatingFolder(true)}
              >
                <FontAwesomeIcon icon="plus" fixedWidth />
                <span>New Folder</span>
              </button>
            ) : (
              <div className="wizard-customize-folder-form">
                <div className="wizard-customize-folder-form-header">
                  <span className="text-sm font-medium text-gray-300">
                    New Folder
                  </span>
                  <button
                    type="button"
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={handleCancelNewFolder}
                  >
                    <FontAwesomeIcon icon="xmark" />
                  </button>
                </div>
                <InputText
                  value={newFolderName}
                  onChange={(val) => setNewFolderName(val)}
                  placeholder="Folder name"
                />
                <div className="grid grid-cols-10 gap-2">
                  {FOLDER_ICONS.map((icon) => {
                    const isIconSelected = icon === newFolderIcon;
                    return (
                      <div
                        key={icon}
                        className={`flex items-center justify-center p-2 rounded cursor-pointer transition-all ${
                          isIconSelected
                            ? "bg-blue-600 ring-2 ring-blue-400 text-white"
                            : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200"
                        }`}
                        onClick={() => setNewFolderIcon(icon)}
                      >
                        <FontAwesomeIcon icon={icon} />
                      </div>
                    );
                  })}
                </div>
                <Button
                  onClick={handleSaveNewFolder}
                  title="Add Folder"
                  textSize="text-sm"
                  padding="py-1 px-3"
                  backgroundColor="bg-blue-600"
                  textColor="text-white"
                  hoverTextColor="hover:text-white"
                  hoverBackgroundColor="hover:bg-blue-500"
                  disabled={!newFolderName.trim() || !newFolderIcon}
                />
              </div>
            )}
            {localMenuItems.map((item) => {
              const isSelected =
                !isCreatingFolder && item.id === state.customization.menuId;
              return (
                <div
                  key={item.id}
                  className={`wizard-customize-folder-item ${
                    isSelected ? "wizard-customize-folder-item--selected" : ""
                  }`}
                  onClick={() => handleMenuSelect(item.id)}
                >
                  <FontAwesomeIcon
                    icon={item.icon || item.folder || "folder"}
                    fixedWidth
                    className={`w-5 h-5 ${
                      isSelected ? "text-blue-400" : "text-gray-400"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isSelected ? "text-blue-300" : "text-gray-300"
                    }`}
                  >
                    {item.name}
                  </span>
                  {isSelected && (
                    <FontAwesomeIcon
                      icon="check"
                      className="ml-auto text-blue-400 text-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* --- Theme picker --- */}
        <div className="wizard-customize-section">
          <label className="wizard-customize-label">
            <FontAwesomeIcon
              icon="palette"
              fixedWidth
              className="wizard-customize-label-icon"
            />
            Theme
          </label>
          <div className="wizard-customize-theme-list">
            {themes &&
              Object.entries(themes)
                .sort(([, a], [, b]) =>
                  (a.name || "").localeCompare(b.name || ""),
                )
                .map(([key, t]) => {
                  const isThemeSelected = state.customization.theme === key;
                  return (
                    <div
                      key={key}
                      className={`wizard-customize-theme-item ${
                        isThemeSelected
                          ? "wizard-customize-theme-item--selected"
                          : ""
                      }`}
                      onClick={() => handleThemeSelect(key)}
                    >
                      <FontAwesomeIcon
                        icon="palette"
                        className={`w-5 h-5 mr-3 ${
                          isThemeSelected ? "text-blue-400" : "text-gray-400"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          isThemeSelected ? "text-blue-300" : "text-gray-300"
                        }`}
                      >
                        {t.name || key}
                      </span>
                      <div className="flex flex-row space-x-1 ml-auto">
                        {t.primary && (
                          <div
                            className={`w-4 h-4 rounded bg-${t.primary}-500`}
                          />
                        )}
                        {t.secondary && (
                          <div
                            className={`w-4 h-4 rounded bg-${t.secondary}-500`}
                          />
                        )}
                        {t.tertiary && (
                          <div
                            className={`w-4 h-4 rounded bg-${t.tertiary}-500`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* --- Provider setup summary --- */}
        {selectedProviders.length > 0 && (
          <div className="wizard-customize-section">
            <label className="wizard-customize-label">
              <FontAwesomeIcon
                icon="plug"
                fixedWidth
                className="wizard-customize-label-icon"
              />
              Provider Status
            </label>
            <div className="wizard-customize-provider-summary">
              {configuredProviders.length > 0 && (
                <div className="wizard-provider-group">
                  <span className="wizard-provider-group-label wizard-provider-group-label--ready">
                    <FontAwesomeIcon
                      icon="circle-check"
                      className="text-green-400"
                    />{" "}
                    Ready ({configuredProviders.length})
                  </span>
                  <div className="wizard-provider-list">
                    {configuredProviders.map((p) => (
                      <span
                        key={p.key}
                        className="wizard-provider-badge wizard-provider-badge--ready"
                      >
                        <FontAwesomeIcon
                          icon={resolveIcon(p.icon)}
                          fixedWidth
                        />
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {needsSetupProviders.length > 0 && (
                <div className="wizard-provider-group">
                  <span className="wizard-provider-group-label wizard-provider-group-label--setup">
                    <FontAwesomeIcon
                      icon="circle-exclamation"
                      className="text-amber-400"
                    />{" "}
                    Needs setup ({needsSetupProviders.length})
                  </span>
                  <div className="wizard-provider-list">
                    {needsSetupProviders.map((p) => (
                      <span
                        key={p.key}
                        className="wizard-provider-badge wizard-provider-badge--setup"
                      >
                        <FontAwesomeIcon
                          icon={resolveIcon(p.icon)}
                          fixedWidth
                        />
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Summary sidebar --- */}
        <div className="wizard-customize-summary">
          <span className="wizard-customize-summary-title">Summary</span>
          {state.customization.name.trim() && (
            <div className="wizard-customize-summary-row">
              <FontAwesomeIcon icon="clone" className="text-blue-400" />
              <span>{state.customization.name.trim()}</span>
            </div>
          )}
          {selectedFolder && (
            <div className="wizard-customize-summary-row">
              <FontAwesomeIcon
                icon={selectedFolder.icon || selectedFolder.folder || "folder"}
                className="text-blue-400"
              />
              <span>{selectedFolder.name}</span>
            </div>
          )}
          {selectedTheme && (
            <div className="wizard-customize-summary-row">
              <FontAwesomeIcon icon="palette" className="text-blue-400" />
              <span>{selectedTheme.name || state.customization.theme}</span>
              <div className="flex flex-row space-x-1 ml-2">
                {selectedTheme.primary && (
                  <div
                    className={`w-3 h-3 rounded bg-${selectedTheme.primary}-500`}
                  />
                )}
                {selectedTheme.secondary && (
                  <div
                    className={`w-3 h-3 rounded bg-${selectedTheme.secondary}-500`}
                  />
                )}
              </div>
            </div>
          )}
          <div className="wizard-customize-summary-row">
            <FontAwesomeIcon
              icon={isPrebuilt ? "box" : "grid-2"}
              className="text-blue-400"
            />
            <span>
              {isPrebuilt
                ? state.selectedDashboard?.displayName ||
                  state.selectedDashboard?.name ||
                  "Pre-built dashboard"
                : `${state.selectedWidgets.length} widget${state.selectedWidgets.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>

        {/* --- Error display --- */}
        {error && (
          <div className="wizard-customize-error">
            <FontAwesomeIcon
              icon="triangle-exclamation"
              className="text-red-400"
            />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
