import { useEffect, useState } from "react";

/**
 * useWidgetSources — the code a widget runs now and when it was built, for
 * the side panel's View code and its version line (approved mockups: widget
 * side panel frame 5, widget versions frames 3-4). Read from the installed
 * package (mainApi.widgets.readSources → its widgets/<Name>.js, .dash.js and
 * dash.json), so it's what the dashboard really runs.
 */

/**
 * The package a widget comes from: its item's packageId/_sourcePackage, or
 * its id ("ai-built.player.Player" → "@ai-built/player"). Null for a widget
 * built into Dash ("dash.…") or a bare name.
 */
export function widgetPackageOf(component, item = null) {
  const own = item && (item.packageId || item._sourcePackage);
  if (own) return String(own);
  const id = String(component || "");
  if (id.startsWith("dash.")) return null;
  const parts = id.split(".");
  return parts.length >= 3 ? `@${parts[0]}/${parts[1]}` : null;
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * "built today at 5:37 PM", "built yesterday at 9:02 AM", "built Oct 29" —
 * or "" when it isn't known (a widget from before builds were stamped).
 */
export function builtText(builtAt, now = new Date()) {
  if (!builtAt) return "";
  const d = new Date(builtAt);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay(d, now)) return `built today at ${time}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return `built yesterday at ${time}`;
  return `built ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  })}`;
}

/** "v1.0.4 · built today at 5:37 PM", "v2.1.0", or "". */
export function versionLine({ version, builtAt } = {}, now = new Date()) {
  return [version ? `v${version}` : "", builtText(builtAt, now)]
    .filter(Boolean)
    .join(" · ");
}

/** The files to show, the component first. */
export function sourceFiles(res, componentName = "") {
  if (!res || !res.success) return [];
  const name = res.componentName || componentName.split(".").pop() || "Widget";
  const files = [];
  if (typeof res.componentCode === "string") {
    files.push({ name: `${name}.js`, code: res.componentCode });
  }
  if (res.configCode)
    files.push({ name: `${name}.dash.js`, code: res.configCode });
  return files;
}

/**
 * @returns {{ loading: boolean, error: string|null, files: Array<{name, code}>,
 *   version: string|null, builtAt: string|null }}
 */
export function useWidgetSources(pkg, component) {
  const [state, setState] = useState({
    loading: !!pkg,
    error: null,
    files: [],
    version: null,
    builtAt: null,
  });
  useEffect(() => {
    let alive = true;
    const api =
      typeof window !== "undefined" && window.mainApi && window.mainApi.widgets;
    if (!pkg || !api || typeof api.readSources !== "function") {
      setState({
        loading: false,
        error: null,
        files: [],
        version: null,
        builtAt: null,
      });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve(api.readSources(pkg, component))
      .then((res) => {
        if (!alive) return;
        const manifest = (res && res.manifest) || {};
        setState({
          loading: false,
          error:
            res && res.success
              ? null
              : (res && res.error) || "Its code couldn't be read.",
          files: sourceFiles(res, component || ""),
          version: manifest.version || null,
          builtAt: manifest.builtAt || null,
        });
      })
      .catch((e) => {
        if (!alive) return;
        setState({
          loading: false,
          error: (e && e.message) || "Its code couldn't be read.",
          files: [],
          version: null,
          builtAt: null,
        });
      });
    return () => {
      alive = false;
    };
  }, [pkg, component]);
  return state;
}
