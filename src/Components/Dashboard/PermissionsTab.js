import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button, FontAwesomeIcon } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { WidgetGrantRow } from "../Settings/sections/WidgetGrantRow";
import { normalizeGrantsByProviderType } from "../../utils/normalizeGrantsByProviderType";
import { applyToolToggle } from "../Settings/sections/applyToolToggle";
import { applyPathRemoval } from "../Settings/sections/applyPathRemoval";
import { applyDomainItemRemoval } from "../Settings/sections/applyDomainItemRemoval";
import { forEachWidget } from "../../utils/providerResolution";
import { pickWidgetRef, isUserWidget } from "../../utils/widgetIdentity";

/**
 * PermissionsTab
 *
 * Dashboard-scoped MCP grants management. Lists every widget in the
 * current workspace alongside its declared permissions and current
 * grant state, with the same per-tool toggles + per-server "Allow
 * all" controls users get in Settings → Privacy.
 *
 * Wins over going to Settings → Privacy:
 *   - Filtered to JUST the widgets in this dashboard (not the global
 *     pile).
 *   - Top-of-tab "Allow all declared tools" approves every
 *     manifest-declared tool across every widget here in one click —
 *     the manual-trigger version of the workspace-open
 *     PreflightConsentModal.
 *
 * Reuses WidgetGrantRow + applyToolToggle / applyPathRemoval so the
 * behavior matches Settings → Privacy exactly. This is purely a
 * scoped + bulk-action wrapper.
 */
