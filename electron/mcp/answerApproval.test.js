/**
 * answerApproval.test.js — tool approvals answered from outside Dash
 * (DASH-32): get_task_status shows them as status "needs" with a safe
 * one-line `what`; answer_approval does Allow once / Deny with the task
 * passphrase, only for a provider's tool in a job started over MCP; the
 * first answer wins; such approvals time out after the team's setting and
 * stop the bot's run, failed, saying why; the log says who answered.
 *
 * The real botController's approval methods run on a stand-in `this` (a
 * real ApprovalRegistry, job tracker and task store; a fake runner).
 * Electron is stubbed, like alwaysAllowController.test.js.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-answerapproval-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_answerapproval__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_answerapproval__"] = {
  id: "__stub_electron_answerapproval__",
  filename: "__stub_electron_answerapproval__",
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
const ApprovalRegistry = require("../bots/approvals");
const { createJobTracker } = require("../jobs/jobTracker");
const { createJobStore } = require("../jobs/jobStore");
const { createMcpTasks } = require("../bots/mcpTasks");
const { TEAM_TOOLS, makeTeamToolHandlers } = require("./teamTools");
const { isToolOn, groupOf, listToolSwitches } = require("./toolSwitches");
const ra = require("../bots/remoteApprovals");

const HOUR = 60 * 60 * 1000;
const PHRASE = "purple otter";
const tick = () => new Promise((r) => setImmediate(r));

const parse = (res) => JSON.parse(res.content[0].text);

/** A stand-in botController with a team (workspace "7") and its jobs. */
function setup({ startedBy = { kind: "task", label: "chat" } } = {}) {
  const timers = [];
  const registry = new ApprovalRegistry({
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.cleared = true;
    },
  });
  const jobs = createJobTracker({
    store: createJobStore({ root: tempDir("dash-answerapproval-jobs-") }),
    settleMs: 1,
  });
  const settings = {};
  const audit = [];
  const aborted = [];
  const names = { lead_7: "Lead", designer: "Designer" };
  const ctl = Object.create(botController);
  Object.assign(ctl, {
    _approvals: registry,
    _jobs: jobs,
    _runVia: new Map(),
    _answerLog: null,
    _testBots: null,
    _runner: {
      abort: (id, reason, message) => {
        aborted.push({ id, reason, message });
        return true;
      },
    },
    _broadcast: () => {},
    _logAudit: (e) => audit.push(e),
    _botName: (id) => names[id] || null,
    _store: {
      getTeamSettings: (ws) => settings[ws] || {},
      setTeamSettings: (ws, patch) => {
        settings[ws] = { ...(settings[ws] || {}), ...patch };
        return settings[ws];
      },
    },
  });

  const job = jobs.startJob({
    workspaceId: "7",
    leadId: "lead_7",
    leadName: "Lead",
    title: "Tidy the plan",
    startedBy,
  });
  jobs.startStep(job.id, { botId: "lead_7", botName: "Lead" });
  jobs.startStep(job.id, {
    botId: "designer",
    botName: "Designer",
    why: { kind: "asked", by: "Lead" },
  });
  ctl._runVia.set("designer", { jobId: job.id });
  ctl._runVia.set("lead_7", { jobId: job.id });

  const state = { tasks: null, lock: null };
  const tasks = createMcpTasks({
    store: {
      loadTasks: () => state.tasks,
      saveTasks: (l) => {
        state.tasks = l;
      },
      getPassphrase: () => PHRASE,
      getLock: () => state.lock,
      saveLock: (l) => {
        state.lock = l;
      },
    },
  });
  const task = tasks.create({
    task: "Tidy the plan",
    team: { id: "7", name: "Sawhorse Team", leadId: "lead_7" },
    from: "chat",
    needsPassphrase: false,
  });
  tasks.running(task.id, { jobId: job.id });

  let on = true;
  const handlers = makeTeamToolHandlers({
    getWorkspaces: () => [],
    bots: {
      list: () => [],
      getRuns: () => [],
      tasks: () => tasks,
      getJob: (id) => ctl.getJob(id),
      jobApprovals: (id) => ctl.jobApprovals(id),
      checkRemoteApproval: (id) => ctl.checkRemoteApproval(id),
      answerApproval: (id, o) => ctl.answerApproval(id, o),
    },
    isOn: () => on,
  });

  const ask = (request) =>
    ctl._createApproval({ botId: "designer", runStartedAt: "r1", ...request });

  return {
    ctl,
    registry,
    jobs,
    job,
    task,
    tasks,
    handlers,
    timers,
    audit,
    aborted,
    settings,
    ask,
    turnOff: () => {
      on = false;
    },
  };
}

