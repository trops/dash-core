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
  CodeEditorInline,
  Stepper,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import {
  deriveFormFields,
  formStateToMcpJson,
  mcpJsonToFormState,
} from "../../../utils/mcpUtils";
import { ToolSelector } from "./ToolSelector";

let rowIdCounter = 0;
const nextRowId = () => `row_${++rowIdCounter}`;

/**
 * Build an mcpConfig object from the current form state.
 */
function buildMcpConfig(
  transport,
  { command, args, envMappingRows, url, headerRows },
) {
  if (transport === "stdio") {
    const envMapping = {};
    envMappingRows.forEach((row) => {
      const env = row.envVar.trim();
      const cred = row.credField.trim();
      if (env && cred) {
        envMapping[env] = cred;
      }
    });
    return {
      transport: "stdio",
      command: command.trim(),
      args: args.trim().split(/\s+/).filter(Boolean),
      envMapping,
    };
  }

  // streamable_http
  const headerTemplate = {};
  headerRows.forEach((row) => {
    const name = row.headerName.trim();
    const value = row.headerValue.trim();
    if (name && value) {
      headerTemplate[name] = value;
    }
  });
  const config = {
    transport: "streamable_http",
    url: url.trim(),
  };
  if (Object.keys(headerTemplate).length > 0) {
    config.headerTemplate = headerTemplate;
  }
  return config;
}

/**
 * CustomMcpServerForm
 *
 * Form for configuring a custom MCP server (not from the catalog).
 * Supports stdio and streamable_http transports with dynamic field derivation.
 * Used for both creating new and editing existing MCP providers.
 *
 * @param {Function} onSave - (providerName, providerType, credentials, mcpConfig) => void
 * @param {Function} onBack - Called when the user wants to return
 * @param {boolean} isEditMode - Whether we're editing an existing provider
 * @param {string} initialName - Pre-populated provider name (edit mode)
 * @param {string} initialTransport - Pre-populated transport type (edit mode)
 * @param {string} initialCommand - Pre-populated command (edit mode)
 * @param {string} initialArgs - Pre-populated args string (edit mode)
 * @param {Array} initialEnvMappingRows - Pre-populated env mapping rows (edit mode)
 * @param {string} initialUrl - Pre-populated URL (edit mode)
 * @param {Array} initialHeaderRows - Pre-populated header rows (edit mode)
 * @param {object} initialCredentials - Pre-populated credential values (edit mode)
 */
