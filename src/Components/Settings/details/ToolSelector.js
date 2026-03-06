import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

/**
 * ToolSelector — checkbox list for selecting which MCP tools are allowed.
 *
 * @param {Array} tools - Array of { name, description } tool objects
 * @param {string[]} selectedTools - Currently selected tool names
 * @param {Function} onSelectionChange - Callback with updated selectedTools array
 */
export const ToolSelector = ({
  tools = [],
  selectedTools = [],
  onSelectionChange,
}) => {
  if (!tools || tools.length === 0) return null;

  const allSelected = selectedTools.length === tools.length;

  const handleToggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(tools.map((t) => t.name));
    }
  };

  const handleToggle = (toolName) => {
    if (selectedTools.includes(toolName)) {
      onSelectionChange(selectedTools.filter((t) => t !== toolName));
    } else {
      onSelectionChange([...selectedTools, toolName]);
    }
  };

  return (
    <div className="space-y-2 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
          Allowed Tools
        </p>
        <button
          onClick={handleToggleAll}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
      </div>
      <p className="text-sm opacity-50">
        Choose which tools this provider can expose to widgets
      </p>
      <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
        {tools.map((tool) => {
          const checked = selectedTools.includes(tool.name);
          return (
            <label
              key={tool.name}
              className="flex items-start gap-2 p-1.5 rounded hover:bg-white/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(tool.name)}
                className="mt-0.5 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/30"
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono">{tool.name}</span>
                {tool.description && (
                  <span className="text-xs opacity-50 ml-2">
                    — {tool.description}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
      <p className="text-xs opacity-40">
        <FontAwesomeIcon icon="shield-halved" className="mr-1" />
        {selectedTools.length} of {tools.length} tools selected
      </p>
    </div>
  );
};