const UNDO = {
  serverName: "Sawhorse",
  toolName: "undo",
  input: { path: "/Users/someone/plans/kitchen-plan.md" },
};

describe("remoteApprovals — titles and a safe 'what'", () => {
  it("tool titles read plainly", () => {
    assert.equal(ra.toolTitle("undo"), "Undo");
    assert.equal(ra.toolTitle("search_emails"), "Search emails");
    assert.equal(ra.toolTitle("getFileInfo"), "Get file info");
    assert.equal(ra.toolTitle("mcp__fs__write-file"), "Write file");
    assert.equal(ra.toolTitle(""), "a tool");
  });

  it("what: the title and a path's basename — never contents or secrets", () => {
    const what = ra.approvalWhat({
      toolName: "write_file",
      input: {
        path: "/Users/someone/secret-folder/notes.md",
        content: "TOP SECRET CONTENTS",
        apiKey: "sk-live-123",
        token: "tok_abc",
      },
    });
    assert.equal(what, "Write file: notes.md");
    assert.doesNotMatch(what, /SECRET CONTENTS|sk-live|tok_abc|secret-folder/);
    // No name-like argument: just the title, nothing dumped.
    assert.equal(
      ra.approvalWhat({
        toolName: "send_message",
        input: { text: "hello there", password: "hunter2" },
      }),
      "Send message",
    );
    // Multi-line "names" are content, not a target.
    assert.equal(
      ra.approvalWhat({
        toolName: "create_note",
        input: { title: "line one\nline two", body: "x" },
      }),
      "Create note",
    );
    // Clipped to one short line.
    const long = ra.approvalWhat({
      toolName: "rename",
      input: { name: "n".repeat(300) },
    });
    assert.ok(long.length <= 80);
  });

  // get_task_status needs no passphrase: `what` never carries a secret.
  const whatOf = (toolName, input) => ra.approvalWhat({ toolName, input });

  it("what: a URL shows only its host — never credentials, path, query or fragment", () => {
    assert.equal(
      whatOf("query", { uri: "postgres://admin:hunter2@db.example.com/prod" }),
      "Query: db.example.com",
    );
    assert.equal(
      whatOf("post", {
        url: "https://hooks.slack.com/services/T0/B0/SECRETTOKEN123",
      }),
      "Post: hooks.slack.com",
    );
    assert.equal(
      whatOf("fetch", { url: "https://api.example.com/x?key=abc#frag" }),
      "Fetch: api.example.com",
    );
    assert.equal(
      whatOf("open", { uri: "file:///Users/someone/plans/kitchen.md" }),
      "Open: kitchen.md",
    );
    // A URL that won't parse: nothing from it.
    assert.equal(
      whatOf("query", { uri: "postgres://admin:hunter2@[bad" }),
      "Query",
    );
    for (const w of [
      whatOf("query", { uri: "postgres://admin:hunter2@db.example.com" }),
      whatOf("post", {
        url: "https://hooks.slack.com/services/T0/B0/SECRETTOKEN123",
      }),
    ]) {
      assert.doesNotMatch(w, /hunter2|admin|SECRETTOKEN|services/);
    }
  });

  it("what: a path's basename only when it doesn't look like a token", () => {
    assert.equal(
      whatOf("write_file", { path: "/a/quarterly-report-v2.docx" }),
      "Write file: quarterly-report-v2.docx",
    );
    assert.equal(
      whatOf("write_file", { path: "/keys/sk-live-ABCDEF1234567890" }),
      "Write file",
    );
    assert.equal(
      whatOf("read_file", { file: "/tmp/9f86d081884c7d659a2feaa0c55ad015" }),
      "Read file",
    );
    assert.equal(
      whatOf("read_file", { path: "/tmp/token-a8Kd93LmQz71.txt" }),
      "Read file",
    );
  });

  it("what: a name, title or id only when it reads as ordinary words", () => {
    assert.equal(
      whatOf("create_page", { title: "Kitchen plan for March" }),
      "Create page: Kitchen plan for March",
    );
    assert.equal(whatOf("rename", { name: "Sawhorse" }), "Rename: Sawhorse");
    assert.equal(whatOf("delete_item", { id: 1234 }), "Delete item: 1234");
    for (const secret of [
      "sk-live-ABCDEFGHIJKLMNOPQRSTUVWX",
      "pk_test_51Habc",
      "xoxb-1234-5678-abcdef",
      "ghp_abcdefABCDEF123456",
      "gho_abc123",
      "glpat-xyz123abc",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJhbGciOiJIUzI1NiJ9.e30.abc",
      "Bearer abc.def.ghi",
      "aGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQ=",
      "0123456789abcdef0123",
      "a".repeat(41),
      "msg_18c3f9a2b7d4e6",
    ]) {
      const w = whatOf("rename", { name: secret });
      assert.equal(w, "Rename", secret);
    }
    // A secret name falls through to a safe argument, if there is one.
    assert.equal(
      whatOf("rename", { name: "sk-live-ABCDEFGHIJKLMNOP", title: "Notes" }),
      "Rename: Notes",
    );
  });

  it("remote: a provider's tool in a task given over MCP only", () => {
    const mcp = { startedBy: { kind: "task" } };
    assert.equal(ra.isRemoteApproval(UNDO, mcp), true);
    // A question asked with ask_team_lead stays like Dash's own work.
    assert.equal(
      ra.isRemoteApproval(UNDO, { startedBy: { kind: "mcp" } }),
      false,
    );
    assert.equal(
      ra.isRemoteApproval(UNDO, { startedBy: { kind: "you" } }),
      false,
    );
    assert.equal(ra.isRemoteApproval(UNDO, null), false);
    assert.equal(ra.isRemoteApproval({ toolName: "Bash" }, mcp), false);
    assert.equal(
      ra.isRemoteApproval({ serverName: "x", toolName: "Write" }, mcp),
      false,
    );
  });

  it("wait hours: 1, 4, 12 or 24 — 4 otherwise", () => {
    assert.equal(ra.waitHoursOf(12), 12);
    assert.equal(ra.waitHoursOf("1"), 1);
    assert.equal(ra.waitHoursOf(undefined), 4);
    assert.equal(ra.waitHoursOf(7), 4);
  });

  it("the answer log keeps the first answer and the last 200", () => {
    const log = ra.createAnswerLog();
    log.record("a", { via: "dash" });
    log.record("a", { via: "mcp" });
    assert.equal(log.get("a").via, "dash");
    for (let i = 0; i < 250; i++) log.record(`x${i}`, { via: "dash" });
    assert.equal(log.size, 200);
    assert.equal(log.get("a"), null);
  });
});

