/**
 * BotEventPublisher.js
 *
 * Turns a bot's run into events on the dashboard bus (PRD US-010):
 *   - `completed` / `failed` when the run ends (with its final text / error)
 *   - `tool.<providerType>.<tool>` per successful provider tool call
 * Every event carries the run's loop chain (see botEvents.checkChain).
 *
 * One run per bot at a time (BotRunner skips overlaps), so per-run state is
 * keyed by bot id. Publishing is best-effort: a failure never breaks a run.
 *
 * Pure (NFR-006): `publish` and `providerType` are injected.
 */
"use strict";

const {
  rootCause,
  toolEventName,
  completedPayload,
  failedPayload,
  toolPayload,
  buildBotEventMessage,
} = require("./botEvents");
const { appendAnswerText } = require("./answerText");

class BotEventPublisher {
  /**
   * @param {{ publish: (msg: object) => void,
   *           providerType: (providerName: string) => string|null }} deps
   */
  constructor({ publish, providerType }) {
    this._publish = publish;
    this._providerType = providerType;
    /** @type {Map<string, { cause: {chain: string[], depth: number}, text: string, afterTool: boolean }>} */
    this._runs = new Map();
  }

  /** A run is starting; `cause` is set when an event triggered it. */
  startRun(botId, cause = rootCause()) {
    this._runs.set(botId, { cause, text: "", afterTool: false });
  }

  /** Every streamed BotEvent of the run; collects the answer text. */
  onRunEvent(botId, event) {
    const run = this._runs.get(botId);
    if (!run || !event) return;
    if (event.type === "tool_call") run.afterTool = true;
    if (event.type === "text" && event.text) {
      run.text = appendAnswerText(run.text, event.text, {
        afterTool: run.afterTool,
      });
      run.afterTool = false;
    }
  }

  /** A provider tool call returned (normalized `{ text, isError }`). */
  toolCalled(bot, { serverName, toolName, args, result }) {
    if (!bot || !result || result.isError) return;
    const name = toolEventName(this._providerType(serverName), toolName);
    if (!name) return;
    const payload = toolPayload(bot, {
      provider: serverName,
      providerType: this._providerType(serverName),
      tool: toolName,
      args,
      result: result.text,
    });
    this._send(bot, name, payload);
  }

  /** The run finished (BotRunner's run record, or its skip result). */
  endRun(bot, record) {
    if (!bot || !record || record.skipped) return;
    const run = this._runs.get(bot.id);
    const output = run ? run.text : "";
    if (record.status === "stopped") {
      // Stopped by the user: neither finished nor failed, so nothing
      // downstream should start.
    } else if (record.status === "failed") {
      this._send(
        bot,
        "failed",
        failedPayload(bot, { trigger: record.trigger, error: record.error }),
      );
    } else {
      this._send(
        bot,
        "completed",
        completedPayload(bot, { trigger: record.trigger, output }),
      );
    }
    this._runs.delete(bot.id);
  }

  _send(bot, event, payload) {
    const run = this._runs.get(bot.id);
    const cause = run ? run.cause : rootCause();
    try {
      this._publish(buildBotEventMessage(bot, event, payload, cause));
    } catch (_e) {
      // Best-effort: the bus must never break a bot run.
    }
  }
}

module.exports = BotEventPublisher;
