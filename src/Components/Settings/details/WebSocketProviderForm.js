import React, { useState, useRef } from "react";
import {
  Button,
  InputText,
  SubHeading3,
  FontAwesomeIcon,
} from "@trops/dash-react";

/**
 * Validate that a URL starts with ws:// or wss://
 */
function isValidWsUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

/**
 * Check if a URL is targeting localhost
 */
function isLocalhostUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1" ||
      u.hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Check if credentials are present in headers or URL template
 */
function hasCredentials(url, headerRows) {
  const hasUrlCreds = url && /\{\{.+?\}\}/.test(url);
  const hasHeaderCreds = headerRows.some(
    (r) => r.value && /\{\{.+?\}\}/.test(r.value),
  );
  return hasUrlCreds || hasHeaderCreds;
}

/**
 * Extract credential field names from URL and header templates
 * e.g., wss://api.example.com?token={{apiKey}} → ["apiKey"]
 */
function extractCredentialFields(url, headerRows) {
  const fields = new Set();
  const pattern = /\{\{(.+?)\}\}/g;

  if (url) {
    let match;
    while ((match = pattern.exec(url)) !== null) {
      fields.add(match[1]);
    }
  }

  for (const row of headerRows) {
    if (row.value) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(row.value)) !== null) {
        fields.add(match[1]);
      }
    }
  }

  return Array.from(fields);
}

/**
 * WebSocketProviderForm
 *
 * Form for creating or editing WebSocket providers.
 * Matches existing Settings UI patterns (ProviderDetail, CustomMcpServerForm).
 *
 * @param {Object} props
 * @param {boolean} props.isEditMode - Whether editing an existing provider
 * @param {string} props.initialName - Provider name (edit mode)
 * @param {string} props.initialUrl - WebSocket URL (edit mode)
 * @param {Array} props.initialHeaderRows - Header key-value rows (edit mode)
 * @param {Array} props.initialSubprotocols - Subprotocol strings (edit mode)
 * @param {Object} props.initialCredentials - Credential values (edit mode)
 * @param {Function} props.onSave - (name, wsConfig, credentials) => void
 * @param {Function} props.onCancel - Cancel handler
 */