describe("get_task_status / list_tasks — a job waiting on the user", () => {
  let s;
  beforeEach(() => {
    s = setup();
  });

  it("an approval: status needs, with the entry and a summary line", async () => {
    const { id } = s.ask({
      ...UNDO,
      input: { ...UNDO.input, content: "SECRET BODY", token: "tok_1" },
    });
    const body = parse(await s.handlers.get_task_status({ taskId: s.task.id }));
    assert.equal(body.status, "needs");
    assert.equal(body.approvals.length, 1);
    const a = body.approvals[0];
    assert.deepEqual(Object.keys(a).sort(), [
      "approvalId",
      "askedAt",
      "bot",
      "botId",
      "provider",
      "remote",
      "tool",
      "toolTitle",
      "what",
    ]);
    assert.equal(a.approvalId, id);
    assert.equal(a.bot, "Designer");
    assert.equal(a.botId, "designer");
    assert.equal(a.provider, "Sawhorse");
    assert.equal(a.tool, "undo");
    assert.equal(a.toolTitle, "Undo");
    assert.equal(a.what, "Undo: kitchen-plan.md");
    assert.equal(a.remote, true);
    assert.match(a.askedAt, /^\d{4}-\d\d-\d\dT/);
    assert.match(
      body.message,
      /Designer is waiting for approval to use Undo on Sawhorse\./,
    );
    // Nothing of the tool's input beyond the basename.
    assert.doesNotMatch(
      JSON.stringify(body),
      /SECRET BODY|tok_1|\/Users\/someone/,
    );
    // The task itself is untouched: still running.
    assert.equal(s.tasks.get(s.task.id).status, "running");
    const list = parse(await s.handlers.list_tasks());
    assert.equal(list.tasks[0].status, "needs");
  });

  it("a paused bot a hand-on waits on: needs, a paused-bot entry", async () => {
    s.jobs.waitStep(s.job.id, {
      botId: "writer",
      botName: "Writer",
      why: { kind: "handon", by: "Designer" },
      summary: "Writer is paused.",
      waiting: "paused",
    });
    const body = parse(await s.handlers.get_task_status({ taskId: s.task.id }));
    assert.equal(body.status, "needs");
    assert.deepEqual(body.approvals, [
      { kind: "paused-bot", bot: "Writer", botId: "writer", remote: false },
    ]);
    assert.match(body.message, /Writer is paused/);
  });

  it("nothing waiting: running as before", async () => {
    const body = parse(await s.handlers.get_task_status({ taskId: s.task.id }));
    assert.equal(body.status, "running");
    assert.equal(body.approvals, undefined);
    assert.equal(
      parse(await s.handlers.list_tasks()).tasks[0].status,
      "running",
    );
  });

  it("an approval in a job started in Dash is listed, but not remote", async () => {
    const d = setup({ startedBy: { kind: "you" } });
    d.ask(UNDO);
    const list = d.ctl.jobApprovals(d.job.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].remote, false);
  });
});

