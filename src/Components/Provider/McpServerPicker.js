import React, { useState, useEffect, useContext, useMemo, useRef } from "react";
import {
  FontAwesomeIcon,
  Modal,
  Panel,
  Button,
  InputText,
  FormLabel,
  Tag,
  Stepper,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import {
  deriveFormFields,
  buildMcpConfigFromOverrides,
  envMappingToRows,
  headerTemplateToRows,
} from "../../utils/mcpUtils";
import { AdvancedMcpConfig } from "./AdvancedMcpConfig";
import { ToolSelector } from "../Settings/details/ToolSelector";

/**
 * McpServerPicker
 *
 * Catalog browser for selecting and configuring MCP servers.
 * Shows a searchable grid of available MCP servers from the seed catalog,
 * then allows the user to configure credentials and save as a provider.
 *
 * Uses a multi-step stepper (Configure → Authorize → Test & Tools) matching
 * the Settings > Providers experience in McpCatalogDetail.
 *
 * @param {boolean} isOpen - Whether the picker modal is open
 * @param {Function} setIsOpen - Callback to close the modal
 * @param {Function} onSave - Callback when MCP provider is saved: (providerName, providerType, credentials, mcpConfig, allowedTools) => void
 * @param {string} [autoSelectId] - Optional catalog server ID to auto-select (skips catalog browser)
 */
export const McpServerPicker = ({
  isOpen,
  setIsOpen,
  onSave,
  autoSelectId,
}) => {
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;

  const [catalog, setCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServer, setSelectedServer] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  // Stepper state
  const [wizardStep, setWizardStep] = useState(0);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authResult, setAuthResult] = useState(null);
  const [selectedTools, setSelectedTools] = useState(null);

  // Configuration form state
  const [providerName, setProviderName] = useState("");
  const [credentialData, setCredentialData] = useState({});
  const [formErrors, setFormErrors] = useState({});

  // Advanced config row state
  const [envMappingRows, setEnvMappingRows] = useState([]);
  const [headerRows, setHeaderRows] = useState([]);
  const rowIdRef = useRef(0);
  const nextRowId = () => `pick_${++rowIdRef.current}`;

  // Compute effective mcpConfig from catalog base + advanced overrides
  const effectiveMcpConfig = useMemo(() => {
    if (!selectedServer?.mcpConfig) return {};
    return buildMcpConfigFromOverrides(
      selectedServer.mcpConfig,
      envMappingRows,
      headerRows,
    );
  }, [selectedServer, envMappingRows, headerRows]);

  // Derive form fields from effectiveMcpConfig + credentialSchema
  const formFields = useMemo(() => {
    if (!selectedServer) return [];
    return deriveFormFields(
      effectiveMcpConfig,
      selectedServer.credentialSchema || {},
    );
  }, [selectedServer, effectiveMcpConfig]);

  // Dynamic wizard steps based on whether auth is needed
  const hasAuth = !!selectedServer?.authCommand;
  const wizardSteps = hasAuth
    ? ["configure", "authorize", "testTools"]
    : ["configure", "testTools"];
  const totalSteps = wizardSteps.length;
  const currentStepType = wizardSteps[wizardStep];

  // Load catalog on open
  useEffect(() => {
    if (isOpen && dashApi && catalog.length === 0) {
      setIsLoadingCatalog(true);
      dashApi.mcpGetCatalog(
        (event, result) => {
          const loadedCatalog = result.catalog || [];
          setCatalog(loadedCatalog);
          setIsLoadingCatalog(false);

          // Auto-select if autoSelectId is provided
          if (autoSelectId) {
            const match = loadedCatalog.find((s) => s.id === autoSelectId);
            if (match) handleSelectServer(match);
          }
        },
        (event, err) => {
          console.error("[McpServerPicker] Error loading catalog:", err);
          setIsLoadingCatalog(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dashApi]);

  // Auto-select from already-loaded catalog when autoSelectId changes
  useEffect(() => {
    if (isOpen && autoSelectId && catalog.length > 0 && !isConfiguring) {
      const match = catalog.find((s) => s.id === autoSelectId);
      if (match) handleSelectServer(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoSelectId]);

  // Filter catalog by search
  const filteredCatalog = catalog.filter((server) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      server.name.toLowerCase().includes(q) ||
      server.description.toLowerCase().includes(q) ||
      (server.tags || []).some((tag) => tag.toLowerCase().includes(q))
    );
  });

  // Wizard step navigation with validation gates
  const handleWizardStepChange = (newStep) => {
    if (newStep < wizardStep) {
      setWizardStep(newStep);
      return;
    }
    if (currentStepType === "configure" && newStep > wizardStep) {
      if (!validateForm()) return;
    }
    if (currentStepType === "authorize" && newStep > wizardStep) {
      if (!authResult?.success) return;
    }
    setWizardStep(newStep);
  };

  // Handle server selection -> show configuration form
  const handleSelectServer = (server) => {
    setSelectedServer(server);
    setIsConfiguring(true);
    setTestResult(null);
    setAuthResult(null);
    setProviderName(server.name);
    setCredentialData({});
    setFormErrors({});
    setWizardStep(0);
    setSelectedTools(null);
    setEnvMappingRows(
      envMappingToRows(server.mcpConfig?.envMapping, nextRowId),
    );
    setHeaderRows(
      headerTemplateToRows(server.mcpConfig?.headerTemplate, nextRowId),
    );
  };

  // Handle credential field changes
  const handleCredentialChange = (fieldName, value) => {
    setCredentialData((prev) => ({ ...prev, [fieldName]: value }));
    if (formErrors[fieldName] && value?.trim()) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  // Validate the configuration form using derived fields
  const validateForm = () => {
    const errors = {};
    if (!providerName?.trim()) {
      errors.providerName = "Provider name is required";
    }
    formFields.forEach((field) => {
      if (field.required && !credentialData[field.key]?.trim()) {
        errors[field.key] = `${field.displayName} is required`;
      }
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle "Test Connection" - start server, list tools, then stop
  const handleTestConnection = () => {
    if (!dashApi || !selectedServer) return;

    setIsTesting(true);
    setTestResult(null);

    const testName = `__test__${selectedServer.id}`;

    dashApi.mcpStartServer(
      testName,
      effectiveMcpConfig,
      credentialData,
      (event, result) => {
        if (result.error) {
          setTestResult({
            success: false,
            message: result.message,
          });
          setIsTesting(false);
          return;
        }

        setTestResult({
          success: true,
          tools: result.tools || [],
          resources: result.resources || [],
          message: `Connected! Found ${(result.tools || []).length} tools.`,
        });

        // Pre-select all tools
        setSelectedTools((result.tools || []).map((t) => t.name));

        // Stop the test server
        dashApi.mcpStopServer(
          testName,
          () => {},
          () => {},
        );
        setIsTesting(false);
      },
      (event, err) => {
        setTestResult({
          success: false,
          message: err?.message || "Connection failed",
        });
        setIsTesting(false);
      },
    );
  };

  // Handle authorize (OAuth browser flow)
  const handleAuthorize = () => {
    if (!dashApi || !selectedServer?.authCommand) return;

    setIsAuthorizing(true);
    setAuthResult(null);

    dashApi.mcpRunAuth(
      effectiveMcpConfig,
      credentialData,
      selectedServer.authCommand,
      (event, result) => {
        if (result.error) {
          setAuthResult({ success: false, message: result.message });
        } else {
          setAuthResult({ success: true, message: "Authorized!" });
        }
        setIsAuthorizing(false);
      },
      (event, err) => {
        setAuthResult({
          success: false,
          message: err?.message || "Authorization failed",
        });
        setIsAuthorizing(false);
      },
    );
  };

  // Handle save - create the MCP provider
  const handleSaveProvider = () => {
    if (!selectedServer || !validateForm()) return;
    onSave(
      providerName.trim(),
      selectedServer.id,
      credentialData,
      effectiveMcpConfig,
      selectedTools,
    );
    handleClose();
  };

  const handleClose = () => {
    setSelectedServer(null);
    setIsConfiguring(false);
    setTestResult(null);
    setAuthResult(null);
    setSelectedTools(null);
    setSearchQuery("");
    setProviderName("");
    setCredentialData({});
    setFormErrors({});
    setEnvMappingRows([]);
    setHeaderRows([]);
    setWizardStep(0);
    setIsOpen(false);
  };

  const handleBack = () => {
    setSelectedServer(null);
    setIsConfiguring(false);
    setTestResult(null);
    setAuthResult(null);
    setSelectedTools(null);
    setProviderName("");
    setCredentialData({});
    setFormErrors({});
    setEnvMappingRows([]);
    setHeaderRows([]);
    setWizardStep(0);
  };

  // Prune credential data when form fields change (advanced config removed a field)
  useEffect(() => {
    const validKeys = new Set(formFields.map((f) => f.key));
    setCredentialData((prev) => {
      const pruned = {};
      for (const key of Object.keys(prev)) {
        if (validKeys.has(key)) {
          pruned[key] = prev[key];
        }
      }
      return pruned;
    });
  }, [formFields]);

  // Icon mapping for catalog entries
  const getIconForServer = (server) => {
    const iconMap = {
      github: "code-branch",
      slack: "comments",
      notion: "book",
      "brave-search": "search",
      filesystem: "folder",
      postgres: "database",
      linear: "clipboard-list",
      memory: "brain",
      "google-drive": "hard-drive",
      gmail: "envelope",
      "google-calendar": "calendar-days",
      algolia: "magnifying-glass-plus",
    };
    return iconMap[server.id] || server.icon || "server";
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={handleClose}
      width="w-11/12 xl:w-5/6"
      height="h-5/6"
    >
      <Panel
        border={true}
        padding={false}
        backgroundColor="bg-gray-800"
        borderColor="border-gray-700"
      >
        {/* Header */}
        <Panel.Header border={true} borderColor="border-gray-700">
          <div className="flex flex-row justify-between items-start w-full">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                {isConfiguring && (
                  <button
                    onClick={handleBack}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <FontAwesomeIcon icon="arrow-left" className="text-lg" />
                  </button>
                )}
                <div>
                  <h2 className="text-2xl font-bold text-gray-100">
                    {isConfiguring && selectedServer
                      ? `Configure ${selectedServer.name}`
                      : "Add MCP Server"}
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {isConfiguring
                      ? selectedServer?.description ||
                        "Configure the MCP server connection"
                      : "Browse available MCP servers from the catalog"}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="ml-4 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <FontAwesomeIcon icon="times" className="text-xl" />
            </button>
          </div>
        </Panel.Header>

        {/* Body */}
        <Panel.Body>
          <div className="h-full overflow-y-auto">
            {!isConfiguring ? (
              // Catalog Browser
              <div className="p-6 space-y-4">
                {/* Search */}
                <InputText
                  value={searchQuery}
                  onChange={(value) => setSearchQuery(value)}
                  placeholder="Search MCP servers..."
                />

                {/* Server Grid */}
                {isLoadingCatalog ? (
                  <div className="text-center py-12 opacity-50">
                    Loading catalog...
                  </div>
                ) : filteredCatalog.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredCatalog.map((server) => (
                      <button
                        key={server.id}
                        onClick={() => handleSelectServer(server)}
                        className="text-left p-4 border border-gray-700 rounded-lg hover:border-blue-500 hover:bg-blue-900/20 transition-all"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <FontAwesomeIcon
                            icon={getIconForServer(server)}
                            className="text-xl text-blue-400"
                          />
                          <span className="font-semibold text-lg">
                            {server.name}
                          </span>
                        </div>
                        <p className="text-sm opacity-70 mb-3">
                          {server.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {(server.tags || []).map((tag) => (
                            <Tag key={tag} text={tag} />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 opacity-50">
                    {searchQuery
                      ? "No servers match your search"
                      : "No MCP servers available in catalog"}
                  </div>
                )}
              </div>
            ) : (
              // MCP Server Configuration — Stepper
              <div className="flex flex-col h-full">
                <div className="flex-1 min-h-0 flex flex-col">
                  <Stepper
                    activeStep={wizardStep}
                    onStepChange={handleWizardStepChange}
                    showNavigation={false}
                    className="flex-1 min-h-0 flex flex-col px-6 pt-4"
                  >
                    {/* ── Step 1: Configure ── */}
                    <Stepper.Step
                      label="Configure"
                      description="Name & credentials"
                    >
                      <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
                        {/* Server Connection Info */}
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                          <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                            MCP Server Connection
                          </p>
                          <div className="space-y-2 text-sm">
                            <div className="flex gap-2">
                              <span className="opacity-50 w-24 shrink-0">
                                Transport:
                              </span>
                              <Tag
                                text={
                                  effectiveMcpConfig.transport ===
                                  "streamable_http"
                                    ? "Streamable HTTP"
                                    : "stdio"
                                }
                              />
                            </div>
                            {effectiveMcpConfig.transport ===
                            "streamable_http" ? (
                              <div className="flex gap-2">
                                <span className="opacity-50 w-24 shrink-0">
                                  Endpoint:
                                </span>
                                <span className="text-xs opacity-70">
                                  Remote hosted server (URL provided below)
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex gap-2">
                                  <span className="opacity-50 w-24 shrink-0">
                                    Command:
                                  </span>
                                  <code className="text-xs bg-white/5 px-2 py-0.5 rounded">
                                    {effectiveMcpConfig.command}{" "}
                                    {(effectiveMcpConfig.args || []).join(" ")}
                                  </code>
                                </div>
                                {effectiveMcpConfig.envMapping &&
                                  Object.keys(effectiveMcpConfig.envMapping)
                                    .length > 0 && (
                                    <div className="flex gap-2">
                                      <span className="opacity-50 w-24 shrink-0">
                                        Env Vars:
                                      </span>
                                      <span className="text-xs opacity-70">
                                        {Object.keys(
                                          effectiveMcpConfig.envMapping,
                                        ).join(", ")}
                                      </span>
                                    </div>
                                  )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Advanced Configuration */}
                        <AdvancedMcpConfig
                          transport={effectiveMcpConfig.transport || "stdio"}
                          envMappingRows={envMappingRows}
                          onEnvMappingRowsChange={setEnvMappingRows}
                          headerRows={headerRows}
                          onHeaderRowsChange={setHeaderRows}
                        />

                        {/* Provider Name */}
                        <div className="flex flex-col gap-2">
                          <FormLabel label="Provider Name" required={true} />
                          <p className="text-sm opacity-50">
                            A name to identify this MCP server instance (e.g.,
                            &quot;Algolia Production&quot;)
                          </p>
                          <InputText
                            value={providerName}
                            onChange={(value) => {
                              setProviderName(value);
                              if (formErrors.providerName && value?.trim()) {
                                setFormErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.providerName;
                                  return next;
                                });
                              }
                            }}
                            placeholder="Enter provider name"
                          />
                          {formErrors.providerName && (
                            <p className="text-sm text-red-400">
                              {formErrors.providerName}
                            </p>
                          )}
                        </div>

                        {/* Derived Configuration Fields */}
                        {formFields.length > 0 && (
                          <>
                            <div className="border-t border-white/10 pt-4">
                              <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                                {effectiveMcpConfig.transport ===
                                "streamable_http"
                                  ? "Server Configuration"
                                  : "Authentication"}
                              </p>
                            </div>

                            {formFields.map((field) => (
                              <div
                                key={field.key}
                                className="flex flex-col gap-2"
                              >
                                <FormLabel
                                  label={field.displayName}
                                  required={field.required}
                                />
                                {field.instructions && (
                                  <p className="text-sm opacity-50">
                                    {field.instructions}
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <InputText
                                      type={field.secret ? "password" : "text"}
                                      value={credentialData[field.key] || ""}
                                      onChange={(value) =>
                                        handleCredentialChange(field.key, value)
                                      }
                                      placeholder={
                                        field.type === "file"
                                          ? "Select a file..."
                                          : `Enter ${field.displayName.toLowerCase()}`
                                      }
                                    />
                                  </div>
                                  {field.type === "file" && (
                                    <button
                                      onClick={async () => {
                                        const filepath =
                                          await window.mainApi.dialog.chooseFile(
                                            true,
                                            ["json"],
                                          );
                                        if (filepath)
                                          handleCredentialChange(
                                            field.key,
                                            filepath,
                                          );
                                      }}
                                      className="px-3 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20 transition-colors"
                                    >
                                      Browse
                                    </button>
                                  )}
                                </div>
                                {formErrors[field.key] && (
                                  <p className="text-sm text-red-400">
                                    {formErrors[field.key]}
                                  </p>
                                )}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </Stepper.Step>

                    {/* ── Conditional: Authorize ── */}
                    {hasAuth && (
                      <Stepper.Step
                        label="Authorize"
                        description="OAuth authentication"
                      >
                        <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
                          <div className="flex flex-col items-center justify-center py-8 space-y-4">
                            <p className="text-sm opacity-60 text-center max-w-md">
                              This server requires OAuth authorization. Click
                              the button below to open a browser window and
                              complete the authentication flow.
                            </p>
                            <Button
                              title={
                                isAuthorizing ? "Authorizing..." : "Authorize"
                              }
                              onClick={handleAuthorize}
                              size="md"
                            />
                          </div>
                          {authResult && (
                            <div
                              className={`p-3 rounded-lg text-sm ${
                                authResult.success
                                  ? "bg-green-900/30 border border-green-700 text-green-300"
                                  : "bg-red-900/30 border border-red-700 text-red-300"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <FontAwesomeIcon
                                  icon={
                                    authResult.success
                                      ? "circle-check"
                                      : "circle-exclamation"
                                  }
                                />
                                <span>{authResult.message}</span>
                              </div>
                            </div>
                          )}
                          {authResult && !authResult.success && (
                            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
                              <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                                Troubleshooting
                              </p>
                              <ul className="text-sm opacity-60 space-y-1 list-disc list-inside">
                                <li>
                                  Ensure Node.js and npx are available in your
                                  PATH
                                </li>
                                <li>
                                  Try running the auth command manually in your
                                  terminal
                                </li>
                                <li>
                                  Check that your OAuth credentials file is
                                  valid
                                </li>
                                <li>
                                  If using nvm, ensure the correct Node version
                                  is active
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>
                      </Stepper.Step>
                    )}

                    {/* ── Test & Tools ── */}
                    <Stepper.Step
                      label="Test & Tools"
                      description="Verify & select tools"
                    >
                      <div className="flex-1 min-h-0 flex flex-col pb-4 space-y-4">
                        <div className="flex items-center gap-3">
                          <Button
                            title={isTesting ? "Fetching..." : "Fetch Tools"}
                            onClick={handleTestConnection}
                            size="sm"
                          />
                          {testResult && (
                            <span
                              className={`text-sm ${testResult.success ? "text-green-400" : "text-red-400"}`}
                            >
                              <FontAwesomeIcon
                                icon={
                                  testResult.success
                                    ? "circle-check"
                                    : "circle-exclamation"
                                }
                                className="mr-1"
                              />
                              {testResult.message}
                            </span>
                          )}
                        </div>
                        {testResult?.success &&
                          testResult.tools?.length > 0 &&
                          selectedTools && (
                            <ToolSelector
                              tools={testResult.tools}
                              selectedTools={selectedTools}
                              onSelectionChange={setSelectedTools}
                            />
                          )}
                        {!testResult && (
                          <div className="text-center py-8 opacity-50">
                            Click &quot;Fetch Tools&quot; to test the connection
                            and discover available tools.
                          </div>
                        )}
                      </div>
                    </Stepper.Step>
                  </Stepper>
                </div>

                {/* Custom Footer */}
                <div className="flex-shrink-0 flex flex-row items-center px-6 py-4 border-t border-white/10">
                  <div className="flex flex-row gap-2">
                    {wizardStep === 0 && (
                      <Button title="Cancel" onClick={handleBack} size="sm" />
                    )}
                    {wizardStep > 0 && (
                      <Button
                        title="Back"
                        onClick={() => setWizardStep(wizardStep - 1)}
                        size="sm"
                      />
                    )}
                  </div>
                  <div className="flex-1 text-center">
                    <span className="text-xs opacity-40">
                      Step {wizardStep + 1} of {totalSteps}
                    </span>
                  </div>
                  <div className="flex flex-row gap-2">
                    {currentStepType === "configure" && (
                      <Button
                        title="Next"
                        onClick={() => handleWizardStepChange(wizardStep + 1)}
                        size="sm"
                      />
                    )}
                    {currentStepType === "authorize" && (
                      <Button
                        title="Next"
                        onClick={() => handleWizardStepChange(wizardStep + 1)}
                        disabled={!authResult?.success}
                        size="sm"
                      />
                    )}
                    {currentStepType === "testTools" && (
                      <Button
                        title="Save MCP Server"
                        onClick={handleSaveProvider}
                        size="sm"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel.Body>
      </Panel>
    </Modal>
  );
};
