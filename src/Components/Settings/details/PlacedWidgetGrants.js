/**
 * PlacedWidgetGrants
 *
 * The grants of single placed widgets of one widget type (DASH-46), shown
 * under that type's row in Settings → Privacy & Security. Each is kept
 * under "<widgetId>#<dashboardId>:<uuid>" and is revoked on its own; the
 * type's grant above it is left alone.
 */
import React from "react";
import { Button } from "@trops/dash-react";

/** "<dashboardId>:<uuid>" → { dashboardId, uuid }. */
export function splitInstanceId(instanceId) {
  const s = typeof instanceId === "string" ? instanceId : "";
  const at = s.indexOf(":");
  if (at < 0) return { dashboardId: null, uuid: s };
  return { dashboardId: s.slice(0, at), uuid: s.slice(at + 1) };
}

/** The dashboard's name, from the user's dashboards, or its id. */
export function dashboardLabel(dashboardId, workspaces) {
  const list = Array.isArray(workspaces) ? workspaces : [];
  const ws = list.find((w) => w && String(w.id) === String(dashboardId));
  const name = ws && (ws.name || ws.label);
  if (typeof name === "string" && name) return name;
  return dashboardId ? `Dashboard ${dashboardId}` : "Unknown dashboard";
}

/** Every folder an instance grant covers, across its servers. */
export function instanceFolders(granted) {
  const out = [];
  for (const [server, perms] of Object.entries(granted?.servers || {})) {
    for (const p of perms?.readPaths || []) out.push({ server, path: p });
    for (const p of perms?.writePaths || [])
      out.push({ server, path: p, write: true });
  }
  return out;
}

export const PlacedWidgetGrants = ({ instances, workspaces, onRevoke }) => {
  if (!Array.isArray(instances) || instances.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 pl-4">
      <span className="text-xs uppercase tracking-wider opacity-60">
        On dashboards ({instances.length})
      </span>
      {instances.map((inst) => {
        const { dashboardId, uuid } = splitInstanceId(inst.instanceId);
        const folders = instanceFolders(inst.granted);
        return (
          <div
            key={inst.key}
            className="flex flex-row items-start justify-between gap-3"
          >
            <div className="flex flex-col min-w-0">
              <span className="text-sm">
                {dashboardLabel(dashboardId, workspaces)}
              </span>
              <span className="text-xs opacity-60 font-mono break-all">
                {uuid}
              </span>
              <span className="text-xs opacity-80 break-all">
                {folders.length === 0
                  ? "No folders"
                  : folders
                      .map(
                        (f) =>
                          `${f.write ? "Write" : "Read"} ${f.path} (${f.server})`,
                      )
                      .join(" · ")}
              </span>
            </div>
            <Button
              title="Revoke"
              size="sm"
              onClick={() => onRevoke && onRevoke(inst.key)}
            />
          </div>
        );
      })}
    </div>
  );
};

export default PlacedWidgetGrants;