export const WebSocketProviderForm = ({
  isEditMode = false,
  initialName = "",
  initialUrl = "",
  initialHeaderRows = [],
  initialSubprotocols = [],
  initialCredentials = {},
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [headerRows, setHeaderRows] = useState(
    initialHeaderRows.length > 0 ? initialHeaderRows : [],
  );
  const [subprotocols, setSubprotocols] = useState(
    initialSubprotocols.join(", "),
  );
  const [credentials, setCredentials] = useState(initialCredentials);
  const [errors, setErrors] = useState({});

  const nextRowIdRef = useRef(0);
  const nextRowId = () => `ws_hdr_${++nextRowIdRef.current}`;

  // Derived state
  const credentialFields = extractCredentialFields(url, headerRows);
  const hasCreds = hasCredentials(url, headerRows);
  const isWs = url.startsWith("ws://");
  const isLocalhost = isLocalhostUrl(url);
  const showSecurityWarning = hasCreds && isWs && !isLocalhost;

  function validate() {
    const errs = {};
    if (!name.trim()) errs.name = "Provider name is required";
    if (!url.trim()) errs.url = "WebSocket URL is required";
    else if (!isValidWsUrl(url))
      errs.url = "URL must start with ws:// or wss://";

    // Check required credential fields are filled
    for (const field of credentialFields) {
      if (!credentials[field]?.trim()) {
        errs[`cred_${field}`] = `${field} is required`;
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSave() {
    if (!validate()) return;

    // Build headers object from rows
    const headers = {};
    for (const row of headerRows) {
      if (row.key.trim()) {
        headers[row.key.trim()] = row.value;
      }
    }

    // Parse subprotocols
    const subprotoArray = subprotocols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const wsConfig = {
      url: url.trim(),
      headers: Object.keys(headers).length > 0 ? headers : null,
      subprotocols: subprotoArray.length > 0 ? subprotoArray : null,
    };

    onSave(name.trim(), wsConfig, credentials);
  }

  function handleAddHeader() {
    setHeaderRows((prev) => [...prev, { id: nextRowId(), key: "", value: "" }]);
  }

  function handleRemoveHeader(id) {
    setHeaderRows((prev) => prev.filter((r) => r.id !== id));
  }

  function handleHeaderChange(id, field, value) {
    setHeaderRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
        <SubHeading3
          title={
            isEditMode ? "Edit WebSocket Provider" : "New WebSocket Provider"
          }
          padding={false}
        />

        {/* Provider Name */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-400">
            Provider Name
          </label>
          <InputText
            value={name}
            onChange={(value) => setName(value)}
            placeholder="e.g., crypto-ws, stock-feed"
            error={!!errors.name}
          />
          {errors.name && (
            <span className="text-xs text-red-400">{errors.name}</span>
          )}
        </div>

        {/* WebSocket URL */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-400">
            WebSocket URL
          </label>
          <InputText
            value={url}
            onChange={(value) => setUrl(value)}
            placeholder="wss://api.example.com/ws or ws://localhost:8080"
            error={!!errors.url}
          />
          {errors.url && (
            <span className="text-xs text-red-400">{errors.url}</span>
          )}
          <p className="text-xs opacity-40">
            Use {"{{fieldName}}"} for credential interpolation (e.g.,
            wss://api.example.com?token={"{{apiKey}}"})
          </p>
        </div>

        {/* Security Warning */}
        {showSecurityWarning && (
          <div className="p-3 rounded-lg text-sm bg-yellow-900/30 border border-yellow-700 text-yellow-300">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon="triangle-exclamation" />
              <span>
                Credentials detected over unencrypted ws:// connection. Use
                wss:// for non-localhost URLs to protect your credentials.
              </span>
            </div>
          </div>
        )}

        {/* Headers Section */}
        <div className="border-t border-white/10 pt-4">
          <p className="text-xs font-semibold opacity-40 uppercase tracking-wider mb-3">
            Headers <span className="normal-case font-normal">(optional)</span>
          </p>

          {headerRows.map((row) => (
            <div key={row.id} className="flex items-center gap-2 mb-2">
              <div className="flex-1">
                <InputText
                  value={row.key}
                  onChange={(value) => handleHeaderChange(row.id, "key", value)}
                  placeholder="Header name"
                />
              </div>
              <div className="flex-1">
                <InputText
                  value={row.value}
                  onChange={(value) =>
                    handleHeaderChange(row.id, "value", value)
                  }
                  placeholder="Header value"
                />
              </div>
              <button
                onClick={() => handleRemoveHeader(row.id)}
                className="p-2 rounded hover:bg-red-500/20 transition-colors opacity-50 hover:opacity-100 text-red-400"
                title="Remove header"
              >
                <FontAwesomeIcon icon="trash" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <button
            onClick={handleAddHeader}
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            <FontAwesomeIcon icon="plus" className="h-3 w-3" />
            Add Header
          </button>
        </div>

        {/* Subprotocols */}
        <div className="border-t border-white/10 pt-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-400">
              Subprotocols{" "}
              <span className="font-normal opacity-50">(optional)</span>
            </label>
            <InputText
              value={subprotocols}
              onChange={(value) => setSubprotocols(value)}
              placeholder="Comma-separated, e.g., graphql-ws, json"
            />
          </div>
        </div>

        {/* Credential Fields (auto-derived from URL/header templates) */}
        {credentialFields.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <p className="text-xs font-semibold opacity-40 uppercase tracking-wider mb-3">
              Credentials
            </p>
            <p className="text-xs opacity-40 mb-3">
              These fields were detected from {"{{...}}"} placeholders in the
              URL and headers.
            </p>

            {credentialFields.map((field) => (
              <div key={field} className="flex flex-col gap-2 mb-3">
                <label className="text-sm font-medium text-gray-400">
                  {field}
                </label>
                <InputText
                  type="password"
                  value={credentials[field] || ""}
                  onChange={(value) =>
                    setCredentials((prev) => ({
                      ...prev,
                      [field]: value,
                    }))
                  }
                  placeholder={`Enter ${field}`}
                  error={!!errors[`cred_${field}`]}
                />
                {errors[`cred_${field}`] && (
                  <span className="text-xs text-red-400">
                    {errors[`cred_${field}`]}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex flex-row justify-end gap-2 px-6 py-4 border-t border-white/10">
        <Button title="Cancel" onClick={onCancel} size="sm" />
        <Button
          title={isEditMode ? "Save" : "Create"}
          onClick={handleSave}
          size="sm"
        />
      </div>
    </div>
  );
};
