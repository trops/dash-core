import React, { useEffect, useState, useCallback } from "react";
import { Button, SubHeading3 } from "@trops/dash-react";
import { GrantManuallyModal } from "./GrantManuallyModal";

/**
 * Privacy & Security
 *
 * Audit panel for per-widget MCP grants. Lists EVERY installed widget,
 * grouped by state:
 *   - declared + granted    (developer asked, user approved)
 *   - declared + ungranted  (developer asked, user hasn't decided yet)
 *   - undeclared + granted  (manual grant or scanner-discovered grant)
 *   - undeclared + ungranted (no manifest at all — "Grant manually" button)
 *
 * The grantOrigin field on each grant ("declared"/"discovered"/"manual"
 * /null-legacy) is surfaced as a small badge so users can see which
 * grants were approved against the developer's declaration vs against a
 * scanner guess vs typed by hand.
 *
 * Reads `window.mainApi.widgetMcp.{listAll,revoke,revokeServer,setGrant}`
 * exposed by dash-electron's preload.
 */
export const PrivacySecuritySection = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [manualGrantWidgetId, setManualGrantWidgetId] = useState(null);
  const [knownServerNames, setKnownServerNames] = useState([]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const api = typeof window !== "undefined" ? window.mainApi : null;
      if (!api?.widgetMcp?.listAll) {
        setRows([]);
        setLoading(false);
        return;
      }
      const result = await api.widgetMcp.listAll();
      setRows(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Pull catalog server names once, used as a datalist hint in the
  // manual-grant modal. Best-effort — if the API isn't there, the
  // datalist is just empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = typeof window !== "undefined" ? window.mainApi : null;
        const result = await api?.mcp?.getCatalog?.();
        const servers = result?.catalog || [];
        if (!cancelled && Array.isArray(servers)) {
          setKnownServerNames(
            servers.map((s) => s?.name).filter((n) => typeof n === "string"),
          );
        }
      } catch {
        // optional hint, ignore failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      await window.mainApi?.widgetMcp?.revokeServer?.(widgetId, serverName);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col p-6">
        <span className="text-sm opacity-60">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6 p-6">
      <div className="flex flex-col space-y-2">
        <SubHeading3 title="Widget MCP permissions" padding={false} />
        <span className="text-xs opacity-60">
          Tools and paths each widget is allowed to call via MCP. Granted paths
          are visible to other widgets in the same dashboard that use the same
          MCP server. Revoke any time.
        </span>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900 bg-opacity-20 border border-red-700 rounded p-3">
          {error}
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-sm opacity-60">No widgets installed.</div>
      )}

      {rows.map(({ widgetId, declared, granted, hasManifest, grantOrigin }) => (
        <WidgetGrantRow
          key={widgetId}
          widgetId={widgetId}
          declared={declared}
          granted={granted}
          hasManifest={hasManifest}
          grantOrigin={grantOrigin}
          onRevokeWidget={() => revokeWidget(widgetId)}
          onRevokeServer={(serverName) => revokeServer(widgetId, serverName)}
          onGrantManually={() => setManualGrantWidgetId(widgetId)}
        />
      ))}

      <GrantManuallyModal
        isOpen={!!manualGrantWidgetId}
        setIsOpen={(open) => {
          if (!open) setManualGrantWidgetId(null);
        }}
        widgetId={manualGrantWidgetId}
        knownServerNames={knownServerNames}
        onGranted={() => {
          setManualGrantWidgetId(null);
          reload();
        }}
      />
    </div>
  );
};

const WidgetGrantRow = ({
  widgetId,
  declared,
  granted,
  hasManifest,
  grantOrigin,
  onRevokeWidget,
  onRevokeServer,
  onGrantManually,
}) => {
  const declaredServers = (declared && declared.servers) || {};
  const grantedServers = (granted && granted.servers) || {};
  const allServerNames = Array.from(
    new Set([...Object.keys(declaredServers), ...Object.keys(grantedServers)]),
  );

  return (
    <div className="flex flex-col space-y-3 border border-gray-700 rounded p-3">
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex flex-row items-center gap-2 min-w-0">
          <span className="text-sm font-mono break-all">{widgetId}</span>
          {grantOrigin && <GrantOriginBadge origin={grantOrigin} />}
          {!hasManifest && !granted && (
            <span className="text-xs uppercase tracking-wider text-amber-400">
              no manifest
            </span>
          )}
        </div>
        <div className="flex flex-row gap-2">
          {!hasManifest && !granted && (
            <Button title="Grant manually" onClick={onGrantManually} />
          )}
          {Object.keys(grantedServers).length > 0 && (
            <Button title="Revoke all" onClick={onRevokeWidget} />
          )}
        </div>
      </div>

      {!declared && !granted && (
        <span className="text-xs opacity-50">
          This widget did not declare MCP permissions and the install-time
          scanner found nothing. Use Grant manually if you trust it.
        </span>
      )}

      {allServerNames.map((serverName) => {
        const decl = declaredServers[serverName] || {};
        const grant = grantedServers[serverName];
        return (
          <div
            key={serverName}
            className="flex flex-col space-y-2 border-t border-gray-800 pt-2"
          >
            <div className="flex flex-row items-center justify-between">
              <span className="text-xs uppercase tracking-wider opacity-70">
                {serverName}
                {!grant && (
                  <span className="ml-2 text-amber-400 normal-case tracking-normal">
                    (declared, not granted)
                  </span>
                )}
              </span>
              {grant && (
                <Button
                  title="Revoke server"
                  onClick={() => onRevokeServer(serverName)}
                />
              )}
            </div>
            <PermsList
              label="Tools"
              declaredItems={decl.tools || []}
              grantedItems={grant?.tools || []}
            />
            <PermsList
              label="Read paths"
              declaredItems={decl.readPaths || []}
              grantedItems={grant?.readPaths || []}
            />
            <PermsList
              label="Write paths"
              declaredItems={decl.writePaths || []}
              grantedItems={grant?.writePaths || []}
            />
          </div>
        );
      })}
    </div>
  );
};

const PermsList = ({ label, declaredItems, grantedItems }) => {
  if (declaredItems.length === 0 && grantedItems.length === 0) return null;
  const grantedSet = new Set(grantedItems);
  const declaredSet = new Set(declaredItems);
  const all = Array.from(new Set([...declaredItems, ...grantedItems]));
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-xs opacity-50">{label}</span>
      {all.map((item) => {
        const isGranted = grantedSet.has(item);
        const isDeclared = declaredSet.has(item);
        return (
          <span
            key={item}
            className={`text-xs font-mono break-all ${
              isGranted
                ? "opacity-100"
                : isDeclared
                  ? "opacity-50 line-through"
                  : "opacity-100 text-amber-400"
            }`}
          >
            {item}
            {!isDeclared && isGranted && (
              <span className="ml-2 opacity-60">(no longer declared)</span>
            )}
          </span>
        );
      })}
    </div>
  );
};

/**
 * Renders a small badge showing how the user got to this grant. Helps
 * the user audit grants that were approved against a scanner guess
 * rather than the developer's explicit declaration.
 */
const GrantOriginBadge = ({ origin }) => {
  const styles = {
    declared: { label: "declared", color: "text-green-400" },
    discovered: { label: "discovered", color: "text-amber-400" },
    manual: { label: "manual", color: "text-blue-400" },
  };
  const style = styles[origin];
  if (!style) return null;
  return (
    <span
      className={`text-xs uppercase tracking-wider ${style.color}`}
      title={`Origin: ${origin}`}
    >
      {style.label}
    </span>
  );
};
