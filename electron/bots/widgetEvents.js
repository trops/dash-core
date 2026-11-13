/**
 * widgetEvents.js — the events Dash sends for every widget (readComplete,
 * renderComplete, readFailed). Its widget's code never sends them, and no
 * .dash.js needs to list them: bots and widgets can always listen.
 * The renderer's copy is src/utils/widgetEvents.js (keep the names alike).
 */
const RESERVED_WIDGET_EVENTS = ["readComplete", "renderComplete", "readFailed"];

const isReservedEvent = (name) =>
  RESERVED_WIDGET_EVENTS.includes(String(name || ""));

module.exports = { RESERVED_WIDGET_EVENTS, isReservedEvent };