export const CustomMcpServerForm = ({
  onSave,
  onBack,
  isEditMode = false,
  initialName = "",
  initialProviderType = "custom",
  initialCredentialSchema = {},
  initialTransport = "stdio",
  initialCommand = "",
  initialArgs = "",
  initialEnvMappingRows = [],
  initialUrl = "",
  initialHeaderRows = [],
  initialCredentials = {},
  initialAllowedTools = null,
}) => {
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;

  // Transport selection
  const [transport, setTransport] = useState(initialTransport);

  // Common
  const [providerName, setProviderName] = useState(initialName);
  const [credentialData, setCredentialData] = useState(initialCredentials);
  const [formErrors, setFormErrors] = useState({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // stdio fields
  const [command, setCommand] = useState(initialCommand);
  const [args, setArgs] = useState(initialArgs);
  const [envMappingRows, setEnvMappingRows] = useState(initialEnvMappingRows);

  // HTTP fields
  const [url, setUrl] = useState(initialUrl);
  const [headerRows, setHeaderRows] = useState(initialHeaderRows);

  // Tool selection state
  const [selectedTools, setSelectedTools] = useState(initialAllowedTools);

  // Wizard step state
  const [wizardStep, setWizardStep] = useState(0);

  // JSON editor state
  const [viewMode, setViewMode] = useState("form"); // "form" | "json"
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState(null);

  // Clear credential data when transport changes (derived fields change entirely)
  // Only in create mode — in edit mode the initial transport is set correctly
  useEffect(() => {
    if (!isEditMode) {
      setCredentialData({});
      setTestResult(null);
    }
  }, [transport, isEditMode]);

  // Wizard step navigation with validation gates
  const handleWizardStepChange = (newStep) => {
    if (newStep < wizardStep) {
      setWizardStep(newStep);
      return;
    }
    // Step 0→1: validate form (skip validation in JSON mode, handled on save)
    if (wizardStep === 0 && newStep >= 1) {
      if (viewMode === "form" && !validateForm()) return;
    }
    // Step 1→2: require test success OR edit mode with existing tools
    if (wizardStep === 1 && newStep >= 2) {
      if (!testResult?.success && !(isEditMode && initialAllowedTools)) return;
    }
    setWizardStep(newStep);
  };

  // Build mcpConfig from current state
  const mcpConfig = useMemo(
    () =>
      buildMcpConfig(transport, {
        command,
        args,
        envMappingRows,
        url,
        headerRows,
      }),
    [transport, command, args, envMappingRows, url, headerRows],
  );

  // Invalidate test result when config changes after a test
  const mcpConfigRef = useRef(mcpConfig);
  useEffect(() => {
    if (mcpConfigRef.current !== mcpConfig && testResult) {
      setTestResult(null);
      setSelectedTools(initialAllowedTools);
    }
    mcpConfigRef.current = mcpConfig;
  }, [mcpConfig, testResult, initialAllowedTools]);

  // Derive credential fields from the live mcpConfig
  const formFields = useMemo(
    () => deriveFormFields(mcpConfig, initialCredentialSchema),
    [mcpConfig, initialCredentialSchema],
  );

  // --- envMapping row handlers ---
  const addEnvRow = () => {
    setEnvMappingRows((prev) => [
      ...prev,
      { id: nextRowId(), envVar: "", credField: "" },
    ]);
  };

  const updateEnvRow = (id, field, value) => {
    setEnvMappingRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeEnvRow = (id) => {
    setEnvMappingRows((prev) => prev.filter((row) => row.id !== id));
  };

  // --- header row handlers ---
  const addHeaderRow = () => {
    setHeaderRows((prev) => [
      ...prev,
      { id: nextRowId(), headerName: "", headerValue: "" },
    ]);
  };

  const updateHeaderRow = (id, field, value) => {
    setHeaderRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeHeaderRow = (id) => {
    setHeaderRows((prev) => prev.filter((row) => row.id !== id));
  };

  // --- credential field change ---
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

  // --- JSON toggle handlers ---
  const handleSwitchToJson = () => {
    const json = formStateToMcpJson(providerName, transport, {
      command,
      args,
      envMappingRows,
      url,
      headerRows,
      credentialData,
    });
    setJsonText(json);
    setJsonError(null);
    setViewMode("json");
  };

  const handleSwitchToForm = () => {
    const result = mcpJsonToFormState(jsonText, nextRowId);
    if (result.error) {
      setJsonError(result.error);
      return;
    }
    setProviderName(result.providerName || providerName);
    setTransport(result.transport);
    setCommand(result.command);
    setArgs(result.args);
    setEnvMappingRows(result.envMappingRows);
    setUrl(result.url);
    setHeaderRows(result.headerRows);
    setCredentialData(result.credentialData);
    setJsonError(null);
    setViewMode("form");
  };

  // --- validation ---
  const validateForm = () => {
    const errors = {};
    if (!providerName?.trim()) {
      errors.providerName = "Provider name is required";
    }
    if (transport === "stdio") {
      if (!command?.trim()) {
        errors.command = "Command is required";
      }
    } else {
      if (!url?.trim()) {
        errors.url = "URL is required";
      }
    }
    formFields.forEach((field) => {
      if (field.required && !credentialData[field.key]?.trim()) {
        errors[field.key] = `${field.displayName} is required`;
      }
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // --- test connection ---
  const handleTestConnection = () => {
    if (!dashApi) return;

    setIsTesting(true);
    setTestResult(null);

    const testName = "__test__custom";

    dashApi.mcpStartServer(
      testName,
      mcpConfig,
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

        // Pre-select tools: intersect with existing allowedTools if editing, or select all
        const allToolNames = (result.tools || []).map((t) => t.name);
        if (initialAllowedTools) {
          setSelectedTools(
            allToolNames.filter((t) => initialAllowedTools.includes(t)),
          );
        } else {
          setSelectedTools(allToolNames);
        }

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

  // --- save ---
  const handleSave = () => {
    // If in JSON mode, parse JSON first to update form state
    if (viewMode === "json") {
      const result = mcpJsonToFormState(jsonText, nextRowId);
      if (result.error) {
        setJsonError(result.error);
        return;
      }
      const name = (result.providerName || providerName || "").trim();
      if (!name) {
        setJsonError("Provider name is required");
        return;
      }
      const config = buildMcpConfig(result.transport, {
        command: result.command,
        args: result.args,
        envMappingRows: result.envMappingRows,
        url: result.url,
        headerRows: result.headerRows,
      });
      onSave(
        name,
        initialProviderType,
        result.credentialData,
        config,
        selectedTools,
      );
      return;
    }

    if (!validateForm()) return;
    onSave(
      providerName.trim(),
      initialProviderType,
      credentialData,
      mcpConfig,
      selectedTools,
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-2">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-200 transition-colors"
        >
          <FontAwesomeIcon icon="arrow-left" className="text-lg" />
        </button>
        <div>
          <SubHeading3
            title={
              isEditMode ? "Edit MCP Server" : "Configure Custom MCP Server"
            }
            padding={false}
          />
          <p className="text-sm opacity-50 mt-1">
            {isEditMode
              ? "Modify this MCP server configuration"
              : "Define a custom MCP server connection"}
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex-1 min-h-0 flex flex-col">
        <Stepper
          activeStep={wizardStep}
          onStepChange={handleWizardStepChange}
          showNavigation={false}
          className="flex-1 min-h-0 flex flex-col px-6 pt-4"
        >
          {/* ── Step 1: Configure ── */}
          <Stepper.Step label="Configure" description="Server & credentials">
            <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
              {/* Provider Name */}
              <div className="flex flex-col gap-2">
                <FormLabel label="Provider Name" required={true} />
                <p className="text-sm opacity-50">
                  A name to identify this MCP server (e.g., &quot;My Custom
                  Server&quot;)
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

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (viewMode === "json") handleSwitchToForm();
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-l transition-colors ${
                    viewMode === "form"
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:text-white/70"
                  }`}
                >
                  Form
                </button>
                <button
                  onClick={() => {
                    if (viewMode === "form") handleSwitchToJson();
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-r transition-colors ${
                    viewMode === "json"
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:text-white/70"
                  }`}
                >
                  JSON
                </button>
              </div>

              {/* JSON Error */}
              {jsonError && <p className="text-sm text-red-400">{jsonError}</p>}

              {/* ── JSON Editor View ── */}
              {viewMode === "json" && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                    MCP Server Configuration (JSON)
                  </p>
                  <p className="text-sm opacity-50">
                    Paste a standard MCP config JSON (compatible with Claude
                    Desktop, Cursor, etc.)
                  </p>
                  <CodeEditorInline
                    code={jsonText}
                    setCode={(val) => {
                      setJsonText(val);
                      setJsonError(null);
                    }}
                    language="json"
                    placeholder={
                      '{\n  "type": "stdio",\n  "command": "npx",\n  "args": ["-y", "package-name"],\n  "env": {\n    "API_KEY": "${API_KEY}"\n  }\n}'
                    }
                  />
                </div>
              )}

              {/* ── Form View ── */}
              {viewMode === "form" && (
                <>
                  {/* Transport Selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                      Transport Type
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Card2
                        hover
                        selected={transport === "stdio"}
                        onClick={() => setTransport("stdio")}
                        className="text-left"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon2 icon="terminal" />
                          <span className="font-semibold text-sm">
                            Local Process (stdio)
                          </span>
                        </div>
                        <p className="text-xs opacity-50">
                          Spawn a local command as a child process
                        </p>
                      </Card2>
                      <Card2
                        hover
                        selected={transport === "streamable_http"}
                        onClick={() => setTransport("streamable_http")}
                        className="text-left"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon2 icon="globe" />
                          <span className="font-semibold text-sm">
                            Remote Server (HTTP)
                          </span>
                        </div>
                        <p className="text-xs opacity-50">
                          Connect to a remote MCP server via HTTP
                        </p>
                      </Card2>
                    </div>
                  </div>

                  {/* ── stdio Fields ── */}
                  {transport === "stdio" && (
                    <div className="space-y-4">
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                          Process Configuration
                        </p>
                      </div>

                      {/* Command */}
                      <div className="flex flex-col gap-2">
                        <FormLabel label="Command" required={true} />
                        <p className="text-sm opacity-50">
                          The executable to run (e.g., npx, node, python)
                        </p>
                        <InputText
                          value={command}
                          onChange={(value) => {
                            setCommand(value);
                            if (formErrors.command && value?.trim()) {
                              setFormErrors((prev) => {
                                const next = { ...prev };
                                delete next.command;
                                return next;
                              });
                            }
                          }}
                          placeholder="e.g., npx"
                        />
                        {formErrors.command && (
                          <p className="text-sm text-red-400">
                            {formErrors.command}
                          </p>
                        )}
                      </div>

                      {/* Args */}
                      <div className="flex flex-col gap-2">
                        <FormLabel label="Arguments" />
                        <p className="text-sm opacity-50">
                          Space-separated arguments passed to the command
                        </p>
                        <InputText
                          value={args}
                          onChange={setArgs}
                          placeholder="e.g., -y @modelcontextprotocol/server-github"
                        />
                      </div>

                      {/* Environment Variable Mapping */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <FormLabel label="Environment Variable Mapping" />
                            <p className="text-sm opacity-50 mt-1">
                              Map environment variables to credential fields
                            </p>
                          </div>
                        </div>

                        {envMappingRows.map((row) => (
                          <div key={row.id} className="flex items-center gap-2">
                            <div className="flex-1">
                              <InputText
                                value={row.envVar}
                                onChange={(value) =>
                                  updateEnvRow(row.id, "envVar", value)
                                }
                                placeholder="ENV_VAR_NAME"
                              />
                            </div>
                            <span className="opacity-30 text-sm shrink-0">
                              &rarr;
                            </span>
                            <div className="flex-1">
                              <InputText
                                value={row.credField}
                                onChange={(value) =>
                                  updateEnvRow(row.id, "credField", value)
                                }
                                placeholder="credentialField"
                              />
                            </div>
                            <button
                              onClick={() => removeEnvRow(row.id)}
                              className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                            >
                              <FontAwesomeIcon
                                icon="times"
                                className="text-sm"
                              />
                            </button>
                          </div>
                        ))}

                        <button
                          onClick={addEnvRow}
                          className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                        >
                          <FontAwesomeIcon icon="plus" className="text-xs" />
                          <span>Add Environment Variable</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── streamable_http Fields ── */}
                  {transport === "streamable_http" && (
                    <div className="space-y-4">
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                          Server Configuration
                        </p>
                      </div>

                      {/* URL */}
                      <div className="flex flex-col gap-2">
                        <FormLabel label="Server URL" required={true} />
                        <p className="text-sm opacity-50">
                          Use{" "}
                          <code className="text-xs bg-white/10 px-1 py-0.5 rounded">
                            {"{{fieldName}}"}
                          </code>{" "}
                          for values provided as credentials
                        </p>
                        <InputText
                          value={url}
                          onChange={(value) => {
                            setUrl(value);
                            if (formErrors.url && value?.trim()) {
                              setFormErrors((prev) => {
                                const next = { ...prev };
                                delete next.url;
                                return next;
                              });
                            }
                          }}
                          placeholder="e.g., https://mcp.example.com/sse"
                        />
                        {formErrors.url && (
                          <p className="text-sm text-red-400">
                            {formErrors.url}
                          </p>
                        )}
                      </div>

                      {/* Headers */}
                      <div className="space-y-3">
                        <div>
                          <FormLabel label="Request Headers" />
                          <p className="text-sm opacity-50 mt-1">
                            Use{" "}
                            <code className="text-xs bg-white/10 px-1 py-0.5 rounded">
                              {"{{fieldName}}"}
                            </code>{" "}
                            in values for credential placeholders
                          </p>
                        </div>

                        {headerRows.map((row) => (
                          <div key={row.id} className="flex items-center gap-2">
                            <div className="flex-1">
                              <InputText
                                value={row.headerName}
                                onChange={(value) =>
                                  updateHeaderRow(row.id, "headerName", value)
                                }
                                placeholder="Header-Name"
                              />
                            </div>
                            <span className="opacity-30 text-sm shrink-0">
                              :
                            </span>
                            <div className="flex-1">
                              <InputText
                                value={row.headerValue}
                                onChange={(value) =>
                                  updateHeaderRow(row.id, "headerValue", value)
                                }
                                placeholder="Bearer {{apiKey}}"
                              />
                            </div>
                            <button
                              onClick={() => removeHeaderRow(row.id)}
                              className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                            >
                              <FontAwesomeIcon
                                icon="times"
                                className="text-sm"
                              />
                            </button>
                          </div>
                        ))}

                        <button
                          onClick={addHeaderRow}
                          className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                        >
                          <FontAwesomeIcon icon="plus" className="text-xs" />
                          <span>Add Header</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Derived Credential Fields ── */}
                  {formFields.length > 0 && (
                    <>
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                          Credentials
                        </p>
                        <p className="text-sm opacity-50 mt-1">
                          Values for the fields referenced in your configuration
                          above
                        </p>
                      </div>

                      {formFields.map((field) => (
                        <div key={field.key} className="flex flex-col gap-2">
                          <FormLabel
                            label={field.displayName}
                            required={field.required}
                          />
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
                </>
              )}
            </div>
          </Stepper.Step>

          {/* ── Step 2: Test ── */}
          <Stepper.Step label="Test" description="Verify connection">
            <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
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
            <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
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
            <Button title="Cancel" onClick={onBack} size="sm" />
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
          <span className="text-xs opacity-40">Step {wizardStep + 1} of 3</span>
        </div>
        <div className="flex flex-row gap-2">
          {wizardStep === 0 && (
            <Button
              title="Next"
              onClick={() => handleWizardStepChange(1)}
              size="sm"
            />
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
                disabled={
                  !testResult?.success && !(isEditMode && initialAllowedTools)
                }
                size="sm"
              />
            </>
          )}
          {wizardStep === 2 && (
            <Button
              title={isEditMode ? "Save Changes" : "Save MCP Server"}
              onClick={handleSave}
              size="sm"
            />
          )}
        </div>
      </div>
    </div>
  );
};
