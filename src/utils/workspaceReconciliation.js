/**
 * workspaceReconciliation.js
 *
 * Single entry point for cleaning stale cross-widget state out of a
 * workspace after a layout mutation (widget added, removed, moved
 * between pages, etc.). Runs after every mutation that touches the
 * layout tree so the persisted workspace never carries references to
 * widgets that no longer exist.
 *
 * The Listeners tab and the runtime event system are built on
 * assumption that `item.listeners` arrays only reference live
 * widgets. Without reconciliation, a delete leaves the surviving
 * widgets' `listeners` entries pointing at the deleted widget's
 * `component[itemId].event` — the runtime silently no-ops because
 * no emitter matches, and the Listeners tab's "all checked" state
 * lies. Same story for `workspace.selectedProviders`, which is
 * keyed by widgetId and accumulates orphaned entries indefinitely.
 *
 * This module owns the prune. It's idempotent and returns a new
 * workspace reference so React memos invalidate downstream.
 */

import { forEachWidget } from "./providerResolution";
import { canonicalItemKey, parseEventString } from "./listenerResolution";

/**
 * Build the set of canonical keys and the set of itemIds for every
 * widget currently in the workspace's layout tree. Keys drive
 * listener pruning; the itemId set drives provider-binding pruning
 * (selectedProviders is keyed by raw widgetId).
 */
function collectLiveIdentity(workspace) {
  const liveCanonicalKeys = new Set();
  const liveItemIds = new Set();
  forEachWidget(workspace, (item) => {
    const key = canonicalItemKey(item);
    if (key) liveCanonicalKeys.add(key);
    // Track every id-ish the runtime might key by. selectedProviders
    // uses `item.uuidString` or `item.uuid` or `item.id` depending on
    // when the binding was written, so accept any of them.
    if (item.uuidString) liveItemIds.add(String(item.uuidString));
    if (item.uuid) liveItemIds.add(String(item.uuid));
    if (item.id != null) liveItemIds.add(String(item.id));
  });
  return { liveCanonicalKeys, liveItemIds };
}

/**
 * Parse an event string and return its canonical key in the same
 * shape `canonicalItemKey` produces for live items. Returns null if
 * the string doesn't parse — caller treats that as "don't recognize
 * it, leave it alone" (we only prune things we can identify).
 */
function eventStringToCanonicalKey(eventString) {
  const parsed = parseEventString(eventString);
  if (!parsed) return null;
  // Event strings carry `component[itemId].event`. `itemId` may be
  // `uuidString`, `uuid`, or `id` depending on when the binding was
  // written — canonicalItemKey produces `component|<id-ish>` for
  // whichever form the live item has. We compare against the set of
  // ALL such keys in the workspace, so the string shape matches.
  return `${parsed.component}|${parsed.itemId}`;
}

/**
 * Prune stale event-string references out of a listeners object.
 * Returns a new object (never mutates). Empty handler arrays drop
 * the handler key; an empty listeners object returns null so the
 * caller drops the field entirely.
 */
function pruneListeners(listeners, liveCanonicalKeys) {
  if (!listeners || typeof listeners !== "object") return null;
  const next = {};
  let dropped = 0;
  for (const [handlerName, value] of Object.entries(listeners)) {
    // Live format is an array of event strings. Older workspaces may
    // carry a single string or an object — both fall through
    // untouched here since they're not a cross-widget reference we
    // can validate against `liveCanonicalKeys`.
    if (!Array.isArray(value)) {
      next[handlerName] = value;
      continue;
    }
    const kept = value.filter((eventStr) => {
      const key = eventStringToCanonicalKey(eventStr);
      if (!key) return true; // unparseable — leave alone
      return liveCanonicalKeys.has(key);
    });
    if (kept.length !== value.length) dropped += value.length - kept.length;
    if (kept.length > 0) next[handlerName] = kept;
    // Empty array = this handler only referenced deleted widgets.
    // Drop the key.
  }
  if (
    dropped === 0 &&
    Object.keys(next).length === Object.keys(listeners).length
  ) {
    // Nothing to change — return the input unchanged so callers can
    // short-circuit on reference equality.
    return listeners;
  }
  if (Object.keys(next).length === 0) return null;
  return next;
}

/**
 * Reconcile every layout item in an array: prune its listeners,
 * recurse into nested containers. Returns a new array when any item
 * changed, otherwise the input (for cheap no-op reference equality).
 */
