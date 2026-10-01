/**
 * eventCatalog.js
 *
 * The events a bot can subscribe to, built for the bot form's picker so users
 * pick events instead of typing them (Bot Factory PRD US-011 AC9).
 *
 * Widget events come from each dashboard's widgets and the events their
 * `.dash.js` declares — the same source as Dashboard Config → Listeners
 * (`getEmitters`). A subscription keeps the exact runtime `eventType`
 * (`Component[itemId].event`, what the matcher compares) plus a structured
 * `source` so a bot template can later export it portably (ref + event, no
 * local ids) and re-resolve it on install.
 *
 * Pure: no React, no IPC.
 */
import {
  getEmitters,
  formatEventString,
} from "../../../utils/listenerResolution";

/**
 * @param {Array<object>} workspaces  dashboards (each with id, name, layout/pages)
 * @param {(component: string) => object|null} getWidgetConfig
 * @returns {Array<{ workspaceId: string, name: string,
 *   widgets: Array<{ ref: string, instanceId: string, label: string, events: string[] }> }>}
 *   dashboards with at least one event-emitting widget
 */
export function buildWidgetEventCatalog(workspaces, getWidgetConfig) {
  if (!Array.isArray(workspaces)) return [];
  const out = [];
  for (const ws of workspaces) {
    if (!ws || ws.id === undefined || ws.id === null) continue;
    const widgets = getEmitters(ws, getWidgetConfig)
      .filter((e) => e.itemId != null && e.events.length)
      .map((e) => ({
        ref: e.component,
        instanceId: String(e.itemId),
        label: e.label || e.component,
        events: e.events,
      }));
    if (!widgets.length) continue;
    out.push({
      workspaceId: String(ws.id),
      name: ws.name || `Dashboard ${ws.id}`,
      widgets,
    });
  }
  // Dashboards can share a name (e.g. copies of "Kitchen Sink"); number the
  // duplicates so each picker entry is distinguishable.
  const totals = {};
  for (const w of out) totals[w.name] = (totals[w.name] || 0) + 1;
  const seen = {};
  for (const w of out) {
    if (totals[w.name] > 1) {
      seen[w.name] = (seen[w.name] || 0) + 1;
      w.name = `${w.name} (${seen[w.name]})`;
    }
  }
  return out;
}

/** A subscription to one widget event, picked from the catalog. */
export function widgetSubscription(workspace, widget, event) {
  return {
    eventType: formatEventString(widget.ref, widget.instanceId, event),
    source: {
      kind: "widget",
      ref: widget.ref,
      instanceId: widget.instanceId,
      event,
      workspaceId: workspace.workspaceId,
    },
    label: `${workspace.name} › ${widget.label} › ${event}`,
  };
}

/**
 * How to show a saved subscription: its label from the live catalog, and
 * whether its widget/event is gone (`missing`). Subscriptions saved before
 * the picker (bare eventType) get a friendly label when they still resolve;
 * otherwise they show as typed.
 */
export function describeSubscription(sub, catalog) {
  const eventType = sub && sub.eventType;
  for (const ws of catalog || []) {
    for (const w of ws.widgets) {
      for (const ev of w.events) {
        if (formatEventString(w.ref, w.instanceId, ev) === eventType) {
          return {
            label: widgetSubscription(ws, w, ev).label,
            missing: false,
          };
        }
      }
    }
  }
  if (sub && sub.source) {
    return { label: sub.label || eventType, missing: true };
  }
  return { label: eventType || "", missing: false };
}
