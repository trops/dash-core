/**
 * listenerResolution.js
 *
 * Companion to providerResolution.js. Walks a workspace's layout tree and
 * computes/edits the event-wiring graph that powers the Dashboard Config
 * modal's Listeners tab.
 *
 * Live-format primer (mirrors `PanelEditItemHandlers`):
 *
 *   layoutItem.listeners = {
 *     [handlerName]: [
 *       "EmitterComponent[itemId].eventName",
 *       ...
 *     ],
 *   }
 *
 *   - Key is the receiver-side handler name (one of the receiver's
 *     `eventHandlers: [...]` declarations on its `.dash.js`).
 *   - Value is an array of EVENT STRINGS, each formatted as
 *     `${component}[${itemId}].${event}` — same shape published by
 *     `WidgetHelpers.publishEvent` and subscribed by `useWidgetEvents.listen`.
 *
 * (The dashboard-export `eventWiring` format in
 * `electron/schema/dashboardConfigUtils.js` is different and lossy — it
 * collapses to component names without item ids. We don't use it here.)
 */

import { forEachWidget } from "./providerResolution";
import {
  pickWidgetDisplayName,
  pickWidgetRef,
  belongsToWorkspace,
  isUserWidget,
} from "./widgetIdentity";

const EVENT_STRING_RE = /^([^[]+)\[([^\]]+)\]\.(.+)$/;

/** Parse "Component[itemId].event" → { component, itemId, event }. */
export function parseEventString(eventString) {
  if (typeof eventString !== "string") return null;
  const m = eventString.match(EVENT_STRING_RE);
  if (!m) return null;
  return {
    component: m[1],
    itemId: m[2],
    event: m[3],
  };
}

/** Build an event string in the canonical runtime format. */
export function formatEventString(component, itemId, event) {
  return `${component}[${itemId}].${event}`;
}

/**
 * Get a stable id for a layout item. Layout items historically used
 * numeric `id`; some newer flows also carry `uuidString`/`uuid`. The
 * runtime event-string format uses whichever is `item.id`, so we
 * default to that and fall back to the others for resilience.
 */
function itemIdOf(item) {
  if (item == null) return null;
  if (item.id !== undefined && item.id !== null) return String(item.id);
  if (item.uuidString) return item.uuidString;
  if (item.uuid) return item.uuid;
  return null;
}

/**
 * Canonical identity key for a layout item: `component|id-ish`.
 * Single source of truth for dedupe in every query below and in
 * `forEachWidget` (providerResolution.js). Including the component
 * prefix prevents two structurally-different widgets from colliding
 * when they happen to share a uuid (rare, but possible when items
 * are pasted between workspaces).
 *
 * Priority matches forEachWidget's stableId so a widget that
 * forEachWidget visited once produces exactly one map entry across
 * every listener-side consumer — no more `STAGEGATECHECKLIST[4]`
 * appearing twice because one caller used `uuidString` and the
 * other used `id`.
 */
export function canonicalItemKey(item) {
  if (!item || !item.component) return null;
  if (item.uuidString) return `${item.component}|${item.uuidString}`;
  if (item.uuid) return `${item.component}|${item.uuid}`;
  if (item.id !== undefined && item.id !== null) {
    return `${item.component}|${item.id}`;
  }
  return null;
}

// Label/widgetRef derivation lives in `widgetIdentity.js` so every
// surface (Listeners tab, Providers tab, Widgets tab, widget card
// header, layout footer) shows the same widget name + scope.package
// .Component subtitle. Local thin wrapper just attaches the cfg.
function labelFor(item, getWidgetConfig) {
  return pickWidgetDisplayName(item, getWidgetConfig?.(item.component));
}

/**
 * Read the events/eventHandlers metadata for a widget. Items can carry
 * the arrays inline (older pattern where they got cached onto the
 * layout item); the current component config carries them via the
 * ComponentManager catalog. We UNION both so we don't flag a binding
 * as orphaned just because an inline cache is stale — if the current
 * widget code declares the event/handler, the binding is valid.
 */
function eventsOf(item, getWidgetConfig) {
  const inline = Array.isArray(item.events) ? item.events : [];
  const cfg = getWidgetConfig?.(item.component) || {};
  const fromCfg = Array.isArray(cfg.events) ? cfg.events : [];
  return [...new Set([...inline, ...fromCfg])];
}