describe("answer_approval", () => {
  let s;
  beforeEach(() => {
    s = setup();
  });

  const answer = (args) => s.handlers.answer_approval(args);

  it("allow_once: the bot goes ahead once — no saved grant — and its job can end done", async () => {
    const { id, promise } = s.ask(UNDO);
    const res = await answer({
      approvalId: id,
      decision: "allow_once",
      passphrase: PHRASE,
      answeredBy: "chat-listener",
    });
    assert.equal(res.isError, undefined);
    const body = parse(res);
    assert.equal(body.status, "allowed");
    assert.match(
      body.message,
      /Allowed once: Designer can use Undo on Sawhorse/,
    );
    const decision = await promise;
    assert.equal(decision.allow, true);
    assert.equal(decision.remember, false);
    assert.equal(decision.via, "mcp");
    assert.equal(decision.answeredBy, "chat-listener");
    assert.equal(s.registry.size, 0);
    // The bots finish: the job ends done.
    s.jobs.endStep(s.job.id, {
      botId: "designer",
      record: { status: "completed", output: "Undid it." },
    });
    s.jobs.endStep(s.job.id, {
      botId: "lead_7",
      record: { status: "completed", output: "Done." },
    });
    const ended = await s.jobs.waitForEnd(s.job.id);
    assert.equal(ended.status, "done");
  });

  it("deny: the bot is told no", async () => {
    const { id, promise } = s.ask(UNDO);
    const body = parse(
      await answer({ approvalId: id, decision: "deny", passphrase: PHRASE }),
    );
    assert.equal(body.status, "denied");
    const decision = await promise;
    assert.equal(decision.allow, false);
    assert.equal(decision.reason, "denied by user");
    assert.equal(decision.via, "mcp");
  });

  it("a wrong passphrase: bad_passphrase, nothing answered; 5 wrong locks it", async () => {
    const { id } = s.ask(UNDO);
    const res = await answer({
      approvalId: id,
      decision: "allow_once",
      passphrase: "nope",
    });
    assert.equal(res.isError, true);
    const body = parse(res);
    assert.equal(body.error, "bad_passphrase");
    assert.equal(body.triesLeft, 4);
    assert.ok(s.registry.get(id), "still waiting");
    for (let i = 0; i < 4; i++) {
      await answer({ approvalId: id, decision: "deny", passphrase: "nope" });
    }
    const locked = parse(
      await answer({ approvalId: id, decision: "deny", passphrase: PHRASE }),
    );
    assert.equal(locked.error, "locked");
    assert.ok(s.registry.get(id), "still waiting after the lock");
  });

  it("already answered (in Dash): says who and how; a second MCP answer too", async () => {
    const a = s.ask(UNDO);
    s.ctl.approve(a.id, { allow: true });
    const res = await answer({
      approvalId: a.id,
      decision: "deny",
      passphrase: PHRASE,
    });
    assert.equal(res.isError, true);
    const body = parse(res);
    assert.equal(body.error, "already_answered");
    assert.equal(body.answeredVia, "dash");
    assert.match(body.message, /already allowed in Dash/);

    const b = s.ask(UNDO);
    parse(
      await answer({
        approvalId: b.id,
        decision: "deny",
        passphrase: PHRASE,
        answeredBy: "phone",
      }),
    );
    const again = parse(
      await answer({
        approvalId: b.id,
        decision: "allow_once",
        passphrase: PHRASE,
      }),
    );
    assert.equal(again.error, "already_answered");
    assert.equal(again.answeredVia, "mcp");
    assert.equal(again.answeredBy, "phone");
    assert.match(again.message, /already denied over MCP by phone/);
    const decision = await b.promise;
    assert.equal(decision.allow, false, "the first answer won");
  });

  it("a built-in tool: not_remote, nothing changes", async () => {
    const { id } = s.ask({ toolName: "Bash", input: { command: "ls" } });
    const body = parse(
      await answer({
        approvalId: id,
        decision: "allow_once",
        passphrase: PHRASE,
      }),
    );
    assert.equal(body.error, "not_remote");
    assert.match(body.message, /built-in tool/);
    assert.ok(s.registry.get(id));
  });

  it("a job started inside Dash: not_remote, nothing changes", async () => {
    const d = setup({ startedBy: { kind: "you" } });
    const { id } = d.ask(UNDO);
    const res = await d.handlers.answer_approval({
      approvalId: id,
      decision: "allow_once",
      passphrase: PHRASE,
    });
    assert.equal(res.isError, true);
    assert.equal(parse(res).error, "not_remote");
    assert.ok(d.registry.get(id));
  });

  it("an unknown id, or a decision other than allow_once / deny", async () => {
    const unknown = parse(
      await answer({
        approvalId: "appr_x",
        decision: "deny",
        passphrase: PHRASE,
      }),
    );
    assert.equal(unknown.error, "unknown_approval");
    const { id } = s.ask(UNDO);
    const always = await answer({
      approvalId: id,
      decision: "always_allow",
      passphrase: PHRASE,
    });
    assert.equal(always.isError, true);
    assert.equal(parse(always).error, "bad_decision");
    assert.ok(s.registry.get(id));
  });

  it("turned off: refuses", async () => {
    const { id } = s.ask(UNDO);
    s.turnOff();
    const res = await answer({
      approvalId: id,
      decision: "deny",
      passphrase: PHRASE,
    });
    assert.equal(res.isError, true);
    assert.equal(parse(res).error, "turned_off");
    assert.ok(s.registry.get(id));
  });

  it("the log: via mcp and answeredBy over MCP, via dash in Dash", async () => {
    const a = s.ask(UNDO);
    await answer({
      approvalId: a.id,
      decision: "allow_once",
      passphrase: PHRASE,
      answeredBy: "chat-listener",
    });
    const b = s.ask(UNDO);
    s.ctl.approve(b.id, { allow: false });
    await tick();
    const allowed = s.audit.find((e) => e.type === "approval-allowed");
    assert.equal(allowed.via, "mcp");
    assert.equal(allowed.answeredBy, "chat-listener");
    assert.equal(allowed.always, false);
    const denied = s.audit.find((e) => e.type === "approval-denied");
    assert.equal(denied.via, "dash");
    assert.equal(denied.answeredBy, undefined);
  });
});

