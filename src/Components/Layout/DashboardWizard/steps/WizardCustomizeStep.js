import React, { useState, useEffect, useContext, useCallback } from "react";
import {
  FontAwesomeIcon,
  InputText,
  ThemeContext,
  Button,
  Card3,
  Tag3,
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
  createHandlerRef = null,
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

  // Sub-step state (DASH-188): 0 = Name, 1 = Folder, 2 = Theme
  const [subStep, setSubStep] = useState(0);

  const isPrebuilt = state.path === "prebuilt";

  // Initialize customization defaults when stepping into this step
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
    // Auto-populate name from selected dashboard (DASH-184)
    if (!state.customization.name && state.selectedDashboard) {
      updates.name =
        state.selectedDashboard.displayName ||
        state.selectedDashboard.name ||
        "";
    }
    if (Object.keys(updates).length > 0) {
      dispatch({ type: "SET_CUSTOMIZATION", payload: updates });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.selectedDashboard]);

  // --- Create logic (DASH-191: moved above useEffect so ref captures actual function) ---
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

        // Install selected registry widgets that aren't yet installed
        if (window.mainApi?.widgets) {
          const installedList = (await window.mainApi.widgets.list()) || [];
          const installedNames = new Set(installedList.map((w) => w.name));

          for (const widget of state.selectedWidgets) {
            if (!widget.isRegistry) continue;
            const scopedId = widget.packageScope
              ? `@${widget.packageScope.replace(/^@/, "")}/${widget.packageName}`
              : widget.packageName;
            if (
              !installedNames.has(scopedId) &&
              !installedNames.has(widget.packageName)
            ) {
              const resolvedUrl = (widget.downloadUrl || "")
                .replace(/\{version\}/g, widget.packageVersion || "")
                .replace(/\{name\}/g, widget.packageName || "");
              if (resolvedUrl) {
                await window.mainApi.widgets.install(scopedId, resolvedUrl);
              }
            }
          }
        }

        const layoutObj = createLayoutFromTemplate(template, menuId || 1);

        // Place widgets into grid cells as proper layout items
        const widgetOrder = state.layout.widgetOrder || [];
        const cells = template.cells.filter((c) => !c.hide);
        const widgetItems = [];
        let nextId = 2; // grid container is ID 1

        for (let i = 0; i < widgetOrder.length && i < cells.length; i++) {
          const widget = state.selectedWidgets.find(
            (w) => (w.name || w.key) === widgetOrder[i],
          );
          if (widget && layoutObj.grid[cells[i].key]) {
            const widgetKey = widget.component || widget.name || widget.key;
            widgetItems.push({
              id: nextId,
              component: widgetKey,
              parent: 1,
              order: i + 1,
              hasChildren: 0,
              scrollable: true,
              workspace: "layout",
            });
            layoutObj.grid[cells[i].key].component = nextId;
            nextId++;
          }
        }

        const fullLayout = [layoutObj, ...widgetItems];

        if (onCreateWorkspace) {
          result = await onCreateWorkspace(fullLayout, theme, name.trim());
        } else if (window.mainApi?.workspace?.saveWorkspaceForApplication) {
          const workspace = {
            name: name.trim(),
            menuId: menuId || 1,
            themeKey: theme,
            layout: fullLayout,
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

  // Expose handleCreate and creating state to parent via ref (DASH-183)
  useEffect(() => {
    if (createHandlerRef) {
      createHandlerRef.current = { handleCreate, creating };
    }
  }, [createHandlerRef, handleCreate, creating]);

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
      setSubStep(2); // Auto-advance to Theme
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

  // --- Success state ---
  if (createdDashboard) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <FontAwesomeIcon
            icon="circle-check"
            className="text-green-400 text-3xl"
          />
          <h3 className="text-lg font-semibold text-gray-200">
            Dashboard created!
          </h3>
          <p className="text-sm text-gray-400">
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

  const SUB_STEPS = [
    { label: "Name", icon: "input-text" },
    { label: "Folder", icon: "folder" },
    { label: "Theme", icon: "palette" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-gray-200">
        Customize your dashboard
      </h3>

      {/* Mini-stepper (DASH-188) */}
      <div className="flex items-center gap-2 mb-2">
        {SUB_STEPS.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && (
              <div
                className={`flex-1 h-px ${i <= subStep ? "bg-blue-500" : "bg-gray-700"}`}
              />
            )}
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === subStep
                  ? "bg-blue-600 text-white"
                  : i < subStep
                    ? "bg-blue-900/50 text-blue-300 cursor-pointer"
                    : "bg-gray-800 text-gray-500"
              }`}
              onClick={() => setSubStep(i)}
            >
              <FontAwesomeIcon icon={s.icon} fixedWidth />
              {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {/* --- Sub-step 0: Name --- */}
        {subStep === 0 && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <FontAwesomeIcon icon="input-text" fixedWidth />
              Dashboard Name
            </label>
            <InputText
              value={state.customization.name}
              onChange={handleNameChange}
              placeholder="My Dashboard"
              autoFocus={true}
            />
            <div className="flex justify-end mt-2">
              <Button
                onClick={() => setSubStep(1)}
                title="Next"
                textSize="text-sm"
                padding="py-1.5 px-4"
                backgroundColor={
                  state.customization.name.trim()
                    ? "bg-blue-600"
                    : "bg-gray-700"
                }
                textColor={
                  state.customization.name.trim()
                    ? "text-white"
                    : "text-gray-500"
                }
                hoverTextColor={
                  state.customization.name.trim()
                    ? "hover:text-white"
                    : "hover:text-gray-500"
                }
                hoverBackgroundColor={
                  state.customization.name.trim()
                    ? "hover:bg-blue-500"
                    : "hover:bg-gray-700"
                }
                disabled={!state.customization.name.trim()}
                icon="arrow-right"
              />
            </div>
          </div>
        )}

        {/* --- Sub-step 1: Folder picker --- */}
        {subStep === 1 && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <FontAwesomeIcon icon="folder" fixedWidth />
              Folder
            </label>
            <div className="flex flex-col gap-1.5">
              {!isCreatingFolder ? (
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 rounded border border-dashed border-gray-600 text-sm text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
                  onClick={() => setIsCreatingFolder(true)}
                >
                  <FontAwesomeIcon icon="plus" fixedWidth />
                  <span>New Folder</span>
                </button>
              ) : (
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
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
                  <Card3
                    key={item.id}
                    hover
                    selected={isSelected}
                    onClick={() => handleMenuSelect(item.id)}
                  >
                    <div className="flex items-center gap-2">
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
                  </Card3>
                );
              })}
            </div>
            <div className="flex justify-end mt-2">
              <Button
                onClick={() => setSubStep(2)}
                title="Next"
                textSize="text-sm"
                padding="py-1.5 px-4"
                backgroundColor="bg-blue-600"
                textColor="text-white"
                hoverTextColor="hover:text-white"
                hoverBackgroundColor="hover:bg-blue-500"
                icon="arrow-right"
              />
            </div>
          </div>
        )}

        {/* --- Sub-step 2: Theme picker --- */}
        {subStep === 2 && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <FontAwesomeIcon icon="palette" fixedWidth />
              Theme
            </label>
            <div className="flex flex-col gap-1.5">
              {themes &&
                Object.entries(themes)
                  .sort(([, a], [, b]) =>
                    (a.name || "").localeCompare(b.name || ""),
                  )
                  .map(([key, t]) => {
                    const isThemeSelected = state.customization.theme === key;
                    return (
                      <Card3
                        key={key}
                        hover
                        selected={isThemeSelected}
                        onClick={() => handleThemeSelect(key)}
                      >
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon
                            icon="palette"
                            className={`w-5 h-5 ${
                              isThemeSelected
                                ? "text-blue-400"
                                : "text-gray-400"
                            }`}
                          />
                          <span
                            className={`text-sm font-medium ${
                              isThemeSelected
                                ? "text-blue-300"
                                : "text-gray-300"
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
                      </Card3>
                    );
                  })}
            </div>
          </div>
        )}

        {/* --- Provider setup summary --- */}
        {selectedProviders.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <FontAwesomeIcon icon="plug" fixedWidth />
              Provider Status
            </label>
            <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-4 flex flex-col gap-3">
              {configuredProviders.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400">
                    <FontAwesomeIcon icon="circle-check" /> Ready (
                    {configuredProviders.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {configuredProviders.map((p) => (
                      <Tag3 key={p.key} text={p.name} />
                    ))}
                  </div>
                </div>
              )}
              {needsSetupProviders.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                    <FontAwesomeIcon icon="circle-exclamation" /> Needs setup (
                    {needsSetupProviders.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {needsSetupProviders.map((p) => (
                      <Tag3 key={p.key} text={p.name} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Summary sidebar --- */}
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-4 flex flex-col gap-2">
          <span className="text-sm font-semibold text-gray-300">Summary</span>
          {state.customization.name.trim() && (
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <FontAwesomeIcon icon="clone" className="text-blue-400" />
              <span>{state.customization.name.trim()}</span>
            </div>
          )}
          {selectedFolder && (
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <FontAwesomeIcon
                icon={selectedFolder.icon || selectedFolder.folder || "folder"}
                className="text-blue-400"
              />
              <span>{selectedFolder.name}</span>
            </div>
          )}
          {selectedTheme && (
            <div className="flex items-center gap-2 text-sm text-gray-300">
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
          <div className="flex items-center gap-2 text-sm text-gray-300">
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
          <div className="flex items-center gap-2 text-red-400 py-2">
            <FontAwesomeIcon icon="triangle-exclamation" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
