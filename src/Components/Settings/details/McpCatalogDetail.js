import React, { useState, useEffect, useContext, useMemo, useRef } from "react";
import {
  FontAwesomeIcon,
  Button,
  Card2,
  Icon2,
  InputText,
  FormLabel,
  Tag,
  SubHeading3,
  Stepper,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import {
  deriveFormFields,
  buildMcpConfigFromOverrides,
  envMappingToRows,
  headerTemplateToRows,
} from "../../../utils/mcpUtils";
import { CustomMcpServerForm } from "./CustomMcpServerForm";
import { ToolSelector } from "./ToolSelector";
import { AdvancedMcpConfig } from "../../Provider/AdvancedMcpConfig";

/**
 * Icon mapping for catalog entries.
 */
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

/**
 * McpCatalogDetail
 *
 * Inline catalog browser + configuration form rendered in the detail column.
 * Replaces the previous full-window McpServerPicker modal.
 *
 * Stage 1: Searchable grid of available MCP servers from the catalog.
 * Stage 2: Configuration form for the selected server (name, credentials, test, save).
 *
 * @param {Function} onSave - (providerName, providerType, credentials, mcpConfig) => void
 * @param {Function} onCancel - Called when the user cancels (returns to empty state)
 */
export const McpCatalogDetail = ({ onSave, onCancel }) => {
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;

  const [catalog, setCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServer, setSelectedServer] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isCustom, setIsCustom] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authResult, setAuthResult] = useState(null);
  const [selectedTools, setSelectedTools] = useState(null);
  const [wizardStep, setWizardStep] = useState(0);

  // Configuration form state
  const [providerName, setProviderName] = useState("");
  const [credentialData, setCredentialData] = useState({});
  const [formErrors, setFormErrors] = useState({});

  // Advanced config row state
  const [envMappingRows, setEnvMappingRows] = useState([]);
  const [headerRows, setHeaderRows] = useState([]);
  const rowIdRef = useRef(0);
  const nextRowId = () => `cat_${++rowIdRef.current}`;

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

  // Load catalog on mount
  useEffect(() => {
    if (dashApi && catalog.length === 0) {
      setIsLoadingCatalog(true);
      dashApi.mcpGetCatalog(
        (event, result) => {
          setCatalog(result.catalog || []);
          setIsLoadingCatalog(false);
        },
        (event, err) => {
          console.error("[McpCatalogDetail] Error loading catalog:", err);
          setIsLoadingCatalog(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashApi]);

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
    // Allow backward navigation freely
    if (newStep < wizardStep) {
      setWizardStep(newStep);
      return;
    }
    // Step 0→1: validate the configure form
    if (wizardStep === 0 && newStep >= 1) {
      if (!validateForm()) return;
    }
    // Step 1→2: require successful test
    if (wizardStep === 1 && newStep >= 2) {
      if (!testResult?.success) return;
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

  // Validate the configuration form
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

  // Handle "Test Connection"
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

  // Handle save
  const handleSaveProvider = () => {
    if (!selectedServer || !validateForm()) return;
    onSave(
      providerName.trim(),
      selectedServer.id,
      credentialData,
      effectiveMcpConfig,
      selectedTools,
    );
  };

  // Select custom server option
  const handleSelectCustom = () => {
    setSelectedServer(null);
    setIsConfiguring(false);
    setIsCustom(true);
    setTestResult(null);
    setProviderName("");
    setCredentialData({});
    setFormErrors({});
  };

  // Back to catalog from config form
  const handleBack = () => {
    setSelectedServer(null);
    setIsConfiguring(false);
    setIsCustom(false);
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

  // ── Custom Server Form ──
  if (isCustom) {
    return <CustomMcpServerForm onSave={onSave} onBack={handleBack} />;
  }

  // ── Stage 2: Configuration Form (3-step Stepper) ──
  if (isConfiguring && selectedServer) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-2">
          <button
            onClick={handleBack}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <FontAwesomeIcon icon="arrow-left" className="text-lg" />
          </button>
          <div>
            <SubHeading3
              title={`Configure ${selectedServer.name}`}
              padding={false}
            />
            <p className="text-sm opacity-50 mt-1">
              {selectedServer.description ||
                "Configure the MCP server connection"}
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex-1 min-h-0 flex flex-col">
          <Stepper
            activeStep={wizardStep}
            onStepChange={handleWizardStepChange}
            showNavigation={false}
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* ── Step 1: Configure ── */}
            <Stepper.Step label="Configure" description="Name & credentials">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-5">
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
                          effectiveMcpConfig.transport === "streamable_http"
                            ? "Streamable HTTP"
                            : "stdio"
                        }
                      />
                    </div>
                    {effectiveMcpConfig.transport === "streamable_http" ? (
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
                          Object.keys(effectiveMcpConfig.envMapping).length >
                            0 && (
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
                        {effectiveMcpConfig.transport === "streamable_http"
                          ? "Server Configuration"
                          : "Authentication"}
                      </p>
                    </div>

                    {formFields.map((field) => (
                      <div key={field.key} className="flex flex-col gap-2">
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
                                  await window.mainApi.dialog.chooseFile(true, [
                                    "json",
                                  ]);
                                if (filepath)
                                  handleCredentialChange(field.key, filepath);
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

                {/* Auth Result */}
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
              </div>
            </Stepper.Step>

            {/* ── Step 2: Test ── */}
            <Stepper.Step label="Test" description="Verify connection">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-5">
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <p className="text-sm opacity-60 text-center">
                    Test the connection to verify your configuration is correct.
                  </p>
                  <Button
                    title={isTesting ? "Testing..." : "Test Connection"}
                    onClick={handleTestConnection}
                    size="md"
                  />
                </div>

                {/* Test Connection Result */}
                {testResult && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      testResult.success
                        ? "bg-green-900/30 border border-green-700 text-green-300"
                        : "bg-red-900/30 border border-red-700 text-red-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon
                        icon={
                          testResult.success
                            ? "circle-check"
                            : "circle-exclamation"
                        }
                      />
                      <span>{testResult.message}</span>
                    </div>
                  </div>
                )}
              </div>
            </Stepper.Step>

            {/* ── Step 3: Tools ── */}
            <Stepper.Step label="Tools" description="Select allowed tools">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-5">
                {testResult?.success &&
                testResult.tools?.length > 0 &&
                selectedTools ? (
                  <ToolSelector
                    tools={testResult.tools}
                    selectedTools={selectedTools}
                    onSelectionChange={setSelectedTools}
                  />
                ) : (
                  <div className="text-center py-8 opacity-50">
                    No tools available. Go back and test the connection first.
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
              <Button title="Cancel" onClick={onCancel} size="sm" />
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
              Step {wizardStep + 1} of 3
            </span>
          </div>
          <div className="flex flex-row gap-2">
            {wizardStep === 0 && (
              <>
                {selectedServer?.authCommand && (
                  <Button
                    title={isAuthorizing ? "Authorizing..." : "Authorize"}
                    onClick={handleAuthorize}
                    size="sm"
                  />
                )}
                <Button
                  title="Next"
                  onClick={() => handleWizardStepChange(1)}
                  size="sm"
                />
              </>
            )}
            {wizardStep === 1 && (
              <>
                <Button
                  title={isTesting ? "Testing..." : "Test Connection"}
                  onClick={handleTestConnection}
                  size="sm"
                />
                <Button
                  title="Next"
                  onClick={() => handleWizardStepChange(2)}
                  disabled={!testResult?.success}
                  size="sm"
                />
              </>
            )}
            {wizardStep === 2 && (
              <Button
                title="Save MCP Server"
                onClick={handleSaveProvider}
                size="sm"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Stage 1: Catalog Browser ──
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <SubHeading3 title="Add MCP Server" padding={false} />
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <FontAwesomeIcon icon="times" className="text-lg" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm opacity-50">
            Browse available MCP servers from the catalog
          </p>
          <button
            onClick={handleSelectCustom}
            className="text-sm text-blue-400 hover:text-blue-300 underline transition-colors"
          >
            or add a custom server
          </button>
        </div>

        {/* Search */}
        <InputText
          value={searchQuery}
          onChange={(value) => setSearchQuery(value)}
          placeholder="Search MCP servers..."
        />

        {/* Server Grid */}
        {isLoadingCatalog ? (
          <div className="text-center py-12 opacity-50">Loading catalog...</div>
        ) : filteredCatalog.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredCatalog.map((server) => (
              <Card2
                key={server.id}
                hover
                onClick={() => handleSelectServer(server)}
                className="text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon2 icon={getIconForServer(server)} size="h-5 w-5" />
                  <span className="font-semibold text-lg">{server.name}</span>
                </div>
                <p className="text-sm opacity-70 mb-3">{server.description}</p>
                <div className="flex flex-wrap gap-1">
                  {(server.tags || []).map((tag) => (
                    <Tag key={tag} text={tag} />
                  ))}
                </div>
              </Card2>
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
    </div>
  );
};
