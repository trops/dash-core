/**
 * MountTokenWrapper
 *
 * Owns the per-widget mount-token lifecycle. On mount, calls
 * `framework.registerMount(widgetId)` and stores the resulting token;
 * on unmount, calls `framework.unregisterMount(token)`. Provides a
 * per-mount bound API (via `makeBoundApi`) through `WidgetContext`.
 *
 * WidgetFactory wraps every widget render in this so widgets receive
 * a token-bound api automatically — the widget developer doesn't have
 * to (and can't) write the widgetId or token into their gated calls.
 *
 * The token registration is async (one IPC round-trip). During that
 * brief window the bound api is null and the widget renders with
 * `widgetData` only; gated calls in the first paint will fall through
 * to `window.mainApi.*` directly which the gates now deny — that's
 * fine, it's a no-op grace period.
 */
import React, { useEffect, useState } from "react";
import { WidgetContext } from "../Context/WidgetContext";
import { makeBoundApi } from "../Api/makeBoundApi";

export const MountTokenWrapper = ({ widgetId, widgetData, children }) => {
  const [token, setToken] = useState(null);

  useEffect(() => {
    if (!widgetId || !window?.mainApi?.framework?.registerMount) {
      // Either no widget identity or the framework bridge isn't
      // exposed (e.g. running outside Electron). Skip registration —
      // the widget will render without a bound api and gated calls
      // will be denied by the runtime gate (correct behavior).
      return;
    }

    let cancelled = false;
    let myToken = null;

    (async () => {
      try {
        myToken = await window.mainApi.framework.registerMount(widgetId);
      } catch (e) {
        // Non-fatal — register-mount IPC failed. Widget renders
        // without a bound api; gated calls will be denied.
        console.warn(
          `[MountTokenWrapper] registerMount(${widgetId}) failed:`,
          e?.message || e,
        );
        return;
      }
      if (cancelled) {
        // The component unmounted before our async callback fired.
        // Clean up the token we just registered.
        if (myToken && window.mainApi?.framework?.unregisterMount) {
          try {
            window.mainApi.framework.unregisterMount(myToken);
          } catch (_) {
            /* ignore — best-effort */
          }
        }
        return;
      }
      setToken(myToken);
    })();

    return () => {
      cancelled = true;
      if (myToken && window.mainApi?.framework?.unregisterMount) {
        try {
          window.mainApi.framework.unregisterMount(myToken);
        } catch (_) {
          /* ignore — unmount cleanup is best-effort */
        }
      }
    };
  }, [widgetId]);

  // Build the per-mount bound API only when we actually have a token.
  // Re-memoizing on token change keeps the proxy stable across renders.
  const api = React.useMemo(
    () => (token ? makeBoundApi(window.mainApi, token) : null),
    [token],
  );

  const contextValue = React.useMemo(
    () => ({ widgetData, api }),
    [widgetData, api],
  );

  return (
    <WidgetContext.Provider value={contextValue}>
      {children}
    </WidgetContext.Provider>
  );
};

export default MountTokenWrapper;