describe("answer_approval is off by default (Settings › MCP Server › Tools)", () => {
  const registered = TEAM_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(t.defaultOff ? { defaultOff: true } : {}),
  }));

  it("not offered until turned on; in Teams and tasks", () => {
    assert.equal(isToolOn("answer_approval", registered, {}), false);
    assert.equal(isToolOn("get_task_status", registered, {}), true);
    assert.equal(
      isToolOn("answer_approval", registered, { answer_approval: true }),
      true,
    );
    assert.equal(groupOf("answer_approval").label, "Teams and tasks");
    const row = listToolSwitches(registered, {}).find(
      (r) => r.name === "answer_approval",
    );
    assert.equal(row.defaultOff, true);
    assert.equal(row.on, false);
  });

  it("its description: passphrase, Allow once or Deny only, remote only", () => {
    const d = TEAM_TOOLS.find((t) => t.name === "answer_approval").description;
    assert.match(d, /task passphrase/);
    assert.match(d, /allow_once/);
    assert.match(d, /deny/);
    assert.match(d, /remote: true/);
    const g = TEAM_TOOLS.find((t) => t.name === "get_task_status").description;
    assert.match(g, /'needs'/);
    assert.match(g, /approvals/);
  });
});

describe("the time limit for approvals in jobs started over MCP", () => {
  it("waits the team's hours (4 by default), then stops the run, failed, saying why", async () => {
    const s = setup();
    s.ask(UNDO);
    const t = s.timers[s.timers.length - 1];
    assert.equal(t.ms, 4 * HOUR);
    t.fn();
    await tick();
    assert.deepEqual(s.aborted, [
      {
        id: "designer",
        reason: "fail",
        message: "Approval for Undo on Sawhorse wasn't answered within 4 h",
      },
    ]);
    assert.ok(
      s.audit.some(
        (e) =>
          e.type === "run-stopped" &&
          e.reason ===
            "Approval for Undo on Sawhorse wasn't answered within 4 h",
      ),
    );
    // The run's record carries it, so the step and the job end failed.
    s.jobs.endStep(s.job.id, {
      botId: "designer",
      record: { status: "failed", error: s.aborted[0].message },
    });
    s.jobs.endStep(s.job.id, {
      botId: "lead_7",
      record: { status: "completed", output: "ok" },
    });
    const ended = await s.jobs.waitForEnd(s.job.id);
    assert.equal(ended.status, "failed");
    assert.equal(
      ended.steps.find((st) => st.botId === "designer").summary,
      "Approval for Undo on Sawhorse wasn't answered within 4 h",
    );
  });

  it("the team's setting: 1 h; a timed-out approval answers already_answered", async () => {
    const s = setup();
    assert.deepEqual(s.ctl.setApprovalWaitHours("7", 1), { hours: 1 });
    assert.equal(s.ctl.approvalWaitHours("7"), 1);
    assert.ok(s.ctl.setApprovalWaitHours("7", 3).error);
    assert.equal(s.ctl.approvalWaitHours("7"), 1);
    const { id } = s.ask(UNDO);
    const t = s.timers[s.timers.length - 1];
    assert.equal(t.ms, 1 * HOUR);
    t.fn();
    await tick();
    assert.equal(
      s.aborted[0].message,
      "Approval for Undo on Sawhorse wasn't answered within 1 h",
    );
    const late = parse(
      await s.handlers.answer_approval({
        approvalId: id,
        decision: "allow_once",
        passphrase: PHRASE,
      }),
    );
    assert.equal(late.error, "already_answered");
    assert.equal(late.answeredVia, "timeout");
  });

  it("an approval in Dash's own conversation keeps the 24 h auto-deny, and no run is stopped", async () => {
    const s = setup({ startedBy: { kind: "you" } });
    s.ask(UNDO);
    const t = s.timers[s.timers.length - 1];
    assert.equal(t.ms, 24 * HOUR);
    t.fn();
    await tick();
    assert.deepEqual(s.aborted, []);
    // A bot outside any job: 24 h too.
    s.ctl._runVia.delete("designer");
    s.ask(UNDO);
    assert.equal(s.timers[s.timers.length - 1].ms, 24 * HOUR);
  });

  it("a question asked with ask_team_lead: 24 h, not remote, no run stopped", async () => {
    const s = setup({ startedBy: { kind: "mcp", label: "MCP" } });
    s.ctl.setApprovalWaitHours("7", 1);
    const { id } = s.ask(UNDO);
    assert.equal(s.ctl.jobApprovals(s.job.id)[0].remote, false);
    const res = parse(
      await s.handlers.answer_approval({
        approvalId: id,
        decision: "allow_once",
        passphrase: PHRASE,
      }),
    );
    assert.equal(res.error, "not_remote");
    assert.match(res.message, /ask_team_lead/);
    const t = s.timers[s.timers.length - 1];
    assert.equal(t.ms, 24 * HOUR);
    t.fn();
    await tick();
    assert.deepEqual(s.aborted, []);
  });
});

