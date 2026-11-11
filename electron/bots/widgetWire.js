/**
 * widgetWire.js
 *
 * A widget that shows what a bot sends (team-dashboards TD-009): the user
 * drags a line from a bot to a widget on the Bots diagram and says what the
 * widget should do with it; a widget with no listener for it is changed by
 * the Dash team. The change carries a `wire` — which bot, which of its
 * events, the listener's name (picked by Dash) and the user's words — and
 * this module turns it into the Builder's and Checker's instructions and
 * the check that the listener is really there. Dash adds the listener to
 * the dashboard after the user saves the change.
 *
 * Pure (NFR-006): no Electron, no I/O.
 */
"use strict";

const HANDLER_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const BOT_ID_RE = /^bot_[A-Za-z0-9_-]+$/;
const EVENT_RE =
  /^(completed|failed|result\.[A-Za-z][A-Za-z0-9_]{0,39}|tool\.[A-Za-z0-9_.-]{1,120})$/;

const text = (v, max) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The wire as the renderer sent it, checked — or null. */
function cleanWire(w) {
  if (!w || typeof w !== "object") return null;
  const botId = text(w.botId, 80);
  const event = text(w.event, 160);
  const handlerName = text(w.handlerName, 60);
  if (!BOT_ID_RE.test(botId) || !EVENT_RE.test(event)) return null;
  if (!HANDLER_RE.test(handlerName)) return null;
  return {
    botId,
    botName: text(w.botName, 80) || "the bot",
    event,
    eventLabel: text(w.eventLabel, 80) || event,
    handlerName,
    ask: text(w.ask, 1000),
  };
}

/** Where the event's own content is, in the message the widget gets. */
function payloadField(event) {
  if (event === "completed")
    return "message.output — the bot's whole answer as text (often Markdown)";
  if (event === "failed") return "message.error — what went wrong, as text";
  if (String(event).startsWith("result."))
    return "message.items — the list of items the bot sent (and message.summary)";
  return "message.result — what the tool returned, as text";
}

/** Where the bot's real messages can be read, by event. */
function samplesLine(wire, who) {
  if (wire.event === "completed") {
    return `${who} what ${wire.botName} really sends: bot_answers with bot "${wire.botId}" gives its last answers whole. An answer longer than 8 KB arrives as its last 8 KB, starting "…[truncated]" — show that as text. Build for the formats you find there — never assume fields a bot doesn't send.`;
  }
  if (String(wire.event).startsWith("result.")) {
    return `${who} what ${wire.botName} really sends: bot_results gives its latest "${wire.event.slice(7)}" result — use the fields its items really have, never assume others.`;
  }
  return `There's nothing to read beforehand: the message is plain text.`;
}

/** What the Builder is told, after the change's other lines. */
function wireBuildLines(wire) {
  if (!wire) return [];
  const h = wire.handlerName;
  const reads = wire.event === "completed" || wire.event === "failed";
  return [
    `This change makes the widget show what the bot ${wire.botName} sends when it ${wire.eventLabel.toLowerCase()}.${
      wire.ask ? ` The user asked: ${JSON.stringify(wire.ask)}` : ""
    }`,
    samplesLine(wire, "Before writing code, read"),
    `Add one listener named exactly ${h}: put "${h}" in eventHandlers in its .dash.js, and in the component use useWidgetEvents from "@trops/dash-core" — const { listen, listeners } = useWidgetEvents(); useEffect(() => { listen(listeners, { ${h}: (data) => { const message = (data && data.message) || data; … } }); }, [listeners, listen]);. The bot's content is in ${payloadField(wire.event)}.`,
    reads
      ? `Read the text with readBotAnswer(text) from "@trops/dash-core" (it finds Markdown lists, tables, images, links and JSON and returns { kind, items, table, json, sections, links, images, text }); show what the user asked from that. When it finds nothing usable, show the text as it is — never show nothing.`
      : `Show what the user asked from it; when it's missing or empty, say so in the widget — never show nothing.`,
    `A message with replay: true is the bot's last one, handed over when the dashboard opens: show it like a new one. Keep the last message in state so the widget doesn't go blank on a re-render, and open links with target="_blank".`,
    "Don't add the listener to the dashboard yourself — Dash connects it after the user saves.",
  ];
}

/** What the Checker is told, after the change's other lines. */
function wireCheckLines(wire) {
  if (!wire) return [];
  return [
    `It must show what the bot ${wire.botName} sends (${wire.eventLabel}) through a listener named exactly ${wire.handlerName}: check_widget fails it when the .dash.js doesn't list it in eventHandlers or the component never listens with it.${
      wire.ask ? ` The user asked: ${JSON.stringify(wire.ask)}` : ""
    }`,
    wire.event === "completed"
      ? `Read ${wire.botName}'s last answers with bot_answers (bot "${wire.botId}") and say, for each one, whether this code would show it as asked — or show it as text when it can't. Code that would show nothing for one of them fails.`
      : String(wire.event).startsWith("result.")
        ? `Read ${wire.botName}'s latest "${wire.event.slice(7)}" result with bot_results and say whether this code shows its items as asked. Code that would show nothing for it fails.`
        : "Say whether this code shows the message's text, and something sensible when it's empty.",
  ];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What's missing for the wire in the drafted code, as check problems. */
function wireProblems(componentCode, configCode, wire) {
  if (!wire) return [];
  const h = wire.handlerName;
  const out = [];
  const config = String(configCode || "");
  const component = String(componentCode || "");
  const handlers = /eventHandlers\s*:\s*\[([^\]]*)\]/.exec(config);
  const quoted = new RegExp(`["'\`]${escapeRe(h)}["'\`]`);
  if (!handlers || !quoted.test(handlers[1])) {
    out.push(
      `Its .dash.js doesn't list "${h}" in eventHandlers — without it Dash can't connect ${wire.botName} to the widget.`,
    );
  }
  if (!/\blisten\s*\(/.test(component)) {
    out.push(
      `It never calls listen from useWidgetEvents, so ${wire.botName}'s messages never reach it.`,
    );
  } else if (!new RegExp(`\\b${escapeRe(h)}\\b\\s*[:(]`).test(component)) {
    out.push(
      `It calls listen, but not with a handler named ${h} — the listener Dash connects.`,
    );
  }
  return out;
}

/** check_widget's result with the wire's problems added. */
function withWireProblems(res, wire) {
  if (!res || !res.success || !wire) return res;
  const extra = wireProblems(res.componentCode, res.configCode, wire);
  if (!extra.length) return res;
  const next = Object.create(Object.getPrototypeOf(res));
  for (const key of Reflect.ownKeys(res)) {
    Object.defineProperty(next, key, Object.getOwnPropertyDescriptor(res, key));
  }
  next.problems = [...(res.problems || []), ...extra];
  return next;
}

module.exports = {
  cleanWire,
  payloadField,
  wireBuildLines,
  wireCheckLines,
  wireProblems,
  withWireProblems,
};
