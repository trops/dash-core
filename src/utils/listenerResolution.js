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
 * Best-effort human label for a layout item: explicit title, then
 * widget config display name, then component name + short id.
 */
function labelFor(item, getWidgetConfig) {
    const cfg = getWidgetConfig?.(item.component) || null;
    const explicit =
        item?.userPrefs?.title || item?.userConfig?.title;
    if (explicit) return explicit;
    if (cfg?.displayName) return cfg.displayName;
    const id = itemIdOf(item);
    return `${item.component || "widget"}${id ? `[${String(id).slice(0, 6)}]` : ""}`;
}

/**
 * Read the events/eventHandlers metadata for a widget. Items can
 * carry the arrays inline (older pattern); otherwise look them up on
 * the catalog via `getWidgetConfig`. Always returns arrays of strings.
 */
function eventsOf(item, getWidgetConfig) {
    if (Array.isArray(item.events) && item.events.length > 0)
        return [...new Set(item.events)];
    const cfg = getWidgetConfig?.(item.component) || {};
    return Array.isArray(cfg.events) ? [...new Set(cfg.events)] : [];
}

function eventHandlersOf(item, getWidgetConfig) {
    if (Array.isArray(item.eventHandlers) && item.eventHandlers.length > 0)
        return [...new Set(item.eventHandlers)];
    const cfg = getWidgetConfig?.(item.component) || {};
    return Array.isArray(cfg.eventHandlers)
        ? [...new Set(cfg.eventHandlers)]
        : [];
}

/**
 * Every widget instance in the workspace that emits at least one event.
 * @returns {Array<{ itemId, component, label, events: string[] }>}
 */
export function getEmitters(workspace, getWidgetConfig) {
    const emitters = [];
    forEachWidget(workspace, (item) => {
        const events = eventsOf(item, getWidgetConfig);
        if (events.length === 0) return;
        const itemId = itemIdOf(item);
        if (itemId == null) return;
        emitters.push({
            itemId,
            component: item.component,
            label: labelFor(item, getWidgetConfig),
            events,
        });
    });
    return emitters;
}

/**
 * Every widget instance in the workspace that accepts at least one
 * handler. Used to populate the receiver dropdown.
 * @returns {Array<{ itemId, component, label, eventHandlers: string[], listeners: object }>}
 */
export function getReceivers(workspace, getWidgetConfig) {
    const receivers = [];
    forEachWidget(workspace, (item) => {
        const handlers = eventHandlersOf(item, getWidgetConfig);
        if (handlers.length === 0) return;
        const itemId = itemIdOf(item);
        if (itemId == null) return;
        receivers.push({
            itemId,
            component: item.component,
            label: labelFor(item, getWidgetConfig),
            eventHandlers: handlers,
            listeners: item.listeners || {},
        });
    });
    return receivers;
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

    // Build lookup: itemId -> { component, events, eventHandlers }
    const widgetsById = new Map();
    forEachWidget(workspace, (item) => {
        const id = itemIdOf(item);
        if (id == null) return;
        widgetsById.set(id, {
            component: item.component,
            events: eventsOf(item, getWidgetConfig),
            eventHandlers: eventHandlersOf(item, getWidgetConfig),
        });
    });

    const orphans = [];
    for (const w of wiring) {
        const src = widgetsById.get(String(w.sourceItemId));
        if (!src) {
            orphans.push({ ...w, reason: "source-missing" });
            continue;
        }
        if (src.component !== w.sourceComponent) {
            // ID hit a different widget than the binding's expected
            // component — treat as missing rather than silently
            // re-targeting.
            orphans.push({ ...w, reason: "source-component-mismatch" });
            continue;
        }
        if (!src.events.includes(w.eventName)) {
            orphans.push({ ...w, reason: "event-not-emitted" });
            continue;
        }
        const receiver = widgetsById.get(String(w.receiverItemId));
        if (receiver && !receiver.eventHandlers.includes(w.handlerName)) {
            orphans.push({ ...w, reason: "handler-not-declared" });
        }
    }
    return orphans;
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
        if (!byReceiver.has(id))
            byReceiver.set(id, { adds: [], removes: [] });
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
        Array.isArray(items)
            ? items.map((item) => transform(item))
            : items;

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