describe("review fixes", () => {
  it("get_task_status with answer_approval off: remote false, and it isn't offered", async () => {
    const s = setup();
    s.ask(UNDO);
    s.turnOff();
    const body = parse(await s.handlers.get_task_status({ taskId: s.task.id }));
    assert.equal(body.status, "needs");
    assert.equal(body.approvals[0].remote, false);
    assert.doesNotMatch(body.message, /answer_approval/);
    assert.match(body.message, /The user can answer in Dash\./);
  });

  it("an answer from Dash is always via dash, whatever the renderer sends", async () => {
    const s = setup();
    const a = s.ask(UNDO);
    s.ctl.approve(a.id, { allow: true, via: "mcp", answeredBy: "spoof" });
    const decision = await a.promise;
    assert.equal(decision.via, "dash");
    assert.equal(decision.answeredBy, undefined);
    const b = s.ask(UNDO);
    s.ctl.approve(b.id, { allow: false, via: "mcp", answeredBy: "spoof" });
    await tick();
    const logged = s.audit.filter(
      (e) => e.type === "approval-allowed" || e.type === "approval-denied",
    );
    assert.equal(logged.length, 2);
    for (const e of logged) {
      assert.equal(e.via, "dash");
      assert.equal(e.answeredBy, undefined);
    }
    const late = parse(
      await s.handlers.answer_approval({
        approvalId: b.id,
        decision: "allow_once",
        passphrase: PHRASE,
      }),
    );
    assert.equal(late.answeredVia, "dash");
    assert.equal(late.answeredBy, undefined);
  });

  it("already answered after the run was stopped: says so", async () => {
    const s = setup();
    const { id } = s.ask(UNDO);
    s.ctl.stop("designer");
    await tick();
    const res = await s.handlers.answer_approval({
      approvalId: id,
      decision: "allow_once",
      passphrase: PHRASE,
    });
    assert.equal(res.isError, true);
    const body = parse(res);
    assert.equal(body.error, "already_answered");
    assert.equal(body.answeredVia, "stopped");
    assert.match(body.message, /run was stopped/);
  });
});
