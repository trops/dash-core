/**
 * createRecent.test.js — Create's Recent and a plan's build memory
 * (create-entry CRE-007 AC2, CRE-003 AC4, CRE-004 AC3; phase 4e-1).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  CreateRecent,
  summarize,
  MAX_ENTRIES,
  MAX_MESSAGES,
} = require("./createRecent");
const {
  conversationFacts,
  buildFacts,
  aboutDashboard,
  MEMORY_NOTE,
} = require("./planMemory");
const { BotMemory } = require("./BotMemory");
const { handleMemoryTool } = require("./memoryTools");

function memStore() {
  let blob = null;
  return {
    read: () => blob,
    write: (o) => {
      blob = JSON.parse(JSON.stringify(o));
    },
    peek: () => blob,
  };
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 12, 0, 0, tick++)).toISOString();

function recent() {
  let n = 0;
  return new CreateRecent({
    persistence: memStore(),
    now: clock,
    newId: () => `plan_${++n}`,
  });
}

const plan = {
  summary: "Ask and greet",
  pieces: [
    { kind: "widget", name: "Ask", source: "new", events: ["askClicked"] },
    {
      kind: "bot",
      name: "Greeter",
      source: "new",
      instructions: "Greet warmly.\nKeep it short.",
      on: [{ widget: "Ask", event: "askClicked" }],
      tools: [{ provider: "gmail" }],
    },
    { kind: "layout", name: "Ask Test", source: "new" },
  ],
};

const buildState = (status, over = {}) => ({
  status,
  dashboard: { id: "77", name: "Ask Test" },
  steps: [
    { id: "dashboard", label: "Create", status: "done" },
    { id: "build:0", label: "Build Ask", status: "done" },
    {
      id: "bot:0",
      label: "Save Greeter",
      status: "needs-provider",
      waitingFor: ["gmail"],
    },
    { id: "check:0", label: "Check Ask", status: "running" },
  ],
  made: { 0: { package: "@ai-built/ask", fixedFor: "it sent nothing" } },
  bots: {},
  fixes: { 0: 1 },
  totals: { tokens: 21000 },
  ...over,
});

describe("CreateRecent — conversations kept as they go", () => {
  it("a new conversation gets an id; saving again updates it", () => {
    const r = recent();
    const a = r.save({ prompt: "A morning brief\nwith mail" });
    assert.equal(a.id, "plan_1");
    assert.equal(a.title, "A morning brief");
    const b = r.save({
      id: a.id,
      conversation: { messages: [{ who: "you", text: "hi" }], plan },
    });
    assert.equal(b.id, a.id);
    assert.equal(b.prompt, "A morning brief\nwith mail");
    // The plan's name wins once there is one.
    assert.equal(b.title, "Ask Test");
    assert.equal(r.get(a.id).conversation.messages.length, 1);
  });

  it("keeps the newest entries of each kind: questions don't push plans out (Phase 4a)", () => {
    const r = recent();
    r.save({ prompt: "the one plan" });
    for (let i = 0; i < MAX_ENTRIES + 3; i++) {
      r.save({ kind: "question", prompt: `q${i}` });
    }
    const list = r.list();
    assert.equal(list.filter((e) => e.kind === "question").length, MAX_ENTRIES);
    assert.deepEqual(
      list.filter((e) => e.kind === "plan").map((e) => e.title),
      ["the one plan"],
    );
  });

  it("lists newest first, as summaries; keeps the newest entries and messages", () => {
    const r = recent();
    for (let i = 0; i < MAX_ENTRIES + 3; i++) r.save({ prompt: `p${i}` });
    const list = r.list();
    assert.equal(list.length, MAX_ENTRIES);
    assert.equal(list[0].title, `p${MAX_ENTRIES + 2}`);
    assert.equal(list[0].status, "draft");
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({
      who: "you",
      text: String(i),
    }));
    const e = r.save({ id: list[0].id, conversation: { messages: many } });
    assert.equal(e.conversation.messages.length, MAX_MESSAGES);
    assert.equal(e.conversation.messages[0].text, "5");
  });

  it("a build's progress shows as status, progress, tokens and what it waits for", () => {
    const r = recent();
    const e = r.save({ prompt: "x", conversation: { plan } });
    r.saveBuild(e.id, { buildId: "b1", plan, state: buildState("running") });
    const s = r.list()[0];
    assert.equal(s.status, "building");
    assert.deepEqual(s.progress, { done: 2, total: 4 });
    assert.equal(s.tokens, 21000);
    assert.deepEqual(s.waitingFor, ["gmail"]);
    assert.equal(s.buildId, "b1");
    assert.equal(r.findByBuild("b1").id, e.id);
    for (const [st, want] of [
      ["done", "built"],
      ["waiting-for-you", "ready"],
      ["finished-with-problems", "problems"],
      ["waiting-for-providers", "waiting"],
      ["stopped", "stopped"],
      ["removed", "removed"],
    ]) {
      assert.equal(
        summarize({ build: { state: { status: st } } }).status,
        want,
      );
    }
  });

  it("a Create › Widget plan says so, and whether its widget was added (QA 2026-10-22)", () => {
    const r = recent();
    const e = r.save({ prompt: "x", conversation: { widget: true } });
    let s = r.list().find((x) => x.id === e.id);
    assert.equal(s.widget, true);
    assert.equal(s.widgetAdded, false);
    r.save({ id: e.id, conversation: { widgetAdded: true } });
    s = r.list().find((x) => x.id === e.id);
    assert.equal(s.widget, true, "a later save keeps the widget flag");
    assert.equal(s.widgetAdded, true);
    assert.equal(summarize({}).widget, false);
  });

  it("a build running when the app closed is interrupted; its running step waits again", () => {
    const r = recent();
    const e = r.save({ prompt: "x" });
    r.saveBuild(e.id, { buildId: "b1", plan, state: buildState("running") });
    assert.deepEqual(r.markInterrupted(), [e.id]);
    const st = r.get(e.id).build.state;
    assert.equal(st.status, "interrupted");
    assert.equal(st.steps.find((s) => s.id === "check:0").status, "waiting");
    assert.equal(r.list()[0].status, "interrupted");
    assert.deepEqual(r.markInterrupted(), []);
  });

  it("remove; changes are announced", () => {
    const r = recent();
    let changes = 0;
    r.onChange(() => changes++);
    const e = r.save({ prompt: "x" });
    assert.equal(r.remove(e.id), true);
    assert.equal(r.remove(e.id), false);
    assert.equal(r.list().length, 0);
    assert.equal(changes, 2);
  });
});

describe("planMemory — the facts Dash writes (no AI)", () => {
  it("request, answers and the plan from the conversation", () => {
    const facts = conversationFacts({
      prompt: "A morning brief",
      conversation: {
        messages: [
          { who: "you", text: "A morning brief" },
          { who: "planner", text: "Which mail?" },
          { who: "you", text: "Only unread" },
        ],
        plan,
      },
    });
    assert.equal(facts.request, "A morning brief");
    assert.deepEqual(facts.answers, ["Only unread"]);
    assert.equal(facts.plan.summary, "Ask and greet");
    assert.deepEqual(facts.plan.pieces, [
      "widget Ask (new) sends askClicked",
      "bot Greeter (new) starts on Ask › askClicked uses gmail",
      "layout Ask Test (new)",
    ]);
  });

  it("the build: what failed, what the Builder fixed and why, what waits", () => {
    const state = buildState("finished-with-problems");
    state.steps.push({
      id: "trigger:0:0",
      label: "Start Greeter",
      status: "failed",
      error: "the widget doesn't send x",
    });
    const { build } = buildFacts(state, plan);
    assert.equal(build.status, "finished-with-problems");
    assert.equal(build.dashboard, "Ask Test");
    assert.deepEqual(build.made, ["@ai-built/ask"]);
    assert.deepEqual(build.problems, [
      "Start Greeter: the widget doesn't send x",
    ]);
    assert.deepEqual(build.fixes, [
      "Ask: the Builder fixed it 1× — last for: it sent nothing",
    ]);
    assert.deepEqual(build.waitingFor, ["gmail"]);
  });

  it("what the built dashboard's team is told about itself", () => {
    const about = aboutDashboard(
      { prompt: "A morning brief" },
      plan,
      buildState("done"),
    );
    assert.equal(about.request, "A morning brief");
    assert.deepEqual(about.bots, ["Greeter: Greet warmly."]);
    assert.deepEqual(about.widgets, ["widget Ask (new) sends askClicked"]);
    assert.equal(aboutDashboard({}, plan, { status: "done" }), null);
  });
});

describe("a plan's memory bucket", () => {
  const memory = () => new BotMemory({ persistence: memStore() });

  it("is its own: a run inside a plan reads and writes only that plan", () => {
    const m = memory();
    m.set("plan", "plan_1", "request", "brief");
    m.set("bot", "planner", "note", "private");
    const ctx = { botId: "planner", workspaceId: null, planId: "plan_1" };
    assert.equal(
      handleMemoryTool(m, ctx, "memory_get", { key: "request" }).text,
      "brief",
    );
    // Even asking for global stays in the plan.
    handleMemoryTool(m, ctx, "memory_set", {
      key: "why",
      value: "renamed",
      scope: "global",
    });
    assert.equal(m.get("plan", "plan_1", "why"), "renamed");
    assert.equal(m.get("global", null, "why"), undefined);
    assert.match(
      handleMemoryTool(m, ctx, "memory_get", { key: "note" }).text,
      /No value stored for 'note' \(this plan\)/,
    );
    // Without a plan, the bot's own memory as before.
    assert.equal(
      handleMemoryTool(m, { botId: "planner" }, "memory_get", { key: "note" })
        .text,
      "private",
    );
  });

  it("is forgotten with its plan", () => {
    const m = memory();
    m.set("plan", "plan_1", "request", "brief");
    assert.equal(m.forget("plan", "plan_1"), true);
    assert.equal(m.get("plan", "plan_1", "request"), undefined);
    assert.equal(m.forget("plan", "plan_1"), false);
    assert.throws(() => m.set("plan", null, "k", 1), /needs a plan id/);
  });

  it("roles are told it's there", () => {
    assert.match(MEMORY_NOTE, /memory_list \/ memory_get/);
  });
});

describe("botController — Recent and build memory are wired", () => {
  const ctrl = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  const api = fs.readFileSync(
    path.join(__dirname, "..", "api", "botApi.js"),
    "utf8",
  );
  const runner = fs.readFileSync(path.join(__dirname, "BotRunner.js"), "utf8");
  it("Recent is persisted, interrupted at startup, and announced", () => {
    assert.match(ctrl, /this\._recent\.markInterrupted\(\)/);
    assert.match(ctrl, /this\._broadcast\(CREATE_RECENT_CHANGED, \{\}\)/);
    for (const m of [
      "listCreateRecent",
      "getCreateRecent",
      "saveCreateRecent",
      "removeCreateRecent",
    ]) {
      assert.match(ctrl, new RegExp(`^  ${m}\\(`, "m"));
      assert.match(api, new RegExp(`${m}: \\(`));
    }
    assert.match(api, /onCreateRecent: \(callback\)/);
  });
  it("a build's progress is kept, and finished dashboards learn about themselves", () => {
    assert.match(ctrl, /this\._keepBuild\(planId, buildId, plan, state\);/);
    assert.match(
      ctrl,
      /this\._memory\.set\("workspace", state\.dashboard\.id, "about", about\)/,
    );
    assert.match(
      ctrl,
      /this\._builds\.get\(resumeFrom\) \|\| this\._restoredBuild\(resumeFrom\)/,
    );
  });
  it("Dash team runs in a plan get that plan's memory tools; the runner passes planId", () => {
    assert.match(
      ctrl,
      /const memory = runOpts && runOpts\.planId \? MEMORY_TOOLS : \[\];/,
    );
    assert.match(
      ctrl,
      // Both a cell build's (counted, Phase 2b) and the rest pass planId.
      /: cell\s*\?[\s\S]{0,220}?return await this\._planAskRole\(role, request, planId\);[\s\S]{0,160}?: \(role, request\) => this\._planAskRole\(role, request, planId\)/,
    );
    assert.match(ctrl, /planId && isDashTeam\(this\._store\.get\(botId\)\)/);
    assert.match(runner, /await this\._resolveTools\(bot, opts\)/);
    assert.match(
      runner,
      /\.\.\.\(opts\.planId \? \{ planId: opts\.planId \} : \{\}\)/,
    );
  });
  it("removing from Recent forgets the plan's memory", () => {
    assert.match(ctrl, /this\._memory\.forget\("plan", id\);/);
    // Remove what was built takes the dashboard's "about" with it.
    assert.match(
      ctrl,
      /this\._memory\.delete\("workspace", dashboardId, "about"\)/,
    );
  });
});

describe("questions in Recent (phase 5e)", () => {
  const make = () => {
    let blob = null;
    let n = 0;
    return new CreateRecent({
      persistence: {
        read: () => blob,
        write: (b) => (blob = JSON.parse(JSON.stringify(b))),
      },
      now: () => `2026-10-12T08:00:0${n++}Z`,
      newId: () => `plan_q${n}`,
    });
  };

  it("a question keeps its kind; asked until the Planner answers", () => {
    const r = make();
    const e = r.save({
      kind: "question",
      prompt: "What did my bots find today?",
      conversation: {
        messages: [{ who: "you", text: "What did my bots find today?" }],
      },
    });
    assert.equal(e.kind, "question");
    assert.equal(r.list()[0].status, "asked");
    r.save({
      id: e.id,
      kind: "plan", // ignored: the kind is set when made
      conversation: {
        messages: [
          { who: "you", text: "What did my bots find today?" },
          {
            who: "planner",
            text: "Morning Briefer sent a brief at 8:02.",
          },
        ],
      },
    });
    const row = r.list()[0];
    assert.equal(row.kind, "question");
    assert.equal(row.status, "answered");
  });

  it("a question to a team lead: answered by the lead, row names it (5e-2a)", () => {
    const r = make();
    const lead = { botId: "b_lead", leadName: "Daily Brief Lead" };
    const e = r.save({
      kind: "question",
      prompt: "Anything urgent?",
      conversation: { recipient: lead },
    });
    r.save({
      id: e.id,
      conversation: {
        messages: [
          { who: "you", text: "Anything urgent?" },
          { who: "lead", text: "No." },
        ],
      },
    });
    const row = r.list()[0];
    assert.equal(row.status, "answered");
    assert.equal(row.to, "Daily Brief Lead");
    // Whose Recents it belongs to in the lead workspace (release 2).
    assert.equal(row.with, "lead:b_lead");
    // The recipient survives saving the messages.
    assert.deepEqual(r.get(e.id).conversation.recipient, lead);
  });

  it("a question to a Dash team role: answered by it, row names it", () => {
    const r = make();
    const e = r.save({
      kind: "question",
      prompt: "Can it poll?",
      conversation: { recipient: { role: "builder", roleName: "Builder" } },
    });
    r.save({
      id: e.id,
      conversation: {
        messages: [
          { who: "you", text: "Can it poll?" },
          { who: "role", text: "Yes." },
        ],
      },
    });
    const row = r.list()[0];
    assert.equal(row.status, "answered");
    assert.equal(row.to, "Builder");
    assert.equal(row.with, "role:builder");
    assert.equal(row.planned, false);
  });

  it("a conversation with a plan in it is tagged planned (release 3a)", () => {
    const r = make();
    const e = r.save({
      kind: "question",
      prompt: "Plan me a home dashboard",
      conversation: { recipient: { role: "dashlead", roleName: "Dash Lead" } },
    });
    r.save({
      id: e.id,
      conversation: {
        workspacePlan: {
          stepId: "1:t1",
          plan: { summary: "Home" },
          checks: {},
        },
      },
    });
    // A later save of the messages keeps it (conversation fields merge).
    r.save({
      id: e.id,
      conversation: { messages: [{ who: "you", text: "x" }] },
    });
    const row = r.list()[0];
    assert.equal(row.planned, true);
    assert.equal(row.with, "role:dashlead");
  });

  it("an unknown kind is a plan", () => {
    const r = make();
    assert.equal(r.save({ kind: "gadget", prompt: "x" }).kind, "plan");
  });
});
