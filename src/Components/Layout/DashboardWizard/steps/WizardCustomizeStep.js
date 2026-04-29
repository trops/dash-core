import React, {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from "react";
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

  // Auth flow state (device-code auth for registry install)
  const [authNeeded, setAuthNeeded] = useState(null);
  const [authFlow, setAuthFlow] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [authError, setAuthError] = useState(null);
  const pollIntervalRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Cycle 2: the inner pages were promoted to top-level wizard steps
  // (state.step 1=Name, 2=Folder, 3=Theme, 4=Review). The internal
  // mini-stepper from DASH-188 is gone — the modal footer's
  // Next/Back drives advancement now, and the wizard's per-step
  // canProceed gates each transition.

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
    setAuthNeeded(null);

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
        } else if (
          window.mainApi?.dashboardConfig?.installDashboardFromRegistry
        ) {
          // Pass the user's customizations as install options so the
          // controller applies them inside processDashboardConfig (one
          // write, no race). Previously we installed with the publisher's
          // menuId then overwrote it via saveWorkspaceForApplication —
          // that left the layout briefly attached to a non-existent
          // folder on the user's machine.
          const installResult =
            await window.mainApi.dashboardConfig.installDashboardFromRegistry(
              appId,
              state.selectedDashboard.name || state.selectedDashboard.key,
              {
                name: name.trim(),
                menuId: menuId || 1,
                themeKey: theme,
              },
            );
          if (installResult?.authRequired) {
            setAuthNeeded(
              installResult.error || "Sign in to install this dashboard.",
            );
            setCreating(false);
            return;
          }
          if (installResult?.workspace) {
            result = { success: true, workspace: installResult.workspace };
          } else if (installResult?.error) {
            throw new Error(installResult.error);
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

  // Expose handleCreate, creating, and createdDashboard state to parent
  // via ref (DASH-183). The parent uses `createdDashboard` to swap the
  // footer "Create Dashboard" button out once the success state is
  // rendered — otherwise the user could accidentally re-fire the
  // install.
  useEffect(() => {
    if (createHandlerRef) {
      createHandlerRef.current = { handleCreate, creating, createdDashboard };
    }
  }, [createHandlerRef, handleCreate, creating, createdDashboard]);

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

  // --- Registry auth sign-in (device-code flow) ---
  async function handleSignIn() {
    setAuthError(null);
    try {
      const flow = await window.mainApi.registryAuth.initiateLogin();
      setAuthFlow(flow);

      if (flow.verificationUrlComplete) {
        window.mainApi.shell.openExternal(flow.verificationUrlComplete);
      }

      setIsPolling(true);
      const interval = (flow.interval || 5) * 1000;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const pollResult = await window.mainApi.registryAuth.pollToken(
            flow.deviceCode,
          );
          if (pollResult.status === "authorized") {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setIsPolling(false);
            setAuthFlow(null);
            setAuthNeeded(null);
            handleCreate();
          } else if (pollResult.status === "expired") {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setIsPolling(false);
            setAuthFlow(null);
            setAuthError("Authorization expired. Please try again.");
          }
        } catch {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setIsPolling(false);
        }
      }, interval);
    } catch (err) {
      console.error("[WizardCustomizeStep] Sign-in error:", err);
      setAuthError(
        "Could not reach the registry. Check your connection and try again.",
      );
    }
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

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-gray-200">
        Customize your dashboard
      </h3>

      {/* Summary — lifted to the top of the step so the user sees what
          they're about to create before filling in the form, instead
          of being tucked at the bottom under the substep content. */}
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
            {state.customization.theme === appThemeKey && (
              <span className="text-xs text-gray-500">(default)</span>
            )}
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

      {/* Visible failure surface for the Create handler — surfaces
          install errors and registry-auth prompts to the user
          (otherwise console.error is stripped by rollup-strip and the
          click silently no-ops). Renders on every numbered step so
          the user sees the issue regardless of where they were when
          Create fired. */}
      {error && (
        <div className="rounded-lg border border-red-500 bg-red-900 p-3 flex items-start gap-2">
          <FontAwesomeIcon
            icon="circle-exclamation"
            className="text-red-400 mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-red-200">{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* --- Step 1: Name --- */}
        {state.step === 1 && (
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
          </div>
        )}

        {/* --- Step 2: Folder picker --- */}
        {state.step === 2 && (
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
          </div>
        )}

        {/* --- Step 3: Theme picker --- */}
        {state.step === 3 && (
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

        {/* --- Step 4: Review — confirm and Create --- */}
        {state.step === 4 && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <FontAwesomeIcon icon="circle-check" fixedWidth />
              Review
            </label>
            <p className="text-sm text-gray-400">
              Confirm the dashboard details above. Click{" "}
              <strong className="text-gray-200">Create Dashboard</strong> when
              you're ready — the modal footer holds the action.
            </p>
          </div>
        )}

        {/* --- Auth prompt (device-code flow for registry install) --- */}
        {authNeeded && (
          <div className="flex flex-col gap-3">
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <FontAwesomeIcon
                  icon="lock"
                  className="h-3.5 w-3.5 text-yellow-400 mt-0.5 flex-shrink-0"
                />
                <span className="text-sm text-yellow-300/90">{authNeeded}</span>
              </div>
            </div>
            {!authFlow && !isPolling && (
              <>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="px-4 py-2 rounded-lg text-sm bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
                >
                  Sign in to Registry
                </button>
                {authError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <FontAwesomeIcon
                        icon="circle-xmark"
                        className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0"
                      />
                      <span className="text-xs text-red-300/90">
                        {authError}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
            {authFlow && isPolling && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
                <p className="text-xs text-blue-300/90">
                  Enter this code in your browser:
                </p>
                <div className="text-center">
                  <span className="text-2xl font-mono font-bold tracking-widest text-white">
                    {authFlow.userCode}
                  </span>
                </div>
                <p className="text-xs text-blue-300/70 text-center">
                  Waiting for authorization — install will resume
                  automatically...
                </p>
              </div>
            )}
          </div>
        )}

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