function eventHandlersOf(item, getWidgetConfig) {
  const inline = Array.isArray(item.eventHandlers) ? item.eventHandlers : [];
  const cfg = getWidgetConfig?.(item.component) || {};
  const fromCfg = Array.isArray(cfg.eventHandlers) ? cfg.eventHandlers : [];
  return [...new Set([...inline, ...fromCfg])];
}

// belongsToWorkspace lives in `widgetIdentity.js` (imported above) so
// every workspace-walker — Listeners, Providers, Widgets, bulk-edit
// panes — uses the same cross-dashboard isolation gate.

/**
 * Every widget instance in the workspace that emits at least one event.
 * Deduplicated by `${component}|${itemId}` — the same compound key that
 * event strings use at runtime, so any "duplicate" in the tree (same
 * widget referenced across pages) resolves to the same wiring target.
 * @returns {Array<{ itemId, component, label, events: string[], key: string }>}
 */
export function getEmitters(workspace, getWidgetConfig) {
  const byKey = new Map();
  forEachWidget(workspace, (item) => {
    if (!isUserWidget(item)) return;
    if (!belongsToWorkspace(item, workspace)) return;
    const events = eventsOf(item, getWidgetConfig);
    if (events.length === 0) return;
    const key = canonicalItemKey(item);
    if (!key) return;
    if (byKey.has(key)) return;
    byKey.set(key, {
      key,
      itemId: itemIdOf(item),
      component: item.component,
      label: labelFor(item, getWidgetConfig),
      widgetRef: pickWidgetRef(item),
      events,
    });
  });
  return Array.from(byKey.values());
}

/**
 * Every widget instance in the workspace that accepts at least one
 * handler. Used to populate the receiver dropdown. Deduplicated by
 * `${component}|${itemId}` (see getEmitters).
 * @returns {Array<{ itemId, component, label, widgetRef, eventHandlers: string[], listeners: object, key: string }>}
 */
export function getReceivers(workspace, getWidgetConfig) {
  const byKey = new Map();
  forEachWidget(workspace, (item) => {
    if (!isUserWidget(item)) return;
    if (!belongsToWorkspace(item, workspace)) return;
    const handlers = eventHandlersOf(item, getWidgetConfig);
    if (handlers.length === 0) return;
    const key = canonicalItemKey(item);
    if (!key) return;
    if (byKey.has(key)) return;
    byKey.set(key, {
      key,
      itemId: itemIdOf(item),
      component: item.component,
      label: labelFor(item, getWidgetConfig),
      widgetRef: pickWidgetRef(item),
      eventHandlers: handlers,
      listeners: item.listeners || {},
    });
  });
  return Array.from(byKey.values());
}

/**
 * Flatten every listener binding in the workspace into a list of
 * { receiverItemId, receiverComponent, handlerName, sourceComponent,
 *   sourceItemId, eventName, raw } tuples. `raw` is the original
 * event string for round-trip fidelity on remove.
 */
export function getCurrentWiring(workspace) {
  const wiring = [];
  forEachWidget(workspace, (item) => {
    if (!belongsToWorkspace(item, workspace)) return;
    const receiverItemId = itemIdOf(item);
    if (receiverItemId == null) return;
    const listeners = item.listeners;
    if (!listeners || typeof listeners !== "object") return;

    for (const [handlerName, eventList] of Object.entries(listeners)) {
      // Live format is array; defensive guard for legacy object
      // form (a single source widget keyed under the handler).
      const events = Array.isArray(eventList)
        ? eventList
        : typeof eventList === "string"
          ? [eventList]
          : [];
      for (const raw of events) {
        const parsed = parseEventString(raw);
        if (!parsed) continue;
        wiring.push({
          receiverItemId,
          receiverComponent: item.component,
          handlerName,
          sourceComponent: parsed.component,
          sourceItemId: parsed.itemId,
          eventName: parsed.event,
          raw,
        });
      }
    }
  });
  return wiring;
}

/**
 * Detect listener bindings that are no longer valid: the source widget
 * doesn't exist in the workspace anymore, or the source widget doesn't
 * declare the event, or the receiver doesn't declare the handler.
 * Each entry includes a `reason` so the modal can show a sensible
 * message.
 */
