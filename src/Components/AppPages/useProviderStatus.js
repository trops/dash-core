import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { getAllProviderBindings } from "../../utils/providerResolution";
import { classOf, providerStatus, providerUsage } from "./providerSummary";

const getWidgetRequirements = (name) =>
  (name && ComponentManager.config(name)?.providers) || [];

const schemaFor = (catalog, provider) =>
  ((catalog || []).find((e) => e && e.id === provider.type) || {})
    .credentialSchema || {};

/** The MCP catalog (credential schemas, auth commands) — loaded once. */
export function useMcpCatalog(dashApi) {
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    if (!dashApi || typeof dashApi.mcpGetCatalog !== "function") return;
    dashApi.mcpGetCatalog(
      (event, result) => {
        if (result && result.catalog) setCatalog(result.catalog);
      },
      () => {},
    );
  }, [dashApi]);
  return catalog;
}

/**
 * useProviderStatus — each provider's status and who uses it, for the
 * Providers page (app-navigation PRD NAV-007). Asks the main process which
 * MCP servers are running (again when the window regains focus) and loads
 * the bots once (and when they change).
 */
export function useProviderStatus({
  providers = {},
  workspaces = [],
  dashApi = null,
  catalog = [],
}) {
  const [running, setRunning] = useState({});
  const [bots, setBots] = useState([]);

  const mcpNames = useMemo(
    () =>
      Object.entries(providers || {})
        .filter(([, p]) => classOf(p) === "mcp")
        .map(([name]) => name)
        .sort()
        .join("\n"),
    [providers],
  );

  // Only re-render when a server's state actually changed.
  const mark = (name, value) =>
    setRunning((prev) =>
      prev[name] === value ? prev : { ...prev, [name]: value },
    );

  const checkRunning = useCallback(() => {
    if (!dashApi || typeof dashApi.mcpGetServerStatus !== "function") return;
    for (const name of mcpNames ? mcpNames.split("\n") : []) {
      dashApi.mcpGetServerStatus(
        name,
        (event, status) =>
          mark(name, !!status && status.status === "connected"),
        () => mark(name, false),
      );
    }
  }, [dashApi, mcpNames]);

  useEffect(() => {
    checkRunning();
    window.addEventListener("focus", checkRunning);
    return () => window.removeEventListener("focus", checkRunning);
  }, [checkRunning]);

  useEffect(() => {
    const api = window.mainApi && window.mainApi.bots;
    if (!api || typeof api.list !== "function") return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(api.list())
        .then((list) => {
          if (alive) setBots(Array.isArray(list) ? list : []);
        })
        .catch(() => {});
    load();
    const id = api.onListChanged ? api.onListChanged(load) : null;
    return () => {
      alive = false;
      if (id != null && api.removeListener) api.removeListener(id);
    };
  }, []);

  // Each dashboard's widget → provider bindings, worked out once and reused
  // for every provider's "used by" (it walks every widget; per provider it
  // made the Providers page take seconds). Recomputed when providers or
  // dashboards change.
  const bindingsFor = useMemo(() => {
    const cache = new Map();
    return (workspace) => {
      if (!cache.has(workspace)) {
        cache.set(
          workspace,
          getAllProviderBindings({
            workspace,
            appProviders: providers,
            getWidgetRequirements,
          }),
        );
      }
      return cache.get(workspace);
    };
  }, [providers, workspaces]);

  return useMemo(
    () => ({
      statusOf: (name) => {
        const p = providers && providers[name];
        return providerStatus(p, {
          running: !!running[name],
          credentialSchema: p ? schemaFor(catalog, p) : {},
        });
      },
      usageOf: (name) => providerUsage(name, { workspaces, bots, bindingsFor }),
      refresh: checkRunning,
    }),
    [providers, running, catalog, workspaces, bots, bindingsFor, checkRunning],
  );
}

/** How many providers need setup — the Providers item's left-nav dot. */
export function useProvidersNeedingSetup() {
  const app = useContext(AppContext) || {};
  const providers = app.providers;
  const catalog = useMcpCatalog(app.dashApi);
  return useMemo(
    () =>
      Object.values(providers || {}).filter(
        (p) =>
          p &&
          providerStatus(p, { credentialSchema: schemaFor(catalog, p) }).key ===
            "needsSetup",
      ).length,
    [providers, catalog],
  );
}
