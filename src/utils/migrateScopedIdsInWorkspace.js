import { migrateBareComponentName } from "./migrateBareComponentName";

/**
 * Workspace-level pre-pass that migrates legacy bare component
 * references throughout an entire workspace. Runs ONCE on workspace
 * load (from `WorkspaceModel`); after this pass every layout item
 * carries a fully scoped `component` AND every listener event string
 * (`Comp[id].evt`) references the matching scoped component.
 *
 * Why workspace-level (and not per-LayoutModel item)?
 *
 *   - Listeners can reference widgets across pages/sidebar/root, so
 *     migrating one item's listeners requires knowing the scoped form
 *     of widgets in OTHER items. Per-item migration can't see that.
 *   - `pruneDeadListenerReferences` (called immediately after) walks
 *     the whole workspace and needs every item's `component` AND
 *     every listener string to use the same identity space. If
 *     listeners still reference bare names but live items are scoped,
 *     prune treats every legacy listener as an orphan and silently
 *     deletes the user's wiring.
 *
 * Mutating in place is intentional — `WorkspaceModel` already deep-
 * copies the input, so the surface mutation is contained to that
 * working copy.
 *
 * @param {object} workspace
 * @param {object} componentMap - registry map keyed by scoped ids
 * @returns {{components: number, listeners: number}} migration counts
 */
export function migrateScopedIdsInWorkspace(workspace, componentMap) {
  const counts = { components: 0, listeners: 0 };
  if (!workspace || !componentMap) return counts;

  const migrateComponent = (item) => {
    if (!item || typeof item !== "object" || !item.component) return;
    const before = item.component;
    const after = migrateBareComponentName(componentMap, before);
    if (after !== before) {
      item.component = after;
      counts.components += 1;
    }
  };

  // Listener event strings parse as `Comp[id].evt`. Only the `Comp`
  // portion is migrated; the id is the receiver's stable layout id
  // (numeric or uuid) and the event name is widget-defined.
  const EVENT_RE = /^([^[]+)(\[[^\]]+\]\..+)$/;
  const migrateListenerStrings = (item) => {
    if (!item || typeof item !== "object") return;
    const listeners = item.listeners;
    if (!listeners || typeof listeners !== "object") return;
    for (const handler of Object.keys(listeners)) {
      const events = listeners[handler];
      if (!Array.isArray(events)) continue;
      for (let i = 0; i < events.length; i += 1) {
        const raw = events[i];
        if (typeof raw !== "string") continue;
        const m = raw.match(EVENT_RE);
        if (!m) continue;
        const [, comp, rest] = m;
        const migrated = migrateBareComponentName(componentMap, comp);
        if (migrated !== comp) {
          events[i] = `${migrated}${rest}`;
          counts.listeners += 1;
        }
      }
    }
  };

  const walk = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      // Migrate this item, then recurse — order matters so that
      // pre-existing listeners on this item see the registry as it
      // was, not the (possibly newly-renamed) component name.
      migrateComponent(item);
      migrateListenerStrings(item);
      if (Array.isArray(item.items)) walk(item.items);
      if (Array.isArray(item.layout)) walk(item.layout);
    }
  };

  walk(workspace.layout);
  if (Array.isArray(workspace.pages)) {
    for (const page of workspace.pages) walk(page?.layout);
  }
  walk(workspace.sidebarLayout);

  return counts;
}
