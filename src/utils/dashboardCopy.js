import { deepCopy } from "@trops/dash-react";
import { remixSourceOf } from "./remixSource";

/**
 * A copy of one of the user's dashboards, ready to save as a new one — the
 * Dashboards page's Duplicate and Create's "Copy one of your dashboards".
 * Its widgets and layout come along. It isn't the registry package the
 * original came from or was published as (publishing it must never update
 * the original's); where it came from otherwise — author, can it be
 * published — stays. Its bots don't come along: they belong to the
 * original's team.
 *
 * @param {object} ws  the dashboard
 * @param {number} [now]  the copy's id and version
 */
export function dashboardCopy(ws, now = Date.now()) {
  const { registryRef: _ref, ...copy } = deepCopy(ws);
  if (copy._dashboardConfig) {
    const {
      registryPackage: _p,
      registryScope: _s,
      version: _v,
      installedVersion: _i,
      ...origin
    } = copy._dashboardConfig;
    copy._dashboardConfig = origin;
  }
  // A copy of someone else's dashboard stays credited to it: publishing
  // the copy is a remix, which its author may not allow.
  const source = remixSourceOf(ws);
  if (source) copy.remixedFrom = source;
  else delete copy.remixedFrom;
  return {
    ...copy,
    id: now,
    version: now,
    name: `${ws.name || "Dashboard"} (Copy)`,
  };
}
