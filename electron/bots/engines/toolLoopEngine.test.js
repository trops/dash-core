/**
 * toolLoopEngine.test.js
 *
 * The engine contract suite. Drives the real tool-loop engine with a scripted
 * mock adapter (no vendor SDK, no network) and mock gate/executor, asserting
 * the invariants every engine must uphold:
 *   - emits normalized BotEvents in order
 *   - routes EVERY tool call through requestPermission before executing
 *   - a denied tool is never executed and returns an error result
 *   - honors abort (stops before running further tools)
 *   - round-trips session state (message history in -> out -> back in)
 *   - enforces maxTurns
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const toolLoopEngine = require("./toolLoopEngine");

async function drain(stream) {
  const out = [];
  for await (const e of stream) out.push(e);
  return out;
}

/**
 * A scripted adapter. `script` is an array of turn results; the last entry
 * repeats if the loop asks for more turns than scripted.
 *   { text?, toolCalls?: [{id,name,input}], stopReason? }
 */
function mockAdapter(script) {
  const calls = { runTurn: 0, toProviderTools: 0, formatToolResults: 0 };
  return {
    calls,
    id: "mock",
    toProviderTools(tools) {
      calls.toProviderTools++;
      return tools || [];
    },
    async runTurn({ onText }) {
      const step = script[Math.min(calls.runTurn, script.length - 1)];
      calls.runTurn++;
      if (step.text && typeof onText === "function") onText(step.text);
      return {
        assistantMessage: { role: "assistant", content: step.text || "" },
        toolCalls: step.toolCalls || [],
        stopReason:
          step.stopReason || (step.toolCalls ? "tool_use" : "end_turn"),
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    formatToolResults(results) {
      calls.formatToolResults++;
      return [{ role: "user", content: JSON.stringify(results) }];
    },
  };
}

function baseCtx(overrides) {
  return {
    adapter: mockAdapter([{ text: "hi", stopReason: "end_turn" }]),
    prompt: "do the thing",
    model: "test-model",
    tools: [],
    requestPermission: async () => ({ allow: true }),
    executeTool: async () => ({ text: "ok" }),
    ...overrides,
  };
}

describe("toolLoopEngine (engine contract)", () => {
  it("no tool calls: emits text, then session, then done", async () => {
    const ctx = baseCtx();
    const events = await drain(toolLoopEngine.run(ctx));
    const types = events.map((e) => e.type);
    assert.deepEqual(types, ["text", "session", "done"]);
    assert.equal(events[0].text, "hi");
    assert.equal(events[2].stopReason, "end_turn");
  });

  it("one tool call then end: gates and executes the call, streams results", async () => {
    let permitted = null;
    let executed = null;
    const ctx = baseCtx({
      adapter: mockAdapter([
        { toolCalls: [{ id: "t1", name: "get_prs", input: { repo: "x" } }] },
        { text: "done", stopReason: "end_turn" },
      ]),
      requestPermission: async (name, input) => {
        permitted = { name, input };
        return { allow: true };
      },
      executeTool: async (name, input) => {
        executed = { name, input };
        return { text: "3 open PRs" };
      },
    });

    const events = await drain(toolLoopEngine.run(ctx));
    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      "tool_call",
      "tool_result",
      "text",
      "session",
      "done",
    ]);
    assert.deepEqual(permitted, { name: "get_prs", input: { repo: "x" } });
    assert.deepEqual(executed, { name: "get_prs", input: { repo: "x" } });
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.output, "3 open PRs");
    assert.equal(toolResult.isError, false);
  });

  it("denied tool: never executes, returns an error tool_result", async () => {
    let executeCalled = false;
    const ctx = baseCtx({
      adapter: mockAdapter([
        { toolCalls: [{ id: "t1", name: "slack_send", input: {} }] },
        { text: "ok", stopReason: "end_turn" },
      ]),
      requestPermission: async () => ({ allow: false, reason: "not granted" }),
      executeTool: async () => {
        executeCalled = true;
        return { text: "should not run" };
      },
    });

    const events = await drain(toolLoopEngine.run(ctx));
    assert.equal(executeCalled, false);
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.isError, true);
    assert.equal(toolResult.output, "not granted");
  });

  it("every tool call is gated (invariant), including parallel calls", async () => {
    const gated = [];
    const ctx = baseCtx({
      adapter: mockAdapter([
        {
          toolCalls: [
            { id: "a", name: "tool_a", input: {} },
            { id: "b", name: "tool_b", input: {} },
          ],
        },
        { text: "done", stopReason: "end_turn" },
      ]),
      requestPermission: async (name) => {
        gated.push(name);
        return { allow: true };
      },
    });

    await drain(toolLoopEngine.run(ctx));
    assert.deepEqual(gated, ["tool_a", "tool_b"]);
  });

  it("abort before the first turn: no runTurn, no execute, emits session", async () => {
    const adapter = mockAdapter([{ text: "x", stopReason: "end_turn" }]);
    let executeCalled = false;
    const ctx = baseCtx({
      adapter,
      signal: { aborted: true },
      executeTool: async () => {
        executeCalled = true;
        return { text: "" };
      },
    });

    const events = await drain(toolLoopEngine.run(ctx));
    assert.equal(adapter.calls.runTurn, 0);
    assert.equal(executeCalled, false);
    assert.ok(events.some((e) => e.type === "session"));
    assert.ok(!events.some((e) => e.type === "tool_call"));
  });

  it("session round-trips: output history seeds the next run", async () => {
    const first = baseCtx({
      adapter: mockAdapter([{ text: "first answer", stopReason: "end_turn" }]),
      prompt: "question one",
    });
    const firstEvents = await drain(toolLoopEngine.run(first));
    const session = firstEvents.find((e) => e.type === "session").session;
    // prompt + assistant reply
    assert.equal(session.messages[0].content, "question one");
    assert.equal(session.messages.length, 2);

    const second = baseCtx({
      adapter: mockAdapter([{ text: "second answer", stopReason: "end_turn" }]),
      prompt: "question two",
      session,
    });
    const secondEvents = await drain(toolLoopEngine.run(second));
    const session2 = secondEvents.find((e) => e.type === "session").session;
    // prior 2 messages retained + new prompt + new reply
    assert.equal(session2.messages.length, 4);
    assert.equal(session2.messages[0].content, "question one");
    assert.equal(session2.messages[2].content, "question two");
  });

  it("enforces maxTurns: an adapter that always calls a tool ends in MAX_TURNS", async () => {
    const ctx = baseCtx({
      adapter: mockAdapter([
        { toolCalls: [{ id: "loop", name: "spin", input: {} }] },
      ]),
      maxTurns: 2,
    });
    const events = await drain(toolLoopEngine.run(ctx));
    const last = events[events.length - 1];
    assert.equal(last.type, "error");
    assert.equal(last.code, "MAX_TURNS");
  });

  it("a thrown adapter error surfaces as an error event, stream still ends", async () => {
    const ctx = baseCtx({
      adapter: {
        id: "boom",
        toProviderTools: () => [],
        runTurn: async () => {
          throw new Error("kaboom");
        },
        formatToolResults: () => [],
      },
    });
    const events = await drain(toolLoopEngine.run(ctx));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match(events[0].message, /kaboom/);
  });

  it("executeTool throwing yields an error tool_result, not a crash", async () => {
    const ctx = baseCtx({
      adapter: mockAdapter([
        { toolCalls: [{ id: "t1", name: "flaky", input: {} }] },
        { text: "ok", stopReason: "end_turn" },
      ]),
      executeTool: async () => {
        throw new Error("tool blew up");
      },
    });
    const events = await drain(toolLoopEngine.run(ctx));
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.isError, true);
    assert.match(toolResult.output, /tool blew up/);
    assert.ok(events.some((e) => e.type === "done"));
  });

  describe("image tool results (CAP-001)", () => {
    const IMG = {
      data: Buffer.alloc(2048).toString("base64"),
      mimeType: "image/png",
    };

    // Adapter that formats results Anthropic-style so images land in history.
    function imageAdapter(script, seen) {
      const a = mockAdapter(script);
      a.formatToolResults = (results) => {
        seen.push(results);
        return [
          {
            role: "user",
            content: results.map((r) => ({
              type: "tool_result",
              tool_use_id: r.id,
              content: [
                { type: "text", text: r.text },
                ...(r.images || []).map((i) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: i.mimeType,
                    data: i.data,
                  },
                })),
              ],
            })),
          },
        ];
      };
      return a;
    }

    it("passes images to the adapter; Activity shows a placeholder", async () => {
      const seen = [];
      const ctx = baseCtx({
        adapter: imageAdapter(
          [
            { toolCalls: [{ id: "t1", name: "fetch_image", input: {} }] },
            { text: "a red shoe", stopReason: "end_turn" },
          ],
          seen,
        ),
        executeTool: async () => ({ text: "shoe.png", images: [IMG] }),
      });
      const events = await drain(toolLoopEngine.run(ctx));
      assert.deepEqual(seen[0][0].images, [IMG]);
      const toolResult = events.find((e) => e.type === "tool_result");
      assert.equal(toolResult.output, "shoe.png\n[image: image/png, 2 KB]");
      assert.equal(JSON.stringify(toolResult).includes(IMG.data), false);
    });

    it("the saved session holds placeholders, not image data", async () => {
      const ctx = baseCtx({
        adapter: imageAdapter(
          [
            { toolCalls: [{ id: "t1", name: "fetch_image", input: {} }] },
            { text: "done", stopReason: "end_turn" },
          ],
          [],
        ),
        executeTool: async () => ({ text: "shoe.png", images: [IMG] }),
      });
      const events = await drain(toolLoopEngine.run(ctx));
      const session = events.find((e) => e.type === "session").session;
      const json = JSON.stringify(session);
      assert.equal(json.includes(IMG.data), false);
      assert.match(json, /\[image: image\/png, 2 KB\]/);
    });

    it("explains a model that refuses images", async () => {
      let turn = 0;
      const adapter = imageAdapter(
        [{ toolCalls: [{ id: "t1", name: "fetch_image", input: {} }] }],
        [],
      );
      const firstTurn = adapter.runTurn;
      adapter.runTurn = async (args) => {
        if (turn++ === 0) return firstTurn(args);
        throw new Error("400 image input is not supported for this model");
      };
      const ctx = baseCtx({
        adapter,
        model: "text-only-model",
        executeTool: async () => ({ text: "x", images: [IMG] }),
      });
      const events = await drain(toolLoopEngine.run(ctx));
      const err = events.find((e) => e.type === "error");
      assert.match(err.message, /can't read images/);
      assert.match(err.message, /text-only-model/);
    });
  });

  it("exposes capabilities and the built-in adapter map", () => {
    assert.equal(toolLoopEngine.id, "tool-loop");
    assert.deepEqual(toolLoopEngine.capabilities, {
      builtInTools: false,
      skills: false,
      nativeSessions: false,
    });
    assert.ok(toolLoopEngine.ADAPTERS.anthropic);
    assert.ok(toolLoopEngine.ADAPTERS["openai-compatible"]);
  });
});
