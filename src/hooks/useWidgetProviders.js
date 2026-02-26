import { useContext } from "react";
import { AppContext } from "../Context/App/AppContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";
import { WidgetContext } from "../Context/WidgetContext";

/**
 * useWidgetProviders Hook
 *
 * Convenience hook for widgets to access only their selected providers with credentials.
 * This is simpler than useDashboard(widgetId) because it automatically determines the widget ID.
 *
 * Matches the provider resolution pattern used by useMcpProvider:
 * 1. Widget-level: widgetData.selectedProviders[providerType] (set by handleSelectProvider on the layout item)
 * 2. Workspace-level fallback: workspace.workspaceData.selectedProviders[widgetId][providerType]
 *
 * Reads provider data from AppContext.providers (not DashboardContext.providers, which has a
 * structural issue where providers don't flow through from AppWrapper).
 *
 * @returns {Object} Object containing:
 *   - providers: {
 *       "algolia": { name, type, credentials },
 *       "slack": { name, type, credentials },
 *       ...
 *     }
 *   - hasProvider(type): Boolean - Check if a provider type is available
 *   - getProvider(type): Provider object or null
 *
 * @example
 * function MyWidget() {
 *   const { providers, hasProvider, getProvider } = useWidgetProviders();
 *
 *   if (!hasProvider("algolia")) {
 *     return <p>Algolia provider not configured</p>;
 *   }
 *
 *   const algolia = getProvider("algolia");
 *   const { appId, apiKey } = algolia.credentials;
 *   // Initialize Algolia client...
 * }
 */
export const useWidgetProviders = () => {
  const app = useContext(AppContext);
  const workspace = useContext(WorkspaceContext);
  const widgetContext = useContext(WidgetContext);

  const widgetData = widgetContext?.widgetData;
  const widgetId = widgetData?.uuidString;

  // Get all provider type declarations from the widget config
  const providerDeclarations = widgetData?.providers || [];

  // Resolve each declared provider using the same two-layer lookup as useMcpProvider:
  // 1. Widget-level: stored directly on the layout item by handleSelectProvider
  // 2. Workspace-level: stored as workspace.selectedProviders[widgetId][providerType]
  const providers = {};
  for (const decl of providerDeclarations) {
    const providerType = decl.type;

    // 1. Widget-level (set by handleSelectProvider on the layout item)
    let providerName = widgetData?.selectedProviders?.[providerType] || null;

    // 2. Workspace-level fallback
    if (!providerName && widgetId) {
      providerName =
        workspace?.workspaceData?.selectedProviders?.[widgetId]?.[
          providerType
        ] || null;
    }

    // Look up from AppContext.providers (not DashboardContext)
    if (providerName) {
      const provider = app?.providers?.[providerName];
      if (provider) {
        providers[providerType] = provider;
      }
    }
  }

  return {
    providers,
    hasProvider: (type) => type in providers,
    getProvider: (type) => providers[type] || null,
  };
};
