import { useState, useEffect } from "react";

/**
 * useWidgetRegistryVersion
 *
 * Returns a counter that increments every time the
 * `dash:widgets-updated` window event fires. Components that derive
 * lists from `ComponentManager.componentMap()` should pass the
 * returned value into their `useMemo` / `useEffect` deps so they
 * re-run when widgets are installed, updated, or uninstalled.
 *
 * Background: `componentMap()` returns a plain JS object held at
 * module scope. React doesn't observe it. Without a counter that
 * consumers can include in deps, every list (widget sidebar,
 * Settings → Widgets, Add Widget dropdown, Dependencies tab, etc.)
 * stays frozen at whatever it derived on first render even after
 * a new package installs and re-registers configs.
 *
 * The producer side is the single dispatch in dash-electron's
 * `Dash.js#handleWidgetInstalled` (and the `handleWidgetsLoaded`
 * + `handleWidgetUninstalled` siblings). That fires
 * `dash:widgets-updated` once per registry mutation; this hook is
 * the consumer-side contract.
 *
 * Usage:
 *
 *   const widgetVersion = useWidgetRegistryVersion();
 *   const allWidgets = useMemo(() => {
 *     const cm = ComponentManager.componentMap();
 *     return Object.keys(cm).filter((k) => cm[k].type === "widget");
 *   }, [widgetVersion]);
 *
 * The hook subscribes once on mount and cleans up on unmount, so
 * adding it to a component is free.
 *
 * @returns {number} monotonically increasing counter, starts at 0
 */
export function useWidgetRegistryVersion() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener("dash:widgets-updated", bump);
    return () => window.removeEventListener("dash:widgets-updated", bump);
  }, []);

  return version;
}
