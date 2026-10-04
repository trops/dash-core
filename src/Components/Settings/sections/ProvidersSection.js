import React, { useState, useContext, useRef, useEffect } from "react";
import {
  Checkbox,
  ConfirmationModal,
  FontAwesomeIcon,
  SearchInput,
  SectionLabel,
  SegmentedControl,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import {
  useMcpCatalog,
  useProviderStatus,
} from "../../AppPages/useProviderStatus";
import { groupProviders } from "../../AppPages/providerSummary";
import { ProviderDetail } from "../details/ProviderDetail";
import { McpCatalogDetail } from "../details/McpCatalogDetail";
import { CustomMcpServerForm } from "../details/CustomMcpServerForm";
import { WebSocketProviderForm } from "../details/WebSocketProviderForm";
import { NewProviderPicker } from "../details/NewProviderPicker";
import { uniqueProviderType } from "../../../utils/providerType";
import {
  envMappingToRows,
  headerTemplateToRows,
} from "../../../utils/mcpUtils";

// Class chips; values match providerTab ("credentials" is the credential class).
const CLASS_CHIPS = [
  { value: "all", label: "All" },
  { value: "credentials", label: "Credentials" },
  { value: "mcp", label: "MCP" },
  { value: "websocket", label: "WebSocket" },
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
  // Used by: dashboards (Open) and bots (Open in Bots view).
  workspaces = [],
  onOpenWorkspace = null,
  onOpenBotInBotsView = null,
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

  const { muted, strong, hairline, selectedBg, selectedBorder } =
    useConfigTokens();
  // MCP catalog: authCommand / credentialSchema lookups and status.
  const catalog = useMcpCatalog(dashApi);
  const status = useProviderStatus({ providers, workspaces, dashApi, catalog });
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
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const [isEditingMcp, setIsEditingMcp] = useState(false);
  const [isAddingWs, setIsAddingWs] = useState(false);
  const [isEditingWs, setIsEditingWs] = useState(false);

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

  function handleSaveEdit() {
    if (!formName.trim() || !dashApi || !appId) return;
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
    if (targetProvider?.providerClass === "websocket" && dashApi?.webSocket) {
      dashApi.webSocket.disconnect(deleteTarget).catch(() => {});
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
    // Forward-only unique types: a hand-rolled custom MCP server arrives with
    // the generic default type "custom", which conflates multiple customs at
    // widget-binding/runtime time. Give each NEW one a unique slug so it has a
    // distinct identity like catalog providers. Catalog installs pass a real
    // id (not "custom") and are untouched; the edit path preserves type, so no
    // existing provider is ever renamed.
    let resolvedType = providerType;
    if (resolvedType === "custom") {
      const existingTypes = Object.values(providers || {}).map((p) => p.type);
      resolvedType = uniqueProviderType(providerName, existingTypes);
    }
    dashApi.saveProvider(
      appId,
      providerName,
      {
        providerType: resolvedType,
        credentials: mcpCredentials,
        providerClass: "mcp",
        mcpConfig,
        allowedTools,
      },
      () => {
        setIsAddingMcp(false);
        refreshProviders && refreshProviders();
        setSelectedName(providerName);
        setProviderTab("mcp");
      },
      (e, err) => console.error("Save MCP provider error:", err),
    );
  }

  // Handle MCP provider editing via CustomMcpServerForm
  function handleMcpEditSave(
    providerName,
    providerType,
    mcpCredentials,
    mcpConfig,
    allowedTools = null,
  ) {
    if (!dashApi || !appId) return;
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
        providerType,
        credentials: mcpCredentials,
        providerClass: "mcp",
        mcpConfig,
        allowedTools,
      },
      () => {
        setSelectedName(providerName);
        setProviderTab("mcp");
        setIsEditingMcp(false);
        resetForm();
        refreshProviders && refreshProviders();

        // Bounce the running MCP subprocess so the edit takes effect without
        // requiring the user to fully quit and relaunch the app. stopServer
        // is a no-op if nothing was running; we always start after stopping
        // so a disconnected provider still picks up the new config on next
        // tool call. Errors are logged but don't block the save UX.
        const bounceName = originalName || providerName;
        if (bounceName) {
          dashApi.mcpStopServer(
            bounceName,
            () => {},
            (e, err) =>
              console.warn(
                `[ProvidersSection] mcpStopServer after save failed for ${bounceName}:`,
                err?.message,
              ),
          );
        }
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
  function handleWsEditSave(providerName, wsConfig, wsCredentials) {
    if (!dashApi || !appId) return;
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
    <div
      role="list"
      aria-label="Providers"
      className="min-h-0 overflow-y-auto flex flex-col gap-3 pr-2"
    >
      {groups.map((g) => (
        <div key={g.cls} className="flex flex-col gap-1">
          <span data-testid="provider-group" className="px-3">
            <SectionLabel text={g.label} />
          </span>
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
                className={`w-full text-left rounded-lg px-3 py-2 border flex flex-row items-center gap-3 ${
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
        <span className={`text-sm px-3 ${muted}`}>
          {Object.keys(providers).length
            ? "No providers match these filters."
            : "No providers yet."}
        </span>
      ) : null}
    </div>
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
        {Object.keys(providers).length
          ? "No providers match these filters."
          : "No providers yet. Add one with New Provider."}
      </span>
    );
  }

  return (
    // The page's base text colour (plain names inherit it); muted text
    // keeps its own token.
    <div
      data-testid="providers-page"
      className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
    >
      {/* Filter bar — fixed; the list and detail scroll on their own. */}
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
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
          <span className="flex flex-row items-center gap-1.5 text-xs text-amber-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {plural(needsSetupCount, "provider")} need
            {needsSetupCount === 1 ? "s" : ""} setup
          </span>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        {listContent}
        {/* The create / edit forms scroll inside themselves (with their own
            footers), so this pane only clips. */}
        <div
          data-testid="provider-detail"
          className={`col-span-2 min-h-0 flex flex-col overflow-hidden rounded-lg border ${hairline}`}
        >
          {detailContent}
        </div>
      </div>
      <ConfirmationModal
        isOpen={!!deleteTarget}
        setIsOpen={() => setDeleteTarget(null)}
        title="Delete Provider"
        message={`Are you sure you want to delete "${deleteTarget}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
