/**
 * safeJsExecutor.js
 *
 * Run renderer-supplied JavaScript bodies in a QuickJS WASM sandbox.
 *
 * Why: dash-core's transformFile API (and a handful of widget eval sites)
 * historically used the dynamic-function constructor to compile user-
 * authored JS in the main process. That gives any caller full Node.js
 * privileges — filesystem, network, child_process — turning a single
 * dataApi call into an RCE primitive. See
 * docs/security/ipc-filesystem-audit.md.
 *
 * QuickJS-emscripten runs JS in a separate WASM sandbox with no host
 * globals (no `require`, no `process`, no `fetch`). Code executes
 * against a tiny built-in surface: `Math`, `JSON`, `Date`, `Array`,
 * primitives. The WASM boundary is the OS's responsibility, so escapes
 * are not a keep-up-with-attackers problem the way `vm.runInNewContext`
 * is.
 *
 * Public API:
 *
 *   await runOnce({ body, args, inputs, timeoutMs, memoryBytes }) — one
 *     compile + run, returns `{ value }` or `{ error }`. Cheap to call
 *     repeatedly but creates a fresh context each time.
 *
 *   await createCompiled({ body, args, memoryBytes }) — compile once
 *     and return `{ run(inputs, timeoutMs), dispose() }` for streaming
 *     workloads (e.g., transformFile maps over many records).
 *
 * Implementation notes:
 *
 *   - The QuickJS WASM module loads once per process (cached).
 *   - Each context gets its own runtime → independent memory limit and
 *     interrupt handler, no cross-talk between concurrent transforms.
 *   - Inputs cross the boundary as JSON strings (round-trip serialized);
 *     output crosses back the same way. Functions/Symbols/Maps don't
 *     survive — but transform mappings produce plain JSON objects by
 *     contract.
 *   - The timeout uses a deadline check inside QuickJS's interrupt
 *     handler, NOT setTimeout — JS event-loop callbacks can't fire
 *     while QuickJS is executing synchronously.
 */
"use strict";

// quickjs-emscripten is loaded lazily inside getModule() rather than at
// module top. Reason: when transform.js (which lives in the same dir)
// does require("./safeJsExecutor") and rollup-plugin-commonjs sees a
// statically-required external (`quickjs-emscripten`) inside that file,
// it can mark the relative import as transitive-external and then fail
// to resolve back. Deferring the require breaks the static-analysis
// chain so the rollup build resolves cleanly.
const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MEMORY_BYTES = 32 * 1024 * 1024; // 32 MB

let _modulePromise = null;
function getModule() {
  if (!_modulePromise) {
    const { getQuickJS } = require("quickjs-emscripten");
    _modulePromise = getQuickJS();
  }
  return _modulePromise;
}

function injectInputs(vm, args, inputs) {
  if (!Array.isArray(args) || !Array.isArray(inputs)) {
    throw new Error(
      "safeJsExecutor: args and inputs must be arrays of equal length",
    );
  }
  if (args.length !== inputs.length) {
    throw new Error("safeJsExecutor: args.length must equal inputs.length");
  }
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error("safeJsExecutor: arg names must be valid JS identifiers");
    }
    const json = JSON.stringify(inputs[i]);
    // Use evalCode to materialize the JSON-typed value inside the
    // VM. For undefined inputs, JSON.stringify returns undefined
    // (not a string) — fall through to evaluating the literal
    // `undefined`.
    const literal = json === undefined ? "undefined" : json;
    const result = vm.evalCode(`(${literal})`);
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      throw new Error(
        `safeJsExecutor: failed to inject "${name}": ${
          err && err.message ? err.message : err
        }`,
      );
    }
    vm.setProp(vm.global, name, result.value);
    result.value.dispose();
  }
}

function setDeadline(vm, timeoutMs) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  vm.runtime.setInterruptHandler(() => Date.now() > deadline);
}

function buildWrappedBody(args, body) {
  // Wrap the user body in an IIFE so `return` works at the body level
  // (matching the dynamic-function-constructor semantics this is
  // replacing).
  return `(function(${args.join(",")}){${body}})(${args.join(",")})`;
}

async function runOnce({
  body,
  args = [],
  inputs = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  memoryBytes = DEFAULT_MEMORY_BYTES,
}) {
  if (typeof body !== "string" || !body.trim()) {
    return { error: "body must be a non-empty string" };
  }
  const QuickJS = await getModule();
  const vm = QuickJS.newContext();
  try {
    vm.runtime.setMemoryLimit(memoryBytes);
    vm.runtime.setMaxStackSize(1024 * 1024);
    setDeadline(vm, timeoutMs);

    injectInputs(vm, args, inputs);
    const wrapped = buildWrappedBody(args, body);
    const result = vm.evalCode(wrapped);

    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      return {
        error:
          err && err.message
            ? String(err.message)
            : typeof err === "string"
              ? err
              : JSON.stringify(err),
      };
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    return { value };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  } finally {
    vm.dispose();
  }
}

async function createCompiled({
  body,
  args = [],
  memoryBytes = DEFAULT_MEMORY_BYTES,
}) {
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("body must be a non-empty string");
  }
  const QuickJS = await getModule();
  const vm = QuickJS.newContext();
  vm.runtime.setMemoryLimit(memoryBytes);
  vm.runtime.setMaxStackSize(1024 * 1024);

  // Define the user function once on the VM globals so subsequent
  // run() calls can invoke it with fresh args without re-parsing.
  const define = vm.evalCode(
    `globalThis.__userFn = function(${args.join(",")}){${body}};`,
  );
  if (define.error) {
    const err = vm.dump(define.error);
    define.error.dispose();
    vm.dispose();
    throw new Error(
      "safeJsExecutor: compile failed: " +
        (err && err.message ? err.message : JSON.stringify(err)),
    );
  }
  define.value.dispose();

  let disposed = false;

  return {
    run(inputs, timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (disposed) {
        return { error: "executor already disposed" };
      }
      try {
        setDeadline(vm, timeoutMs);
        const argList = inputs
          .map((v) => (v === undefined ? "undefined" : JSON.stringify(v)))
          .join(",");
        const result = vm.evalCode(`__userFn(${argList})`);
        if (result.error) {
          const err = vm.dump(result.error);
          result.error.dispose();
          return {
            error:
              err && err.message
                ? String(err.message)
                : typeof err === "string"
                  ? err
                  : JSON.stringify(err),
          };
        }
        const value = vm.dump(result.value);
        result.value.dispose();
        return { value };
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
      }
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        vm.dispose();
      }
    },
  };
}

module.exports = {
  runOnce,
  createCompiled,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MEMORY_BYTES,
};
