/**
 * mainApi.test.js
 *
 * mainApi.on returns an id that removeListener takes (QA 2026-10-24).
 * Across the contextBridge a renderer function arrives as a new copy on
 * each call, so removeListener(name, fn) never matched what on(name, fn)
 * added: every widget file read left its listeners behind
 * (MaxListenersExceededWarning on data-read-from-file-error).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const listeners = {};
const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  send: () => {},
  on: (evt, fn) => ipcRenderer.addListener(evt, fn),
  addListener: (evt, fn) => {
    listeners[evt] = [...(listeners[evt] || []), fn];
  },
  removeListener: (evt, fn) => {
    listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
  },
  removeAllListeners: (evt) => {
    delete listeners[evt];
  },
};

const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron") return { ipcRenderer, shell: {} };
  return originalLoad.call(this, request, parent, ...rest);
};

const { createMainApi } = require("./mainApi");

test("a listener is removed by the id on returns", () => {
  const api = createMainApi();
  const fn = () => {};
  const id = api.on("read-ok", fn);
  assert.equal(typeof id, "string");
  assert.equal(listeners["read-ok"].length, 1);
  // What the contextBridge hands over the second time: a different copy.
  api.removeListener("read-ok", id);
  assert.equal(listeners["read-ok"].length, 0);
});

test("each on gets its own id; removing one leaves the other", () => {
  const api = createMainApi();
  const a = api.on("read-err", () => {});
  const b = api.on("read-err", () => {});
  assert.notEqual(a, b);
  api.removeListener("read-err", a);
  assert.equal(listeners["read-err"].length, 1);
  api.removeListener("read-err", b);
  assert.equal(listeners["read-err"].length, 0);
});

test("removing by the function itself still works (same-world callers)", () => {
  const api = createMainApi();
  const fn = () => {};
  api.on("save-ok", fn);
  api.removeListener("save-ok", fn);
  assert.equal(listeners["save-ok"].length, 0);
});
