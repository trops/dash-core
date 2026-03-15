import React, { useState, useContext, useMemo, useRef } from "react";
import {
  Button,
  InputText,
  SubHeading3,
  Tag,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import {
  deriveFormFields,
  formatFieldName,
  isLikelySecret,
} from "../../../utils/mcpUtils";
import { ToolSelector } from "./ToolSelector";

export const ProviderDetail = ({
  providerName = null,
  provider = null,
  isEditing = false,
  isCreating = false,
  formName = "",
  setFormName,
  formType = "",
  setFormType,
  formCredentials = {},
  setFormCredentials,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onCreate,
  onDelete,
  onSaveAllowedTools,
  catalogAuthCommand = null,
  catalogCredentialSchema = {},
}) => {
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;
  const isMcp = provider?.providerClass === "mcp";
  const isWs = provider?.providerClass === "websocket";

  // MCP test connection state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [selectedTools, setSelectedTools] = useState(null);

  // MCP auth state
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authResult, setAuthResult] = useState(null);

  // Resolve authCommand: provider.mcpConfig.authCommand > catalogAuthCommand prop
  const resolvedAuthCommand =
    provider?.mcpConfig?.authCommand || catalogAuthCommand || null;

  // Derive credential fields for MCP providers in edit mode
  const mcpFormFields = useMemo(() => {
    if (!isMcp || !provider?.mcpConfig) return [];
    return deriveFormFields(provider.mcpConfig, catalogCredentialSchema);
  }, [isMcp, provider, catalogCredentialSchema]);

  // Credential field keys for non-MCP providers
  const credentialKeys = useMemo(() => {
    if (isMcp || !provider?.credentials) return [];
    return Object.keys(provider.credentials);
  }, [isMcp, provider]);

  // Dynamic credential fields for create mode
  const [credentialFields, setCredentialFields] = useState(
    isCreating ? [{ id: "default_apiKey", key: "apiKey", secret: true }] : [],
  );
  const fieldIdRef = useRef(0);

  const handleFieldKeyChange = (id, newKey) => {
    setCredentialFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const oldKey = f.key;
        if (oldKey && formCredentials[oldKey] !== undefined) {
          setFormCredentials((creds) => {
            const updated = { ...creds };
            const val = updated[oldKey];
            delete updated[oldKey];
            if (newKey.trim()) updated[newKey] = val;
            return updated;
          });
        }
        return { ...f, key: newKey };
      }),
    );
  };

  const handleFieldValueChange = (id, value) => {
    const field = credentialFields.find((f) => f.id === id);
    if (field?.key) {
      setFormCredentials((prev) => ({ ...prev, [field.key]: value }));
    }
  };

  const handleFieldSecretToggle = (id) => {
    setCredentialFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, secret: !f.secret } : f)),
    );
  };

  const handleAddField = () => {
    fieldIdRef.current += 1;
    setCredentialFields((prev) => [
      ...prev,
      { id: `field_${fieldIdRef.current}`, key: "", secret: false },
    ]);
  };

  const handleRemoveField = (id) => {
    const field = credentialFields.find((f) => f.id === id);
    if (field?.key) {
      setFormCredentials((prev) => {
        const updated = { ...prev };
        delete updated[field.key];
        return updated;
      });
    }
    setCredentialFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleCredentialChange = (key, value) => {
    setFormCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const handleTestConnection = () => {
    if (!dashApi || !provider?.mcpConfig || !providerName) return;

    setIsTesting(true);
    setTestResult(null);

    dashApi.mcpStartServer(
      providerName,
      provider.mcpConfig,
      provider.credentials,
      (event, result) => {
        if (result.error) {
          setTestResult({ success: false, message: result.message });
          setIsTesting(false);
          return;
        }

        setTestResult({
          success: true,
          tools: result.tools || [],
          message: `Connected! Found ${(result.tools || []).length} tools.`,
        });

        // Pre-select: intersect with existing allowedTools, or select all
        const allToolNames = (result.tools || []).map((t) => t.name);
        if (provider?.allowedTools) {
          setSelectedTools(
            allToolNames.filter((t) => provider.allowedTools.includes(t)),
          );
        } else {
          setSelectedTools(allToolNames);
        }

        // Stop after test
        dashApi.mcpStopServer(
          providerName,
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

  const handleAuthorize = () => {
    if (!dashApi || !provider?.mcpConfig || !resolvedAuthCommand) return;

    setIsAuthorizing(true);
    setAuthResult(null);

    dashApi.mcpRunAuth(
      provider.mcpConfig,
      provider.credentials,
      resolvedAuthCommand,
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

  // WebSocket test connection state
  const [isWsTesting, setIsWsTesting] = useState(false);
  const [wsTestResult, setWsTestResult] = useState(null);

  const handleWsTestConnection = async () => {
    if (!dashApi?.webSocket || !provider?.wsConfig?.url || !providerName)
      return;

    setIsWsTesting(true);
    setWsTestResult(null);

    const startTime = Date.now();
    try {
      const result = await dashApi.webSocket.connect(providerName, {
        url: provider.wsConfig.url,
        headers: provider.wsConfig.headers || null,
        subprotocols: provider.wsConfig.subprotocols || null,
        credentials: provider.credentials || null,
      });

      const latency = Date.now() - startTime;

      if (result.error) {
        setWsTestResult({
          success: false,
          message: result.message || "Connection failed",
        });
      } else {
        setWsTestResult({
          success: true,
          message: `Connected in ${latency}ms`,
        });

        // Disconnect after test
        await dashApi.webSocket.disconnect(providerName).catch(() => {});
      }
    } catch (err) {
      setWsTestResult({
        success: false,
        message: err?.message || "Connection failed",
      });
    }
    setIsWsTesting(false);
  };

  const isFormMode = isEditing || isCreating;

  // ── MCP config info block (shared between read-only view and edit form) ──
  const mcpConfigBlock = isMcp && provider?.mcpConfig && (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
        MCP Server Connection
      </p>
      <div className="space-y-2 text-sm">
        <div className="flex gap-2">
          <span className="opacity-50 w-24 shrink-0">Transport:</span>
          <Tag
            text={
              provider.mcpConfig.transport === "streamable_http"
                ? "Streamable HTTP"
                : "stdio"
            }
          />
        </div>
        {provider.mcpConfig.transport === "streamable_http" ? (
          <div className="flex gap-2">
            <span className="opacity-50 w-24 shrink-0">Endpoint:</span>
            <span className="text-xs opacity-70">Remote hosted server</span>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <span className="opacity-50 w-24 shrink-0">Command:</span>
              <code className="text-xs bg-white/5 px-2 py-0.5 rounded">
                {provider.mcpConfig.command}{" "}
                {(provider.mcpConfig.args || []).join(" ")}
              </code>
            </div>
            {provider.mcpConfig.envMapping &&
              Object.keys(provider.mcpConfig.envMapping).length > 0 && (
                <div className="flex gap-2">
                  <span className="opacity-50 w-24 shrink-0">Env Vars:</span>
                  <span className="text-xs opacity-70">
                    {Object.keys(provider.mcpConfig.envMapping).join(", ")}
                  </span>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );

  // ── Edit / Create form ──
  if (isFormMode) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          <SubHeading3
            title={isCreating ? "New Provider" : "Edit Provider"}
            padding={false}
          />

          {/* Provider name (always shown) */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-400">
              Provider Name
            </label>
            <InputText
              value={formName}
              onChange={(value) => setFormName(value)}
              placeholder="Provider name"
            />
          </div>

          {/* Provider type (credential providers & create mode only) */}
          {(!isMcp || isCreating) && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-400">
                Provider Type
              </label>
              <InputText
                value={formType}
                onChange={(value) => setFormType(value)}
                placeholder="Provider type (e.g. algolia, openai)"
              />
            </div>
          )}

          {/* Credential fields for create mode */}
          {isCreating && (
            <>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                  Credentials
                </p>
              </div>

              {credentialFields.map((field) => (
                <div key={field.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <InputText
                        value={field.key}
                        onChange={(value) =>
                          handleFieldKeyChange(field.id, value)
                        }
                        placeholder="Field name (e.g. apiKey)"
                      />
                    </div>
                    <button
                      onClick={() => handleFieldSecretToggle(field.id)}
                      className="p-2 rounded hover:bg-white/10 transition-colors opacity-50 hover:opacity-100"
                      title={field.secret ? "Show as text" : "Mark as secret"}
                    >
                      <FontAwesomeIcon
                        icon={field.secret ? "eye-slash" : "eye"}
                        className="h-3.5 w-3.5"
                      />
                    </button>
                    <button
                      onClick={() => handleRemoveField(field.id)}
                      className="p-2 rounded hover:bg-red-500/20 transition-colors opacity-50 hover:opacity-100 text-red-400"
                      title="Remove field"
                    >
                      <FontAwesomeIcon icon="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {field.key.trim() && (
                    <InputText
                      type={field.secret ? "password" : "text"}
                      value={formCredentials[field.key] || ""}
                      onChange={(value) =>
                        handleFieldValueChange(field.id, value)
                      }
                      placeholder={`Enter ${field.key}`}
                    />
                  )}
                </div>
              ))}

              <button
                onClick={handleAddField}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                <FontAwesomeIcon icon="plus" className="h-3 w-3" />
                Add Credential Field
              </button>
            </>
          )}

          {/* MCP provider edit: read-only config + editable credentials */}
          {isEditing && isMcp && (
            <>
              {mcpConfigBlock}

              {mcpFormFields.length > 0 && (
                <>
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                      {provider.mcpConfig?.transport === "streamable_http"
                        ? "Server Configuration"
                        : "Authentication"}
                    </p>
                  </div>

                  {mcpFormFields.map((field) => (
                    <div key={field.key} className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-400">
                        {field.displayName}
                      </label>
                      {field.instructions && (
                        <p className="text-sm opacity-50">
                          {field.instructions}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <InputText
                            type={field.secret ? "password" : "text"}
                            value={formCredentials[field.key] || ""}
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
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* Credential provider edit: editable credential fields */}
          {isEditing && !isMcp && credentialKeys.length > 0 && (
            <>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                  Credentials
                </p>
              </div>

              {credentialKeys.map((key) => (
                <div key={key} className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-400">
                    {formatFieldName(key)}
                  </label>
                  <InputText
                    type={isLikelySecret(key) ? "password" : "text"}
                    value={formCredentials[key] || ""}
                    onChange={(value) => handleCredentialChange(key, value)}
                    placeholder={`Enter ${formatFieldName(key).toLowerCase()}`}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex flex-row justify-end gap-2 px-6 py-4 border-t border-white/10">
          <Button title="Cancel" onClick={onCancelEdit} size="sm" />
          <Button
            title={isCreating ? "Create" : "Save"}
            onClick={isCreating ? onCreate : onSaveEdit}
            size="sm"
          />
        </div>
      </div>
    );
  }

  // ── Read-only detail view ──
  if (!providerName || !provider) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {/* Name */}
        <SubHeading3 title={providerName} padding={false} />

        {/* Info */}
        <div className="flex flex-col space-y-3">
          {provider.type && (
            <div className="flex flex-row items-center gap-2">
              <span className="text-sm opacity-50">Type:</span>
              <Tag text={provider.type} />
            </div>
          )}
          <div className="flex flex-row items-center gap-2">
            <span className="text-sm opacity-50">Class:</span>
            <Tag
              text={
                isWs ? "WebSocket" : isMcp ? "MCP Server" : "API Credentials"
              }
            />
          </div>
        </div>

        {/* MCP-specific info */}
        {isMcp && provider.mcpConfig && (
          <>
            {/* Section: Server Configuration */}
            <div className="space-y-4">
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider mb-3">
                  Server Configuration
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex gap-2">
                    <span className="opacity-50 w-20">Transport:</span>
                    <span>
                      {provider.mcpConfig.transport === "streamable_http"
                        ? "Streamable HTTP"
                        : "stdio"}
                    </span>
                  </div>
                  {provider.mcpConfig.transport === "streamable_http" ? (
                    <div className="flex gap-2">
                      <span className="opacity-50 w-20">Endpoint:</span>
                      <span className="text-xs opacity-70">
                        Remote hosted server
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <span className="opacity-50 w-20">Command:</span>
                        <code className="text-xs bg-white/5 px-2 py-0.5 rounded">
                          {provider.mcpConfig.command}{" "}
                          {(provider.mcpConfig.args || []).join(" ")}
                        </code>
                      </div>
                      {provider.mcpConfig.envMapping &&
                        Object.keys(provider.mcpConfig.envMapping).length >
                          0 && (
                          <div className="flex gap-2">
                            <span className="opacity-50 w-20">Env Vars:</span>
                            <span className="text-xs">
                              {Object.keys(provider.mcpConfig.envMapping).join(
                                ", ",
                              )}
                            </span>
                          </div>
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Section: Connection & Tools */}
            <div className="space-y-4">
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider mb-3">
                  Connection & Tools
                </p>
              </div>

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

              {/* Tool Selection after successful test */}
              {testResult?.success &&
                testResult.tools?.length > 0 &&
                selectedTools && (
                  <ToolSelector
                    tools={testResult.tools}
                    selectedTools={selectedTools}
                    onSelectionChange={setSelectedTools}
                  />
                )}

              {/* Allowed Tools read-only display (when no test result) */}
              {!testResult &&
                provider?.allowedTools &&
                provider.allowedTools.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {provider.allowedTools.map((tool) => (
                        <span
                          key={tool}
                          className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 opacity-70"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs opacity-40">
                      {provider.allowedTools.length} tool
                      {provider.allowedTools.length !== 1 ? "s" : ""} allowed —
                      test connection to modify
                    </p>
                  </div>
                )}

              {/* No tools or test yet */}
              {!testResult &&
                (!provider?.allowedTools ||
                  provider.allowedTools.length === 0) && (
                  <p className="text-sm opacity-40">
                    No tools configured — use Test Connection to discover
                    available tools.
                  </p>
                )}
            </div>
          </>
        )}

        {/* WebSocket-specific info */}
        {isWs && provider.wsConfig && (
          <>
            <div className="space-y-4">
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider mb-3">
                  Connection
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex gap-2">
                    <span className="opacity-50 w-24 shrink-0">URL:</span>
                    <code className="text-xs bg-white/5 px-2 py-0.5 rounded break-all">
                      {provider.wsConfig.url}
                    </code>
                  </div>
                  {provider.wsConfig.headers &&
                    Object.keys(provider.wsConfig.headers).length > 0 && (
                      <div className="flex gap-2">
                        <span className="opacity-50 w-24 shrink-0">
                          Headers:
                        </span>
                        <span className="text-xs opacity-70">
                          {Object.keys(provider.wsConfig.headers).join(", ")}
                        </span>
                      </div>
                    )}
                  {provider.wsConfig.subprotocols &&
                    provider.wsConfig.subprotocols.length > 0 && (
                      <div className="flex gap-2">
                        <span className="opacity-50 w-24 shrink-0">
                          Subprotocols:
                        </span>
                        <span className="text-xs opacity-70">
                          {provider.wsConfig.subprotocols.join(", ")}
                        </span>
                      </div>
                    )}
                </div>
              </div>
            </div>

            {/* WebSocket Test Result */}
            {wsTestResult && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  wsTestResult.success
                    ? "bg-green-900/30 border border-green-700 text-green-300"
                    : "bg-red-900/30 border border-red-700 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon
                    icon={
                      wsTestResult.success
                        ? "circle-check"
                        : "circle-exclamation"
                    }
                  />
                  <span>{wsTestResult.message}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex flex-row justify-end gap-2 px-6 py-4 border-t border-white/10">
        {isMcp && resolvedAuthCommand && (
          <Button
            title={isAuthorizing ? "Authorizing..." : "Authorize"}
            onClick={handleAuthorize}
            size="sm"
          />
        )}
        {isMcp && (
          <Button
            title={isTesting ? "Testing..." : "Test Connection"}
            onClick={handleTestConnection}
            size="sm"
          />
        )}
        {isWs && (
          <Button
            title={isWsTesting ? "Testing..." : "Test Connection"}
            onClick={handleWsTestConnection}
            size="sm"
          />
        )}
        {isMcp && selectedTools && onSaveAllowedTools && (
          <Button
            title="Update Allowed Tools"
            onClick={() => onSaveAllowedTools(providerName, selectedTools)}
            size="sm"
          />
        )}
        <Button
          title="Edit"
          onClick={() => onStartEdit(providerName, provider)}
          size="sm"
        />
        <Button
          title="Delete"
          onClick={() => onDelete(providerName)}
          size="sm"
        />
      </div>
    </div>
  );
};
