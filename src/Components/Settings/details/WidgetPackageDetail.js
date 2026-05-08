/**
 * WidgetPackageDetail
 *
 * Right-column for the redesigned Privacy & Security section. Shows
 * every widget in the selected package along with its grants and
 * exposes:
 *   - "Revoke all in package" — loops every sibling widget that has
 *     grants and revokes them.
 *   - per-widget "Revoke all" / "Grant manually" (via WidgetGrantRow).
 *   - per-server "Revoke server" (via WidgetGrantRow).
 *
 * Read-only structurally: doesn't fetch anything itself; the parent
 * passes the already-loaded packageGroup and the action callbacks.
 */
import React, { useState } from "react";
import { Button, FontAwesomeIcon } from "@trops/dash-react";
import { WidgetGrantRow } from "../sections/WidgetGrantRow";

export const WidgetPackageDetail = ({
  packageGroup,
  onRevokeWidget,
  onRevokeServer,
  onGrantManually,
  onRevokePackage,
  onToggleTool,
  onToggleAllForServer,
  onDeletePath,
  onDeleteDomainItem,
}) => {
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  if (!packageGroup) return null;

  const { packageId, displayName, widgets, grantCount, hasAnyGrant } =
    packageGroup;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col space-y-4 p-6">
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col min-w-0">
            <div className="flex flex-row items-center gap-2 min-w-0">
              <FontAwesomeIcon
                icon={packageId ? "box" : "circle-question"}
                className="h-4 w-4 opacity-70"
              />
              <span className="text-base font-semibold text-gray-100 break-all">
                {displayName}
              </span>
            </div>
            <span className="text-xs opacity-60 mt-1">
              {widgets.length} widget{widgets.length === 1 ? "" : "s"} installed
              {hasAnyGrant ? ` · ${grantCount} with grants` : " · no grants"}
            </span>
          </div>
          {hasAnyGrant && (
            <Button
              title="Revoke all in package"
              onClick={() => setConfirmRevokeAll(true)}
              backgroundColor="bg-red-700"
              textColor="text-white"
              hoverBackgroundColor="hover:bg-red-600"
              size="sm"
            />
          )}
        </div>

        {confirmRevokeAll && (
          <div className="flex flex-col gap-2 border border-amber-700 bg-amber-900 bg-opacity-20 rounded p-3">
            <span className="text-xs text-amber-300">
              Revoke grants for all {grantCount} widget
              {grantCount === 1 ? "" : "s"} in{" "}
              <span className="font-mono">{displayName}</span>? This cannot be
              undone — affected widgets will re-prompt next time they call a
              gated API.
            </span>
            <div className="flex flex-row gap-2 justify-end">
              <Button
                title="Cancel"
                onClick={() => setConfirmRevokeAll(false)}
                size="sm"
              />
              <Button
                title="Revoke all"
                backgroundColor="bg-red-700"
                textColor="text-white"
                hoverBackgroundColor="hover:bg-red-600"
                size="sm"
                onClick={() => {
                  setConfirmRevokeAll(false);
                  onRevokePackage && onRevokePackage(packageGroup);
                }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col space-y-3">
          {widgets.map((row) => (
            <WidgetGrantRow
              key={row.widgetId}
              widgetId={row.widgetId}
              declared={row.declared}
              granted={row.granted}
              hasManifest={row.hasManifest}
              grantOrigin={row.grantOrigin}
              onRevokeWidget={() => onRevokeWidget(row.widgetId)}
              onRevokeServer={(serverName) =>
                onRevokeServer(row.widgetId, serverName)
              }
              onGrantManually={() => onGrantManually(row.widgetId)}
              onToggleTool={onToggleTool}
              onToggleAllForServer={onToggleAllForServer}
              onDeletePath={onDeletePath}
              onDeleteDomainItem={onDeleteDomainItem}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
