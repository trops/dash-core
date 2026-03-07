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
import {
  envMappingToRows,
  headerTemplateToRows,
} from "../../../utils/mcpUtils";

export const ProvidersSection = ({
  dashApi = null,
  credentials = null,
  createRequested = false,
  onCreateAcknowledged = null,
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
  const [isEditing, setIsEditing] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formCredentials, setFormCredentials] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const [isEditingMcp, setIsEditingMcp] = useState(false);

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

  function resetForm() {
    setFormName("");
    setFormType("");
    setFormCredentials({});
    setIsCreating(false);
    setIsEditing(false);
    setIsEditingMcp(false);
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
    setProviderTab(provider.providerClass === "mcp" ? "mcp" : "credentials");

    if (provider.providerClass === "mcp") {
      setIsEditingMcp(true);
      setIsEditing(false);
    } else {
      setFormName(name);
      setFormType(provider.type || "");
      setFormCredentials(provider.credentials || {});
      setIsEditing(true);
      setIsEditingMcp(false);
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
      },
      () => {
        refreshProviders && refreshProviders();
      },
      (e, err) => console.error("Save allowed tools error:", err),
    );
  }

  // Respond to external create trigger from header
  const prevCreateRequested = useRef(false);
  useEffect(() => {
    if (createRequested && !prevCreateRequested.current) {
      resetForm();
      setSelectedName(null);
      setIsAddingMcp(false);
      setIsCreating(true);
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
    providerTab === "credentials" ? credentialProviders : mcpProviders;
  const activeIcon = providerTab === "credentials" ? "key" : "server";

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
              API Credentials
            </Tabs3.Trigger>
            <Tabs3.Trigger value="mcp" className="flex-1">
              MCP Servers
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
              : "No MCP servers configured"}
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
      </Sidebar.Content>
    </>
  );

  let detailContent = null;
  if (isAddingMcp) {
    detailContent = (
      <McpCatalogDetail
        onSave={handleMcpSave}
        onCancel={() => setIsAddingMcp(false)}
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
