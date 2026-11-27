/**
 * selfTest.test.js — a team's self-test (DASH-109): outward tools skipped
 * and logged, outward commands blocked, pr-ci skipped, the untested-change
 * marker, and Test team's job.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const {
  TEST_BLOCKED,
  skipsInTest,
  skippedAnswer,
  withTestBlocks,
  testPrompt,
  cleanTestItem,
  untestedMark,
} = require("./selfTest");
const { commandDecision } = require("../checks/commandRules");
const { runCheck } = require("../checks/checkRunner");
const { createJobTracker } = require("../jobs/jobTracker");

describe("outward actions in a test", () => {
  it("tools that could change something are skipped; ones that read aren't", () => {
    for (const t of [
      "addOrEditJiraIssueComment",
      "transitionJiraIssue",
      "merge_pull_request",
      "create_pull_request",
      "editJiraIssue",
      "send_email",
    ]) {
      assert.equal(skipsInTest(t), true, t);
    }
    for (const t of [
      "getJiraIssue",
      "searchJiraIssuesUsingJql",
      "get_file_contents",
      "list_pull_requests",
      "search_code",
    ]) {
      assert.equal(skipsInTest(t), false, t);
    }
  });

  it("a skipped tool's answer, and what the job keeps", () => {
    const { result, note } = skippedAnswer(
      "Atlassian MCP",
      "addOrEditJiraIssueComment",
      { issueIdOrKey: "DASH-97", commentBody: "Merged!" },
    );
    assert.equal(result.isError, false);
    assert.match(
      result.text,
      /^Skipped in a test: addOrEditJiraIssueComment on Atlassian MCP wasn't called/,
    );
    assert.deepEqual(note, {
      server: "Atlassian MCP",
      tool: "addOrEditJiraIssueComment",
      args: '{"issueIdOrKey":"DASH-97","commentBody":"Merged!"}',
    });
    const big = skippedAnswer("s", "t", { x: "y".repeat(5000) });
    assert.ok(big.note.args.length < 1600);
  });

  it("outward commands are blocked, its own blocked list kept", () => {
    const bot = withTestBlocks({
      name: "PR Bot",
      commands: { allowed: ["git"], blocked: ["rm"] },
    });
    assert.deepEqual(bot.commands.blocked.slice(0, 1), ["rm"]);
    for (const c of TEST_BLOCKED) assert.ok(bot.commands.blocked.includes(c));
    assert.equal(
      commandDecision("git push -u origin fix/DASH-97", bot.commands).decision,
      "blocked",
    );
    assert.equal(
      commandDecision("cd /w && gh pr create --fill", bot.commands).decision,
      "blocked",
    );
    assert.equal(
      commandDecision("gh issue comment 3 -b hi", bot.commands).decision,
      "blocked",
    );
    assert.notEqual(
      commandDecision("git status", bot.commands).decision,
      "blocked",
    );
    assert.notEqual(
      commandDecision("git commit -m x", bot.commands).decision,
      "blocked",
    );
    assert.deepEqual(
      withTestBlocks({ name: "x" }).commands.blocked,
      TEST_BLOCKED,
    );
  });

  it("pr-ci passes as skipped in a test, and runs otherwise", async () => {
    const input = { input: { answer: "```json\n{}\n```" } };
    const t = await runCheck({ kind: "pr-ci" }, input, { selfTest: true });
    assert.equal(t.pass, true);
    assert.match(t.reason, /^Skipped in a test/);
    const real = await runCheck({ kind: "pr-ci" }, input, {});
    assert.equal(real.pass, false);
    assert.match(real.reason, /no PR link/);
  });
});

describe("the test item, the prompt and the marker", () => {
  it("cleans a test item, and says what to work on", () => {
    assert.deepEqual(
      cleanTestItem({ id: " DASH-97 ", title: "Slugs", junk: 1 }),
      { id: "DASH-97", title: "Slugs" },
    );
    assert.equal(cleanTestItem({ title: "no id" }), null);
    assert.match(
      testPrompt({ id: "DASH-97", title: "Slugs" }),
      /^Self-test: work on DASH-97 — Slugs/,
    );
    assert.deepEqual(
      untestedMark("Reporter changed", new Date("2026-11-27T00:00:00Z")),
      { since: "2026-11-27T00:00:00.000Z", what: "Reporter changed" },
    );
  });

  it("a test job keeps what it skipped; a real one doesn't", () => {
    const jobs = new Map();
    const store = {
      get: (id) => jobs.get(id) || null,
      put: (j) => jobs.set(j.id, j),
      list: () => [...jobs.values()],
      remove: (id) => jobs.delete(id),
    };
    const tracker = createJobTracker({ store: { ...store, save: store.put } });
    const test = tracker.startJob({
      workspaceId: "w",
      title: "Test",
      test: true,
      item: { id: "DASH-97" },
    });
    const real = tracker.startJob({ workspaceId: "w", title: "Real" });
    assert.equal(tracker.isTest(test.id), true);
    assert.equal(tracker.isTest(real.id), false);
    assert.equal(
      tracker.noteSkipped(test.id, { tool: "t", server: "s", args: "{}" }),
      1,
    );
    assert.equal(tracker.noteSkipped(real.id, { tool: "t" }), null);
  });
});

describe("botController: Test team and the untested marker", () => {
  const Module = require("node:module");
  const stub = "__stub_electron_selftest__";
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === "electron") return stub;
    return originalResolve.call(this, request, parent, ...rest);
  };
  require.cache[stub] = {
    id: stub,
    filename: stub,
    loaded: true,
    exports: {
      app: {
        getPath: () => os.tmpdir(),
        getAppPath: () => os.tmpdir(),
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
  Module._resolveFilename = originalResolve;

  const fake = (settings = {}) => {
    const teams = { w: { ...settings } };
    const started = [];
    const ran = [];
    const self = {
      _store: {
        getTeamSettings: (w) => teams[w] || {},
        setTeamSettings: (w, p) => (teams[w] = { ...(teams[w] || {}), ...p }),
        list: () => [
          { id: "t", name: "Ticket Bot", workspaceId: "w" },
          {
            id: "tr",
            name: "Triage",
            workspaceId: "w",
            subscriptions: [{ eventType: "bot:local/ticket-bot[t].completed" }],
          },
        ],
        get: () => null,
      },
      _jobs: { startJob: (j) => (started.push(j), { id: "job_1", ...j }) },
      _run: (id, o) => (ran.push({ id, o }), Promise.resolve({})),
    };
    for (const k of [
      "testItem",
      "setTestItem",
      "untested",
      "_markUntested",
      "testTeam",
    ])
      self[k] = botController[k];
    return { self, teams, started, ran };
  };

  it("Test team needs a test item, then starts a test job on the chain's first bot", async () => {
    const { self, started, ran } = fake();
    assert.match((await self.testTeam("w")).error, /test item first/);
    assert.match(self.setTestItem("w", { title: "x" }).error, /needs an id/);
    self.setTestItem("w", { id: "DASH-97", title: "Slugs" });
    const r = await self.testTeam("w");
    assert.equal(r.jobId, "job_1");
    assert.equal(r.botId, "t");
    assert.equal(started[0].test, true);
    assert.deepEqual(started[0].item, { id: "DASH-97", title: "Slugs" });
    assert.equal(started[0].title, "Test: Ticket Bot on DASH-97");
    assert.equal(ran[0].o.jobId, "job_1");
    assert.match(ran[0].o.prompt, /^Self-test: work on DASH-97/);
  });

  it("a change marks the team untested", () => {
    const { self, teams } = fake();
    assert.equal(self.untested("w"), null);
    self._markUntested("w", "Reporter changed");
    assert.equal(teams.w.untested.what, "Reporter changed");
    assert.equal(self.untested("w").what, "Reporter changed");
  });
});
