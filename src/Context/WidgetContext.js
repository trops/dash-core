import { createContext } from "react";

/**
 * WidgetContext
 *
 * Per-widget React context. WidgetFactory builds the value at mount
 * time and re-builds when the widget unmounts/remounts.
 *
 * Shape:
 *   - widgetData: the widget's instance data (uuid, params, providers,
 *     notifications, etc.) — read by hooks like useMcpProvider,
 *     useScheduler, useNotifications.
 *   - api: a per-mount proxy of `window.mainApi` produced by
 *     `makeBoundApi(window.mainApi, mountToken)`. Every gated method
 *     on this proxy auto-injects the mount token; widgets that use
 *     `props.api.data.saveData(...)` get gated automatically. Null
 *     during the brief window before the framework's mount-token IPC
 *     resolves; consumers should fall back to `window.mainApi` only
 *     for explicitly non-gated reads.
 */
export const WidgetContext = createContext({
  widgetData: null,
  api: null,
});
