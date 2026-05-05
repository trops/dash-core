/**
 * jitConsent.test.js
 *
 * Pins the just-in-time consent module's contract: when an MCP call
 * lands at the gate without a grant, jitConsent.requestApproval emits
 * an IPC event, awaits the user response, and resolves with the
 * decision (or rejects on timeout). Coalescing prevents duplicate
 * prompts when a widget bursts identical calls.
 *
 * The IPC layer is mocked here — we test the request/response state
 * machine, not the electron IPC path.
 *
 * Run: `node --test electron/mcp/jitConsent.test.js`
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// Stub electron BEFORE require — jitConsent uses BrowserWindow.getAllWindows()
// to broadcast the request event. We replace it with a trivial stub.
const Module = require("node:module");
const emittedEvents = [];
const stubBrowserWindow = {
  getAllWindows: () => [
    {
      webContents: {
        send: (channel, payload) => {
          emittedEvents.push({ channel, payload });
        },
      },
    },
  ],
};
const fakeElectron = { BrowserWindow: stubBrowserWindow, ipcMain: null };
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_jit__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_jit__"] = {
  id: "__stub_electron_jit__",
  filename: "__stub_electron_jit__",
  loaded: true,
  exports: fakeElectron,
};

const {
  requestApproval,
  _handleResponse,
  _resetForTest,
} = require("./jitConsent");

function resetState() {
  _resetForTest();
  emittedEvents.length = 0;
}

const sampleRequest = {
  widgetId: "@trops/widget-x",
  domain: "mcp",
  action: "callTool",
  args: {
    serverName: "filesystem",
    toolName: "read_file",
    args: { path: "/Users/jane/notes.md" },
  },
};

test("requestApproval: emits a permission-required event with the request payload", async () => {
  resetState();
  const promise = requestApproval(sampleRequest, { timeoutMs: 50 });
  // Event was emitted synchronously
  assert.strictEqual(emittedEvents.length, 1);
  assert.strictEqual(emittedEvents[0].channel, "widget:permission-required");
  assert.strictEqual(emittedEvents[0].payload.widgetId, "@trops/widget-x");
  assert.strictEqual(emittedEvents[0].payload.domain, "mcp");
  assert.ok(emittedEvents[0].payload.requestId);
  // Drain the promise so node doesn't keep the test alive on the timer.
  await promise.catch(() => {});
});

test("requestApproval: resolves with user decision when responded", async () => {
  resetState();
  const promise = requestApproval(sampleRequest, { timeoutMs: 5000 });
  const requestId = emittedEvents[0].payload.requestId;
  _handleResponse({
    requestId,
    decision: { approve: true, scope: "tool" },
  });
  const result = await promise;
  assert.strictEqual(result.approve, true);
  assert.strictEqual(result.scope, "tool");
});

test("requestApproval: denial is signalled via approve: false", async () => {
  resetState();
  const promise = requestApproval(sampleRequest, { timeoutMs: 5000 });
  const requestId = emittedEvents[0].payload.requestId;
  _handleResponse({ requestId, decision: { approve: false } });
  const result = await promise;
  assert.strictEqual(result.approve, false);
});

test("requestApproval: times out after the deadline", async () => {
  resetState();
  await assert.rejects(
    requestApproval(sampleRequest, { timeoutMs: 30 }),
    /timeout|timed out/i,
  );
});

test("requestApproval: coalesces duplicate requests during pending window", async () => {
  resetState();
  const a = requestApproval(sampleRequest, { timeoutMs: 5000 });
  const b = requestApproval(sampleRequest, { timeoutMs: 5000 });
  // Only ONE IPC event for two requests
  assert.strictEqual(emittedEvents.length, 1);
  const requestId = emittedEvents[0].payload.requestId;
  _handleResponse({ requestId, decision: { approve: true, scope: "tool" } });
  const [resA, resB] = await Promise.all([a, b]);
  assert.strictEqual(resA.approve, true);
  assert.strictEqual(resB.approve, true);
});

test("requestApproval: distinct (widget, server, tool) requests get distinct prompts", async () => {
  resetState();
  const a = requestApproval(sampleRequest, { timeoutMs: 5000 });
  const b = requestApproval(
    {
      ...sampleRequest,
      args: { ...sampleRequest.args, toolName: "list_directory" },
    },
    { timeoutMs: 5000 },
  );
  // Two distinct prompts
  assert.strictEqual(emittedEvents.length, 2);
  const idA = emittedEvents[0].payload.requestId;
  const idB = emittedEvents[1].payload.requestId;
  assert.notStrictEqual(idA, idB);
  _handleResponse({ requestId: idA, decision: { approve: true } });
  _handleResponse({ requestId: idB, decision: { approve: false } });
  assert.strictEqual((await a).approve, true);
  assert.strictEqual((await b).approve, false);
});

test("requestApproval: response for unknown requestId is silently ignored", () => {
  resetState();
  // Should not throw
  assert.doesNotThrow(() =>
    _handleResponse({ requestId: "nonexistent", decision: { approve: true } }),
  );
});

test("requestApproval: malformed input rejects synchronously", async () => {
  resetState();
  await assert.rejects(requestApproval(null), /invalid/i);
  await assert.rejects(requestApproval({}), /invalid/i);
  await assert.rejects(requestApproval({ widgetId: "" }), /invalid/i);
});
