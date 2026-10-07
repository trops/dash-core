/**
 * toolLoopEngine.js
 *
 * The provider-neutral tool-loop engine — Bot Factory's generalization of the
 * Anthropic loop in electron/controller/llmController.js. It runs its own agent
 * loop over any chat model with tool calling:
 *
 *   stream a turn -> collect tool calls -> gate each via requestPermission ->
 *   execute via executeTool -> append results -> repeat, until the model ends
 *   its turn or maxTurns is hit.
 *
 * Vendor specifics live entirely in the adapter (anthropic | openai-compatible);
 * tool execution and the permission gate are injected via RunContext, so this
 * file imports no Electron and no vendor SDK and is unit-testable in plain Node.
 *
 * Session state is the message history: emitted as a "session" BotEvent for the
 * runner to persist, and read back from ctx.session on the next run.
 */
"use strict";

const { createEventStream } = require("./eventStream");
const anthropicAdapter = require("./adapters/anthropicAdapter");
const openAICompatibleAdapter = require("./adapters/openAICompatibleAdapter");
const {
  describeResult,
  stripImagesForStorage,
  imageRejectionMessage,
} = require("../toolImages");

const ADAPTERS = {
  anthropic: anthropicAdapter,
  "openai-compatible": openAICompatibleAdapter,
};

const DEFAULT_MAX_TURNS = 10;

function resolveAdapter(ctx) {
  // ctx.adapter (an adapter object) wins — used by tests and callers that pass
  // a resolved adapter; otherwise resolve ctx.adapterId against the built-ins.
  if (ctx.adapter) return ctx.adapter;
  const adapter = ctx.adapterId && ADAPTERS[ctx.adapterId];
  if (!adapter) {
    throw new Error(
      `tool-loop: no adapter for "${ctx.adapterId}" (expected one of ${Object.keys(
        ADAPTERS,
      ).join(", ")})`,
    );
  }
  return adapter;
}

async function runLoop(ctx, stream, state) {
  const adapter = resolveAdapter(ctx);
  const maxTurns = ctx.maxTurns || DEFAULT_MAX_TURNS;
  const providerTools = adapter.toProviderTools(ctx.tools || []);

  // Seed history from the prior session, then append this run's prompt.
  const messages =
    ctx.session && Array.isArray(ctx.session.messages)
      ? ctx.session.messages.slice()
      : [];
  if (ctx.prompt) messages.push({ role: "user", content: ctx.prompt });

  const aborted = () => ctx.signal && ctx.signal.aborted;
  // The stored session keeps placeholders, not image data (CAP-001); the live
  // history keeps the images so later turns of this run can still see them.
  const pushSession = () =>
    stream.push({
      type: "session",
      session: { messages: stripImagesForStorage(messages) },
    });

  let turn = 0;
  while (turn <= maxTurns) {
    if (aborted()) {
      pushSession();
      return;
    }

    const result = await adapter.runTurn({
      credentials: ctx.credentials,
      client: ctx.client,
      baseURL: ctx.baseURL,
      model: ctx.model,
      system: ctx.systemPrompt,
      messages,
      tools: providerTools,
      signal: ctx.signal,
      onText: (t) => stream.push({ type: "text", text: t }),
    });

    messages.push(result.assistantMessage);

    const toolCalls = result.toolCalls || [];
    if (!toolCalls.length || result.stopReason === "end_turn") {
      pushSession();
      stream.push({
        type: "done",
        stopReason: result.stopReason || "end_turn",
        usage: result.usage || null,
      });
      return;
    }

    turn++;

    const results = [];
    for (const call of toolCalls) {
      if (aborted()) {
        pushSession();
        return;
      }

      stream.push({
        type: "tool_call",
        id: call.id,
        name: call.name,
        input: call.input,
      });

      let text = "";
      let images = null;
      let isError = false;

      // Every tool call routes through the gate before executing — the engine
      // contract the runner and tests depend on.
      const decision = await ctx.requestPermission(call.name, call.input);
      if (!decision || decision.allow === false) {
        text = (decision && decision.reason) || "Permission denied.";
        isError = true;
      } else {
        try {
          const r = await ctx.executeTool(call.name, call.input);
          text = (r && r.text) || "";
          isError = !!(r && r.isError);
          if (r && Array.isArray(r.images) && r.images.length) {
            images = r.images;
            state.sentImages = true;
          }
        } catch (err) {
          text = `Error: ${err.message}`;
          isError = true;
        }
      }

      stream.push({
        type: "tool_result",
        id: call.id,
        name: call.name,
        // Activity shows a placeholder per image, never the image data.
        output: images ? describeResult({ text, images }) : text,
        isError,
      });
      results.push(
        images
          ? { id: call.id, name: call.name, text, images, isError }
          : { id: call.id, name: call.name, text, isError },
      );
    }

    for (const m of adapter.formatToolResults(results)) messages.push(m);
  }

  stream.push({
    type: "error",
    message: `Exceeded maximum tool-use rounds (${maxTurns}).`,
    code: "MAX_TURNS",
  });
}

/** @type {import("./BotEngine").BotEngine} */
const toolLoopEngine = {
  id: "tool-loop",
  capabilities: { builtInTools: false, skills: false, nativeSessions: false },

  run(ctx) {
    const stream = createEventStream();
    const state = { sentImages: false };
    (async () => {
      try {
        await runLoop(ctx, stream, state);
      } catch (err) {
        // A model that can't read images gets a plain explanation.
        const imageMessage = state.sentImages
          ? imageRejectionMessage(err, ctx.model)
          : null;
        stream.push({
          type: "error",
          message: imageMessage || err.message || "Engine error",
          code: imageMessage ? "MODEL_NO_IMAGES" : err.code || "ENGINE_ERROR",
        });
      } finally {
        stream.end();
      }
    })();
    return stream;
  },
};

module.exports = toolLoopEngine;
module.exports.ADAPTERS = ADAPTERS;
