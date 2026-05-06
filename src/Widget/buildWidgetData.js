/**
 * buildWidgetData
 *
 * Pure helper extracted from WidgetFactory's render path. Builds the
 * `widgetData` object that flows through WidgetContext to every hook
 * (useMcpProvider, useWebSocketProvider, useNotifications, ...).
 *
 * Why `name` is set explicitly: layout-tree nodes (workspaces.json) carry
 * `component`/`componentName`/`uuid` but no `name`. The MCP gate's
 * runtime identity comes from `widgetData.name`; without it the gate hits
 * the legacy `widgetId === null` bypass and silently allows every call.
 * Defaulting to `component` keeps the gate firing for ordinary widgets.
 */
export function buildWidgetData({ params, component, config, uuidString }) {
  return {
    ...params,
    name: params?.name ?? component,
    uuidString,
    providers: config?.providers || [],
    notifications: config?.notifications || [],
  };
}
