/**
 * BotEventPublisher.js
 *
 * Turns a bot's run into events on the dashboard bus (PRD US-010):
 *   - `completed` / `failed` when the run ends (with its final text / error)
 *   - `tool.<providerType>.<tool>` per successful provider tool call
 *   - `result.<name>` per result the bot sends (team-dashboards TD-001)
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
  resultEventName,
  completedPayload,
  failedPayload,
  toolPayload,
  buildBotEventMessage,
} = require("./botEvents");
const { appendAnswerText } = require("./answerText");

class BotEventPublisher {
  /**
   * @param {{ publish: (msg: object) => void,
   *           providerType: (providerName: string) => string|null,
   *           saveResult?: (bot: object, payload: object) => void }} deps
   *   saveResult: a held result saved as the bot's latest when it goes out
   */
  constructor({ publish, providerType, saveResult = null }) {
    this._publish = publish;
    this._providerType = providerType;
    this._saveResult = saveResult;
    /** @type {Map<string, { cause: {chain: string[], depth: number}, text: string, afterTool: boolean, held: object[]|null }>} */
    this._runs = new Map();
  }

  /**
   * A run is starting; `cause` is set when an event triggered it. `hold`:
   * the bot has checks (bot-checks PRD), so the results it sends wait with
   * its answer until its checks pass.
   */
  startRun(botId, cause = rootCause(), { hold = false } = {}) {
    this._runs.set(botId, {
      cause,
      text: "",
      afterTool: false,
      held: hold ? [] : null,
    });
  }

  /**
   * The run ended and its work is held for its checks: nothing goes out
   * now. Returns what to send once they pass — the run's cause and the
   * results it sent — or null when no run was tracked.
   */
  holdRun(botId) {
    const run = this._runs.get(botId);
    this._runs.delete(botId);
    if (!run) return null;
    return { cause: run.cause, results: run.held || [] };
  }

  /**
   * Work that passed its checks goes on: the results it sent, then its
   * `completed` event with the answer, under the cause of the run that
   * started it (so the chain's limits still count it).
   */
  release(
    bot,
    { cause = rootCause(), results = [], trigger = null, output = "" } = {},
  ) {
    if (!bot) return;
    this._sendHeld(bot, results, cause);
    this._sendAs(
      bot,
      "completed",
      completedPayload(bot, { trigger, output }),
      cause,
    );
  }

  /** Whether the bot's running run holds what it sends. */
  holding(botId) {
    const run = this._runs.get(botId);
    return !!(run && run.held);
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

  /** The bot sent a result (a resultPayload) during its run. */
  sendResult(bot, payload) {
    const name = resultEventName(payload && payload.name);
    if (!bot || !name) return;
    const run = this._runs.get(bot.id);
    // Held with the answer until the bot's checks pass.
    if (run && run.held) {
      run.held.push(payload);
      return;
    }
    this._send(bot, name, payload);
  }

  /** The run finished (BotRunner's run record, or its skip result). */
  endRun(bot, record) {
    if (!bot || !record || record.skipped) return;
    const run = this._runs.get(bot.id);
    const output = run ? run.text : "";
    if (record.status === "stopped" || record.status === "interrupted") {
      // Stopped by the user, or because Dash quit: neither finished nor
      // failed, so nothing downstream should start.
    } else if (record.status === "failed") {
      // No checks to wait for: what it sent goes out as it was.
      if (run) this._sendHeld(bot, run.held, run.cause);
      this._send(
        bot,
        "failed",
        failedPayload(bot, { trigger: record.trigger, error: record.error }),
      );
    } else {
      if (run) this._sendHeld(bot, run.held, run.cause);
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
    this._sendAs(bot, event, payload, run ? run.cause : rootCause());
  }

  /** Held results going out: each saved as the latest, then published. */
  _sendHeld(bot, payloads, cause) {
    for (const payload of payloads || []) {
      const name = resultEventName(payload && payload.name);
      if (!name) continue;
      if (this._saveResult) {
        try {
          this._saveResult(bot, payload);
        } catch (_e) {
          // Still sent: a widget open now shows it.
        }
      }
      this._sendAs(bot, name, payload, cause);
    }
  }

  _sendAs(bot, event, payload, cause) {
    try {
      this._publish(buildBotEventMessage(bot, event, payload, cause));
    } catch (_e) {
      // Best-effort: the bus must never break a bot run.
    }
  }
}

module.exports = BotEventPublisher;
