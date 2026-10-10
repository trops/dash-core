/**
 * resultTools.js
 *
 * Bots send structured results to their dashboard (team-dashboards TD-001).
 * A bot declares results on its definition (`publishes: [{ name, label,
 * description }]`) and gets one in-process tool, `send_result`, served under a
 * virtual "bot-results" server that the bot PermissionGate auto-allows — like
 * memory, it only reaches the bot's own dashboard bus.
 *
 * Portable (NFR-006): no Electron. botController routes RESULTS_SERVER calls
 * here, then saves the latest result and publishes it as
 * `bot:<ref>[<botId>].result.<name>`.
 */
"use strict";

const { resultPayload, parseResultEventType } = require("./botEvents");

const RESULTS_SERVER = "bot-results";
const SEND_RESULT = "send_result";
const MAX_RESULT_ITEMS = 200;
const MAX_RESULT_BYTES = 64 * 1024;

function declared(bot) {
  return ((bot && bot.publishes) || []).filter((p) => p && p.name);
}

/** The bot's result tools: none unless it declares at least one result. */
function resultToolsFor(bot) {
  const results = declared(bot);
  if (!results.length) return [];
  const listing = results
    .map((p) => {
      const about = p.description || p.label;
      return about ? `${p.name} — ${about}` : p.name;
    })
    .join("; ");
  return [
    {
      name: SEND_RESULT,
      description:
        "Send a result to your dashboard. Widgets that show this result update " +
        "right away, and bots that run on it start. Use it to deliver the data " +
        "your instructions ask for, as a list of items. Send the whole current " +
        "list each time — it replaces the previous one. Give every item a short " +
        "`title`; optional `subtitle`, `detail`, `link` (an http or https URL) " +
        "and `time` (ISO 8601). Other fields are passed to widgets as they are. " +
        `Your results: ${listing}.`,
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: results.map((p) => p.name),
            description: "Which of your results this is.",
          },
          items: {
            type: "array",
            items: { type: "object" },
            description: `The items, at most ${MAX_RESULT_ITEMS}. An empty list clears the result.`,
          },
          summary: {
            type: "string",
            description:
              "Optional one-line summary, e.g. '3 emails need a reply'.",
          },
        },
        required: ["name", "items"],
      },
    },
  ];
}

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Check a send_result call against the bot's declared results.
 * @returns {{ ok: true, result: { name, label, items, summary } }
 *         | { ok: false, message: string }}
 */
function checkResult(bot, args) {
  const a = args || {};
  const decl = declared(bot).find((p) => p.name === a.name);
  if (!decl) {
    const names = declared(bot).map((p) => p.name);
    return {
      ok: false,
      message: names.length
        ? `'${a.name}' isn't one of your results (${names.join(", ")}).`
        : "This bot doesn't declare any results.",
    };
  }
  if (!Array.isArray(a.items)) {
    return { ok: false, message: "'items' must be a list of objects." };
  }
  if (a.items.length > MAX_RESULT_ITEMS) {
    return {
      ok: false,
      message: `Too many items (${a.items.length}); send at most ${MAX_RESULT_ITEMS}.`,
    };
  }
  if (!a.items.every(isPlainObject)) {
    return { ok: false, message: "Every item must be an object." };
  }
  if (a.summary != null && typeof a.summary !== "string") {
    return { ok: false, message: "'summary' must be text." };
  }
  let json;
  try {
    json = JSON.stringify({ items: a.items, summary: a.summary || null });
  } catch (_e) {
    return { ok: false, message: "The items couldn't be read as JSON." };
  }
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_RESULT_BYTES) {
    return {
      ok: false,
      message: `The result is too large (${Math.ceil(bytes / 1024)} KB); keep it under ${MAX_RESULT_BYTES / 1024} KB — fewer items or shorter text.`,
    };
  }
  // A JSON round trip leaves plain data only.
  const clean = JSON.parse(json);
  return {
    ok: true,
    result: {
      name: decl.name,
      label: decl.label || decl.name,
      items: clean.items,
      summary: clean.summary,
    },
  };
}

/**
 * A bot's send_result call: check it, save it as the latest result for its
 * name, then publish it (widgets + subscribed bots).
 * @param {{ store: object, publisher: { sendResult: Function },
 *           now?: () => string }} deps
 * @returns {{ text: string, isError: boolean }}
 */
function sendResult({ store, publisher, now }, botId, args) {
  const bot = store.get(botId);
  if (!bot) return { text: "Unknown bot.", isError: true };
  const check = checkResult(bot, args);
  if (!check.ok) return { text: check.message, isError: true };
  const payload = resultPayload(bot, {
    ...check.result,
    sentAt: now ? now() : new Date().toISOString(),
  });
  try {
    store.setResult(bot.id, payload.name, payload);
  } catch (e) {
    return {
      text: `Couldn't save the result: ${(e && e.message) || e}`,
      isError: true,
    };
  }
  publisher.sendResult(bot, payload);
  const n = payload.items.length;
  return {
    text: `Sent "${payload.label}" (${n} item${n === 1 ? "" : "s"}).`,
    isError: false,
  };
}

/**
 * The saved latest result for a result event type
 * (`bot:<ref>[<botId>].result.<name>`), or null when it isn't one, the bot
 * is gone, or the bot no longer declares that result.
 */
function latestResult(store, eventType) {
  const parsed = parseResultEventType(eventType);
  if (!parsed) return null;
  const bot = store.get(parsed.botId);
  if (!bot || !declared(bot).some((p) => p.name === parsed.name)) return null;
  return store.getResult(bot.id, parsed.name);
}

module.exports = {
  RESULTS_SERVER,
  SEND_RESULT,
  MAX_RESULT_ITEMS,
  MAX_RESULT_BYTES,
  resultToolsFor,
  checkResult,
  sendResult,
  latestResult,
};
