/**
 * cleanForeignWidgetsFromWorkspace.js
 *
 * One-shot data cleanup that runs at workspace load time. Removes
 * any layout item whose `dashboardId` doesn't match the workspace's
 * own id. These are "foreign" items — leaked into this workspace's
 * tree by some earlier bug (most commonly a shared array reference
 * across two open dashboards' sidebar layouts).
 *
 * Without this pass, the items linger in `workspaces.json` forever
 * and re-appear in every Listeners / Providers / Widgets tab the
 * user opens. Filtering at the UI layer hides them but doesn't fix
 * the persistent state. This utility writes the corrupted items
 * out so the next save persists the cleaned shape.
 *
 * Mutates in place. Idempotent — running twice on a clean workspace
 * is a no-op. Returns a summary of what was removed for diagnostics
 * (callers can log it to surface the cleanup to the user).
 *
 * Items WITHOUT a `dashboardId` stamp are NOT removed — they're
 * either deeply-nested items LayoutModel didn't reach OR legacy
 * pre-stamping data. Stripping them would lose legitimate widgets.
 * They're stamped with the workspace's id instead, which is
 * idempotent and self-correcting.
 *
 * @param {Object} workspace - workspace object (mutated in place)
 * @returns {{ removed: number, stamped: number }}
 */
export function cleanForeignWidgetsFromWorkspace(workspace) {
  const summary = { removed: 0, stamped: 0 };
  if (!workspace || workspace.id === undefined || workspace.id === null) {
    return summary;
  }
  const wsId = String(workspace.id);

  const cleanList = (items) => {
    if (!Array.isArray(items)) return items;
    const kept = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const stamp = item.dashboardId;
      if (stamp !== undefined && stamp !== null && String(stamp) !== wsId) {
        // Foreign item — drop it.
        summary.removed += 1;
        continue;
      }
      if (stamp === undefined || stamp === null) {
        // Unstamped — adopt into this workspace.
        item.dashboardId = workspace.id;
        summary.stamped += 1;
      }
      // Recurse into nested arrays so foreign items inside grid
      // containers' `items` / nested `layout` are caught too.
      if (Array.isArray(item.items)) item.items = cleanList(item.items);
      if (Array.isArray(item.layout)) item.layout = cleanList(item.layout);
      kept.push(item);
    }
    return kept;
  };

  if (Array.isArray(workspace.layout)) {
    workspace.layout = cleanList(workspace.layout);
  }
  if (Array.isArray(workspace.sidebarLayout)) {
    workspace.sidebarLayout = cleanList(workspace.sidebarLayout);
  }
  if (Array.isArray(workspace.pages)) {
    for (const page of workspace.pages) {
      if (page && Array.isArray(page.layout)) {
        page.layout = cleanList(page.layout);
      }
    }
  }

  return summary;
}
