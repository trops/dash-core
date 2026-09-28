/**
 * eventStream.test.js
 *
 * Pins the async-queue semantics the engine loop relies on: items pushed before
 * a consumer attaches are buffered and delivered in order, a consumer awaiting
 * an empty queue unblocks when an item arrives, and end() terminates iteration.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createEventStream } = require("./eventStream");

async function drain(stream) {
  const out = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe("eventStream", () => {
  it("buffers items pushed before iteration and preserves order", async () => {
    const s = createEventStream();
    s.push("a");
    s.push("b");
    s.push("c");
    s.end();
    assert.deepEqual(await drain(s), ["a", "b", "c"]);
  });

  it("delivers an item to a waiting consumer (push after await)", async () => {
    const s = createEventStream();
    const iterator = s[Symbol.asyncIterator]();
    const pending = iterator.next(); // no items yet — this awaits
    s.push("late");
    const first = await pending;
    assert.equal(first.value, "late");
    assert.equal(first.done, false);
    s.end();
    assert.equal((await iterator.next()).done, true);
  });

  it("end() terminates iteration and ignores later pushes", async () => {
    const s = createEventStream();
    s.push(1);
    s.end();
    s.push(2); // dropped — stream already ended
    assert.deepEqual(await drain(s), [1]);
  });
});
