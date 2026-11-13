/**
 * The events Dash sends for every widget, and how a widget event is named
 * — pure, so models and checks can use it (widgetEvents.js sends them).
 * Keep the names alike in electron/bots/widgetEvents.js.
 */
export const READ_COMPLETE = "readComplete";
export const RENDER_COMPLETE = "renderComplete";
export const READ_FAILED = "readFailed";

/** Sent for every widget, whatever its .dash.js lists. */
export const RESERVED_WIDGET_EVENTS = [
  READ_COMPLETE,
  RENDER_COMPLETE,
  READ_FAILED,
];

export const isReservedEvent = (name) =>
  RESERVED_WIDGET_EVENTS.includes(String(name || ""));

/** "Calendar[12].readComplete" — or null without a component and id. */
export function widgetEventName(component, id, event) {
  if (!component || id === null || id === undefined || id === "") return null;
  return `${component}[${id}].${event}`;
}
