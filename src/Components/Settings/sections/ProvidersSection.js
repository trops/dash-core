import React, { useState, useContext, useRef, useEffect } from "react";
import {
  ConfirmationModal,
  FontAwesomeIcon,
  Sidebar,
  Tag3,
  Tabs3,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { SectionLayout } from "../SectionLayout";
import { ProviderDetail } from "../details/ProviderDetail";
import { McpCatalogDetail } from "../details/McpCatalogDetail";
import { CustomMcpServerForm } from "../details/CustomMcpServerForm";
import { WebSocketProviderForm } from "../details/WebSocketProviderForm";
import { NewProviderPicker } from "../details/NewProviderPicker";
import {
  envMappingToRows,
  headerTemplateToRows,
} from "../../../utils/mcpUtils";

export const ProvidersSection = ({
  dashApi = null,
  credentials = null,
  createRequested = false,
  onCreateAcknowledged = null,
  // Optional: when createRequested fires, pre-route the create flow
  // by class and pre-select the provider type. Used by the
  // cross-modal "Add new <type>" CTA from the Widget Builder.
  initialProviderType = null,
  initialProviderClass = null,
}) => {
  const appContext = useContext(AppContext);
  const providers = appContext?.providers || {};
  const refreshProviders = appContext?.refreshProviders;

  // Load MCP catalog for authCommand lookups
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    if (!dashApi) return;
    dashApi.mcpGetCatalog(
      (event, result) => {
        if (result?.catalog) setCatalog(result.catalog);
      },
      () => {},
    );
  }, [dashApi]);

  const [providerTab, setProviderTab] = useState("credentials");
  const [selectedName, setSelectedName] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  // When the user clicks "+ New Provider" without a pre-selected
  // class (Settings header button), show the class chooser
  // (Credential / MCP / WebSocket) instead of defaulting to the
  // credential form. Widget Builder's deep-link path passes a class
  // explicitly and bypasses this chooser.
  const [isShowingClassChooser, setIsShowingClassChooser] = useState(false);
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

  // Separate credential and MCP providers for display
  const credentialProviders = providerEntries.filter(
    ([, p]) => (p.providerClass || "credential") === "credential",
  );
  const mcpProviders = providerEntries.filter(
    ([, p]) => p.providerClass === "mcp",
  );
  const wsProviders = providerEntries.filter(
    ([, p]) => p.providerClass === "websocket",
  );

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
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      resetForm();
      setSelectedName(null);
      setIsShowingClassChooser(false);
      if (initialProviderClass === "mcp") {
        // MCP class: open the catalog detail. Pre-select happens in
        // McpCatalogDetail via the initialSelectedId prop passed below.
        setIsCreating(false);
        setIsAddingMcp(true);
      } else if (initialProviderClass === "websocket") {
        // WebSocket class: open the WebSocket add form. Reachable via
        // a future Widget Builder deep-link for ws-typed widgets.
        setIsCreating(false);
        setIsAddingMcp(false);
        setIsAddingWs(true);
      } else if (initialProviderClass === "credential") {
        // Credential class: open the credential create form and
        // pre-fill the type field if provided.
        setIsAddingMcp(false);
        setIsCreating(true);
        if (initialProviderType) {
          setFormType(initialProviderType);
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
    prevCreateRequested.current = createRequested;
    if (createRequested && onCreateAcknowledged) {
      onCreateAcknowledged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequested]);

  const selectedProvider =
    selectedName && providers[selectedName] ? providers[selectedName] : null;

  const activeProviders =
    providerTab === "credentials"
      ? credentialProviders
      : providerTab === "mcp"
        ? mcpProviders
        : wsProviders;
  const activeIcon =
    providerTab === "credentials"
      ? "key"
      : providerTab === "mcp"
        ? "server"
        : "plug";

  const listContent = (
    <>
      <div className="px-2 pt-2">
        <Tabs3
          value={providerTab}
          onValueChange={setProviderTab}
          backgroundColor="bg-transparent"
          spacing="p-0"
        >
          <Tabs3.List className="w-full flex" spacing="p-0.5">
            <Tabs3.Trigger value="credentials" className="flex-1">
              Credentials
            </Tabs3.Trigger>
            <Tabs3.Trigger value="mcp" className="flex-1">
              MCP
            </Tabs3.Trigger>
            <Tabs3.Trigger value="websocket" className="flex-1">
              WebSocket
            </Tabs3.Trigger>
          </Tabs3.List>
        </Tabs3>
      </div>
      <Sidebar.Content>
        {activeProviders.map(([name, provider]) => {
          const isSelected = selectedName === name && !isCreating;
          return (
            <Sidebar.Item
              key={name}
              icon={
                <FontAwesomeIcon icon={activeIcon} className="h-3.5 w-3.5" />
              }
              active={isSelected}
              onClick={() => {
                setSelectedName(name);
                setIsCreating(false);
                setIsEditing(false);
                setIsAddingMcp(false);
                resetForm();
              }}
              badge={provider.type ? <Tag3 text={provider.type} /> : null}
              className={isSelected ? "bg-white/10 opacity-100" : ""}
            >
              {name}
            </Sidebar.Item>
          );
        })}

        {activeProviders.length === 0 && (
          <span className="text-sm opacity-40 py-8 text-center">
            {providerTab === "credentials"
              ? "No API credentials configured"
              : providerTab === "mcp"
                ? "No MCP servers configured"
                : "No WebSocket providers configured"}
          </span>
        )}

        {providerTab === "mcp" && (
          <div className="px-3 py-3 mt-2 border-t border-white/10">
            <button
              onClick={() => {
                setIsAddingMcp(true);
                setSelectedName(null);
                setIsCreating(false);
                setIsEditing(false);
              }}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors w-full"
            >
              <FontAwesomeIcon icon="plus" className="h-3 w-3" />
              Add MCP Server
            </button>
          </div>
        )}

        {providerTab === "websocket" && (
          <div className="px-3 py-3 mt-2 border-t border-white/10">
            <button
              onClick={() => {
                setIsAddingWs(true);
                setSelectedName(null);
                setIsCreating(false);
                setIsEditing(false);
                setIsAddingMcp(false);
              }}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors w-full"
            >
              <FontAwesomeIcon icon="plus" className="h-3 w-3" />
              Add WebSocket Provider
            </button>
          </div>
        )}
      </Sidebar.Content>
    </>
  );

  let detailContent = null;
  if (isAddingWs) {
    detailContent = (
      <WebSocketProviderForm
        onSave={handleWsSave}
        onCancel={() => setIsAddingWs(false)}
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
  } else if (selectedName && selectedProvider) {
    // Look up authCommand from the catalog for this provider type
    const catalogEntry = catalog.find(
      (entry) => entry.id === selectedProvider.type,
    );
    detailContent = (
      <ProviderDetail
        providerName={selectedName}
        provider={selectedProvider}
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
  }

  return (
    <>
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a provider to view details"
      />
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
    </>
  );
};
