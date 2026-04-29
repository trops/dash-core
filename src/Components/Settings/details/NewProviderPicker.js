import React, { useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

const OptionCard = ({ icon, title, description, onClick, currentTheme }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex flex-row items-center gap-4 p-4 rounded-lg text-left transition-opacity ${
      currentTheme["bg-primary-medium"] || "bg-white/5"
    } hover:opacity-80`}
  >
    <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center opacity-60">
      <FontAwesomeIcon icon={icon} className="h-5 w-5" />
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs opacity-50 mt-0.5">{description}</span>
    </div>
    <div className="flex-shrink-0 ml-auto opacity-30">
      <FontAwesomeIcon icon="chevron-right" className="h-3 w-3" />
    </div>
  </button>
);

/**
 * NewProviderPicker — the 3-option chooser shown when the user clicks
 * "+ New Provider" from the Settings → Providers header without a
 * specific class pre-selected. Mirrors InstallWidgetPicker's pattern
 * so the UI feels consistent across "+ New ..." entry points in
 * Settings.
 *
 * Calls `onSelect(class)` with the literal class string ("credential",
 * "mcp", or "websocket"). The parent (ProvidersSection) then routes
 * to the appropriate create flow:
 *
 *   credential → ProviderDetail (credential create form)
 *   mcp        → McpCatalogDetail (catalog browser)
 *   websocket  → WsProviderDetail (WebSocket add form)
 *
 * The Widget Builder's existing deep-link path (which always passes
 * an explicit class) bypasses this chooser and goes straight to the
 * matching form.
 */
export const NewProviderPicker = ({ onSelect }) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`flex-1 overflow-y-auto p-6 space-y-3 ${
          panelStyles.textColor || "text-gray-200"
        }`}
      >
        <span className="text-xs font-semibold opacity-50 block mb-4">
          ADD A NEW PROVIDER
        </span>
        <OptionCard
          icon="key"
          title="Credential"
          description="API key or token credentials for services like Algolia, Anthropic, or any HTTP API"
          onClick={() => onSelect("credential")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="plug"
          title="MCP"
          description="Model Context Protocol server — pick from a curated catalog (Slack, Filesystem, Notion, etc.)"
          onClick={() => onSelect("mcp")}
          currentTheme={currentTheme}
        />
        <OptionCard
          icon="diagram-project"
          title="WebSocket"
          description="Real-time WebSocket connection to a streaming endpoint"
          onClick={() => onSelect("websocket")}
          currentTheme={currentTheme}
        />
      </div>
    </div>
  );
};