function reconcileLayoutArray(items, liveCanonicalKeys) {
  if (!Array.isArray(items)) return items;
  let changed = false;
  const next = items.map((item) => {
    const updated = reconcileLayoutItem(item, liveCanonicalKeys);
    if (updated !== item) changed = true;
    return updated;
  });
  return changed ? next : items;
}

function reconcileLayoutItem(item, liveCanonicalKeys) {
  if (!item || typeof item !== "object") return item;
  let next = item;
  let changed = false;

  if (item.listeners) {
    const pruned = pruneListeners(item.listeners, liveCanonicalKeys);
    if (pruned !== item.listeners) {
      next = { ...next };
      if (pruned === null) {
        delete next.listeners;
      } else {
        next.listeners = pruned;
      }
      changed = true;
    }
  }

  if (Array.isArray(item.items)) {
    const innerNext = reconcileLayoutArray(item.items, liveCanonicalKeys);
    if (innerNext !== item.items) {
      next = { ...next, items: innerNext };
      changed = true;
    }
  }
  if (Array.isArray(item.layout)) {
    const innerNext = reconcileLayoutArray(item.layout, liveCanonicalKeys);
    if (innerNext !== item.layout) {
      next = { ...next, layout: innerNext };
      changed = true;
    }
  }

  return changed ? next : item;
}

/**
 * Prune `workspace.selectedProviders`. The map is keyed by widget
 * id — drop every top-level key whose widgetId is not in the live
 * set. Returns the input unchanged when nothing's stale, otherwise
 * a fresh object.
 */
function pruneSelectedProviders(selectedProviders, liveItemIds) {
  if (!selectedProviders || typeof selectedProviders !== "object") {
    return selectedProviders;
  }
  let changed = false;
  const next = {};
  for (const [widgetId, value] of Object.entries(selectedProviders)) {
    if (liveItemIds.has(String(widgetId))) {
      next[widgetId] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : selectedProviders;
}

/**
 * Main entry point. Given a workspace, returns a workspace where:
 *   - Every surviving widget's `item.listeners` contains only event
 *     strings whose source widget is live.
 *   - `workspace.selectedProviders` is keyed only by live widgetIds.
 *
 * Does NOT mutate the input. Returns a new object reference when
 * anything changed; returns the input unchanged when clean (so
 * React `useMemo` callers with a `workspace` dep can short-circuit).
 *
 * Idempotent: `reconcile(reconcile(ws))` deep-equals `reconcile(ws)`.
 *
 * @param {Object} workspace
 * @returns {Object}
 */
export function reconcileWorkspaceAfterLayoutChange(workspace) {
  if (!workspace || typeof workspace !== "object") return workspace;

  const { liveCanonicalKeys, liveItemIds } = collectLiveIdentity(workspace);

  let changed = false;
  let next = workspace;

  // Main layout
  if (Array.isArray(workspace.layout)) {
    const innerNext = reconcileLayoutArray(workspace.layout, liveCanonicalKeys);
    if (innerNext !== workspace.layout) {
      next = { ...next, layout: innerNext };
      changed = true;
    }
  }

  // Page layouts
  if (Array.isArray(workspace.pages)) {
    let pagesChanged = false;
    const nextPages = workspace.pages.map((page) => {
      if (!page || typeof page !== "object") return page;
      if (!Array.isArray(page.layout)) return page;
      const innerNext = reconcileLayoutArray(page.layout, liveCanonicalKeys);
      if (innerNext !== page.layout) {
        pagesChanged = true;
        return { ...page, layout: innerNext };
      }
      return page;
    });
    if (pagesChanged) {
      next = { ...next, pages: nextPages };
      changed = true;
    }
  }

  // Sidebar layout
  if (Array.isArray(workspace.sidebarLayout)) {
    const innerNext = reconcileLayoutArray(
      workspace.sidebarLayout,
      liveCanonicalKeys,
    );
    if (innerNext !== workspace.sidebarLayout) {
      next = { ...next, sidebarLayout: innerNext };
      changed = true;
    }
  }

  // Provider bindings
  if (workspace.selectedProviders) {
    const prunedProviders = pruneSelectedProviders(
      workspace.selectedProviders,
      liveItemIds,
    );
    if (prunedProviders !== workspace.selectedProviders) {
      next = { ...next, selectedProviders: prunedProviders };
      changed = true;
    }
  }

  return changed ? next : workspace;
}

export default reconcileWorkspaceAfterLayoutChange;
