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
export function describeSubscription(sub, catalog, botCatalog = []) {
  const eventType = sub && sub.eventType;
  // Bot subscriptions resolve against the bot catalog; `kind` lets the form
  // say "bot missing" instead of "widget missing".
  if (sub && sub.source && sub.source.kind === "bot") {
    for (const b of botCatalog || []) {
      for (const ev of b.events) {
        const s = botSubscription(b, ev);
        if (s.eventType === eventType) {
          return { label: s.label, missing: false, kind: "bot" };
        }
      }
    }
    return { label: sub.label || eventType, missing: true, kind: "bot" };
  }
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

/**
 * Events other bots publish (bot:<ref>[<botId>].<event>, PRD US-010), for the
 * "Another bot" side of the picker. Derived from each bot's settings — never
 * hand-declared: Completed, Failed, and one `tool.<providerType>.<tool>` per
 * tool the bot may use (the provider's tools, narrowed by the bot's
 * selection). Providers with no known type or tool list are skipped.
 *
 * @param {Array<object>} bots
 * @param {Array<{name, type, tools}>} toolSources  bots.listToolSources()
 * @param {string} [excludeBotId]  the bot being edited — can't trigger itself
 */
export function buildBotEventCatalog(bots, toolSources, excludeBotId = null) {
  if (!Array.isArray(bots)) return [];
  const sources = Array.isArray(toolSources) ? toolSources : [];
  const out = [];
  for (const bot of bots) {
    if (!bot || !bot.id || !bot.ref || bot.id === excludeBotId) continue;
    const events = [
      { event: "completed", label: "Completed" },
      { event: "failed", label: "Failed" },
    ];
    for (const provider of bot.mcpServers || []) {
      const src = sources.find((s) => s && s.name === provider);
      if (!src || !src.type || !Array.isArray(src.tools)) continue;
      const sel = bot.toolSelections && bot.toolSelections[provider];
      const tools = Array.isArray(sel)
        ? src.tools.filter((t) => sel.includes(t))
        : src.tools;
      for (const tool of tools) {
        events.push({
          event: `tool.${src.type}.${tool}`,
          label: `${provider} › ${tool}`,
        });
      }
    }
    out.push({ botId: bot.id, ref: bot.ref, name: bot.name || bot.id, events });
  }
  return out;
}

/** A subscription to one bot event, picked from the bot catalog. */
export function botSubscription(botEntry, ev) {
  return {
    eventType: `bot:${botEntry.ref}[${botEntry.botId}].${ev.event}`,
    source: {
      kind: "bot",
      ref: botEntry.ref,
      instanceId: botEntry.botId,
      event: ev.event,
    },
    label: `${botEntry.name} › ${ev.label}`,
  };
}
