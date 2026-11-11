import React, { useState, useContext, useMemo, useRef } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  InputText,
  SectionLabel,
  SubHeading3,
  Tag,
  FontAwesomeIcon,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { connectionErrorText } from "../../../utils/connectionErrorText";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import {
  deriveFormFields,
  formatFieldName,
  isLikelySecret,
  isBuiltinMcpConfig,
} from "../../../utils/mcpUtils";
import { ToolSelector } from "./ToolSelector";
import {
  reconnectProvider,
  signsInWithCommand,
} from "../../Issues/issueActions";
import { withoutProvidersPageTip } from "../../Issues/issueText";

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
  onToggleDefaultForType,
  catalogAuthCommand = null,
  catalogCredentialSchema = {},
  onBack = null,
  // Providers page (app-navigation NAV-007): status, who uses it, and
  // where Open goes.
  status = null,
  usage = null,
  workspaces = [],
  onOpenWorkspace = null,
  onOpenBotInBotsView = null,
  // NAV-015: opens "Use <provider> for…" (tick the widgets and bots).
  onChooseWhereToUse = null,
  // A program from a loaded profile: the user's OK lets it run (dash-profiles).
  onApproveRun = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const appContext = useContext(AppContext);
  const dashApi = appContext?.dashApi;
  const isMcp = provider?.providerClass === "mcp";
  const isWs = provider?.providerClass === "websocket";

  const [approveError, setApproveError] = useState(null);
  // Reconnect from its health banner (issues PRD): { busy, note }.
  const [reconnectState, setReconnectState] = useState({
    busy: false,
    note: "",
  });
  // A held provider from a profile runs a program here, or reaches an address.
  const runsProgram = !!(provider?.mcpConfig && provider.mcpConfig.command);
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

  // Pre-select: intersect with existing allowedTools, or select all
  const preselectTools = (tools) => {
    const allToolNames = (tools || []).map((t) => t.name);
    if (provider?.allowedTools) {
      setSelectedTools(
        allToolNames.filter((t) => provider.allowedTools.includes(t)),
      );
    } else {
      setSelectedTools(allToolNames);
    }
  };

  // Test Connection never stops a server your dashboards are using: if the
  // provider is already connected, report it as is (saving a provider
  // restarts it, so it runs with the saved credentials). Only a server the
  // test itself started is stopped afterwards.
  const handleTestConnection = () => {
    if (!dashApi || !provider?.mcpConfig || !providerName) return;

    setIsTesting(true);
    setTestResult(null);

    if (typeof dashApi.mcpGetServerStatus !== "function") {
      startTestServer();
      return;
    }
    dashApi.mcpGetServerStatus(
      providerName,
      (event, status) => {
        if (status && status.status === "connected") {
          const tools = status.tools || [];
          setTestResult({
            success: true,
            tools,
            message: `Connected and in use. Found ${tools.length} tools.`,
          });
          preselectTools(tools);
          setIsTesting(false);
          return;
        }
        startTestServer();
      },
      () => startTestServer(),
    );
  };

  const startTestServer = () => {
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

        preselectTools(result.tools);

        // Only the test was using it — stop it again.
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
          // Signed in here: a provider from a profile is set up now.
          if (provider && provider.needsSetup) {
            const pApi = window.mainApi && window.mainApi.providers;
            const appId = appContext?.credentials?.appId;
            if (pApi && pApi.markSetUp && appId) {
              Promise.resolve(pApi.markSetUp(appId, providerName))
                .then(
                  () =>
                    appContext.refreshProviders &&
                    appContext.refreshProviders(),
                )
                .catch(() => {});
            }
          }
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
    const wsApi = dashApi?.api?.webSocket;
    if (!wsApi || !provider?.wsConfig?.url || !providerName) return;

    setIsWsTesting(true);
    setWsTestResult(null);

    // Its own connection: under the provider's name it would reuse, then
    // close, the socket the provider's widgets are using.
    const testName = `${providerName} (connection test)`;
    const startTime = Date.now();
    try {
      const result = await wsApi.connect(testName, {
        url: provider.wsConfig.url,
        headers: provider.wsConfig.headers || null,
        subprotocols: provider.wsConfig.subprotocols || null,
        credentials: provider.credentials || null,
      });

      const latency = Date.now() - startTime;

      if (result.error) {
        setWsTestResult({
          success: false,
          message:
            connectionErrorText(result.message, provider.wsConfig.url) ||
            "Connection failed",
        });
      } else {
        setWsTestResult({
          success: true,
          message: `Connected in ${latency}ms`,
        });
      }
      await wsApi.disconnect(testName).catch(() => {});
    } catch (err) {
      setWsTestResult({
        success: false,
        message:
          connectionErrorText(err?.message, provider.wsConfig?.url) ||
          "Connection failed",
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
              isBuiltinMcpConfig(provider.mcpConfig)
                ? "Built into Dash"
                : provider.mcpConfig.transport === "streamable_http"
                  ? "Streamable HTTP"
                  : "stdio"
            }
          />
        </div>
        {isBuiltinMcpConfig(provider.mcpConfig) ? (
          <div className="flex gap-2">
            <span className="opacity-50 w-24 shrink-0">Runs:</span>
            <span className="text-xs opacity-70">
              Inside Dash — nothing to install
            </span>
          </div>
        ) : provider.mcpConfig.transport === "streamable_http" ? (
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
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 transition-opacity"
            >
              <FontAwesomeIcon icon="chevron-left" className="h-3 w-3" />
              Back
            </button>
          )}
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
                      className={`p-2 rounded transition-colors opacity-50 hover:opacity-100 ${statusTokens.error.icon} ${statusTokens.error.hoverBg}`}
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

  const classLabel = isWs
    ? "WebSocket"
    : isMcp
      ? "MCP server"
      : "API credentials";
  const STATUS_DOT = {
    needsSetup: statusTokens.warning.solidBg,
    connected: statusTokens.success.solidBg,
    ready: "bg-gray-500",
    problem: statusTokens.error.solidBg,
  };
  const statusDot = (status && STATUS_DOT[status.key]) || STATUS_DOT.ready;
  const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const wsById = (id) =>
    (workspaces || []).find((w) => String(w.id) === String(id)) || null;
  const resultBox = (result) =>
    result ? (
      <div
        className={`p-3 rounded-lg border text-sm ${
          result.success
            ? `${statusTokens.success.border} ${statusTokens.success.text}`
            : `${statusTokens.error.border} ${statusTokens.error.text}`
        }`}
      >
        <div className="flex items-center gap-2">
          <FontAwesomeIcon
            icon={result.success ? "circle-check" : "circle-exclamation"}
          />
          <span>{result.message}</span>
        </div>
      </div>
    ) : null;
  const row = (label, value) => (
    <div className="flex gap-3 text-sm">
      <span className={`w-24 shrink-0 ${muted}`}>{label}</span>
      {value}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 gap-5">
      {/* Header: name, type · class, status; actions */}
      <div className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className={`text-lg font-semibold truncate ${strong}`}>
            {providerName}
          </h3>
          <span className={`text-sm ${muted}`}>
            {provider.type ? `${provider.type} · ` : ""}
            {classLabel}
            {provider.isDefaultForType ? " · default for its type" : ""}
          </span>
          {status ? (
            <span className="flex flex-row flex-wrap items-center gap-1.5 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDot}`}
              />
              <span
                className={
                  status.key === "needsSetup"
                    ? statusTokens.warning.icon
                    : status.key === "problem"
                      ? statusTokens.error.icon
                      : ""
                }
              >
                {status.label}
              </span>
              {status.missing && status.missing.length ? (
                <span className={`text-xs ${muted}`}>
                  {`Missing: ${status.missing.join(", ")}`}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {isMcp && resolvedAuthCommand && (
            <Button3
              title={isAuthorizing ? "Authorizing..." : "Authorize"}
              onClick={handleAuthorize}
              size="sm"
            />
          )}
          {isMcp && (
            <Button3
              title={isTesting ? "Testing..." : "Test Connection"}
              onClick={handleTestConnection}
              size="sm"
            />
          )}
          {isWs && (
            <Button3
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
          <Button3
            title="Edit"
            onClick={() => onStartEdit(providerName, provider)}
            size="sm"
          />
          <Button3
            title="Delete"
            onClick={() => onDelete(providerName)}
            size="sm"
          />
        </div>
      </div>

      {/* Its open issue (issues PRD): it couldn't start, or its sign-in
          expired — the error, and Reconnect / Sign in. */}
      {status && status.key === "problem" ? (
        <AlertBanner
          variant="error"
          size="compact"
          title={status.label}
          message={status.detail || ""}
        >
          <span className="flex flex-col gap-2" data-testid="provider-health">
            {status.issue && status.issue.hint ? (
              <span>{status.issue.hint}</span>
            ) : null}
            {isMcp ? (
              <span className="flex flex-row flex-wrap items-center gap-2">
                {status.signIn &&
                signsInWithCommand(provider, resolvedAuthCommand) ? (
                  <Button
                    title={isAuthorizing ? "Signing in…" : "Sign in"}
                    size="sm"
                    onClick={handleAuthorize}
                  />
                ) : (
                  <Button
                    title={reconnectState.busy ? "Reconnecting…" : "Reconnect"}
                    size="sm"
                    disabled={reconnectState.busy}
                    onClick={async () => {
                      setReconnectState({ busy: true, note: "" });
                      const res = await reconnectProvider(
                        dashApi,
                        providerName,
                        provider,
                      );
                      setReconnectState({
                        busy: false,
                        note: res.ok
                          ? "It started again."
                          : `It didn't start: ${withoutProvidersPageTip(
                              res.message,
                            )}`,
                      });
                    }}
                  />
                )}
                {reconnectState.note ? (
                  <span role="status">{reconnectState.note}</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </AlertBanner>
      ) : null}

      {/* From a loaded profile (dash-profiles): where it came from, and a
          program it runs waits for the user's OK. */}
      {status && status.runApproval ? (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${hairline}`}
          data-testid="provider-run-approval"
        >
          <span className={strong}>
            {`"${providerName}" came with your profile${
              provider.fromProfile ? ` "${provider.fromProfile}"` : ""
            }. ${
              runsProgram
                ? "To connect, it runs this program on this Mac:"
                : "It connects to this address — the key you add is sent there:"
            }`}
          </span>
          <code
            className={`block rounded-md border px-3 py-2 font-mono text-xs break-all ${hairline}`}
          >
            {runsProgram
              ? [provider.mcpConfig.command, ...(provider.mcpConfig.args || [])]
                  .filter(Boolean)
                  .join(" ")
              : (provider.mcpConfig && provider.mcpConfig.url) || ""}
          </code>
          <span className={muted}>
            {`Only allow it if you know this profile — you made it, or someone you trust did. It won't ${
              runsProgram ? "run" : "connect"
            } until you do.`}
          </span>
          {onApproveRun ? (
            <span className="flex flex-row flex-wrap items-center gap-3">
              <Button
                title="Allow"
                size="sm"
                onClick={async () =>
                  setApproveError((await onApproveRun(providerName)) || null)
                }
              />
              {approveError ? <span role="alert">{approveError}</span> : null}
            </span>
          ) : null}
        </div>
      ) : status && status.fromProfile ? (
        <AlertBanner
          variant="warning"
          size="compact"
          message={
            status.label === "Sign in on this Mac"
              ? `Came with your profile "${status.fromProfile}". Sign-ins stay on the Mac they were made on — sign in here with Authorize.`
              : `Came with your profile "${status.fromProfile}" without its key — add it with Edit. Its other settings came along.`
          }
        />
      ) : null}

      {/* Default-for-type: any widget that needs this type and hasn't been
          bound explicitly uses this provider. Single winner per type —
          turning it on clears the flag on every sibling of the same type. */}
      {provider.type && onToggleDefaultForType && (
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!provider.isDefaultForType}
            onChange={(e) =>
              onToggleDefaultForType(providerName, provider, e.target.checked)
            }
            className="h-4 w-4"
          />
          <span>
            Use as default for{" "}
            <code
              className={`text-xs px-1.5 py-0.5 rounded border ${hairline}`}
            >
              {provider.type}
            </code>{" "}
            widgets
          </span>
        </label>
      )}

      {/* Used by */}
      {usage ? (
        <div data-testid="provider-used-by" className="flex flex-col gap-2">
          <div className="flex flex-row items-center justify-between gap-3">
            <SectionLabel text="Used by" />
            {onChooseWhereToUse && provider && provider.type ? (
              <Button3
                title="Choose where to use…"
                size="xs"
                onClick={() => onChooseWhereToUse(providerName)}
              />
            ) : null}
          </div>
          {usage.count ? (
            <div className="flex flex-col gap-1.5">
              {usage.dashboards.map((d) => {
                const ws = wsById(d.workspaceId);
                return (
                  <div
                    key={`d-${d.workspaceId}`}
                    className="flex flex-row items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-row items-center gap-2 min-w-0">
                      <FontAwesomeIcon icon="clone" className={muted} />
                      <span className="truncate">{d.workspaceName}</span>
                      <span className={`text-xs ${muted}`}>
                        {plural(d.widgets, "widget")}
                      </span>
                    </span>
                    {ws && onOpenWorkspace ? (
                      <Button3
                        title="Open"
                        size="xs"
                        onClick={() => onOpenWorkspace(ws)}
                      />
                    ) : null}
                  </div>
                );
              })}
              {usage.bots.map((b) => {
                const ws = b.workspaceId ? wsById(b.workspaceId) : null;
                return (
                  <div
                    key={`b-${b.id}`}
                    className="flex flex-row items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-row items-center gap-2 min-w-0">
                      <FontAwesomeIcon icon="robot" className={muted} />
                      <span className="truncate">{b.name}</span>
                      <span className={`text-xs ${muted}`}>
                        {ws ? ws.name : "Unassigned"}
                      </span>
                    </span>
                    {ws && onOpenBotInBotsView ? (
                      <Button3
                        title="Open in Bots view"
                        size="xs"
                        onClick={() => onOpenBotInBotsView(ws, b.id)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className={`text-sm ${muted}`}>
              No dashboards or bots use it yet.
            </span>
          )}
        </div>
      ) : null}

      {/* MCP: server configuration, then connection & tools */}
      {isMcp && provider.mcpConfig && (
        <>
          <div className="flex flex-col gap-2">
            <SectionLabel text="Server configuration" />
            {row(
              "Transport",
              <span>
                {isBuiltinMcpConfig(provider.mcpConfig)
                  ? "Built into Dash"
                  : provider.mcpConfig.transport === "streamable_http"
                    ? "Streamable HTTP"
                    : "stdio"}
              </span>,
            )}
            {isBuiltinMcpConfig(provider.mcpConfig) ? (
              row(
                "Runs",
                <span className={`text-xs ${muted}`}>
                  Inside Dash — nothing to install
                </span>,
              )
            ) : provider.mcpConfig.transport === "streamable_http" ? (
              row(
                "Endpoint",
                <span className={`text-xs ${muted}`}>
                  Remote hosted server
                </span>,
              )
            ) : (
              <>
                {row(
                  "Command",
                  <code
                    className={`text-xs px-2 py-0.5 rounded border break-all ${hairline}`}
                  >
                    {provider.mcpConfig.command}{" "}
                    {(provider.mcpConfig.args || []).join(" ")}
                  </code>,
                )}
                {provider.mcpConfig.envMapping &&
                  Object.keys(provider.mcpConfig.envMapping).length > 0 &&
                  row(
                    "Env vars",
                    <span className="text-xs">
                      {Object.keys(provider.mcpConfig.envMapping).join(", ")}
                    </span>,
                  )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <SectionLabel text="Connection & tools" />
            {resultBox(authResult)}
            {resultBox(testResult)}

            {/* Tool selection after a successful test */}
            {testResult?.success &&
              testResult.tools?.length > 0 &&
              selectedTools && (
                <ToolSelector
                  tools={testResult.tools}
                  selectedTools={selectedTools}
                  onSelectionChange={setSelectedTools}
                />
              )}

            {/* Allowed tools (read-only until a test) */}
            {!testResult &&
              provider?.allowedTools &&
              provider.allowedTools.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {provider.allowedTools.map((tool) => (
                      <span
                        key={tool}
                        className={`text-xs font-mono px-2 py-0.5 rounded border ${hairline} ${muted}`}
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                  <p className={`text-xs ${muted}`}>
                    {provider.allowedTools.length} tool
                    {provider.allowedTools.length !== 1 ? "s" : ""} allowed —
                    test connection to modify
                  </p>
                </div>
              )}

            {!testResult &&
              (!provider?.allowedTools ||
                provider.allowedTools.length === 0) && (
                <p className={`text-sm ${muted}`}>
                  No tools configured — use Test Connection to discover
                  available tools.
                </p>
              )}
          </div>
        </>
      )}

      {/* WebSocket: connection */}
      {isWs && provider.wsConfig && (
        <div className="flex flex-col gap-2">
          <SectionLabel text="Connection" />
          {row(
            "URL",
            <code
              className={`text-xs px-2 py-0.5 rounded border break-all ${hairline}`}
            >
              {provider.wsConfig.url}
            </code>,
          )}
          {provider.wsConfig.headers &&
            Object.keys(provider.wsConfig.headers).length > 0 &&
            row(
              "Headers",
              <span className="text-xs">
                {Object.keys(provider.wsConfig.headers).join(", ")}
              </span>,
            )}
          {provider.wsConfig.subprotocols &&
            provider.wsConfig.subprotocols.length > 0 &&
            row(
              "Subprotocols",
              <span className="text-xs">
                {provider.wsConfig.subprotocols.join(", ")}
              </span>,
            )}
          {resultBox(wsTestResult)}
        </div>
      )}
    </div>
  );
};
