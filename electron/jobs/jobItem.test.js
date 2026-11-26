/**
 * jobItem.test.js — a job's work item and workspace (DASH-100): what a job
 * is about and where its files are, set once and carried by Dash so no bot
 * copies them forward.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  cleanItem,
  cleanWorkspace,
  contextFrom,
  mergeItem,
  insideFolders,
  contextText,
  contextEnv,
  withEventContext,
} = require("./jobContext");
const { createJobStore } = require("./jobStore");
const { createJobTracker } = require("./jobTracker");
const { withTeamValues, missingMessage } = require("../bots/teamValues");
const { createMcpTasks } = require("../bots/mcpTasks");

const answer = (j) => `Done.\n\n\`\`\`json\n${JSON.stringify(j)}\n\`\`\``;

describe("a work item", () => {
  it("only needs an id; any tracker's id will do", () => {
    assert.deepEqual(cleanItem({ id: "DASH-93" }), { id: "DASH-93" });
    assert.deepEqual(cleanItem("Projects/Spool clip.md"), {
      id: "Projects/Spool clip.md",
    });
    assert.deepEqual(
      cleanItem({
        id: "trops/app#12",
        title: "  Fix   it ",
        url: "https://github.com/trops/app/issues/12",
        source: "GitHub",
      }),
      {
        id: "trops/app#12",
        title: "Fix it",
        url: "https://github.com/trops/app/issues/12",
        source: "github",
      },
    );
  });

  it("drops what it can't trust: no id, a url that isn't http, a source with spaces", () => {
    assert.equal(cleanItem({ title: "no id" }), null);
    assert.equal(cleanItem(null), null);
    assert.deepEqual(
      cleanItem({
        id: "X-1",
        url: "javascript:alert(1)",
        source: "my tracker",
      }),
      { id: "X-1" },
    );
  });

  it("its id never changes once a job has one; missing fields fill in", () => {
    const first = mergeItem(null, { id: "DASH-93" });
    assert.deepEqual(first, { item: { id: "DASH-93" }, changed: true });
    const more = mergeItem(first.item, { id: "DASH-93", title: "Slugs" });
    assert.deepEqual(more.item, { id: "DASH-93", title: "Slugs" });
    assert.equal(more.changed, true);
    const other = mergeItem(more.item, { id: "DASH-94", title: "Other" });
    assert.deepEqual(other.item, { id: "DASH-93", title: "Slugs" });
    assert.equal(other.refused, "DASH-94");
    assert.equal(other.changed, false);
  });
});

describe("what an answer names", () => {
  it("reads item and workspace from the last json block", () => {
    const text = `${answer({ item: { id: "OLD-1" } })}\nthen\n${answer({
      key: "DASH-93",
      item: { id: "DASH-93", source: "jira" },
      workspace: { dir: "~/DashFactory/DASH-93", branch: "fix/DASH-93-x" },
    })}`;
    const c = contextFrom(text, { home: "/Users/u" });
    assert.deepEqual(c.item, { id: "DASH-93", source: "jira" });
    assert.deepEqual(c.workspace, {
      dir: "/Users/u/DashFactory/DASH-93",
      branch: "fix/DASH-93-x",
    });
  });

  it("a relative workspace, or no json at all, names nothing", () => {
    assert.deepEqual(
      contextFrom(answer({ workspace: { dir: "rel/dir" } })),
      {},
    );
    assert.deepEqual(contextFrom("no json here"), {});
    assert.equal(cleanWorkspace({ dir: "x" }), null);
  });

  it("a workspace must be inside the bot's folders", () => {
    assert.equal(
      insideFolders("/w/DashFactory/DASH-93", ["/w/DashFactory"]),
      true,
    );
    assert.equal(insideFolders("/w/DashFactory", ["/w/DashFactory"]), true);
    assert.equal(insideFolders("/w/Other", ["/w/DashFactory"]), false);
    assert.equal(
      insideFolders("/w/DashFactory/../etc", ["/w/DashFactory"]),
      false,
    );
    assert.equal(insideFolders("/w/x", []), false);
  });
});

describe("a check's environment", () => {
  it("has DASH_ITEM_* and DASH_WORKSPACE / DASH_BRANCH", () => {
    assert.deepEqual(
      contextEnv({
        item: { id: "DASH-93", title: "Slugs", source: "jira" },
        workspace: { dir: "/w/DASH-93", branch: "fix/x" },
      }),
      {
        DASH_ITEM_ID: "DASH-93",
        DASH_ITEM_TITLE: "Slugs",
        DASH_ITEM_URL: "",
        DASH_ITEM_SOURCE: "jira",
        DASH_WORKSPACE: "/w/DASH-93",
        DASH_BRANCH: "fix/x",
      },
    );
    assert.deepEqual(contextEnv({}), {});
    assert.deepEqual(contextText({ item: { id: "A-1" } }), {
      "item.id": "A-1",
      "item.title": "",
      "item.url": "",
      "item.source": "",
    });
  });
});

describe("events", () => {
  const ctx = { item: { id: "DASH-95" }, workspace: { dir: "/w/DASH-95" } };
  it("a completed or failed event says its job, item and workspace", () => {
    const failed = withEventContext(
      {
        eventType: "bot:local/triage[b1].failed",
        jobId: "job_1",
        content: { error: "Triage was stopped" },
      },
      ctx,
    );
    assert.deepEqual(failed.content, {
      error: "Triage was stopped",
      jobId: "job_1",
      item: { id: "DASH-95" },
      workspace: { dir: "/w/DASH-95" },
    });
    const done = withEventContext(
      { eventType: "bot:local/x[b].completed", jobId: "job_2", content: {} },
      { item: null, workspace: null },
    );
    assert.deepEqual(done.content, { jobId: "job_2" });
  });

  it("other events, and events with no job, are left alone", () => {
    const result = {
      eventType: "bot:local/x[b].result.brief",
      jobId: "j",
      content: {},
    };
    assert.deepEqual(withEventContext(result, ctx).content, {});
    const noJob = { eventType: "bot:local/x[b].failed", content: {} };
    assert.deepEqual(withEventContext(noJob, ctx).content, {});
  });
});

describe("a job carries its item and workspace", () => {
  let dir;
  let t;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-jobitem-"));
    t = createJobTracker({
      store: createJobStore({ root: dir }),
      setTimer: () => ({}),
      clearTimer: () => {},
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("from its task", () => {
    const job = t.startJob({
      workspaceId: "ws1",
      title: "Fix the slug bug",
      item: { id: "DASH-93", url: "https://x.atlassian.net/browse/DASH-93" },
    });
    assert.deepEqual(t.itemOf(job.id), {
      id: "DASH-93",
      url: "https://x.atlassian.net/browse/DASH-93",
    });
    // Saved with the job.
    assert.deepEqual(t.get(job.id).item.id, "DASH-93");
  });

  it("from an answer, and its id is fixed after", () => {
    const job = t.startJob({ workspaceId: "ws1", title: "Next ticket" });
    assert.equal(t.itemOf(job.id), null);
    assert.equal(t.setItem(job.id, { id: "DASH-93" }).item.id, "DASH-93");
    const r = t.setItem(job.id, { id: "DASH-94", title: "Hijack" });
    assert.equal(r.refused, "DASH-94");
    assert.deepEqual(t.itemOf(job.id), { id: "DASH-93" });
    t.setItem(job.id, { id: "DASH-93", title: "Slugs" });
    assert.deepEqual(t.itemOf(job.id), { id: "DASH-93", title: "Slugs" });
  });

  it("a workspace, kept with its branch when a later answer only names the folder", () => {
    const job = t.startJob({ workspaceId: "ws1", title: "x" });
    t.setWorkspace(job.id, { dir: "/w/DASH-93", branch: "fix/a" });
    t.setWorkspace(job.id, { dir: "/w/DASH-93" });
    assert.deepEqual(t.workspaceOf(job.id), {
      dir: "/w/DASH-93",
      branch: "fix/a",
    });
    assert.deepEqual(t.contextOf(job.id), {
      item: null,
      workspace: { dir: "/w/DASH-93", branch: "fix/a" },
    });
  });
});

describe("bots use {item.*} and {workspace.*}", () => {
  const bot = {
    id: "b1",
    workspaceId: "ws1",
    instructions:
      "Comment on {item.id} ({item.source}). Work in {workspace.dir} on {workspace.branch}. Leave ${HOME} and {notASetting.x} alone.",
    projects: ["{workspace.dir}"],
    checks: {
      steps: [
        {
          kind: "check",
          check: { kind: "command", command: 'test -n "{item.id}"' },
        },
      ],
    },
  };
  const context = {
    item: { id: "DASH-93", source: "jira" },
    workspace: { dir: "/w/DASH-93", branch: "fix/x" },
  };

  it("fill in from the job, on a team with no settings at all", () => {
    const { bot: out, missing } = withTeamValues(bot, null, { context });
    assert.deepEqual(missing, []);
    assert.equal(
      out.instructions,
      "Comment on DASH-93 (jira). Work in /w/DASH-93 on fix/x. Leave ${HOME} and {notASetting.x} alone.",
    );
    assert.deepEqual(out.projects, ["/w/DASH-93"]);
    assert.equal(out.checks.steps[0].check.command, 'test -n "DASH-93"');
  });

  it("next to a team's own settings and tables", () => {
    const team = {
      declared: [
        { name: "base", type: "text" },
        {
          name: "repo",
          type: "table",
          columns: [{ name: "url", type: "url" }],
        },
      ],
      values: {
        base: "main",
        repo: [{ key: "a", url: "https://github.com/x/a" }],
      },
    };
    const b = { ...bot, instructions: "{item.id} in {repo.url} from {base}" };
    const { bot: out, missing } = withTeamValues(b, team, {
      picks: { repo: "a" },
      context,
    });
    assert.deepEqual(missing, []);
    assert.equal(
      out.instructions,
      "DASH-93 in https://github.com/x/a from main",
    );
  });

  it("a run that uses them before its job has them can't start, saying why", () => {
    const { missing } = withTeamValues(bot, null, {});
    assert.deepEqual(
      missing.map((m) => m.reason),
      ["no-item", "no-workspace"],
    );
    const msg = missingMessage(missing);
    assert.match(msg, /no work item yet, so \{item\.id\}/);
    assert.match(msg, /"item": \{"id"/);
    assert.match(msg, /no workspace yet/);
  });

  it("a bot that doesn't use them is left alone", () => {
    const plain = { id: "b2", workspaceId: "ws1", instructions: "Say hi {x}" };
    const r = withTeamValues(plain, null, { context });
    assert.equal(r.bot, plain);
    assert.deepEqual(r.missing, []);
  });
});

describe("give_task's item", () => {
  it("is kept with the task, cleaned", () => {
    let saved = null;
    const tasks = createMcpTasks({
      store: {
        loadTasks: () => saved,
        saveTasks: (l) => {
          saved = l;
        },
        getPassphrase: () => null,
        getLock: () => null,
        saveLock: () => {},
      },
    });
    const task = tasks.create({
      task: "Fix it",
      team: { id: "ws1", name: "Code Factory", leadId: "lead1" },
      item: { id: "DASH-93", url: "nope", title: "Slugs" },
    });
    assert.deepEqual(task.item, { id: "DASH-93", title: "Slugs" });
    const none = tasks.create({
      task: "Anything",
      team: { id: "ws1", name: "Code Factory", leadId: "lead1" },
    });
    assert.equal(none.item, undefined);
  });
});
