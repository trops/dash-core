import React, { useEffect, useState, useCallback } from "react";
import { Button, SubHeading3, FontAwesomeIcon } from "@trops/dash-react";
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
          Granting access here is a trust signal about the widget — not a
          per-dashboard switch.
        </span>
      </div>

      <HowThisWorksPanel />

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

// Mock fixtures for the "Example rows" section. These use the same
// WidgetGrantRow component the real rows use, so the preview always
// reflects the real rendering. Click handlers are no-ops — the panel is
// for visualization only.
const EXAMPLE_FIXTURES = [
  {
    caption: "Declared by the developer and granted by the user.",
    widgetId: "@example/notes-summarizer",
    hasManifest: true,
    grantOrigin: "declared",
    declared: {
      servers: {
        filesystem: {
          tools: ["read_file", "list_directory"],
          readPaths: ["~/Documents/notes"],
          writePaths: [],
        },
      },
    },
    granted: {
      grantOrigin: "declared",
      servers: {
        filesystem: {
          tools: ["read_file", "list_directory"],
          readPaths: ["~/Documents/notes"],
          writePaths: [],
        },
      },
    },
  },
  {
    caption: "Declared by the developer — the user hasn't decided yet.",
    widgetId: "@example/code-search",
    hasManifest: true,
    grantOrigin: null,
    declared: {
      servers: {
        github: { tools: ["search_repositories", "get_file_contents"] },
      },
    },
    granted: null,
  },
  {
    caption: "Detected by the install-time scanner and granted.",
    widgetId: "@example/file-helper",
    hasManifest: false,
    grantOrigin: "discovered",
    declared: null,
    granted: {
      grantOrigin: "discovered",
      servers: {
        filesystem: { tools: ["read_file"], readPaths: [], writePaths: [] },
      },
    },
  },
  {
    caption: "Granted manually because the widget had no manifest.",
    widgetId: "@example/legacy-widget",
    hasManifest: false,
    grantOrigin: "manual",
    declared: null,
    granted: {
      grantOrigin: "manual",
      servers: {
        filesystem: {
          tools: ["read_file", "write_file"],
          readPaths: ["~/Downloads"],
          writePaths: ["/tmp/widget-output"],
        },
      },
    },
  },
];

const noop = () => {};

/**
 * Collapsible explainer that documents how grants flow per-widget vs
 * per-dashboard, with a concrete example table and rendered preview rows
 * for each grant state. Default-collapsed so users who don't care never
 * see it.
 */
const HowThisWorksPanel = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700 rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-row items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-800"
      >
        <span>How widget MCP permissions work</span>
        <FontAwesomeIcon
          icon={open ? "chevron-up" : "chevron-down"}
          className="h-3 w-3 opacity-60"
        />
      </button>

      {open && (
        <div className="flex flex-col space-y-4 px-3 py-3 border-t border-gray-800 text-xs leading-relaxed">
          <div className="space-y-2">
            <p>
              <span className="font-semibold">
                The grant is about the widget, not the dashboard.
              </span>{" "}
              When you grant <code>@trops/notes-summarizer</code> access to{" "}
              <code>~/Documents</code>, you're saying "I trust this widget with
              this path, anywhere." Grants live one-per-widget, regardless of
              how many dashboards use it.
            </p>
            <p>
              <span className="font-semibold">
                Each dashboard automatically scopes its servers.
              </span>{" "}
              When you open a dashboard, Dash spawns a separate MCP server
              process per dashboard. That server is configured with only the
              paths granted to widgets actually on that dashboard — nothing
              else. Two dashboards using the same widget share the same grant;
              two dashboards using different widgets get different effective
              scopes.
            </p>
            <p>
              <span className="font-semibold">What this doesn't do.</span>{" "}
              There's no way today to say "this widget can use filesystem on
              Dashboard 1 but not Dashboard 2." Grants are per-widget;
              per-(widget, dashboard) granularity would need a bigger UX rework.
              If you don't want a widget to access a path on a particular
              dashboard, the workaround is to remove it from that dashboard or
              revoke the grant entirely.
            </p>
          </div>

          <div className="space-y-2">
            <div className="font-semibold">
              Example: widget A granted <code>/Documents</code>, widget B
              granted <code>/Code</code>
            </div>
            <table className="w-full text-xs border border-gray-800">
              <thead>
                <tr className="bg-gray-900">
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Scenario
                  </th>
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Dashboard 1 sees
                  </th>
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Dashboard 2 sees
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-2 py-1 border-b border-gray-800">
                    A on Dash 1, B on Dash 2
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Code
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1 border-b border-gray-800">
                    A on both, B on Dash 2
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents, /Code
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1">A + B both on Dash 1</td>
                  <td className="px-2 py-1 font-mono">/Documents, /Code</td>
                  <td className="px-2 py-1 opacity-60">(no server)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="font-semibold">What each row state looks like</div>
            {EXAMPLE_FIXTURES.map((f) => (
              <div key={f.widgetId} className="space-y-1">
                <div className="italic opacity-60">{f.caption}</div>
                <WidgetGrantRow
                  widgetId={f.widgetId}
                  declared={f.declared}
                  granted={f.granted}
                  hasManifest={f.hasManifest}
                  grantOrigin={f.grantOrigin}
                  onRevokeWidget={noop}
                  onRevokeServer={noop}
                  onGrantManually={noop}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
