/**
 * backgroundConversation.test.js — a lead asked from outside the app (an MCP
 * task) is kept as a conversation: what was asked, the lead's hand-offs as
 * they happen, and its answer — so Open conversation isn't empty. The real
 * botController methods, with Electron stubbed like userRunPaused.test.js.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-bgconv-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_bgconv__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_bgconv__"] = {
  id: "__stub_electron_bgconv__",
  filename: "__stub_electron_bgconv__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: function () {},
    shell: {},
    dialog: {},
  },
};

const botController = require("../controller/botController");

const LEAD = { id: "lead_w", name: "Woodworking Projects Lead", role: "lead" };

// The run streams a hand-off to the Dash team, then answers.
function fake() {
  const c = Object.create(botController);
  const entries = {};
  let n = 0;
  c._store = { get: (id) => (id === LEAD.id ? LEAD : null) };
  c._pause = { isPaused: () => false, isGloballyPaused: () => false };
  c.listLeads = () => [
    {
      botId: LEAD.id,
      leadName: LEAD.name,
      dashboardId: "7",
      dashboardName: "Woodworking",
    },
  ];
  c._recent = {
    save({ id = null, kind, prompt, conversation } = {}) {
      const key = id || `plan_${++n}`;
      const prev = entries[key] || {
        id: key,
        kind,
        prompt: "",
        conversation: {},
      };
      if (typeof prompt === "string") prev.prompt = prompt;
      prev.conversation = { ...prev.conversation, ...(conversation || {}) };
      entries[key] = JSON.parse(JSON.stringify(prev));
      return entries[key];
    },
    remove(id) {
      delete entries[id];
    },
  };
  c.runs = [];
  c._run = (botId, opts) => {
    c.runs.push({ botId, conversationId: opts.conversationId });
    const emit = (e) => opts.onEvent && opts.onEvent(e);
    emit({ type: "text", text: "Thinking" });
    emit({
      type: "tool_call",
      id: "t1",
      name: "mcp__bot-mcp__team_ask_dash_team",
      input: { role: "planner", request: "Plan two more bots" },
    });
    emit({ type: "tool_call", id: "t2", name: "Read", input: {} });
    emit({
      type: "tool_result",
      id: "t1",
      output: 'Planner: Here\'s the plan.\n<plan>{"summary":"Two bots"}</plan>',
    });
    return Promise.resolve({
      status: "completed",
      output: "I brought in the Dash team. The plan is ready for your yes.",
    });
  };
  return { c, entries };
}

describe("a lead asked over MCP is kept as a conversation", () => {
  it("what was asked, the hand-offs, the answer — and the run knows which", async () => {
    const { c, entries } = fake();
    await c.askLead(LEAD.id, "Make more bots\n\n(A task given via MCP…)", {
      via: "mcp-task:claude",
      shown: "Make more bots",
      from: "claude",
    });
    const [entry] = Object.values(entries);
    assert.equal(entry.kind, "question");
    assert.equal(entry.prompt, "Make more bots");
    assert.equal(entry.conversation.recipient.leadName, LEAD.name);
    const bg = entry.conversation.background;
    assert.equal(bg.from, "claude");
    assert.equal(bg.status, "completed");
    assert.match(bg.answer, /plan is ready/);
    // Only the hand-off's call and its result — not every tool.
    assert.deepEqual(
      bg.events.map((e) => `${e.type}:${e.id}`),
      ["tool_call:t1", "tool_result:t1"],
    );
    assert.equal(c.runs[0].conversationId, entry.id);
  });

  it("asked in the app: nothing extra is kept", async () => {
    const { c, entries } = fake();
    c._asUserRun = (_id, start) => start();
    await c.askLead(LEAD.id, "Hi", { via: "create" });
    assert.equal(Object.keys(entries).length, 0);
  });

  it("a quick question (ask_team_lead) isn't kept — it would crowd Recent", async () => {
    const { c, entries } = fake();
    await c.askLead(LEAD.id, "Anything urgent?", {
      via: "mcp",
      shown: "Anything urgent?",
    });
    assert.equal(Object.keys(entries).length, 0);
  });

  it("a task that never started (busy, paused) leaves nothing behind", async () => {
    const { c, entries } = fake();
    c._run = () =>
      Promise.resolve({
        skipped: true,
        reason: "a run is already in progress",
      });
    await c.askLead(LEAD.id, "Make more bots", {
      via: "mcp-task:claude",
      shown: "Make more bots",
    });
    assert.equal(Object.keys(entries).length, 0);
  });
});