export function getOrphanedListeners(workspace, getWidgetConfig) {
  const wiring = getCurrentWiring(workspace);
  if (wiring.length === 0) return [];

  // Build two lookups:
  //   byCompositeKey: `${component}|${itemId}` → widget meta  (primary)
  //   byItemId:       `${itemId}`              → widget meta  (fallback,
  //                      used only for the "source-missing" check where
  //                      the wiring's component can't be trusted yet)
  // The composite key matches how the runtime event-string
  // (`Component[itemId].event`) identifies a widget, so orphan
  // decisions line up with what actually fires at runtime.
  const byCompositeKey = new Map();
  const byItemId = new Map();
  forEachWidget(workspace, (item) => {
    if (!belongsToWorkspace(item, workspace)) return;
    const id = itemIdOf(item);
    if (id == null) return;
    const meta = {
      component: item.component,
      events: eventsOf(item, getWidgetConfig),
      eventHandlers: eventHandlersOf(item, getWidgetConfig),
    };
    byCompositeKey.set(`${item.component}|${id}`, meta);
    // First-seen wins on numeric-id collisions; good enough for the
    // "does any widget with this id exist?" fallback.
    if (!byItemId.has(id)) byItemId.set(id, meta);
  });

  const orphans = [];
  for (const w of wiring) {
    const srcKey = `${w.sourceComponent}|${w.sourceItemId}`;
    const src = byCompositeKey.get(srcKey);
    if (!src) {
      // No (component, id) match. If some OTHER widget still owns
      // this id, the source component changed; otherwise it's truly
      // missing. Preserves the user's ability to see whether a
      // rename happened vs. a delete.
      const fallback = byItemId.get(String(w.sourceItemId));
      orphans.push({
        ...w,
        reason: fallback ? "source-component-mismatch" : "source-missing",
      });
      continue;
    }
    if (!src.events.includes(w.eventName)) {
      orphans.push({ ...w, reason: "event-not-emitted" });
      continue;
    }
    const receiverKey = `${w.receiverComponent}|${w.receiverItemId}`;
    const receiver = byCompositeKey.get(receiverKey);
    if (receiver && !receiver.eventHandlers.includes(w.handlerName)) {
      orphans.push({ ...w, reason: "handler-not-declared" });
    }
  }
  return orphans;
}

/**
 * Mutate a workspace tree in place, removing listener bindings whose
 * source widget is not present in the workspace. Pure: doesn't need
 * ComponentManager, so it's safe to call from WorkspaceModel during
 * load — the workspace's own tree is the only source of truth.
 *
 * Handles the four cases producing a "source-missing" orphan:
 *   - the emitter widget was deleted
 *   - the emitter widget's id now belongs to a different component
 *     (stored binding has stale component name)
 *   - the source string failed to parse (legacy/garbage data)
 *
 * Leaves "event-not-emitted" / "handler-not-declared" cases untouched
 * because they require the current widget catalog to decide — those
 * are handled at runtime with full ComponentManager access.
 *
 * @returns {number} count of bindings removed (for logging/diagnostics)
 */
export function pruneDeadListenerReferences(workspace) {
  if (!workspace) return 0;

  // Build the set of live widgets in the tree, keyed by the same
  // `${component}|${itemId}` the runtime uses to resolve events.
  const liveKeys = new Set();
  const walkForLive = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.component) {
        const id = itemIdOf(item);
        if (id != null) liveKeys.add(`${item.component}|${id}`);
      }
      if (Array.isArray(item.items)) walkForLive(item.items);
      if (Array.isArray(item.layout)) walkForLive(item.layout);
    }
  };
  walkForLive(workspace.layout);
  if (Array.isArray(workspace.pages)) {
    for (const page of workspace.pages) walkForLive(page?.layout);
  }
  walkForLive(workspace.sidebarLayout);

  let removed = 0;
  const pruneListeners = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.listeners && typeof item.listeners === "object") {
        for (const handler of Object.keys(item.listeners)) {
          const events = item.listeners[handler];
          if (!Array.isArray(events)) continue;
          const kept = [];
          for (const raw of events) {
            const parsed = parseEventString(raw);
            if (
              parsed &&
              liveKeys.has(`${parsed.component}|${parsed.itemId}`)
            ) {
              kept.push(raw);
            } else {
              removed += 1;
            }
          }
          if (kept.length === 0) {
            delete item.listeners[handler];
          } else if (kept.length !== events.length) {
            item.listeners[handler] = kept;
          }
        }
      }
      if (Array.isArray(item.items)) pruneListeners(item.items);
      if (Array.isArray(item.layout)) pruneListeners(item.layout);
    }
  };
  pruneListeners(workspace.layout);
  if (Array.isArray(workspace.pages)) {
    for (const page of workspace.pages) pruneListeners(page?.layout);
  }
  pruneListeners(workspace.sidebarLayout);

  return removed;
}

