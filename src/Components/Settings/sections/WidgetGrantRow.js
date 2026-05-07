/**
 * WidgetGrantRow + supporting components — pure extraction from
 * PrivacySecuritySection.js. No behavior change. Lifted into its own
 * file so the new package-detail panel can import the same row
 * renderer used elsewhere in the section.
 */
import React from "react";
import { Button, Switch } from "@trops/dash-react";
import { computeStaleItems, isServerEntirelyStale } from "./grantStaleness";

export const GrantOriginBadge = ({ origin }) => {
  const styles = {
    declared: { label: "declared", color: "text-green-400" },
    discovered: { label: "discovered", color: "text-amber-400" },
    manual: { label: "manual", color: "text-blue-400" },
    live: { label: "live", color: "text-purple-400" },
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

/**
 * Tools-row variant with a per-tool Switch so the user can revoke a
 * single tool without going nuclear ("Revoke server" or "Revoke all").
 * Toggling OFF a granted tool calls onToggleTool(serverName, tool, false).
 * Toggling ON a declared-but-not-granted tool calls (..., true) to add
 * it to the existing grant — only enabled when the server already has
 * at least one granted tool (so the renderer knows which provider
 * instance label to write under). For pure declared-only servers the
 * toggle stays disabled; the runtime JIT prompt is the entry point.
 */
const ToolToggleList = ({
  declaredTools,
  grantedTools,
  serverName,
  onToggleTool,
  hasAnyGrantOnServer,
}) => {
  if (declaredTools.length === 0 && grantedTools.length === 0) return null;
  const grantedSet = new Set(grantedTools);
  const staleSet = computeStaleItems(declaredTools, grantedTools, true);
  const all = Array.from(new Set([...declaredTools, ...grantedTools]));
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-xs opacity-50">Tools</span>
      {all.map((tool) => {
        const isGranted = grantedSet.has(tool);
        const isStale = staleSet.has(tool);
        // Disable toggling ON when there's no existing grant on the
        // server — the renderer would have nowhere to write the
        // change without a provider instance label. Toggling OFF is
        // always allowed when the tool IS granted.
        const disabled = !isGranted && !hasAnyGrantOnServer;
        return (
          <div
            key={tool}
            className="flex flex-row items-center justify-between gap-2"
          >
            <span
              className={`text-xs font-mono break-all ${
                isStale
                  ? "text-amber-400"
                  : isGranted
                    ? "opacity-100"
                    : "opacity-50"
              }`}
            >
              {tool}
              {isStale && (
                <span className="ml-2 not-italic font-sans normal-case tracking-normal text-amber-400">
                  (stale — widget no longer requests this)
                </span>
              )}
            </span>
            <Switch
              checked={isGranted}
              onChange={(next) => onToggleTool(serverName, tool, next)}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
};

const PermsList = ({ label, declaredItems, grantedItems, validatesStale }) => {
  if (declaredItems.length === 0 && grantedItems.length === 0) return null;
  const grantedSet = new Set(grantedItems);
  const staleSet = computeStaleItems(
    declaredItems,
    grantedItems,
    validatesStale,
  );
  const all = Array.from(new Set([...declaredItems, ...grantedItems]));
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-xs opacity-50">{label}</span>
      {all.map((item) => {
        const isGranted = grantedSet.has(item);
        const isStale = staleSet.has(item);
        return (
          <span
            key={item}
            className={`text-xs font-mono break-all ${
              isStale
                ? "text-amber-400"
                : isGranted
                  ? "opacity-100"
                  : "opacity-50 line-through"
            }`}
          >
            {item}
            {isStale && (
              <span className="ml-2 not-italic font-sans normal-case tracking-normal text-amber-400">
                (stale — widget no longer requests this; consider revoking)
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
};

export const WidgetGrantRow = ({
  widgetId,
  declared,
  granted,
  hasManifest,
  grantOrigin,
  onRevokeWidget,
  onRevokeServer,
  onGrantManually,
  onToggleTool,
  onToggleAllForServer,
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
        const allStale = isServerEntirelyStale(decl, grant);
        return (
          <div
            key={serverName}
            className="flex flex-col space-y-2 border-t border-gray-800 pt-2"
          >
            <div className="flex flex-row items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wider opacity-70">
                {serverName}
                {grant?._labels && grant._labels.length > 0 && (
                  <span className="ml-2 normal-case tracking-normal opacity-60">
                    ({grant._labels.join(", ")})
                  </span>
                )}
                {!grant && (
                  <span className="ml-2 text-amber-400 normal-case tracking-normal">
                    (declared, not granted)
                  </span>
                )}
              </span>
              <div className="flex flex-row items-center gap-2">
                {(decl.tools || []).length > 0 && onToggleAllForServer && (
                  <div className="flex flex-row items-center gap-2">
                    <span className="text-xs opacity-60 normal-case tracking-normal">
                      Allow all
                    </span>
                    <Switch
                      checked={
                        (decl.tools || []).length > 0 &&
                        (decl.tools || []).every((t) =>
                          (grant?.tools || []).includes(t),
                        )
                      }
                      onChange={(next) =>
                        onToggleAllForServer(widgetId, serverName, next)
                      }
                    />
                  </div>
                )}
                {grant && (
                  <Button
                    title="Revoke server"
                    onClick={() => onRevokeServer(serverName)}
                  />
                )}
              </div>
            </div>
            {allStale && (
              <div className="text-xs text-amber-400 bg-amber-900 bg-opacity-20 border border-amber-700 rounded px-2 py-1.5">
                All grants on this server are no longer in the manifest — the
                widget likely no longer uses this server. Consider revoking.
              </div>
            )}
            <ToolToggleList
              declaredTools={decl.tools || []}
              grantedTools={grant?.tools || []}
              serverName={serverName}
              hasAnyGrantOnServer={!!grant}
              onToggleTool={(srv, tool, next) =>
                onToggleTool && onToggleTool(widgetId, srv, tool, next)
              }
            />
            <PermsList
              label="Read paths"
              declaredItems={decl.readPaths || []}
              grantedItems={grant?.readPaths || []}
              validatesStale={false}
            />
            <PermsList
              label="Write paths"
              declaredItems={decl.writePaths || []}
              grantedItems={grant?.writePaths || []}
              validatesStale={false}
            />
          </div>
        );
      })}

      {/* Phase 2 — fs domain grants. */}
      {granted?.domains?.fs &&
        ((granted.domains.fs.readPaths || []).length > 0 ||
          (granted.domains.fs.writePaths || []).length > 0) && (
          <div className="flex flex-col space-y-2 border-t border-gray-800 pt-2">
            <span className="text-xs uppercase tracking-wider opacity-70">
              filesystem
            </span>
            {Array.isArray(granted.domains.fs.actions) &&
              granted.domains.fs.actions.length > 0 && (
                <PermsList
                  label="Actions"
                  declaredItems={[]}
                  grantedItems={granted.domains.fs.actions}
                  validatesStale={false}
                />
              )}
            <PermsList
              label="Read filenames"
              declaredItems={[]}
              grantedItems={granted.domains.fs.readPaths || []}
              validatesStale={false}
            />
            <PermsList
              label="Write filenames"
              declaredItems={[]}
              grantedItems={granted.domains.fs.writePaths || []}
              validatesStale={false}
            />
          </div>
        )}

      {/* Phase 3 — network domain grants. */}
      {granted?.domains?.network &&
        (granted.domains.network.hosts || []).length > 0 && (
          <div className="flex flex-col space-y-2 border-t border-gray-800 pt-2">
            <span className="text-xs uppercase tracking-wider opacity-70">
              network
            </span>
            {Array.isArray(granted.domains.network.actions) &&
              granted.domains.network.actions.length > 0 && (
                <PermsList
                  label="Actions"
                  declaredItems={[]}
                  grantedItems={granted.domains.network.actions}
                  validatesStale={false}
                />
              )}
            <PermsList
              label="Allowed hosts"
              declaredItems={[]}
              grantedItems={granted.domains.network.hosts || []}
              validatesStale={false}
            />
          </div>
        )}
    </div>
  );
};
