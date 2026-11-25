/**
 * sealedRunner.js — runs ONE script check, inside the sealed child process
 * script.js starts (flows PRD, phase 2; G17). Never required by the app.
 *
 * The process was started with Node's permission model: it can read only
 * this file, write nothing, start no processes or workers. Node 22 (what
 * Electron ships) can't turn the network off with a flag, so before the
 * script runs this file takes the network away itself: the network modules
 * can't be loaded and the fetch family is removed. The script then runs in
 * a fresh vm context with no require, process or fetch of its own.
 *
 * Reads { source, input } as JSON on stdin; prints one line:
 *   DASH_RESULT {"pass":…, "reason":…, "details":…}
 */
"use strict";

const Module = require("module");
const vm = require("vm");

const NO_NET =
  "No internet in a script check: it runs sealed off. Use a command or a tool call check to reach a service.";
const NO_MODULE =
  "A script check can't load modules: it gets its input and returns { pass, reason, details }.";

const BLOCKED_MODULES = new Set([
  "net",
  "tls",
  "http",
  "https",
  "http2",
  "dgram",
  "dns",
  "dns/promises",
  "undici",
  "child_process",
  "worker_threads",
  "cluster",
  "inspector",
  "fs",
  "fs/promises",
]);

// Taken before the script runs; the script never sees these.
const realLoad = Module._load;
const strip = (name) => String(name || "").replace(/^node:/, "");
Module._load = function sealedLoad(request, ...rest) {
  const name = strip(request);
  if (BLOCKED_MODULES.has(name)) {
    throw new Error(
      [
        "net",
        "tls",
        "http",
        "https",
        "http2",
        "dgram",
        "dns",
        "dns/promises",
        "undici",
      ].includes(name)
        ? NO_NET
        : NO_MODULE,
    );
  }
  return realLoad.call(this, request, ...rest);
};
for (const g of [
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "Request",
  "Response",
  "Headers",
]) {
  try {
    Object.defineProperty(globalThis, g, {
      get() {
        throw new Error(NO_NET);
      },
      configurable: false,
    });
  } catch (_e) {
    // Not there in this Node.
  }
}
// process.getBuiltinModule (Node ≥ 22.3) loads a module without _load.
const realGetBuiltin = process.getBuiltinModule;
if (typeof realGetBuiltin === "function") {
  try {
    process.getBuiltinModule = function sealedGetBuiltin(name) {
      const n = strip(name);
      if (BLOCKED_MODULES.has(n)) throw new Error(NO_NET);
      return realGetBuiltin.call(process, name);
    };
  } catch (_e) {
    // Read-only in this Node.
  }
}
for (const k of ["binding", "_linkedBinding", "dlopen"]) {
  try {
    process[k] = () => {
      throw new Error(NO_MODULE);
    };
  } catch (_e) {
    // Read-only in this Node.
  }
}

function send(result) {
  process.stdout.write(`DASH_RESULT ${JSON.stringify(result)}\n`);
}

function shape(v) {
  if (!v || typeof v !== "object" || typeof v.pass !== "boolean") {
    return {
      pass: false,
      reason: "The script must return { pass, reason, details }.",
    };
  }
  let details = v.details === undefined ? null : v.details;
  try {
    details = JSON.parse(JSON.stringify(details));
  } catch (_e) {
    details = String(details);
  }
  return {
    pass: v.pass,
    reason: typeof v.reason === "string" ? v.reason.slice(0, 2000) : "",
    details,
    // Passed with nothing to hand on (DASH-65).
    ...(v.pass === true && v.handOn === false ? { handOn: false } : {}),
  };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  raw += d;
});
process.stdin.on("end", async () => {
  let job;
  try {
    job = JSON.parse(raw);
  } catch (_e) {
    send({ pass: false, reason: "The check got no input." });
    return;
  }
  const logs = [];
  const sandbox = {
    console: {
      log: (...a) => logs.push(a.map(String).join(" ").slice(0, 500)),
    },
  };
  const ctx = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  try {
    vm.runInContext(String(job.source || ""), ctx, {
      filename: "check.js",
      timeout: 5000,
    });
    if (typeof ctx.check !== "function") {
      send({
        pass: false,
        reason: "The script must define function check(input).",
      });
      return;
    }
    ctx.__input = JSON.parse(JSON.stringify(job.input || {}));
    let out = vm.runInContext("check(__input)", ctx, { timeout: 5000 });
    if (out && typeof out.then === "function") out = await out;
    const res = shape(out);
    if (logs.length) res.logs = logs.slice(-20);
    send(res);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    const why = `${e && e.code} ${msg}`;
    send({
      pass: false,
      reason: /ERR_ACCESS_DENIED|Access to this API has been restricted/i.test(
        why,
      )
        ? "The script tried to reach files or start a process, which a script check can't do."
        : /Code generation from strings disallowed/i.test(why)
          ? "The script tried to step outside its sealed box (to reach the internet, files or other code), which a script check can't do."
          : msg === NO_NET || msg === NO_MODULE
            ? msg
            : `The script failed: ${msg.slice(0, 500)}`,
    });
  }
});
