/**
 * jobPicks.test.js — the row of a team's table a job picked (DASH-84) reaches
 * its later runs and their checks: the answer names "repo": "dash-core", the
 * job keeps it, and the next bot's {repo.validateCmd} is dash-core's.
 * The real botController and BotRunner pieces; Electron stubbed like
 * oneJobAtATime.test.js.
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tempDir } = require("../testUtils/tempDir");

const Module = require("node:module");
const stubDir = tempDir("zz-electron-picks-");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_picks__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_picks__"] = {
  id: "__stub_electron_picks__",
  filename: "__stub_electron_picks__",
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
const BotRunner = require("./BotRunner");
const { mergeTeamValues } = require("./teamValues");
const { createJobStore } = require("../jobs/jobStore");
const { createJobTracker } = require("../jobs/jobTracker");

const WS = "ws1";
const TEAM = mergeTeamValues(null, {
  declare: [
    {
      name: "repo",
      label: "Repos",
      type: "table",
      columns: [
        { name: "url", type: "url" },
        { name: "validateCmd", type: "command" },
      ],
    },
  ],
  values: {
    repo: [
      {
        key: "dash-core",
        url: "https://github.com/trops/dash-core",
        validateCmd: "npm run core-ci",
      },
      {
        key: "dash-react",
        url: "https://github.com/trops/dash-react",
        validateCmd: "npm run react-ci",
      },
    ],
  },
});
const CODER = {
  id: "coder",
  name: "Coder",
  workspaceId: WS,
  instructions: "Work on {repo.url}.",
  checks: {
    steps: [
      {
        kind: "check",
        check: { kind: "command", command: "{repo.validateCmd}" },
      },
    ],
  },
};

const dirs = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

function fake() {
  const dir = fs.mkdtempSync(path.join(stubDir, "jobs-"));
  dirs.push(dir);
  const c = Object.create(botController);
  c._store = {
    list: () => [CODER],
    get: (id) => (id === CODER.id ? CODER : null),
    getTeamSettings: () => ({ declared: TEAM.declared, values: TEAM.values }),
  };
  c._jobs = createJobTracker({
    store: createJobStore({ root: dir }),
    settleMs: 1,
  });
  return c;
}
const answer = (j) => `Planned.\n\`\`\`json\n${JSON.stringify(j)}\n\`\`\``;

describe("a job's picked row reaches its later runs (DASH-84)", () => {
  it("an answer that names a row is remembered on its job", () => {
    const c = fake();
    const job = c._jobs.startJob({ workspaceId: WS, title: "DASH-9" });
    c._rememberPicks(job.id, WS, answer({ key: "DASH-9", repo: "dash-react" }));
    assert.deepEqual(c._jobs.picksOf(job.id), { repo: "dash-react" });
    // Text with no pick changes nothing.
    c._rememberPicks(job.id, WS, "All done.");
    assert.deepEqual(c._jobs.picksOf(job.id), { repo: "dash-react" });
  });

  it("checks are filled from the answer's pick, else the job's", () => {
    const c = fake();
    const job = c._jobs.startJob({ workspaceId: WS, title: "DASH-9" });
    c._jobs.setPicks(job.id, { repo: "dash-react" });
    const fromJob = c.resolvedBot("coder", { jobId: job.id, output: "Done." });
    assert.equal(fromJob.checks.steps[0].check.command, "npm run react-ci");
    const fromAnswer = c.resolvedBot("coder", {
      jobId: job.id,
      output: answer({ repo: "dash-core" }),
    });
    assert.equal(fromAnswer.checks.steps[0].check.command, "npm run core-ci");
    // Without context it keeps {repo.*} (nothing picked).
    assert.equal(
      c.resolvedBot("coder").checks.steps[0].check.command,
      "{repo.validateCmd}",
    );
  });

  it("a run is filled from its input's pick, else the job's (BotRunner)", () => {
    const r = Object.create(BotRunner.prototype);
    r._store = {
      getTeamSettings: () => ({ declared: TEAM.declared, values: TEAM.values }),
    };
    const fromJob = r._withTeamValues(CODER, {
      prompt: "Ticket Bot completed.",
      teamPicks: { repo: "dash-core" },
    });
    assert.deepEqual(fromJob.missing, []);
    assert.equal(
      fromJob.bot.instructions,
      "Work on https://github.com/trops/dash-core.",
    );
    const fromInput = r._withTeamValues(CODER, {
      prompt: answer({ repo: "dash-react" }),
      teamPicks: { repo: "dash-core" },
    });
    assert.equal(
      fromInput.bot.instructions,
      "Work on https://github.com/trops/dash-react.",
    );
    const none = r._withTeamValues(CODER, { prompt: "go" });
    assert.equal(none.missing[0].reason, "unpicked");
  });

  it("a run starts with its job's picks, then its input's (DASH-92)", () => {
    const c = fake();
    const job = c._jobs.startJob({ workspaceId: WS, title: "DASH-9" });
    c._jobs.setPicks(job.id, { repo: "dash-core" });
    assert.deepEqual(c._runPicks("coder", job.id, "go"), { repo: "dash-core" });
    assert.deepEqual(
      c._runPicks("coder", job.id, answer({ repo: "dash-react" })),
      { repo: "dash-react" },
    );
    assert.deepEqual(c._runPicks("coder", null, "go"), {});
    assert.deepEqual(c._runPicks("nobody", job.id, "go"), {
      repo: "dash-core",
    });
  });
});
