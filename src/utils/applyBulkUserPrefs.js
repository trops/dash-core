/**
 * Apply a bulk-edit pref change set to a workspace.
 *
 * Drives the Dashboard Config modal's "Widgets" tab Save flow.
 * Given an array of `{ widgetId, key, value }` changes, walks every
 * widget instance in the workspace and patches `item.userPrefs` for
 * matching ids.
 *
 * Identity: `widgetId` matches `item.uuidString`, then `item.uuid`,
 * then `item.id` (matches the resolution order in `WidgetsTab` and
 * `forEachWidget`'s stable-id walker, so the same widget the user
 * saw in the bulk-edit pane is the one that gets patched). String
 * coercion is intentional — numeric layout ids serialize to strings
 * when staging crosses React state, so a `widgetId: 5` stage entry
 * still hits `item.id: 5` and vice versa.
 *
 * MUTATION WALKER: this intentionally does NOT use `forEachWidget`.
 * That helper dedupes by `${component}|${id}` so the dashboard
 * config UI shows one row per widget even when the same item is
 * referenced from multiple locations (root layout AND a page,
 * common when WorkspaceModel sets `page.layout = workspace.layout`).
 * On mutation we have to patch EVERY reference — after the deep
 * clone below the aliased shared object becomes two separate object
 * references, and skipping the second means the dashboard renders
 * the unpatched copy and the user sees no change. This is the bug
 * the "bulk edit doesn't apply" report surfaced.
 *
 * Returns a deep-cloned workspace; the original is untouched.
 * Returns the input unchanged if `changes` is empty / malformed.
 *
 * @param {Object} workspace
 * @param {Array<{widgetId: string|number, key: string, value: any}>} changes
 * @returns {Object} new workspace with patched userPrefs
 */
export function applyBulkUserPrefs(workspace, changes) {
  if (!workspace) return workspace;
  if (!Array.isArray(changes) || changes.length === 0) return workspace;

  const byWidget = new Map();
  for (const change of changes) {
    if (!change || !change.widgetId || !change.key) continue;
    const id = String(change.widgetId);
    if (!byWidget.has(id)) byWidget.set(id, {});
    byWidget.get(id)[change.key] = change.value;
  }
  if (byWidget.size === 0) return workspace;

  const next = JSON.parse(JSON.stringify(workspace));

  const patchItem = (item) => {
    if (!item || !item.component) return;
    const candidates = [item.uuidString, item.uuid, item.id]
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map((v) => String(v));
    const matchedKey = candidates.find((c) => byWidget.has(c));
    if (!matchedKey) return;
    const patch = byWidget.get(matchedKey);
    item.userPrefs = { ...(item.userPrefs || {}), ...patch };
  };

  // Reference-only walker. WeakSet prevents infinite loops on
  // pathological self-referential structures while still allowing
  // every distinct object reference to be visited.
  const seen = new WeakSet();
  const walk = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      patchItem(item);
      if (Array.isArray(item.items)) walk(item.items);
      if (Array.isArray(item.layout)) walk(item.layout);
    }
  };

  walk(next.layout);
  if (Array.isArray(next.pages)) {
    for (const page of next.pages) walk(page?.layout);
  }
  walk(next.sidebarLayout);

  return next;
}