export const PermissionsTab = ({ workspace }) => {
  const { providers } = React.useContext(AppContext);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Build the set of widget identifiers in this workspace. Walk every
  // layout location (main, pages, sidebar). `pickWidgetRef` returns
  // the dotted scoped id string (`scope.package.component`) — exactly
  // what the runtime grant store keys grants under, so we can join
  // directly against `widgetMcp.listAll` without further translation.
  const dashboardWidgetIds = useMemo(() => {
    const ids = new Set();
    if (!workspace) return ids;
    forEachWidget(workspace, (w) => {
      if (!isUserWidget(w)) return;
      const dottedId = pickWidgetRef(w);
      if (typeof dottedId === "string" && dottedId) ids.add(dottedId);
    });
    return ids;
  }, [workspace]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const api = typeof window !== "undefined" ? window.mainApi : null;
      if (!api?.widgetMcp?.listAll) {
        setRows([]);
        setLoading(false);
        return;
      }
      const all = await api.widgetMcp.listAll();
      setRows(Array.isArray(all) ? all : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filteredRows = useMemo(() => {
    if (dashboardWidgetIds.size === 0) return [];
    const filtered = rows.filter((r) => dashboardWidgetIds.has(r.widgetId));
    return normalizeGrantsByProviderType(filtered, providers);
  }, [rows, dashboardWidgetIds, providers]);

  const resolveLabels = (currentGrant, serverName, on) => {
    const labels = [];
    if (providers && typeof providers === "object") {
      for (const label of Object.keys(currentGrant.servers || {})) {
        const t = providers[label]?.type;
        if (t === serverName || label === serverName) labels.push(label);
      }
      if (labels.length === 0 && on) {
        for (const [label, p] of Object.entries(providers)) {
          if (p?.type === serverName) {
            labels.push(label);
            break;
          }
        }
      }
    }
    if (labels.length === 0 && currentGrant.servers?.[serverName]) {
      labels.push(serverName);
    }
    return labels;
  };

  const writeGrantOrRevoke = async (widgetId, next) => {
    if (next === null) {
      await window.mainApi?.widgetMcp?.revoke?.(widgetId);
    } else {
      await window.mainApi?.widgetMcp?.setGrant?.(widgetId, next);
    }
  };

  const toggleTool = async (widgetId, serverName, tool, on) => {
    try {
      const row = rows.find((r) => r.widgetId === widgetId);
      if (!row) return;
      const currentGrant = row.granted || { servers: {} };
      const labels = resolveLabels(currentGrant, serverName, on);
      if (labels.length === 0) return;
      const next = applyToolToggle(currentGrant, labels, tool, on);
      await writeGrantOrRevoke(widgetId, next);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const toggleAllForServer = async (widgetId, serverName, on) => {
    try {
      const row = rows.find((r) => r.widgetId === widgetId);
      if (!row) return;
      const declaredTools = row.declared?.servers?.[serverName]?.tools || [];
      if (declaredTools.length === 0) return;
      const currentGrant = row.granted || { servers: {} };
      const labels = resolveLabels(currentGrant, serverName, on);
      if (labels.length === 0) return;
      let next = currentGrant;
      for (const tool of declaredTools) {
        next = applyToolToggle(next || { servers: {} }, labels, tool, on);
      }
      await writeGrantOrRevoke(widgetId, next);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const deletePath = async (widgetId, serverName, kind, path) => {
    try {
      const row = rows.find((r) => r.widgetId === widgetId);
      if (!row || !row.granted) return;
      const labels = resolveLabels(row.granted, serverName, false);
      if (labels.length === 0) return;
      const next = applyPathRemoval(row.granted, labels, kind, path);
      await writeGrantOrRevoke(widgetId, next);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const deleteDomainItem = async (widgetId, domain, kind, value) => {
    try {
      const row = rows.find((r) => r.widgetId === widgetId);
      if (!row || !row.granted) return;
      const next = applyDomainItemRemoval(row.granted, domain, kind, value);
      await writeGrantOrRevoke(widgetId, next);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const revokeWidget = async (widgetId) => {
    try {
      await window.mainApi?.widgetMcp?.revoke?.(widgetId);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const revokeServer = async (widgetId, serverName) => {
    try {
      const row = rows.find((r) => r.widgetId === widgetId);
      const labels = [];
      if (row?.granted?.servers && providers) {
        for (const label of Object.keys(row.granted.servers)) {
          const t = providers[label]?.type;
          if (t === serverName || label === serverName) labels.push(label);
        }
      }
      const targets = labels.length > 0 ? labels : [serverName];
      for (const label of targets) {
        await window.mainApi?.widgetMcp?.revokeServer?.(widgetId, label);
      }
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  // Bulk: approve every declared tool on every widget in the dashboard,
  // OR revoke every grant on every widget in the dashboard. Sequential
  // so a mid-loop failure surfaces clearly and the next reload picks up
  // whatever did succeed.
  const approveAllInDashboard = async () => {
    setBusy(true);
    try {
      for (const row of filteredRows) {
        const declared = row.declared?.servers || {};
        for (const serverName of Object.keys(declared)) {
          await toggleAllForServer(row.widgetId, serverName, true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const revokeAllInDashboard = async () => {
    setBusy(true);
    try {
      for (const row of filteredRows) {
        if (row.granted) {
          await window.mainApi?.widgetMcp?.revoke?.(row.widgetId);
        }
      }
      reload();
    } finally {
      setBusy(false);
    }
  };

  const totalDeclared = filteredRows.reduce(
    (sum, r) => sum + Object.keys(r.declared?.servers || {}).length,
    0,
  );
  const totalGranted = filteredRows.filter((r) => r.granted).length;

  if (loading) {
    return <div className="text-sm opacity-60 p-4">Loading permissions…</div>;
  }

  if (filteredRows.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="text-sm opacity-70">
          No widgets in this dashboard request any MCP permissions.
        </div>
        <div className="text-xs opacity-50">
          Permissions only show up here when a widget's published manifest (or
          local source) declares MCP tool usage.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 flex flex-row items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {filteredRows.length} widget
            {filteredRows.length === 1 ? "" : "s"} with permissions in this
            dashboard
          </span>
          <span className="text-xs opacity-60 mt-0.5">
            {totalGranted} currently granted across {totalDeclared} declared
            server{totalDeclared === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-row gap-2">
          <Button
            title="Allow all declared"
            onClick={approveAllInDashboard}
            disabled={busy}
            size="sm"
          />
          <Button
            title="Revoke all"
            onClick={revokeAllInDashboard}
            disabled={busy || totalGranted === 0}
            size="sm"
          />
        </div>
      </div>
      {error && (
        <div className="flex-shrink-0 text-xs text-red-400 bg-red-900/20 border border-red-700 rounded p-2 mt-3">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto pt-3 space-y-3">
        {filteredRows.map((row) => (
          <WidgetGrantRow
            key={row.widgetId}
            widgetId={row.widgetId}
            declared={row.declared}
            granted={row.granted}
            hasManifest={row.hasManifest}
            grantOrigin={row.grantOrigin}
            onRevokeWidget={() => revokeWidget(row.widgetId)}
            onRevokeServer={(serverName) =>
              revokeServer(row.widgetId, serverName)
            }
            onGrantManually={() => {}}
            onToggleTool={toggleTool}
            onToggleAllForServer={toggleAllForServer}
            onDeletePath={deletePath}
            onDeleteDomainItem={deleteDomainItem}
          />
        ))}
      </div>
    </div>
  );
};
