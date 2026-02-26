import React, { useState, useRef } from "react";
import { FontAwesomeIcon, InputText, FormLabel } from "@trops/dash-react";

/**
 * AdvancedMcpConfig
 *
 * Collapsible "Advanced Configuration" section for catalog MCP providers.
 * Allows users to add/remove env var mappings (stdio) or headers (HTTP)
 * beyond what the catalog defines by default.
 *
 * @param {"stdio"|"streamable_http"} transport - The MCP transport type
 * @param {Array} envMappingRows - Row state for stdio env var mappings
 * @param {Function} onEnvMappingRowsChange - Setter for envMappingRows
 * @param {Array} headerRows - Row state for HTTP header mappings
 * @param {Function} onHeaderRowsChange - Setter for headerRows
 */
export const AdvancedMcpConfig = ({
  transport,
  envMappingRows,
  onEnvMappingRowsChange,
  headerRows,
  onHeaderRowsChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const rowIdRef = useRef(0);
  const nextRowId = () => `adv_${++rowIdRef.current}`;

  // --- env mapping row handlers ---
  const addEnvRow = () => {
    onEnvMappingRowsChange((prev) => [
      ...prev,
      { id: nextRowId(), envVar: "", credField: "" },
    ]);
  };

  const updateEnvRow = (id, field, value) => {
    onEnvMappingRowsChange((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeEnvRow = (id) => {
    onEnvMappingRowsChange((prev) => prev.filter((row) => row.id !== id));
  };

  // --- header row handlers ---
  const addHeaderRow = () => {
    onHeaderRowsChange((prev) => [
      ...prev,
      { id: nextRowId(), headerName: "", headerValue: "" },
    ]);
  };

  const updateHeaderRow = (id, field, value) => {
    onHeaderRowsChange((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeHeaderRow = (id) => {
    onHeaderRowsChange((prev) => prev.filter((row) => row.id !== id));
  };

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors"
      >
        <FontAwesomeIcon
          icon={isExpanded ? "chevron-down" : "chevron-right"}
          className="text-xs opacity-50"
        />
        <span className="font-semibold opacity-70">Advanced Configuration</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {transport === "streamable_http" ? (
            // HTTP headers
            <>
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
                  <span className="opacity-30 text-sm shrink-0">:</span>
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
                    <FontAwesomeIcon icon="times" className="text-sm" />
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
            </>
          ) : (
            // stdio env var mapping
            <>
              <div>
                <FormLabel label="Environment Variable Mapping" />
                <p className="text-sm opacity-50 mt-1">
                  Map environment variables to credential fields
                </p>
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
                  <span className="opacity-30 text-sm shrink-0">&rarr;</span>
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
                    <FontAwesomeIcon icon="times" className="text-sm" />
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
            </>
          )}
        </div>
      )}
    </div>
  );
};
