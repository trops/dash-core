/**
 * teamTasks.test.js — tasks via MCP (bot-teams TEAM-016): give_task,
 * confirm_task, get_task_status and list_tasks, with the real task store and
 * injected bots. A team starts only on the user's passphrase, only if it takes
 * tasks, and the lead's run may then run its bots (via "mcp-task").
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { makeTeamToolHandlers } = require("./teamTools");
const { createMcpTasks } = require("../bots/mcpTasks");

const workspaces = [
  { id: 7, name: "Room Design" },
  { id: 8, name: "Home Projects" },
  { id: 9, name: "Inbox" },
];
const bots = [
  { id: "lead_7", role: "lead", workspaceId: "7", name: "Room Design Lead" },
  { id: "b7", workspaceId: "7", name: "Designer" },
  { id: "lead_8", role: "lead", workspaceId: "8", name: "Home Projects Lead" },
  { id: "lead_9", role: "lead", workspaceId: "9", name: "Inbox Lead" },
];

function setup(over = {}) {
  const state = { tasks: null, lock: null };
  let t = Date.parse("2026-11-01T09:14:00.000Z");
  let n = 0;
  const tasks = createMcpTasks({
    store: {
      loadTasks: () => state.tasks,
      saveTasks: (l) => {
        state.tasks = l;
      },
      getPassphrase: () =>
        "passphrase" in over ? over.passphrase : "purple otter",
      getLock: () => state.lock,
      saveLock: (l) => {
        state.lock = l;
      },
    },
    now: () => t,
    newId: () => `task_${++n}`,
  });
  const calls = [];
  const routed = [];
  const takes = new Set(over.takes || ["7", "8"]);
  // Teams that ask for the passphrase first (the rest start right away).
  const asks = new Set(over.asks || ["7", "8"]);
  const handlers = makeTeamToolHandlers({
    getWorkspaces: () => workspaces,
    taskWaitMs: over.taskWaitMs || 1000,
    bots: {
      list: () => bots,
      getRuns: () => [],
      leadAvailability: over.leadAvailability || (() => ({})),
      askLead:
        over.askLead ||
        (async (id, q, opts) => {
          calls.push({ id, q, opts });
          return {
            status: "completed",
            output: "Designed the guest bedroom: 3 looks, 12 images.",
          };
        }),
      takesMcpTasks: (id) => takes.has(String(id)),
      asksTaskPassphrase: (id) => asks.has(String(id)),
      tasks: () => tasks,
      takeTaskNotes: over.takeTaskNotes,
      routeTask: async (task, teams, opts) => {
        routed.push({ task, teams: teams.map((x) => x.name) });
        if (opts && opts.from) routed.from = opts.from;
        return over.route ? over.route(teams) : { ambiguous: teams };
      },
    },
  });
  return {
    handlers,
    calls,
    routed,
    tasks,
    takes,
    advance: (ms) => {
      t += ms;
    },
  };
}
const body = (r) => JSON.parse(r.content[0].text);

describe("give_task", () => {
  it("waits for the passphrase, naming the team", async () => {
    const { handlers, calls } = setup();
    const r = body(
      await handlers.give_task({
        task: "Design the guest bedroom, boho",
        team: "room design",
        from: "ha-bridge",
      }),
    );
    assert.equal(r.status, "waiting");
    assert.equal(r.team, "Room Design");
    assert.match(r.message, /Room Design will do/);
    assert.match(r.message, /confirm_task/);
    assert.equal(calls.length, 0);
  });

  it("with the passphrase, starts the lead — allowed to run its bots", async () => {
    const { handlers, calls } = setup();
    const r = body(
      await handlers.give_task({
        task: "Design the guest bedroom",
        team: "7",
        passphrase: "Purple, otter.",
        from: "ha-bridge",
      }),
    );
    assert.equal(r.status, "done");
    assert.match(r.summary, /3 looks/);
    assert.equal(calls[0].id, "lead_7");
    assert.equal(calls[0].opts.via, "mcp-task:ha-bridge");
    assert.match(calls[0].q, /^Design the guest bedroom/);
    assert.match(calls[0].q, /confirmed it with their task passphrase/);
    assert.doesNotMatch(calls[0].q, /otter/);
  });

  it("no team named: the Dash team picks from the teams that take tasks", async () => {
    const { handlers, routed, calls } = setup({
      route: (teams) => ({ team: teams[0] }),
    });
    const r = body(
      await handlers.give_task({
        task: "Design the guest bedroom",
        from: "ha-bridge",
      }),
    );
    assert.equal(routed.from, "ha-bridge"); // for the routing log
    assert.deepEqual(
      [...routed],
      [
        {
          task: "Design the guest bedroom",
          teams: ["Room Design", "Home Projects"],
        },
      ],
    );
    assert.equal(r.status, "waiting");
    assert.equal(r.team, "Room Design");
    assert.equal(r.routedBy, "dash-team");
    assert.match(r.message, /^The Dash team picked Room Design\. /);
    assert.equal(calls.length, 0);
  });

  it("the Dash team can't tell: asks which, naming only those", async () => {
    const { handlers, tasks } = setup();
    const r = body(await handlers.give_task({ task: "x" }));
    assert.equal(r.status, "needs-team");
    assert.match(
      r.message,
      /Which team: Room Design \(id 7\) or Home Projects \(id 8\)\?/,
    );
    assert.doesNotMatch(r.message, /Inbox/);
    assert.equal(tasks.list().length, 0);
  });

  it("no team fits: says so, and makes nothing", async () => {
    const { handlers, tasks } = setup({ route: () => ({ none: true }) });
    const r = body(await handlers.give_task({ task: "Order groceries" }));
    assert.equal(r.status, "no-team");
    assert.match(r.message, /None of the user's teams does that kind of work/);
    assert.equal(tasks.list().length, 0);
  });

  it("the Dash Lead busy: asks the user for the team", async () => {
    const { handlers } = setup({
      route: () => ({ error: "The Dash Lead is busy with another request." }),
    });
    const r = body(await handlers.give_task({ task: "x" }));
    assert.equal(r.status, "needs-team");
    assert.match(r.message, /busy.*Ask the user which team: Room Design/);
  });

  it("routed, with the passphrase: starts straight away", async () => {
    const { handlers, calls } = setup({
      route: (teams) => ({ team: teams[1] }),
    });
    const r = body(
      await handlers.give_task({
        task: "Fix the fence",
        passphrase: "purple otter",
      }),
    );
    assert.equal(r.status, "done");
    assert.equal(calls[0].id, "lead_8");
  });

  it("a team that doesn't take tasks isn't found", async () => {
    const { handlers, tasks } = setup();
    const r = body(await handlers.give_task({ task: "x", team: "Inbox" }));
    assert.equal(r.status, "needs-team");
    assert.equal(tasks.list().length, 0);
  });

  it("says when no team takes tasks yet", async () => {
    const { handlers } = setup({ takes: [] });
    const r = body(await handlers.give_task({ task: "x" }));
    assert.match(r.message, /No team takes tasks via MCP yet/);
  });

  it("a paused or over-budget team says so, and no task is made", async () => {
    for (const [avail, re] of [
      [{ paused: true }, /paused/],
      [{ overBudget: true }, /over its budget/],
    ]) {
      const { handlers, tasks } = setup({ leadAvailability: () => avail });
      const r = body(await handlers.give_task({ task: "x", team: "7" }));
      assert.equal(r.status, "blocked");
      assert.match(r.message, re);
      assert.equal(tasks.list().length, 0);
    }
  });

  it("needs a task", async () => {
    const { handlers } = setup();
    assert.equal((await handlers.give_task({})).isError, true);
  });

  it("a team that doesn't ask for a passphrase starts right away", async () => {
    const { handlers, calls, tasks } = setup({ asks: [] });
    const r = body(
      await handlers.give_task({
        task: "Design the guest bedroom",
        team: "7",
        from: "voice-assistant",
      }),
    );
    assert.equal(r.status, "done");
    assert.match(r.message, /Room Design finished/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.via, "mcp-task:voice-assistant");
    // The lead isn't told the user confirmed it with a passphrase.
    assert.doesNotMatch(calls[0].q, /passphrase/);
    assert.equal(tasks.get(r.taskId).needsPassphrase, false);
  });

  it("routed to a team that doesn't ask: says which, and starts", async () => {
    const { handlers, calls } = setup({
      asks: [],
      route: (teams) => ({ team: teams[1] }),
    });
    const r = body(await handlers.give_task({ task: "Fix the squeaky door" }));
    assert.match(r.message, /^The Dash team picked Home Projects\. /);
    assert.equal(r.status, "done");
    assert.equal(calls[0].id, "lead_8");
  });

  it("the lock after wrong passphrases doesn't stop a team that doesn't ask", async () => {
    const { handlers, tasks } = setup({ asks: ["7"] });
    for (let i = 0; i < 5; i++) tasks.verify("wrong");
    assert.ok(tasks.lockedUntil());
    const r8 = body(await handlers.give_task({ task: "Fix it", team: "8" }));
    assert.equal(r8.status, "done");
    const r7 = body(await handlers.give_task({ task: "Design it", team: "7" }));
    assert.equal(r7.status, "locked");
  });

  it("list_teams says which teams ask for a passphrase", async () => {
    const { handlers } = setup({ asks: ["7"] });
    const r = JSON.parse((await handlers.list_teams()).content[0].text);
    const byName = Object.fromEntries(r.teams.map((t) => [t.name, t]));
    assert.equal(byName["Room Design"].asksPassphrase, true);
    assert.equal(byName["Home Projects"].asksPassphrase, false);
    assert.equal("asksPassphrase" in byName.Inbox, false);
  });

  it("a task with the passphrase in it is refused — never kept or routed", async () => {
    const { handlers, tasks, routed } = setup();
    const r = body(
      await handlers.give_task({
        task: "Purple otter. Design the guest bedroom",
        from: "ha-bridge",
      }),
    );
    assert.equal(r.status, "invalid");
    assert.match(r.message, /separately as 'passphrase'/);
    assert.doesNotMatch(JSON.stringify(r), /otter/i);
    assert.equal(tasks.list().length, 0);
    assert.equal(routed.length, 0);
    // Words that only contain it don't count.
    assert.equal(tasks.mentionsPassphrase("purple otters everywhere"), false);
  });
});

describe("confirm_task", () => {
  const give = async (handlers) =>
    body(await handlers.give_task({ task: "Design it", team: "7" })).taskId;

  it("the right passphrase starts it; the answer comes back", async () => {
    const { handlers, calls } = setup();
    const id = await give(handlers);
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.equal(r.status, "done");
    assert.match(r.message, /Room Design finished/);
    assert.equal(calls.length, 1);
  });

  it("a bot that didn't run (paused) leaves it needing the user", async () => {
    // Notes from an earlier run are dropped when the task starts.
    const notes = [["stale"], ["Designer didn't run: this bot is paused."]];
    const { handlers, tasks } = setup({
      takeTaskNotes: (leadId) => {
        assert.equal(leadId, "lead_7");
        return notes.shift() || [];
      },
    });
    const id = await give(handlers);
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.equal(r.status, "done");
    assert.equal(r.needsUser, "Designer didn't run: this bot is paused.");
    assert.match(r.message, /needs the user in Dash: Designer didn't run/);
    assert.doesNotMatch(r.message, /stale/);
    assert.equal(tasks.get(id).needsYou, r.needsUser);
  });

  it("a wrong one says how many tries are left, and never repeats it", async () => {
    const { handlers, calls } = setup();
    const id = await give(handlers);
    const r = await handlers.confirm_task({
      taskId: id,
      passphrase: "blue whale",
    });
    assert.match(body(r).message, /isn't right\. 4 tries left/);
    assert.doesNotMatch(r.content[0].text, /whale|otter/);
    assert.equal(body(r).status, "waiting");
    assert.equal(calls.length, 0);
  });

  it("5 wrong lock tasks — the right one too, and give_task", async () => {
    const { handlers, calls } = setup();
    const id = await give(handlers);
    let r;
    for (let i = 0; i < 5; i++) {
      r = body(await handlers.confirm_task({ taskId: id, passphrase: "no" }));
    }
    assert.match(r.message, /locked until/);
    r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.match(r.message, /5 wrong passphrases: tasks are locked/);
    r = body(await handlers.give_task({ task: "y", team: "7" }));
    assert.equal(r.status, "locked");
    assert.equal(calls.length, 0);
  });

  it("a team that asks for a passphrase, with none set: says where to set it, makes no task", async () => {
    const { handlers, tasks, calls } = setup({ passphrase: null });
    const r = body(await handlers.give_task({ task: "Design it", team: "7" }));
    assert.equal(r.status, "blocked");
    assert.match(r.message, /asks for a passphrase first, and none is set/);
    assert.match(r.message, /Settings › MCP Server/);
    assert.equal(tasks.list().length, 0);
    assert.equal(calls.length, 0);
  });

  it("removed after the task was given: confirm says where to set it", async () => {
    const state = { phrase: "purple otter" };
    const { handlers } = setup({
      get passphrase() {
        return state.phrase;
      },
    });
    const id = await give(handlers);
    state.phrase = null;
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "x" }),
    );
    assert.match(r.message, /Settings › MCP Server › Task passphrase/);
  });

  it("an expired task can't start", async () => {
    const { handlers, advance, calls } = setup();
    const id = await give(handlers);
    advance(10 * 60 * 1000);
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.equal(r.status, "expired");
    assert.equal(calls.length, 0);
  });

  it("a long task is still running when the wait is up; status follows it", async () => {
    let finish;
    const { handlers } = setup({
      taskWaitMs: 10,
      askLead: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const id = await give(handlers);
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.equal(r.status, "running");
    assert.match(r.message, /get_task_status/);
    finish({ status: "completed", output: "All done." });
    await new Promise((res) => setImmediate(res));
    const s = body(await handlers.get_task_status({ taskId: id }));
    assert.equal(s.status, "done");
    assert.equal(s.summary, "All done.");
  });

  it("a busy lead or a failed run fails the task with why", async () => {
    for (const [result, re] of [
      [{ skipped: true }, /busy/],
      [{ status: "failed", error: "credit balance is too low" }, /credit/],
    ]) {
      const { handlers } = setup({ askLead: async () => result });
      const id = await give(handlers);
      const r = body(
        await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
      );
      assert.equal(r.status, "failed");
      assert.match(r.message, re);
    }
  });

  it("a run stopped in Dash, cut off by Dash closing, or blocked isn't done", async () => {
    for (const [result, re] of [
      [{ status: "stopped", output: "Half a" }, /stopped in Dash/],
      [{ status: "interrupted", output: "Half a" }, /Dash closed/],
      [
        { skipped: true, reason: "all bots are paused" },
        /didn't start: all bots are paused/,
      ],
    ]) {
      const { handlers } = setup({ askLead: async () => result });
      const id = await give(handlers);
      const r = body(
        await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
      );
      assert.equal(r.status, "failed");
      assert.match(r.message, re);
    }
  });

  it("all bots paused or another profile: refused before the passphrase", async () => {
    for (const [avail, re] of [
      [{ allPaused: true }, /All bots are paused/],
      [{ otherProfile: true }, /isn't in the profile/],
    ]) {
      const { handlers, tasks } = setup({ leadAvailability: () => avail });
      const r = body(await handlers.give_task({ task: "x", team: "7" }));
      assert.equal(r.status, "blocked");
      assert.match(r.message, re);
      assert.equal(tasks.list().length, 0);
    }
  });

  it("a team turned off after the task was given doesn't start", async () => {
    const { handlers, calls, takes } = setup();
    const id = await give(handlers);
    takes.delete("7");
    const r = body(
      await handlers.confirm_task({ taskId: id, passphrase: "purple otter" }),
    );
    assert.equal(r.status, "failed");
    assert.match(r.message, /doesn't take tasks via MCP/);
    assert.equal(calls.length, 0);
  });

  it("an unknown taskId is an error", async () => {
    const { handlers } = setup();
    assert.equal(
      (await handlers.confirm_task({ taskId: "nope", passphrase: "x" }))
        .isError,
      true,
    );
  });
});

describe("list_tasks and list_teams", () => {
  it("lists recent tasks, newest first", async () => {
    const { handlers } = setup();
    await handlers.give_task({ task: "first", team: "7" });
    await handlers.give_task({ task: "second", team: "8" });
    const r = body(await handlers.list_tasks({}));
    assert.deepEqual(
      r.tasks.map((t) => [t.task, t.team]),
      [
        ["second", "Home Projects"],
        ["first", "Room Design"],
      ],
    );
    assert.ok(!("leadId" in r.tasks[0]));
  });

  it("list_teams says which teams take tasks", async () => {
    const { handlers } = setup();
    const r = body(await handlers.list_teams({}));
    assert.deepEqual(
      r.teams.map((t) => [t.name, t.takesTasks]),
      [
        ["Room Design", true],
        ["Home Projects", true],
        ["Inbox", false],
      ],
    );
  });
});
