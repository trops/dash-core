/**
 * widgetPanelText.js — the words of the edit panel's widget panel
 * (consolidation Phase 3P): whose a widget is, event and handler names a
 * person can read, the listeners a widget has, why Change waits, and the
 * card's "something's missing" pill (Phase 4c).
 *
 * Pure.
 */
import { deriveWidgetOwnership } from "../../utils/widgetOwnership";
import { parseEventString, isBotSource } from "../../utils/listenerResolution";

/**
 * "Built by AI · yours", "Yours · published to the registry",
 * "From the registry · by acme", "Built into Dash" — or "".
 */
export function ownerLabel({ component, sourcePackage = null, username = "" }) {
  const id = typeof component === "string" ? component : "";
  if (id.startsWith("dash.")) return "Built into Dash";
  const { widgetScope, isOwner } = deriveWidgetOwnership({
    originalPackage: sourcePackage,
    originalComponentName: id,
    registryUsername: username || null,
  });
  const scope = String(widgetScope || "").toLowerCase();
  if (scope === "ai-built") return "Built by AI · yours";
  if (isOwner) return "Yours · published to the registry";
  if (scope) return `From the registry · by ${widgetScope}`;
  return "";
}

/**
 * A code name as words: "queryChanged" → "query changed",
 * "onQueryChanged" → "query changed" (a handler's "on" dropped),
 * "fetch_complete" → "fetch complete".
 */
export function humanizeName(name, { handler = false } = {}) {
  let s = String(name || "");
  if (handler) s = s.replace(/^(on|handle)(?=[A-Z_])/, "");
  return s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The listeners a widget has, one row each: which widget or bot sends what,
 * and which of this widget's handlers runs.
 * @param {object} item  the widget's layout item ({ listeners })
 * @param {(component: string, itemId: string) => string} nameOf
 *   the source's display name (a widget on the dashboard, or a bot)
 * @returns {Array<{ handler, eventString, source, event, isBot }>}
 */
export function listenerRows(item, nameOf = () => "") {
  const listeners = (item && item.listeners) || {};
  const rows = [];
  for (const handler of Object.keys(listeners)) {
    const list = listeners[handler];
    if (!Array.isArray(list)) continue;
    for (const eventString of list) {
      const parsed = parseEventString(eventString);
      if (!parsed) continue;
      rows.push({
        handler,
        eventString,
        source:
          nameOf(parsed.component, parsed.itemId) ||
          humanizeName(parsed.component.split(".").pop()),
        event: parsed.event,
        isBot: isBotSource(parsed.component),
      });
    }
  }
  return rows;
}

/**
 * The card's one "something's missing" pill (consolidation Phase 4c): a
 * required connection that isn't set, and listeners not connected. One
 * problem names itself; two say "2 things to fix". It opens the panel at
 * the first fix — Connections before Listens for.
 * @param {{ missingConnections?: string[], unconnectedListeners?: number,
 *   label?: (type: string) => string }} args
 * @returns {null | { text, section: "providers" | "handlers", icon }}
 */
export function cardFixPill({
  missingConnections = [],
  unconnectedListeners = 0,
  label = (t) => t,
} = {}) {
  const conn = missingConnections.filter(Boolean);
  const n = Number(unconnectedListeners) || 0;
  const count = conn.length + (n > 0 ? 1 : 0);
  if (!count) return null;
  if (count > 1) {
    return {
      text: `${count} things to fix`,
      section: conn.length ? "providers" : "handlers",
      icon: "triangle-exclamation",
    };
  }
  if (conn.length) {
    const name = label(conn[0]);
    return {
      text: `Needs ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} connection`,
      section: "providers",
      icon: "plug",
    };
  }
  return {
    text: `${n} listener${n === 1 ? "" : "s"} not connected`,
    section: "handlers",
    icon: "tower-broadcast",
  };
}

/** Why Change waits: "Save or cancel your 1 change first." */
export function changeBlockedText(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `Save or cancel your ${n === 1 ? "1 change" : `${n} changes`} first.`;
}