/**
 * Apply a staged delta to a workspace's listener bindings and return a
 * NEW workspace object (deep-cloned along the modified path).
 *
 * `adds` / `removes` are arrays of
 *   { receiverItemId, handlerName, sourceComponent, sourceItemId, eventName }
 *
 * Removes may also pass `raw` (the exact pre-existing event string) for
 * a precise match; otherwise we match on the canonical formatted form.
 */
export function applyWiringChanges(workspace, { adds = [], removes = [] }) {
  if (!workspace) return workspace;
  if (adds.length === 0 && removes.length === 0) return workspace;

  // Group changes by receiver for cheap per-item updates.
  const byReceiver = new Map();
  const ensure = (id) => {
    if (!byReceiver.has(id)) byReceiver.set(id, { adds: [], removes: [] });
    return byReceiver.get(id);
  };
  for (const a of adds) {
    if (!a.receiverItemId) continue;
    ensure(String(a.receiverItemId)).adds.push(a);
  }
  for (const r of removes) {
    if (!r.receiverItemId) continue;
    ensure(String(r.receiverItemId)).removes.push(r);
  }

  // Walk the tree and rebuild listeners on every touched item. We do
  // shallow clones along the path so React change detection is
  // reliable — but the tree shape is preserved.
  const cloneList = (items) =>
    Array.isArray(items) ? items.map((item) => transform(item)) : items;

  const transform = (item) => {
    if (!item || typeof item !== "object") return item;
    let next = item;

    const id = itemIdOf(item);
    const change = id != null ? byReceiver.get(String(id)) : null;
    if (change) {
      const newListeners = applyToItem(item.listeners || {}, change);
      next = { ...next, listeners: newListeners };
    }
    if (Array.isArray(next.items)) {
      next = { ...next, items: cloneList(next.items) };
    }
    if (Array.isArray(next.layout)) {
      next = { ...next, layout: cloneList(next.layout) };
    }
    return next;
  };

  const updatedWs = { ...workspace };
  if (Array.isArray(workspace.layout)) {
    updatedWs.layout = cloneList(workspace.layout);
  }
  if (Array.isArray(workspace.pages)) {
    updatedWs.pages = workspace.pages.map((page) => ({
      ...page,
      layout: cloneList(page.layout),
    }));
  }
  if (Array.isArray(workspace.sidebarLayout)) {
    updatedWs.sidebarLayout = cloneList(workspace.sidebarLayout);
  }
  return updatedWs;
}

function applyToItem(listeners, { adds, removes }) {
  // Deep enough clone for handler arrays.
  const next = {};
  for (const [k, v] of Object.entries(listeners)) {
    next[k] = Array.isArray(v) ? [...v] : v;
  }

  // Removes first so a re-add (rare) lands.
  for (const r of removes) {
    const target = r.handlerName;
    if (!target) continue;
    const events = next[target];
    if (!Array.isArray(events)) continue;
    const eventStr =
      r.raw ||
      formatEventString(r.sourceComponent, r.sourceItemId, r.eventName);
    const filtered = events.filter((e) => e !== eventStr);
    if (filtered.length === 0) {
      delete next[target];
    } else {
      next[target] = filtered;
    }
  }

  for (const a of adds) {
    const target = a.handlerName;
    if (!target) continue;
    const eventStr = formatEventString(
      a.sourceComponent,
      a.sourceItemId,
      a.eventName,
    );
    const existing = Array.isArray(next[target]) ? next[target] : [];
    if (existing.includes(eventStr)) continue;
    next[target] = [...existing, eventStr];
  }

  return next;
}
