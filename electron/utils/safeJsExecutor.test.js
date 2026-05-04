/**
 * safeJsExecutor.test.js
 *
 * Pins the sandbox properties of the QuickJS-backed JS executor.
 *
 * Why each test exists:
 *
 *   - happy-path: confirms the executor actually runs JS and round-trips
 *     JSON values across the WASM boundary.
 *   - escape-* tests: each one is a known JS sandbox-escape pattern.
 *     If any of them ever returns a real Node global (e.g. process), the
 *     sandbox is broken and we MUST hear about it. The `*` patterns
 *     come from public sandbox-escape research; new ones get appended
 *     here as they're discovered.
 *   - timeout: pins that an infinite loop interrupts at the deadline,
 *     not blocks forever. Uses a small budget so the test stays fast.
 *   - oom: pins that a runaway memory allocator hits the cap and errors
 *     instead of consuming the host process's heap.
 *   - createCompiled streaming: pins that compile-once + run-many works
 *     so transformFile's per-record loop doesn't regress.
 *
 * Run with `node --test electron/utils/safeJsExecutor.test.js` (no
 * jsdom, no jest — keeps the dep surface minimal).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const exec = require("./safeJsExecutor");

test("happy path: simple shape transform", async () => {
  const r = await exec.runOnce({
    body: "return { id: refObj.objectID, name: refObj.title.toUpperCase(), n: index };",
    args: ["refObj", "index"],
    inputs: [{ objectID: "a1", title: "hello" }, 0],
  });
  assert.strictEqual(r.error, undefined, "no error expected");
  assert.deepStrictEqual(r.value, { id: "a1", name: "HELLO", n: 0 });
});

test("escape: require is not defined", async () => {
  const r = await exec.runOnce({
    body: "return require('fs').readdirSync('/');",
    args: [],
    inputs: [],
  });
  assert.ok(r.error, "expected an error");
  assert.match(r.error, /require/i);
});

test("escape: process is not defined", async () => {
  const r = await exec.runOnce({
    body: "return process.env;",
    args: [],
    inputs: [],
  });
  assert.ok(r.error, "expected an error");
  assert.match(r.error, /process/i);
});

test("escape: fetch is not defined", async () => {
  const r = await exec.runOnce({
    body: "return typeof fetch;",
    args: [],
    inputs: [],
  });
  // QuickJS doesn't define fetch — typeof returns "undefined".
  assert.strictEqual(r.value, "undefined");
});

test("escape: Function-constructor reflection cannot reach process", async () => {
  const r = await exec.runOnce({
    body: "return ({}).constructor.constructor('return process')();",
    args: [],
    inputs: [],
  });
  // The Function constructor exists inside the sandbox, but the body
  // it compiles also runs inside the sandbox — where `process` does
  // not exist. Either an error or an undefined return is acceptable;
  // a real Node `process` object is NOT.
  if (r.error) {
    assert.match(r.error, /process/i);
  } else {
    assert.ok(
      r.value === undefined || r.value === null,
      `expected undefined/null, got ${JSON.stringify(r.value)}`,
    );
  }
});

test("escape: Array-constructor reflection cannot reach process", async () => {
  const r = await exec.runOnce({
    body: 'return [][["constructor"]][["constructor"]](\'return process\')();',
    args: [],
    inputs: [],
  });
  if (r.error) {
    assert.match(r.error, /process/i);
  } else {
    assert.ok(r.value === undefined || r.value === null);
  }
});

test("escape: globalThis.process is undefined", async () => {
  const r = await exec.runOnce({
    body: "return typeof globalThis.process;",
    args: [],
    inputs: [],
  });
  assert.strictEqual(r.value, "undefined");
});

test("timeout: infinite loop interrupts at deadline", async () => {
  const t0 = Date.now();
  const r = await exec.runOnce({
    body: "while(true){}",
    args: [],
    inputs: [],
    timeoutMs: 200,
  });
  const dur = Date.now() - t0;
  assert.ok(r.error, "expected an error");
  assert.match(r.error, /interrupt/i);
  // Interrupt should fire within ~2× the deadline. Allow plenty of
  // slack for slow CI machines.
  assert.ok(dur < 1000, `interrupt took too long: ${dur}ms`);
});

test("oom: memory bomb hits cap and errors", async () => {
  const r = await exec.runOnce({
    body: "let a=[]; while(true){ a.push(new Array(100000).fill(0)); }",
    args: [],
    inputs: [],
    timeoutMs: 5000,
    memoryBytes: 8 * 1024 * 1024,
  });
  assert.ok(r.error, "expected an error");
  assert.match(r.error, /memory|interrupt/i);
});

test("createCompiled: streaming run reuses compiled function", async () => {
  const compiled = await exec.createCompiled({
    body: "return { id: refObj.id, doubled: refObj.n * 2 };",
    args: ["refObj", "index"],
  });
  try {
    for (let i = 0; i < 5; i++) {
      const r = compiled.run([{ id: "r" + i, n: i + 1 }, i]);
      assert.strictEqual(r.error, undefined);
      assert.deepStrictEqual(r.value, {
        id: "r" + i,
        doubled: (i + 1) * 2,
      });
    }
  } finally {
    compiled.dispose();
  }
});

test("createCompiled: dispose makes subsequent run errror cleanly", async () => {
  const compiled = await exec.createCompiled({
    body: "return refObj;",
    args: ["refObj"],
  });
  compiled.dispose();
  const r = compiled.run([{}]);
  assert.ok(r.error, "expected an error after dispose");
});
