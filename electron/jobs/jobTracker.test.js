/**
 * jobTracker.test.js — a job follows one chain of work through a lead
 * (DASH-28, DASH-31): lead → asked bot → its checks → hand-ons, done only
 * when none is still going. Jobs are kept on disk and never deleted by
 * themselves.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createJobStore } = require("./jobStore");
const { createJobTracker, jobStatus } = require("./jobTracker");

let dir;
let clock;
let timers;
let changes;

function make() {
  const store = createJobStore({ root: dir });
  return createJobTracker({
    store,
    now: () => clock,
    onChange: (j) => changes.push(j.status),
    setTimer: (fn) => {
      const t = { fn };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
  });
}
// The settle moment passes.
const settle = () => {
  for (const t of timers.splice(0)) if (!t.cleared) t.fn();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-jobs-"));
  clock = Date.parse("2026-11-21T11:38:00Z");
  timers = [];
  changes = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const done = (output) => ({ status: "completed", output });

describe("a job through the lead", () => {
  it("lead → Designer → hand-on Drafter: running until the Drafter is done", async () => {
    const t = make();
    const job = t.startJob({
      workspaceId: "ws1",
      leadId: "lead1",
      leadName: "Woodworking Lead",
      title: "Walnut U desk, 60 inches wide",
      startedBy: { kind: "task", label: "Slack", taskId: "task_1" },
    });
    assert.equal(job.status, "running");
    const ended = t.waitForEnd(job.id);

    t.startStep(job.id, {
      botId: "lead1",
      botName: "Woodworking Lead",
      why: { kind: "task" },
    });
    t.startStep(job.id, {
      botId: "des",
      botName: "Designer",
      why: { kind: "asked", by: "Woodworking Lead" },
    });
    t.endStep(job.id, { botId: "lead1", record: done("Asked the Designer.") });
    t.endStep(job.id, { botId: "des", record: done("Designed it.") });
    // The Drafter's hand-on starts a tick later: still running meanwhile.
    assert.equal(t.get(job.id).status, "running");
    t.startStep(job.id, {
      botId: "dra",
      botName: "Drafter",
      why: { kind: "handon", by: "Designer" },
    });
    settle(); // the earlier settle timers were cleared by the new step
    assert.equal(t.get(job.id).status, "running");
    t.endStep(job.id, { botId: "dra", record: done("Drawn: 3 sheets.") });
    assert.equal(t.get(job.id).status, "running");
    settle();
    const final = await ended;
    assert.equal(final.status, "done");
    assert.deepEqual(
      final.steps.map((s) => [s.botName, s.status]),
      [
        ["Woodworking Lead", "done"],
        ["Designer", "done"],
        ["Drafter", "done"],
      ],
    );
    assert.equal(final.steps[2].summary, "Drawn: 3 sheets.");
    assert.ok(final.endedAt);
  });

  it("checks are a stage of the step; a retry joins the same job", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Brief" });
    t.startStep(job.id, { botId: "w", botName: "Writer" });
    t.endStep(job.id, {
      botId: "w",
      record: done("Draft"),
      checking: { goalId: "goal_1" },
    });
    settle();
    assert.equal(t.get(job.id).status, "running");
    assert.equal(t.get(job.id).steps[0].status, "checking");
    assert.equal(t.jobForGoal("goal_1"), job.id);
    t.checksMoved("goal_1", "passed");
    assert.equal(t.get(job.id).status, "running");
    settle();
    assert.equal(t.get(job.id).status, "done");
  });

  it("a step that passed its checks stays done when the reviewer's run ends after", () => {
    const t = make();
    const job = t.startJob({ leadId: null, title: "Ticket" });
    t.startStep(job.id, { botId: "c", botName: "Coder" });
    t.endStep(job.id, {
      botId: "c",
      record: done("Coded"),
      checking: { goalId: "goal_r" },
    });
    t.checksMoved("goal_r", "passed");
    // The reviewer's run is marked "review" when it ends, after the pass.
    t.checksMoved("goal_r", "review");
    settle();
    assert.equal(t.get(job.id).steps[0].status, "done");
    assert.equal(t.get(job.id).status, "done");
  });

  it("a hand-on waiting on a paused bot: needs you, then running once it's on", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Spool shelf" });
    t.startStep(job.id, { botId: "des", botName: "Designer" });
    t.endStep(job.id, { botId: "des", record: done("Designed.") });
    t.waitStep(job.id, {
      botId: "dra",
      botName: "Drafter",
      summary: "Drafter is paused, so it hasn't started.",
    });
    settle();
    assert.equal(t.get(job.id).status, "needs-you");
    t.startStep(job.id, { botId: "dra", botName: "Drafter" });
    const steps = t.get(job.id).steps;
    assert.equal(steps.length, 2, "the waiting step became the run");
    assert.equal(steps[1].status, "running");
    assert.equal(t.get(job.id).status, "running");
  });

  it("a failed step fails the job once nothing else is going", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1" });
    t.startStep(job.id, { botId: "a", botName: "Inbox Reader" });
    t.endStep(job.id, {
      botId: "a",
      record: { status: "failed", error: "Gmail sign-in expired." },
    });
    settle();
    const j = t.get(job.id);
    assert.equal(j.status, "failed");
    assert.equal(j.steps[0].summary, "Gmail sign-in expired.");
  });

  it("kept on disk; after a restart, what was going is stopped and said so", () => {
    const t = make();
    const job = t.startJob({ leadId: "lead1", title: "Long one" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    const again = make();
    again.interruptLeftovers();
    const j = again.get(job.id);
    assert.equal(j.status, "stopped");
    assert.match(j.steps[0].summary, /Dash closed/);
    // Only the user deletes a job.
    assert.equal(again.list().length, 1);
    assert.equal(again.remove(job.id), true);
    assert.equal(make().list().length, 0);
  });

  it("lists by dashboard, newest change first", () => {
    const t = make();
    const a = t.startJob({ workspaceId: "1", leadId: "l" });
    clock += 1000;
    const b = t.startJob({ workspaceId: "2", leadId: "l" });
    clock += 1000;
    t.startStep(a.id, { botId: "x", botName: "X" });
    assert.deepEqual(
      t.list().map((j) => j.id),
      [a.id, b.id],
    );
    assert.deepEqual(
      t.list({ workspaceId: "2" }).map((j) => j.id),
      [b.id],
    );
  });
});

describe("after the review", () => {
  it("a hand-on whose event was replaced, or whose bot was deleted, is skipped so its job ends", () => {
    const t = make();
    const job = t.startJob({ leadId: "l", title: "A" });
    t.startStep(job.id, { botId: "des", botName: "Designer" });
    t.endStep(job.id, { botId: "des", record: done("ok") });
    t.waitStep(job.id, { botId: "dra", botName: "Drafter", summary: "paused" });
    settle();
    assert.equal(t.get(job.id).status, "needs-you");
    t.releaseWaiting("dra", "Drafter ran a newer event instead of this one.");
    settle();
    const j = t.get(job.id);
    assert.equal(j.steps[1].status, "skipped");
    assert.equal(j.status, "done");
  });

  it("Stop job stops hand-ons that haven't started", () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    t.endStep(job.id, { botId: "a", record: done("ok") });
    t.waitStep(job.id, { botId: "b", botName: "B", summary: "paused" });
    t.stopWaiting(job.id);
    settle();
    assert.equal(t.get(job.id).status, "stopped");
  });

  it("deleting a job tells whoever waits for it that it stopped", async () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "a", botName: "A" });
    const ended = t.waitForEnd(job.id);
    t.remove(job.id);
    assert.equal((await ended).status, "stopped");
  });

  it("a task's job whose lead never started stops after a restart", () => {
    const t = make();
    const job = t.startJob({ leadId: "l", leadName: "Lead" });
    make().interruptLeftovers();
    const j = make().get(job.id);
    assert.equal(j.status, "stopped");
    assert.match(j.steps[0].summary, /before it started/);
  });

  it("checks waiting on the user make the job need you; the goal index finds it", () => {
    const t = make();
    const job = t.startJob({ leadId: "l" });
    t.startStep(job.id, { botId: "w", botName: "Writer" });
    t.endStep(job.id, {
      botId: "w",
      record: done("x"),
      checking: { goalId: "goal_9" },
    });
    // A fresh tracker builds its index from disk.
    const again = make();
    assert.equal(again.jobForGoal("goal_9"), job.id);
    again.checksMoved("goal_9", "needs-you");
    assert.equal(again.get(job.id).status, "needs-you");
    assert.equal(again.isOpen(job.id), true);
  });
});

describe("jobStatus", () => {
  it("needs you wins; nothing run at all is stopped", () => {
    assert.equal(jobStatus([]), "running");
    assert.equal(
      jobStatus([{ status: "running" }, { status: "needs-you" }]),
      "needs-you",
    );
    assert.equal(jobStatus([{ status: "done" }], true), "running");
    assert.equal(
      jobStatus([{ status: "done" }, { status: "skipped" }]),
      "done",
    );
    assert.equal(jobStatus([{ status: "skipped" }]), "stopped");
  });
});

describe("a refused run on its job (DASH-115)", () => {
  it("the failed step keeps what was refused, why and the fix; a test's own block doesn't", () => {
    const t = make();
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "PR" });
    t.startStep(job.id, { botId: "pr", botName: "PR Bot" });
    const refusal = {
      kind: "command",
      what: "git push -u origin feat/x",
      why: "it isn't in the bot's allowed commands",
      fix: "Add it on the bot's Commands, or give it a provider tool that does this.",
      section: "commands",
      message: "PR Bot can't run `git push -u origin feat/x`: …",
    };
    t.endStep(job.id, {
      botId: "pr",
      record: {
        status: "failed",
        error: refusal.message,
        // As the run keeps them: JSON, sealed at rest.
        refusals: JSON.stringify([
          { ...refusal, what: "ls", test: true },
          refusal,
        ]),
      },
    });
    const step = t.get(job.id).steps[0];
    assert.equal(step.status, "failed");
    assert.deepEqual(step.refusal, refusal);
    t.startStep(job.id, { botId: "pr2", botName: "Other" });
    t.endStep(job.id, {
      botId: "pr2",
      record: { status: "completed", refusals: [{ ...refusal, test: true }] },
    });
    assert.equal(t.get(job.id).steps[1].refusal, undefined);
  });
});

describe("a refusal on a job is sealed at rest (DASH-115)", () => {
  it("the job file holds no plain command", () => {
    const box = {
      seal: (s) => `enc:${Buffer.from(s).toString("base64")}`,
      open: (s) => Buffer.from(String(s).slice(4), "base64").toString(),
    };
    const t = createJobTracker({
      store: createJobStore({ root: dir, box }),
      now: () => clock,
      setTimer: () => ({}),
      clearTimer: () => {},
    });
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "PR" });
    t.startStep(job.id, { botId: "pr", botName: "PR Bot" });
    t.endStep(job.id, {
      botId: "pr",
      record: {
        status: "failed",
        error: "x",
        refusals: JSON.stringify([
          { kind: "command", what: "git push origin secret-branch", why: "w" },
        ]),
      },
    });
    assert.equal(
      t.get(job.id).steps[0].refusal.what,
      "git push origin secret-branch",
    );
    const files = fs.readdirSync(dir);
    const raw = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(raw.length && raw.every((r) => !r.includes("secret-branch")));
  });
});

describe("a step's answer and handoff (DASH-123)", () => {
  const { splitAnswer, keepHandoff, cleanProse } = require("./stepAnswer");
  const answer = [
    "DASH-97 is first.",
    "",
    "Next I'll move it to **In Progress**.",
    "",
    "```json",
    JSON.stringify(
      {
        status: "ok",
        item: { id: "DASH-97", url: "https://x.test/DASH-97" },
        summary: "Took DASH-97",
        body: "Part of DASH-94\n\nIn code-factory-sandbox…",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  it("keeps the prose as Markdown and the handoff apart", () => {
    const t = make();
    const job = t.startJob({ leadId: null, leadName: "Ticket Bot" });
    t.startStep(job.id, { botId: "tb", botName: "Ticket Bot" });
    t.endStep(job.id, { botId: "tb", record: done(answer) });
    const step = t.get(job.id).steps[0];
    assert.equal(
      step.summary,
      "DASH-97 is first.\n\nNext I'll move it to **In Progress**.",
    );
    assert.equal(step.handoff.status, "ok");
    assert.equal(step.handoff.item.id, "DASH-97");
    assert.equal(
      step.handoff.body,
      "Part of DASH-94\n\nIn code-factory-sandbox…",
    );
    // A run again of the step starts it clean.
    t.startStep(job.id, { botId: "tb", botName: "Ticket Bot" });
    t.waitStep(job.id, { botId: "tb", botName: "Ticket Bot", summary: "x" });
    t.startStep(job.id, { botId: "tb", botName: "Ticket Bot" });
    assert.equal(t.get(job.id).steps.at(-1).handoff, undefined);
  });

  it("splits an answer: no block, whole JSON, a bash block, a broken one", () => {
    assert.deepEqual(splitAnswer("Just words."), {
      prose: "Just words.",
      handoff: null,
    });
    assert.deepEqual(splitAnswer('{"status":"none"}'), {
      prose: "",
      handoff: { status: "none" },
    });
    const bash = "Ran it:\n```bash\nnpm test\n```";
    assert.deepEqual(splitAnswer(bash), { prose: bash, handoff: null });
    const broken = 'Done.\n```json\n{"status": "ok",\n```';
    assert.deepEqual(splitAnswer(broken), { prose: broken, handoff: null });
    // Only the last json block is the handoff; an earlier one stays.
    const two = 'A:\n```json\n{"a":1}\n```\nB.\n```json\n{"b":2}\n```';
    assert.deepEqual(splitAnswer(two), {
      prose: 'A:\n```json\n{"a":1}\n```\nB.',
      handoff: { b: 2 },
    });
  });

  it("keeps a big handoff small, and prose readable", () => {
    const big = { status: "ok", summary: "s", log: "x".repeat(20000) };
    const kept = keepHandoff(big);
    assert.equal(kept.status, "ok");
    assert.ok(JSON.stringify(kept).length <= 8000);
    const many = { status: "ok" };
    for (let i = 0; i < 40; i++) many[`k${i}`] = "y".repeat(900);
    assert.deepEqual(Object.keys(keepHandoff(many)), ["status", "clipped"]);
    assert.equal(keepHandoff([1]), null);
    assert.equal(cleanProse("a\r\n\n\n\nb  \nc"), "a\n\nb\nc");
    assert.equal(cleanProse("abcdef", 4), "abc…");
  });
});

describe("a failed job's why and running it again (DASH-122)", () => {
  it("a Setup check step keeps its problems; a later run's end clears them", () => {
    const t = make();
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "x" });
    t.startStep(job.id, { botId: "b1", botName: "Setup check" });
    t.endStep(job.id, {
      botId: "b1",
      record: {
        status: "failed",
        error: "The team's setup has 1 problem",
        problems: [
          {
            kind: "setting",
            bot: "Workspace Bot",
            botId: "b2",
            setting: "workFolder",
            message:
              "Workspace Bot uses Work folder ({workFolder}), which has no value",
            extra: "dropped",
          },
          { kind: "x" },
        ],
      },
    });
    const [step] = t.get(job.id).steps;
    assert.deepEqual(step.problems, [
      {
        kind: "setting",
        bot: "Workspace Bot",
        botId: "b2",
        setting: "workFolder",
        message:
          "Workspace Bot uses Work folder ({workFolder}), which has no value",
      },
    ]);
  });

  it("checks that fail it out fail the step, keeping its answer as its prose", () => {
    const t = make();
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "x" });
    t.startStep(job.id, { botId: "c", botName: "Coder" });
    t.endStep(job.id, {
      botId: "c",
      record: done("Changed formatDate."),
      checking: { goalId: "goal_f" },
    });
    t.checksMoved("goal_f", "stopped");
    t.checksMoved(
      "goal_f",
      "failed",
      'Didn\'t pass "validate" on try 2: 2 tests fail',
    );
    settle();
    const got = t.get(job.id);
    assert.equal(got.status, "failed");
    assert.equal(got.steps[0].status, "failed");
    assert.equal(got.steps[0].summary, "Changed formatDate.");
    assert.match(got.steps[0].failed, /validate/);
  });

  it("retryStep opens the job again and the step waits for its bot's run", () => {
    const t = make();
    const job = t.startJob({ workspaceId: "ws1", leadId: "l", title: "x" });
    t.startStep(job.id, { botId: "c", botName: "Coder" });
    t.endStep(job.id, {
      botId: "c",
      record: { status: "failed", error: "boom" },
    });
    settle();
    assert.equal(t.get(job.id).status, "failed");
    const stepId = t.get(job.id).steps[0].id;
    // Only a failed or stopped step of an ended job.
    assert.equal(t.retryStep(job.id, "nope"), null);
    const step = t.retryStep(job.id, stepId);
    assert.equal(step.status, "queued");
    assert.equal(step.retries, 1);
    assert.equal(t.get(job.id).status, "running");
    assert.equal(t.get(job.id).endedAt, null);
    assert.equal(t.retryStep(job.id, stepId), null);
    // Its bot's run takes the same step up, and the job ends done.
    t.startStep(job.id, { botId: "c", botName: "Coder" });
    assert.equal(t.get(job.id).steps.length, 1);
    t.endStep(job.id, { botId: "c", record: done("Fixed.") });
    settle();
    assert.equal(t.get(job.id).status, "done");
  });
});
