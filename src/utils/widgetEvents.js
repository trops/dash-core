/**
 * widgetEvents — the events every widget sends, sent by Dash itself (the
 * approved "Widget, step by step" Talks to step): readComplete when it has
 * read from its provider, readFailed when it couldn't, renderComplete when
 * it's on screen. Any widget or bot can listen; nothing to set up, and the
 * widget's own code never sends them.
 *
 * Also the one place a widget event's name is made
 * ("<component>[<layout item id>].<event>") and the renderer's copy of
 * roleTools.classifyTool (keep the verbs in step with
 * electron/bots/roleTools.js).
 */
import { DashboardPublisher } from "../DashboardPublisher";

import {
  READ_COMPLETE,
  RENDER_COMPLETE,
  READ_FAILED,
  widgetEventName,
} from "./widgetEventNames";

export {
  READ_COMPLETE,
  RENDER_COMPLETE,
  READ_FAILED,
  RESERVED_WIDGET_EVENTS,
  isReservedEvent,
  widgetEventName,
} from "./widgetEventNames";

const READ_VERBS = new Set(
  "get list search read find fetch query describe view count lookup show check download export history info status".split(
    " ",
  ),
);
const CHANGE_VERBS = new Set(
  "write create edit delete remove append move rename update set add insert send post reply forward archive upload publish invite share mark label trash star schedule cancel approve merge close open assign modify patch put run execute react pin kick join leave".split(
    " ",
  ),
);

const nameWords = (name) =>
  String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Can this tool change things? Its read-only flag wins; otherwise the
 * first verb in its name. "unknown" when neither says.
 */
export function classifyTool(tool) {
  const name = typeof tool === "string" ? tool : tool && tool.name;
  const ann = (tool && typeof tool === "object" && tool.annotations) || {};
  if (ann.readOnlyHint === true) return "read";
  if (ann.readOnlyHint === false || ann.destructiveHint === true) {
    return "change";
  }
  for (const w of nameWords(name)) {
    if (READ_VERBS.has(w)) return "read";
    if (CHANGE_VERBS.has(w)) return "change";
  }
  return "unknown";
}

// What it read, kept small: every window gets it, and the last one is kept.
const MAX_TEXT = 2000;

/** A tool result's text, short — for readComplete. */
export function resultText(result) {
  const content = result && Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function send(widgetData, event, payload) {
  const d = widgetData || {};
  const name = widgetEventName(d.componentName, d.id, event);
  if (!name) return;
  try {
    DashboardPublisher.pub(name, payload, { workspaceId: d.dashboardId });
  } catch (_e) {
    // A widget keeps working if no one can hear it.
  }
}

/**
 * After a call to the widget's provider: readComplete for a read that
 * worked, readFailed for one that didn't. A call that changes things sends
 * neither — it isn't a read.
 */
export function sendReadEvent(widgetData, { provider, tool, result, error }) {
  if (classifyTool(tool) === "change") return;
  const at = new Date().toISOString();
  if (error) {
    send(widgetData, READ_FAILED, {
      provider: provider || null,
      tool,
      error: String(error),
      at,
    });
    return;
  }
  send(widgetData, READ_COMPLETE, {
    provider: provider || null,
    tool,
    result: resultText(result),
    at,
  });
}

/** The widget is on screen. */
export function sendRenderEvent(widgetData) {
  send(widgetData, RENDER_COMPLETE, { at: new Date().toISOString() });
}
