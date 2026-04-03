import React, { useContext, useEffect, useState, useCallback } from "react";
import {
  Switch,
  SubHeading3,
  Button,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

const BACKENDS = [
  { value: "claude-code", label: "Claude Code CLI" },
  { value: "anthropic", label: "Anthropic API" },
];

export const AiAssistantSection = () => {
  const appContext = useContext(AppContext);
  const settings = appContext?.settings || {};
  const providers = appContext?.providers || {};
  const refreshProviders = appContext?.refreshProviders;
  const dashApi = appContext?.dashApi;
  const credentials = appContext?.credentials;

  // AI Assistant settings from app settings
  const aiSettings = settings.aiAssistant || {};

  const [cliStatus, setCliStatus] = useState(null); // null=checking, {available,path}
  const [preferredBackend, setPreferredBackend] = useState(
    aiSettings.preferredBackend || "claude-code",
  );
  const [selectedModel, setSelectedModel] = useState(
    aiSettings.model || "claude-sonnet-4-20250514",
  );
  const [apiKey, setApiKey] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [saveKeyStatus, setSaveKeyStatus] = useState(null);

  // Find existing Anthropic provider
  const anthropicProvider = Object.entries(providers).find(
    ([, p]) =>
      p.type === "anthropic" &&
      (p.providerClass || "credential") === "credential",
  );
  const hasAnthropicProvider = !!anthropicProvider;
  const anthropicProviderName = anthropicProvider?.[0];

  // Check CLI availability on mount
  useEffect(() => {
    if (window.mainApi?.llm?.checkCliAvailable) {
      window.mainApi.llm
        .checkCliAvailable()
        .then((result) => setCliStatus(result || { available: false }))
        .catch(() => setCliStatus({ available: false }));
    } else {
      setCliStatus({ available: false });
    }
  }, []);

  // Save AI settings to app settings
  const saveAiSettings = useCallback(
    (updates) => {
      if (appContext?.changeSettings) {
        const current = appContext.settings || {};
        const newAiSettings = {
          ...(current.aiAssistant || {}),
          ...updates,
        };
        appContext.changeSettings({
          ...current,
          aiAssistant: newAiSettings,
        });
      }
    },
    [appContext],
  );

  function handleBackendChange(e) {
    const value = e.target.value;
    setPreferredBackend(value);
    saveAiSettings({ preferredBackend: value });
  }

  function handleModelChange(e) {
    const value = e.target.value;
    setSelectedModel(value);
    saveAiSettings({ model: value });
  }

  function handleSaveApiKey() {
    if (!apiKey.trim() || !dashApi || !credentials) return;
    setIsSavingKey(true);
    setSaveKeyStatus(null);

    const providerName = anthropicProviderName || "Anthropic (AI Assistant)";
    dashApi.saveProvider(
      credentials.appId,
      providerName,
      {
        providerType: "anthropic",
        credentials: { apiKey: apiKey.trim() },
      },
      () => {
        setIsSavingKey(false);
        setSaveKeyStatus("saved");
        setApiKey("");
        if (refreshProviders) refreshProviders();
        // Auto-select anthropic backend when key is added
        if (!hasAnthropicProvider) {
          setPreferredBackend("anthropic");
          saveAiSettings({
            preferredBackend: "anthropic",
            anthropicProvider: providerName,
          });
        }
      },
      (e, err) => {
        setIsSavingKey(false);
        setSaveKeyStatus("error");
        console.error("[AiAssistantSection] Save provider error:", err);
      },
    );
  }

  // Determine effective backend (what will actually be used)
  const effectiveBackend =
    preferredBackend === "claude-code" && cliStatus?.available
      ? "claude-code"
      : preferredBackend === "anthropic" && hasAnthropicProvider
        ? "anthropic"
        : cliStatus?.available
          ? "claude-code"
          : hasAnthropicProvider
            ? "anthropic"
            : null;

  return (
    <div className="flex flex-col space-y-6">
      {/* Status Overview */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Connection Status" padding={false} />
        <div className="flex flex-col gap-3">
          {/* CLI Status */}
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={`h-2.5 w-2.5 rounded-full ${cliStatus?.available ? "bg-green-400" : cliStatus === null ? "bg-yellow-400 animate-pulse" : "bg-gray-500"}`}
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">Claude Code CLI</span>
                <span className="text-xs opacity-50">
                  {cliStatus === null
                    ? "Checking..."
                    : cliStatus.available
                      ? `Available at ${cliStatus.path || "claude"}`
                      : "Not installed"}
                </span>
              </div>
            </div>
            {cliStatus && !cliStatus.available && (
              <a
                href="https://docs.anthropic.com/en/docs/claude-code/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Install Guide
              </a>
            )}
          </div>

          {/* Anthropic API Status */}
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={`h-2.5 w-2.5 rounded-full ${hasAnthropicProvider ? "bg-green-400" : "bg-gray-500"}`}
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">Anthropic API</span>
                <span className="text-xs opacity-50">
                  {hasAnthropicProvider
                    ? `Connected via "${anthropicProviderName}"`
                    : "No API key configured"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Overall readiness */}
        {effectiveBackend ? (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <FontAwesomeIcon icon="check-circle" className="h-3.5 w-3.5" />
            <span>
              AI Assistant ready via{" "}
              {effectiveBackend === "claude-code"
                ? "Claude Code CLI"
                : "Anthropic API"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <FontAwesomeIcon
              icon="exclamation-triangle"
              className="h-3.5 w-3.5"
            />
            <span>
              Install Claude Code CLI or add an Anthropic API key to enable the
              AI Assistant
            </span>
          </div>
        )}
      </div>

      {/* Preferred Backend */}
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Preferred Backend" padding={false} />
        <div className="flex flex-row items-center justify-between py-1">
          <div className="flex flex-col">
            <span className="text-sm font-medium">LLM Backend</span>
            <span className="text-xs opacity-50">
              Which service to use for AI features
            </span>
          </div>
          <select
            value={preferredBackend}
            onChange={handleBackendChange}
            className="bg-white/10 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {BACKENDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
                {b.value === "claude-code" && !cliStatus?.available
                  ? " (not available)"
                  : ""}
                {b.value === "anthropic" && !hasAnthropicProvider
                  ? " (no key)"
                  : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-row items-center justify-between py-1">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Model</span>
            <span className="text-xs opacity-50">
              Claude model for AI Assistant conversations
            </span>
          </div>
          <select
            value={selectedModel}
            onChange={handleModelChange}
            className="bg-white/10 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* API Key Setup (only if no Anthropic provider exists) */}
      {!hasAnthropicProvider && (
        <div className="flex flex-col space-y-3">
          <SubHeading3 title="Anthropic API Key" padding={false} />
          <div className="flex flex-col gap-2">
            <span className="text-xs opacity-50">
              Enter your Anthropic API key to use the Anthropic backend. The key
              will be stored securely and encrypted.
            </span>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaveKeyStatus(null);
                }}
                placeholder="sk-ant-..."
                className="flex-1 bg-white/10 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Button
                title={isSavingKey ? "Saving..." : "Save"}
                onClick={handleSaveApiKey}
                disabled={!apiKey.trim() || isSavingKey}
              />
            </div>
            {saveKeyStatus === "saved" && (
              <span className="text-xs text-green-400">
                API key saved and encrypted.
              </span>
            )}
            {saveKeyStatus === "error" && (
              <span className="text-xs text-red-400">
                Failed to save API key. Check the console for details.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Info about existing provider */}
      {hasAnthropicProvider && (
        <div className="flex flex-col space-y-3">
          <SubHeading3 title="Anthropic API Key" padding={false} />
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                Using provider: {anthropicProviderName}
              </span>
              <span className="text-xs opacity-50">
                Manage this provider in Settings &gt; Providers
              </span>
            </div>
            <FontAwesomeIcon
              icon="check-circle"
              className="h-4 w-4 text-green-400"
            />
          </div>
        </div>
      )}
    </div>
  );
};
