import React, { useState, useContext, useRef, useEffect } from "react";
import {
  Button,
  Checkbox,
  ConfirmationModal,
  EmptyState,
  FontAwesomeIcon,
  SearchInput,
  SegmentedControl,
  StatusBadge,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import {
  getWidgetRequirements,
  useMcpCatalog,
  useProviderStatus,
} from "../../AppPages/useProviderStatus";
import {
  groupProviders,
  providerDeleteMessage,
  providerRenameMessage,
} from "../../AppPages/providerSummary";
import { ListGroupLabel, ManageLayout } from "../../AppPages/ManageLayout";
import {
  applyProviderUse,
  planProviderUse,
  providerUseModel,
} from "../../AppPages/providerUsePlan";
import { ProviderUseDialog } from "../../AppPages/ProviderUseDialog";
import { ProviderDetail } from "../details/ProviderDetail";
import { McpCatalogDetail } from "../details/McpCatalogDetail";
import { CustomMcpServerForm } from "../details/CustomMcpServerForm";
import { WebSocketProviderForm } from "../details/WebSocketProviderForm";
import { NewProviderPicker } from "../details/NewProviderPicker";
import { saveMcpProvider } from "../../../utils/saveMcpProvider";
import {
  envMappingToRows,
  headerTemplateToRows,
} from "../../../utils/mcpUtils";

// Class chips; values match providerTab ("credentials" is the credential
// class). Plain labels (design audit): what each class is for, not its jargon.
const CLASS_CHIPS = [
  { value: "all", label: "All" },
  { value: "credentials", label: "API keys" },
  { value: "mcp", label: "Tools (MCP)" },
  { value: "websocket", label: "Live data" },
];
const CLS_OF_TAB = {
  credentials: "credential",
  mcp: "mcp",
  websocket: "websocket",
};
const STATUS_DOT = {
  needsSetup: "bg-amber-400",
  connected: "bg-green-400",
  ready: "bg-gray-500",
};
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * ProvidersSection — the Providers Manage page (app-navigation PRD NAV-007):
 * search, class chips and a Needs setup filter over a list grouped by class,
 * each provider with its status (Needs setup / Connected / Starts when used /
 * Saved) and how many dashboards and bots use it; the detail adds what's
 * missing and Used by. The create / edit flows (class chooser, MCP catalog,
 * custom MCP form, WebSocket form, credential form) are unchanged.
 */
export const ProvidersSection = ({
  dashApi = null,
  credentials = null,
  createRequested = false,
  onCreateAcknowledged = null,
  // Used by: dashboards (Open) and bots (Open in Bots view). Null = not
  // given (Create's Connect dialog), so Delete / Rename can't say who uses one.
  workspaces: workspacesProp = null,
  onOpenWorkspace = null,
  onOpenBotInBotsView = null,
  // Re-reads dashboards (and open tabs) after Choose where to use… saves.
  onReloadWorkspaces = null,
  // Deep links (Bots view "Open Settings › Providers", provider prompts): a
  // provider to select, or a create flow to start. AppPage remounts this
  // section for each new link, so these are read once.
  initialProviderName = null,
  initialCreateRequested = false,
  // Optional: when createRequested fires, pre-route the create flow
  // by class and pre-select the provider type. Used by the
  // cross-modal "Add new <type>" CTA from the Widget Builder.
  initialProviderType = null,
  initialProviderClass = null,
}) => {
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const refreshProviders = appContext?.refreshProviders;

  const { muted, strong, selectedBg, selectedBorder } = useConfigTokens();
  // MCP catalog: authCommand / credentialSchema lookups and status.
  const catalog = useMcpCatalog(dashApi);
  const workspaces = workspacesProp || [];
  const status = useProviderStatus({ providers, workspaces, dashApi, catalog });
  // Who uses a provider, or null while that isn't known.
  const knownUsage = (name) =>
    workspacesProp && status.botsLoaded ? status.usageOf(name) : null;
  const [needsSetupOnly, setNeedsSetupOnly] = useState(false);

  const [providerTab, setProviderTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedName, setSelectedName] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  // When the user clicks "+ New Provider" without a pre-selected
  // class (Settings header button), show the class chooser
  // (Credential / MCP / WebSocket) instead of defaulting to the
  // credential form. Widget Builder's deep-link path passes a class
  // explicitly and bypasses this chooser.
  const [isShowingClassChooser, setIsShowingClassChooser] = useState(false);
  // Tracks whether the current create-flow detail was reached via the
  // chooser (vs. the Widget Builder deep-link or list-edit). Only the
  // chooser-entry path renders the "← Back" affordance, since that's
  // the only path that has somewhere to go back to.
  const [cameFromClassChooser, setCameFromClassChooser] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formCredentials, setFormCredentials] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  // A rename of a provider something uses waits here for a confirm:
  // { from, to, message, save }.
  const [renameConfirm, setRenameConfirm] = useState(null);
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const [isEditingMcp, setIsEditingMcp] = useState(false);
  const [isAddingWs, setIsAddingWs] = useState(false);
  const [isEditingWs, setIsEditingWs] = useState(false);
  // NAV-015 "Choose where to use…": the provider whose dialog is open, and
  // the rows worked out when it opened (kept fixed while the user ticks).
  const [useTarget, setUseTarget] = useState(null);
  const [useModel, setUseModel] = useState(null);

  const openChooseWhereToUse = (name) => {
    setUseModel(
      providerUseModel({
        providerName: name,
        providers,
        workspaces,
        bots: status.bots,
        getWidgetRequirements,
        statusOf: status.statusOf,
      }),
    );
    setUseTarget(name);
  };
  const closeChooseWhereToUse = () => {
    setUseTarget(null);
    setUseModel(null);
  };
  const saveProviderUse = async (picks) => {
    const plan = planProviderUse(useModel, picks);
    const result = await applyProviderUse({
      plan,
      workspaces,
      bots: status.bots,
      dashApi,
      appId: credentials?.appId,
      botsApi: window.mainApi && window.mainApi.bots,
    });
    // Fresh dashboards for Used by, the status and any open dashboard tabs.
    if (result.dashboards && onReloadWorkspaces) onReloadWorkspaces();
    return result;
  };

  // Row ID counter for env/header rows in MCP edit mode
  const nextRowIdRef = useRef(0);
  const nextRowId = () => `prov_row_${++nextRowIdRef.current}`;

  const providerEntries = Object.entries(providers);
  const appId = credentials?.appId;

  function resetForm() {
    setFormName("");
    setFormType("");
    setFormCredentials({});
    setIsCreating(false);
    setIsEditing(false);
    setIsEditingMcp(false);
    setIsEditingWs(false);
  }

  function handleSave() {
    if (!formName.trim() || !dashApi || !appId) return;
    const credentials = {};
    Object.entries(formCredentials).forEach(([key, value]) => {
      if (key.trim()) credentials[key.trim()] = value;
    });
    dashApi.saveProvider(
      appId,
      formName.trim(),
      { providerType: formType.trim(), credentials },
      () => {
        resetForm();
        setProviderTab("credentials");
        refreshProviders && refreshProviders();
      },
      (e, err) => console.error("Save provider error:", err),
    );
  }

  function handleStartEdit(name, provider) {
    setSelectedName(name);
    setIsCreating(false);

    if (provider.providerClass === "websocket") {
      setProviderTab("websocket");
      setIsEditingWs(true);
      setIsEditing(false);
      setIsEditingMcp(false);
    } else if (provider.providerClass === "mcp") {
      setProviderTab("mcp");
      setIsEditingMcp(true);
      setIsEditing(false);
      setIsEditingWs(false);
    } else {
      setProviderTab("credentials");
      setFormName(name);
      setFormType(provider.type || "");
      setFormCredentials(provider.credentials || {});
      setIsEditing(true);
      setIsEditingMcp(false);
      setIsEditingWs(false);
    }
  }

  // Widgets and bots find a provider by name: renaming one that's in use
  // asks first (QA 2026-10-22).
  function confirmRename(from, to, save) {
    const message =
      from && to && from !== to
        ? providerRenameMessage(from, to, knownUsage(from))
        : null;
    if (message) setRenameConfirm({ from, to, message, save });
    else save();
  }

  function handleSaveEdit() {
    if (!formName.trim() || !dashApi || !appId) return;
    confirmRename(selectedName, formName.trim(), saveEdit);
  }

  function saveEdit() {
    const originalName = selectedName;
    const originalProvider = providers[originalName];
    // Delete old if name changed, then save new
    if (originalName !== formName.trim()) {
      dashApi.deleteProvider(
        appId,
        originalName,
        () => {},
        () => {},
      );
    }
    dashApi.saveProvider(
      appId,
      formName.trim(),
      {
        providerType: formType.trim(),
        credentials: formCredentials,
        providerClass: originalProvider?.providerClass || "credential",
        mcpConfig: originalProvider?.mcpConfig || null,
      },
      () => {
        setSelectedName(formName.trim());
        resetForm();
        refreshProviders && refreshProviders();
      },
      (e, err) => console.error("Save provider error:", err),
    );
  }

  function handleConfirmDelete() {
    if (!deleteTarget || !dashApi || !appId) return;

    // If it's an MCP provider, stop the server first
    const targetProvider = providers[deleteTarget];
    if (targetProvider?.providerClass === "mcp") {
      dashApi.mcpStopServer(
        deleteTarget,
        () => {},
        () => {},
      );
    }

    // If it's a WebSocket provider, disconnect first
    if (
      targetProvider?.providerClass === "websocket" &&
      dashApi?.api?.webSocket
    ) {
      dashApi.api.webSocket.disconnect(deleteTarget).catch(() => {});
    }

    dashApi.deleteProvider(
      appId,
      deleteTarget,
      () => {
        if (selectedName === deleteTarget) {
          setSelectedName(null);
          resetForm();
        }
        setDeleteTarget(null);
        refreshProviders && refreshProviders();
      },
      (e, err) => {
        console.error("Delete provider error:", err);
        setDeleteTarget(null);
      },
    );
  }

  // Handle MCP provider creation from catalog picker
  function handleMcpSave(
    providerName,
    providerType,
    mcpCredentials,
    mcpConfig,
    allowedTools = null,
  ) {
    if (!dashApi || !appId) return;
    // Shared with the draft review's Add/Install dialog: a new custom server
    // gets a unique type (the edit path preserves type, so no existing
    // provider is ever renamed), and the save is announced
    // (dash:provider-installed) so open bot forms can turn it on.
    saveMcpProvider({
      dashApi,
      appId,
      providers,
      name: providerName,
      type: providerType,
      credentials: mcpCredentials,
      mcpConfig,
      allowedTools,
    })
      .then(() => {
        setIsAddingMcp(false);
        refreshProviders && refreshProviders();
        setSelectedName(providerName);
        setProviderTab("mcp");
      })
      .catch((err) => console.error("Save MCP provider error:", err));
  }

  // Handle MCP provider editing via CustomMcpServerForm
  function handleMcpEditSave(...args) {
    if (!dashApi || !appId) return;
    confirmRename(selectedName, args[0], () => saveMcpEdit(...args));
  }

  function saveMcpEdit(
    providerName,
    providerType,
    mcpCredentials,
    mcpConfig,
    allowedTools = null,
  ) {
    const originalName = selectedName;
    const renamed = !!originalName && originalName !== providerName;

    // A rename saves the new name first, taking the provider's sign-in with
    // it (renamedFrom), then deletes the old name.
    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType,
        credentials: mcpCredentials,
        providerClass: "mcp",
        mcpConfig,
        allowedTools,
        renamedFrom: renamed ? originalName : null,
      },
      (event, result) => {
        // The save reports its own failure as a result, not an error: keep
        // the old name (and its sign-in) if nothing was written.
        if (result?.error) {
          console.error("Save MCP provider error:", result.message);
          return;
        }
        if (renamed) {
          dashApi.deleteProvider(
            appId,
            originalName,
            () => {},
            () => {},
          );
        }
        setSelectedName(providerName);
        setProviderTab("mcp");
        setIsEditingMcp(false);
        resetForm();
        refreshProviders && refreshProviders();

        // Stop the MCP server so the edit takes effect without quitting the
        // app, and start it again only if it was running: a stopped one
        // picks up the new config on its next use, and starting a sign-in
        // provider that has no sign-in yet would open one (QA 2026-10-24).
        // Errors are logged but don't block the save UX.
        const bounceName = originalName || providerName;
        const restart = () =>
          dashApi.mcpStartServer(
            providerName,
            mcpConfig,
            mcpCredentials,
            (event, result) => {
              if (result?.error) {
                console.warn(
                  `[ProvidersSection] mcpStartServer after save failed for ${providerName}:`,
                  result.message,
                );
              } else {
                console.log(
                  `[ProvidersSection] ${providerName} restarted with new config`,
                );
              }
            },
            (e, err) =>
              console.warn(
                `[ProvidersSection] mcpStartServer after save errored for ${providerName}:`,
                err?.message,
              ),
          );
        const stop = (wasRunning) =>
          dashApi.mcpStopServer(
            bounceName,
            () => wasRunning && restart(),
            (e, err) =>
              console.warn(
                `[ProvidersSection] mcpStopServer after save failed for ${bounceName}:`,
                err?.message,
              ),
          );
        dashApi.mcpGetServerStatus(
          bounceName,
          (e, status) => stop(status?.status === "connected"),
          () => stop(false),
        );
      },
      (e, err) => console.error("Save MCP provider error:", err),
    );
  }

  // Handle saving just allowedTools for an existing MCP provider
  function handleSaveAllowedTools(providerName, allowedTools) {
    if (!dashApi || !appId) return;
    const existingProvider = providers[providerName];
    if (!existingProvider) return;

    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType: existingProvider.type,
        credentials: existingProvider.credentials,
        providerClass: "mcp",
        mcpConfig: existingProvider.mcpConfig,
        allowedTools,
        isDefaultForType: !!existingProvider.isDefaultForType,
      },
      () => {
        refreshProviders && refreshProviders();
      },
      (e, err) => console.error("Save allowed tools error:", err),
    );
  }

  // Flip the app-wide "default for this type" flag on a provider.
  // Single-winner invariant is enforced in providerController.saveProvider
  // itself (siblings of the same type get their flag cleared in the same
  // save), so this handler just passes the new value through. We forward
  // the provider's full existing config so saveProvider doesn't lose any
  // other field (mcpConfig, wsConfig, allowedTools, etc.).
  function handleToggleDefaultForType(providerName, prov, newDefault) {
    if (!dashApi || !appId || !prov) return;
    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType: prov.type,
        credentials: prov.credentials,
        providerClass: prov.providerClass || "credential",
        mcpConfig: prov.mcpConfig || null,
        allowedTools: prov.allowedTools || null,
        wsConfig: prov.wsConfig || null,
        isDefaultForType: !!newDefault,
      },
      () => {
        refreshProviders && refreshProviders();
      },
      (e, err) =>
        console.error("Toggle default-for-type failed:", err?.message || err),
    );
  }

  // Handle WebSocket provider creation
  function handleWsSave(providerName, wsConfig, wsCredentials) {
    if (!dashApi || !appId) return;
    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType: "websocket",
        credentials: wsCredentials,
        providerClass: "websocket",
        wsConfig,
      },
      () => {
        setIsAddingWs(false);
        refreshProviders && refreshProviders();
        setSelectedName(providerName);
        setProviderTab("websocket");
      },
      (e, err) => console.error("Save WebSocket provider error:", err),
    );
  }

  // Handle WebSocket provider editing
  function handleWsEditSave(...args) {
    if (!dashApi || !appId) return;
    confirmRename(selectedName, args[0], () => saveWsEdit(...args));
  }

  function saveWsEdit(providerName, wsConfig, wsCredentials) {
    const originalName = selectedName;

    // Delete old if name changed
    if (originalName && originalName !== providerName) {
      dashApi.deleteProvider(
        appId,
        originalName,
        () => {},
        () => {},
      );
    }

    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType: "websocket",
        credentials: wsCredentials,
        providerClass: "websocket",
        wsConfig,
      },
      () => {
        setSelectedName(providerName);
        setProviderTab("websocket");
        setIsEditingWs(false);
        resetForm();
        refreshProviders && refreshProviders();
      },
      (e, err) => console.error("Save WebSocket provider error:", err),
    );
  }

  // Respond to external create trigger from header (or from the
  // cross-modal "Add new <type>" event dispatched by the Widget
  // Builder, with optional initialProviderType/initialProviderClass
  // for type pre-fill / catalog pre-select).
  function startCreate(providerClass, providerType) {
    resetForm();
    setSelectedName(null);
    setIsShowingClassChooser(false);
    // External create requests (deep-link or header button) do NOT
    // come via the chooser, so any leftover "came from chooser" state
    // from a prior session must be cleared before routing.
    setCameFromClassChooser(false);
    if (providerClass === "mcp") {
      // MCP class: open the catalog detail. Pre-select happens in
      // McpCatalogDetail via the initialSelectedId prop passed below.
      setIsCreating(false);
      setIsAddingMcp(true);
    } else if (providerClass === "websocket") {
      // WebSocket class: open the WebSocket add form. Reachable via
      // a future Widget Builder deep-link for ws-typed widgets.
      setIsCreating(false);
      setIsAddingMcp(false);
      setIsAddingWs(true);
    } else if (providerClass === "credential") {
      // Credential class: open the credential create form and
      // pre-fill the type field if provided.
      setIsAddingMcp(false);
      setIsCreating(true);
      if (providerType) {
        setFormType(providerType);
      }
    } else {
      // No class specified — Settings header "+ New Provider"
      // button hits this branch. Show the chooser so the user
      // picks Credential / MCP / WebSocket explicitly instead of
      // landing on the credential form by default.
      setIsAddingMcp(false);
      setIsCreating(false);
      setIsAddingWs(false);
      setIsShowingClassChooser(true);
    }
  }

  const prevCreateRequested = useRef(false);
  useEffect(() => {
    // The header's New Provider always starts at the class chooser — the
    // class / type props belong to a deep link (applied below), not to it.
    if (createRequested && !prevCreateRequested.current) {
      startCreate(null, null);
    }
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  // Deep links, once: a provider to select, or a create flow to start.
  // Providers can arrive after mount, so wait until the named one exists.
  const linkApplied = useRef(false);
  useEffect(() => {
    if (linkApplied.current) return;
    if (initialCreateRequested) {
      linkApplied.current = true;
      startCreate(initialProviderClass, initialProviderType);
    } else if (initialProviderName && providers[initialProviderName]) {
      linkApplied.current = true;
      setSelectedName(initialProviderName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCreateRequested, initialProviderName, providers]);

  const groups = groupProviders(providers, {
    cls: CLS_OF_TAB[providerTab] || "all",
    query: searchQuery,
    needsSetupOnly,
    statusOf: (name) => status.statusOf(name).key,
  });
  const visibleNames = groups.flatMap((g) => g.items.map((i) => i.name));
  const isFlowOpen =
    // A create link not applied yet: don't flash a provider first.
    (initialCreateRequested && !linkApplied.current) ||
    isCreating ||
    isShowingClassChooser ||
    isAddingMcp ||
    isAddingWs ||
    isEditingMcp ||
    isEditingWs;
  // The selected provider, else the first one shown (like the other pages).
  const shownName =
    selectedName && providers[selectedName]
      ? selectedName
      : !isFlowOpen
        ? visibleNames[0] || null
        : null;
  const selectedProvider =
    selectedName && providers[selectedName] ? providers[selectedName] : null;
  const shownProvider = shownName ? providers[shownName] : null;
  const needsSetupCount = Object.keys(providers).filter(
    (name) => status.statusOf(name).key === "needsSetup",
  ).length;

  const iconForClass = (cls) =>
    cls === "mcp" ? "server" : cls === "websocket" ? "plug" : "key";

  const selectProvider = (name) => {
    setSelectedName(name);
    setIsCreating(false);
    setIsEditing(false);
    setIsAddingMcp(false);
    setIsAddingWs(false);
    setIsEditingMcp(false);
    setIsEditingWs(false);
    setIsShowingClassChooser(false);
    setCameFromClassChooser(false);
    resetForm();
  };

  const listContent = (
    <>
      {groups.map((g) => (
        <div key={g.cls} className="flex flex-col gap-0.5">
          <ListGroupLabel text={g.label} testId="provider-group" />
          {g.items.map(({ name, provider, cls }) => {
            const active = !isFlowOpen && name === shownName;
            const st = status.statusOf(name);
            const dot = STATUS_DOT[st.key] || STATUS_DOT.ready;
            const used = status.usageOf(name).count;
            return (
              <button
                key={name}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => selectProvider(name)}
                className={`w-full text-left rounded-lg px-2 py-2 border flex flex-row items-center gap-3 ${
                  active
                    ? `${selectedBg} ${selectedBorder}`
                    : "border-transparent"
                }`}
              >
                <FontAwesomeIcon
                  icon={iconForClass(cls)}
                  className={`flex-shrink-0 ${muted}`}
                />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span
                    data-name
                    className={`text-sm font-medium truncate ${strong}`}
                  >
                    {name}
                  </span>
                  <span className={`text-xs truncate ${muted}`}>
                    {provider.type || cls}
                    {used ? ` · used by ${used}` : ""}
                  </span>
                </span>
                <span
                  className={`flex flex-row items-center gap-1.5 text-xs flex-shrink-0 ${muted}`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${dot}`}
                  />
                  {st.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {!visibleNames.length ? (
        <span className={`text-sm px-2 ${muted}`}>
          No providers match these filters.
        </span>
      ) : null}
    </>
  );

  // Closes whichever create-flow detail is open and re-opens the
  // class chooser. Only attached to the detail's onBack prop when
  // the user reached it via the chooser (cameFromClassChooser).
  const goBackToClassChooser = () => {
    resetForm();
    setIsAddingWs(false);
    setIsAddingMcp(false);
    setIsCreating(false);
    setCameFromClassChooser(false);
    setIsShowingClassChooser(true);
  };

  let detailContent = null;
  if (isAddingWs) {
    detailContent = (
      <WebSocketProviderForm
        onSave={handleWsSave}
        onCancel={() => setIsAddingWs(false)}
        onBack={cameFromClassChooser ? goBackToClassChooser : null}
      />
    );
  } else if (isEditingWs && selectedName && selectedProvider) {
    const wc = selectedProvider.wsConfig || {};
    const editHeaderRows = wc.headers
      ? Object.entries(wc.headers).map(([key, value], i) => ({
          id: `ws_edit_${i}`,
          key,
          value,
        }))
      : [];
    detailContent = (
      <WebSocketProviderForm
        key={selectedName}
        isEditMode={true}
        initialName={selectedName}
        initialUrl={wc.url || ""}
        initialHeaderRows={editHeaderRows}
        initialSubprotocols={wc.subprotocols || []}
        initialCredentials={selectedProvider.credentials || {}}
        onSave={handleWsEditSave}
        onCancel={() => setIsEditingWs(false)}
      />
    );
  } else if (isShowingClassChooser) {
    detailContent = (
      <NewProviderPicker
        onSelect={(cls) => {
          setIsShowingClassChooser(false);
          setCameFromClassChooser(true);
          if (cls === "mcp") {
            setIsAddingMcp(true);
          } else if (cls === "websocket") {
            setIsAddingWs(true);
          } else {
            setIsCreating(true);
          }
        }}
      />
    );
  } else if (isAddingMcp) {
    detailContent = (
      <McpCatalogDetail
        onSave={handleMcpSave}
        onCancel={() => setIsAddingMcp(false)}
        initialSelectedId={initialProviderType}
        onBack={cameFromClassChooser ? goBackToClassChooser : null}
      />
    );
  } else if (isCreating) {
    detailContent = (
      <ProviderDetail
        isCreating={true}
        formName={formName}
        setFormName={setFormName}
        formType={formType}
        setFormType={setFormType}
        formCredentials={formCredentials}
        setFormCredentials={setFormCredentials}
        onCreate={handleSave}
        onCancelEdit={() => {
          resetForm();
          setIsCreating(false);
        }}
        onBack={cameFromClassChooser ? goBackToClassChooser : null}
      />
    );
  } else if (isEditingMcp && selectedName && selectedProvider) {
    const mc = selectedProvider.mcpConfig || {};
    const editCatalogEntry = catalog.find(
      (entry) => entry.id === selectedProvider.type,
    );
    detailContent = (
      <CustomMcpServerForm
        key={selectedName}
        isEditMode={true}
        initialName={selectedName}
        initialProviderType={selectedProvider.type || "custom"}
        initialCredentialSchema={editCatalogEntry?.credentialSchema || {}}
        initialTransport={mc.transport || "stdio"}
        initialCommand={mc.command || ""}
        initialArgs={(mc.args || []).join(" ")}
        initialEnvMappingRows={envMappingToRows(mc.envMapping, nextRowId)}
        initialUrl={mc.url || ""}
        initialHeaderRows={headerTemplateToRows(mc.headerTemplate, nextRowId)}
        initialCredentials={selectedProvider.credentials || {}}
        initialAllowedTools={selectedProvider.allowedTools || null}
        initialAuthCommand={editCatalogEntry?.authCommand || null}
        initialMcpConfig={mc}
        onSave={handleMcpEditSave}
        onBack={() => setIsEditingMcp(false)}
      />
    );
  } else if (shownName && shownProvider) {
    // Look up authCommand from the catalog for this provider type
    const catalogEntry = catalog.find(
      (entry) => entry.id === shownProvider.type,
    );
    detailContent = (
      <ProviderDetail
        key={shownName}
        providerName={shownName}
        provider={shownProvider}
        status={status.statusOf(shownName)}
        usage={status.usageOf(shownName)}
        workspaces={workspaces}
        onOpenWorkspace={onOpenWorkspace}
        onOpenBotInBotsView={onOpenBotInBotsView}
        onChooseWhereToUse={openChooseWhereToUse}
        isEditing={isEditing}
        formName={formName}
        setFormName={setFormName}
        formType={formType}
        setFormType={setFormType}
        formCredentials={formCredentials}
        setFormCredentials={setFormCredentials}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={resetForm}
        onStartEdit={handleStartEdit}
        onDelete={(name) => setDeleteTarget(name)}
        onSaveAllowedTools={handleSaveAllowedTools}
        onToggleDefaultForType={handleToggleDefaultForType}
        catalogAuthCommand={catalogEntry?.authCommand || null}
        catalogCredentialSchema={catalogEntry?.credentialSchema || {}}
      />
    );
  } else if (!isFlowOpen) {
    detailContent = (
      <span className={`p-5 text-sm ${muted}`}>
        No providers match these filters.
      </span>
    );
  }

  // No providers at all (and no create flow open): one empty state instead
  // of search, filters and two "nothing here" lines.
  const isEmpty = !Object.keys(providers).length && !isFlowOpen;

  return (
    <ManageLayout
      testId="providers-page"
      listLabel="Providers"
      detailTestId="provider-detail"
      // The create / edit forms scroll inside themselves (with their own
      // footers), so this pane only clips.
      detailFlush
      empty={
        isEmpty ? (
          <EmptyState
            testId="providers-empty"
            icon={<FontAwesomeIcon icon="plug" className="h-6 w-6" />}
            title="No providers yet"
            description="Providers connect your widgets and bots to services like Slack or GitHub — add your first one to get started."
          >
            <Button
              title="New provider"
              size="sm"
              onClick={() => startCreate(null, null)}
            />
          </EmptyState>
        ) : null
      }
      toolbar={
        <>
          <div className="w-72">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search providers…"
            />
          </div>
          <SegmentedControl
            ariaLabel="Class"
            options={CLASS_CHIPS}
            value={providerTab}
            onChange={setProviderTab}
          />
          <Checkbox
            label="Needs setup only"
            checked={needsSetupOnly}
            onChange={setNeedsSetupOnly}
          />
          <span className="flex-1" />
          {needsSetupCount ? (
            <StatusBadge
              state="warning"
              compact
              label={`${plural(needsSetupCount, "provider")} need${
                needsSetupCount === 1 ? "s" : ""
              } setup`}
            />
          ) : null}
        </>
      }
      list={listContent}
      detail={detailContent}
    >
      {/* Mounted only while open: inside Create's Connect Modal, a confirm
          mounted closed opens beneath it. */}
      {deleteTarget ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setDeleteTarget(null)}
          title={`Delete ${deleteTarget}?`}
          message={providerDeleteMessage(
            deleteTarget,
            knownUsage(deleteTarget),
          )}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
      {renameConfirm ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setRenameConfirm(null)}
          title={`Rename ${renameConfirm.from}?`}
          message={renameConfirm.message}
          confirmLabel="Rename"
          variant="danger"
          onConfirm={() => {
            const { save } = renameConfirm;
            setRenameConfirm(null);
            save();
          }}
          onCancel={() => setRenameConfirm(null)}
        />
      ) : null}
      <ProviderUseDialog
        isOpen={!!useTarget}
        model={useModel}
        onSave={saveProviderUse}
        onClose={closeChooseWhereToUse}
      />
    </ManageLayout>
  );
};
