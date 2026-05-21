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
 * 3. App-default fallback: any provider of matching type flagged `isDefaultForType` in AppContext.providers
 *    (managed via Settings → Providers "Use as default…" toggle)
 * 4. null — widget surfaces its own "no provider" empty state
 *
 * Existing widgets/workspaces retain their explicit bindings; the default layer only
 * activates for widgets with no explicit binding (mirrors useMcpProvider exactly).
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
  // Identity-key fallback chain matches the bulk-save canonical
  // chain (`item.uuidString || item.uuid || item.id`). Without the
  // fallback, widgets that lack `uuidString` (older / AI-built
  // instances) silently miss workspace-level bindings written by
  // the dashboard config bulk edit modal.
  const widgetId = widgetData?.uuidString || widgetData?.uuid || widgetData?.id;

  // Get all provider type declarations from the widget config
  const providerDeclarations = widgetData?.providers || [];

  // Resolve each declared provider using the same three-layer lookup as useMcpProvider:
  // 1. Widget-level: stored directly on the layout item by handleSelectProvider
  // 2. Workspace-level: stored as workspace.selectedProviders[widgetId][providerType]
  // 3. App-default:    any provider in AppContext.providers flagged isDefaultForType
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

    // 3. App-default fallback — only kicks in for widgets with no explicit
    //    per-widget or per-workspace binding. Walking the map is O(N)
    //    in the provider count, which is small (typically <20 even for
    //    heavy users); the cost is bounded and the lookup runs once per
    //    declared provider type per render.
    if (!providerName && app?.providers && typeof app.providers === "object") {
      for (const [name, data] of Object.entries(app.providers)) {
        if (data?.type === providerType && data?.isDefaultForType === true) {
          providerName = name;
          break;
        }
      }
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
