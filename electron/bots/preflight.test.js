/**
 * preflight.test.js — a team's setup, checked before a job starts
 * (DASH-108): each kind of problem, with its fix, and the gate that keeps
 * a job with a bad setup from starting.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const { preflight, preflightText, teamRepos, pushes } = require("./preflight");
const { mergeTeamValues } = require("./teamValues");
const { checkAiLogin } = require("./aiLogin");

function team({ rows, extra = [], values = {} } = {}) {
  const r = mergeTeamValues(null, {
    declare: [
      {
        name: "repo",
        label: "Repos",
        type: "table",
        columns: [
          { name: "url", label: "Repository", type: "url" },
          { name: "baseBranch", label: "Base branch", type: "text" },
        ],
      },
      {
        name: "workRoot",
        label: "Work folder",
        type: "folder",
        default: "~/DashFactory",
      },
      { name: "ticketQuery", label: "Ticket query", type: "text" },
      ...extra,
    ],
    values: {
      repo: rows || [
        {
          key: "sandbox",
          url: "https://github.com/trops/sandbox",
          baseBranch: "main",
        },
        {
          key: "sandbox-2",
          url: "https://github.com/trops/sandbox-2",
          baseBranch: "main",
        },
      ],
      ticketQuery: "project = DASH",
      ...values,
    },
  });
  assert.deepEqual(r.errors, []);
  return { declared: r.declared, values: r.values };
}

const ticketBot = {
  id: "t",
  name: "Ticket Bot",
  instructions: "Search {ticketQuery}.",
};
const coder = {
  id: "c",
  name: "Coder",
  instructions: "Work in {workRoot}. Commit.",
  checks: {
    steps: [
      {
        id: "s1",
        kind: "check",
        name: "Validate",
        check: { kind: "repo", name: "validate", base: "{repo.baseBranch}" },
      },
    ],
  },
};
const prBot = {
  id: "p",
  name: "PR Bot",
  instructions: "git push -u origin <branch>, then open a PR.",
};

/** A fake GitHub: `repos` by slug: { push, checks: [names] } or a code. */
function fakeGitHub(repos) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization || null });
    const m = url.match(
      /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(\/contents\/\.dash\/checks\?ref=(.+))?$/,
    );
    const r = m && repos[m[1]];
    if (!r) return { status: 404, json: async () => ({}) };
    if (typeof r === "number") return { status: r, json: async () => ({}) };
    if (m[2]) {
      if (!r.checks) return { status: 404, json: async () => ({}) };
      return {
        status: 200,
        json: async () => r.checks.map((name) => ({ name })),
      };
    }
    return {
      status: 200,
      json: async () => ({
        default_branch: "main",
        permissions: { pull: true, push: r.push !== false },
      }),
    };
  };
  return { fetch, calls };
}

const deps = (gh, extra = {}) => ({
  fetch: gh.fetch,
  gitToken: async () => "t0ken",
  providerFailures: async () => [],
  ...extra,
});

describe("preflight", () => {
  it("a good setup passes", async () => {
    const gh = fakeGitHub({
      "trops/sandbox": { checks: ["validate.sh"] },
      "trops/sandbox-2": { checks: ["validate"] },
    });
    const res = await preflight(
      { bots: [ticketBot, coder, prBot], team: team(), home: "/Users/me" },
      deps(gh),
    );
    assert.deepEqual(res.problems, []);
    assert.equal(res.ok, true);
    assert.ok(gh.calls.every((c) => c.auth === "Bearer t0ken"));
    assert.ok(
      gh.calls.some((c) => c.url.endsWith("contents/.dash/checks?ref=main")),
    );
  });

  it("a setting with no value, and a table with no rows", async () => {
    const t = team({ values: { ticketQuery: "" } });
    const res = await preflight(
      { bots: [ticketBot], team: t },
      deps(fakeGitHub({})),
    );
    assert.equal(res.ok, false);
    assert.equal(res.problems[0].kind, "setting");
    assert.equal(
      res.problems[0].message,
      "Ticket Bot uses Ticket query ({ticketQuery}), which has no value: fill it in on the team's page",
    );
    const rows = await preflight(
      {
        bots: [{ name: "Triage", instructions: "One of: {repo.rows}" }],
        team: team({ rows: [] }),
      },
      deps(fakeGitHub({})),
    );
    assert.match(
      rows.problems[0].message,
      /^Triage uses the Repos table, which has no rows/,
    );
  });

  it("a pick, item or workspace isn't setup: the job fills those", async () => {
    const bot = {
      name: "Coder",
      instructions: "Clone {repo.url} into {workspace.dir} for {item.id}.",
    };
    const res = await preflight(
      { bots: [bot], team: team() },
      deps(fakeGitHub({ "trops/sandbox": {}, "trops/sandbox-2": {} })),
    );
    assert.deepEqual(res.problems, []);
  });

  it("a provider that doesn't start", async () => {
    const res = await preflight(
      { bots: [ticketBot], team: team() },
      deps(fakeGitHub({ "trops/sandbox": {}, "trops/sandbox-2": {} }), {
        providerFailures: async (bot) =>
          bot.name === "Ticket Bot"
            ? [{ serverName: "Atlassian MCP", message: "401 Unauthorized" }]
            : [],
      }),
    );
    assert.equal(res.problems.length, 1);
    assert.equal(
      res.problems[0].message,
      "Ticket Bot's provider Atlassian MCP isn't working (401 Unauthorized): fix it on the Providers page",
    );
  });

  it("an expired AI login, a working one, and a missing one (DASH-114)", async () => {
    const asked = [];
    const logins = {
      "claude-code": {
        ok: false,
        expired: true,
        problem:
          "has a login that reached its time limit (2026-11-01T00:00:00.000Z) and can't be renewed",
        fix: "run `claude auth login` in a terminal, then try again",
      },
      openai: { ok: true },
      anthropic: {
        ok: false,
        missing: true,
        problem: "has no API key saved",
        fix: "add one in Settings › AI, or switch back to your Claude subscription",
      },
    };
    const onAnthropic = { name: "Reviewer", instructions: "Review." };
    const onOpenAI = { name: "Writer", instructions: "Write." };
    const res = await preflight(
      { bots: [ticketBot, coder, onAnthropic, onOpenAI], team: team() },
      deps(fakeGitHub({ "trops/sandbox": {}, "trops/sandbox-2": {} }), {
        providerFailures: async () => [],
        aiProviderOf: (bot) =>
          bot === onAnthropic
            ? "anthropic"
            : bot === onOpenAI
              ? "openai"
              : "claude-code",
        defaultAiProvider: "claude-code",
        aiLogin: async (id) => (asked.push(id), logins[id]),
      }),
    );
    // One call per provider, the default included.
    assert.deepEqual(asked.sort(), ["anthropic", "claude-code", "openai"]);
    const ai = res.problems.filter((p) => p.kind === "ai-login");
    assert.equal(res.ok, false);
    assert.deepEqual(
      ai.map((p) => p.message),
      [
        "Ticket Bot, Coder run on Claude Code, which has a login that reached its time limit (2026-11-01T00:00:00.000Z) and can't be renewed: run `claude auth login` in a terminal, then try again",
        "Reviewer runs on the Anthropic API, which has no API key saved: add one in Settings › AI, or switch back to your Claude subscription",
      ],
    );
    assert.match(preflightText(res.problems), /claude auth login/);
  });

  it("the user's default AI is checked even when no bot runs on it", async () => {
    const res = await preflight(
      { bots: [], team: null },
      {
        defaultAiProvider: "claude-code",
        aiLogin: async () => ({
          ok: false,
          problem: "isn't logged in",
          fix: "run `claude auth login` in a terminal, then try again",
        }),
      },
    );
    assert.equal(
      res.problems[0].message,
      "Your default AI, Claude Code, isn't logged in: run `claude auth login` in a terminal, then try again",
    );
    // A check that can't run, or none given, says nothing.
    const broken = await preflight(
      { bots: [ticketBot], team: null },
      {
        aiProviderOf: () => "claude-code",
        aiLogin: async () => {
          throw new Error("boom");
        },
      },
    );
    assert.deepEqual(broken.problems, []);
    const none = await preflight({ bots: [ticketBot], team: null }, {});
    assert.deepEqual(none.problems, []);
  });

  it("a repo the token can't read, or push to when a bot pushes (DASH-90's 403)", async () => {
    const gh = fakeGitHub({
      "trops/sandbox": { push: false },
      "trops/sandbox-2": 404,
    });
    const res = await preflight({ bots: [prBot], team: team() }, deps(gh));
    const msgs = res.problems.map((p) => p.message);
    assert.deepEqual(msgs, [
      "The GitHub provider's token can't push to trops/sandbox: add the repo to the token with write access (Contents and Pull requests)",
      "The GitHub provider's token can't read trops/sandbox-2 (HTTP 404): add the repo to the token, or check the Repos table's address",
    ]);
    // Nobody pushes: read access is enough.
    const readOnly = await preflight(
      { bots: [ticketBot], team: team() },
      deps(
        fakeGitHub({ "trops/sandbox": { push: false }, "trops/sandbox-2": {} }),
      ),
    );
    assert.deepEqual(readOnly.problems, []);
  });

  it("no GitHub provider: says so", async () => {
    const res = await preflight(
      { bots: [ticketBot], team: team() },
      deps(fakeGitHub({ "trops/sandbox": {} }), { gitToken: async () => null }),
    );
    assert.match(
      res.problems[0].message,
      /^Dash \(no bot on the team has a GitHub provider\) can't read trops\/sandbox-2 \(HTTP 404\): give a bot on the team a GitHub provider$/,
    );
  });

  it("a repo check that isn't on a repo's base branch", async () => {
    const gh = fakeGitHub({
      "trops/sandbox": { checks: ["validate.sh"] },
      "trops/sandbox-2": { checks: ["setup"] },
    });
    const res = await preflight({ bots: [coder], team: team() }, deps(gh));
    assert.equal(res.problems.length, 1);
    assert.equal(
      res.problems[0].message,
      'trops/sandbox-2 has no .dash/checks/validate on main, which Coder\'s "Validate" runs: add it to the repo, or give the step a fallback',
    );
    // With a fallback, or set to skip, it isn't needed.
    for (const extra of [
      { fallback: { kind: "command", command: "npm test" } },
      { ifMissing: "skip" },
    ]) {
      const bot = {
        ...coder,
        checks: {
          steps: [
            {
              ...coder.checks.steps[0],
              check: { ...coder.checks.steps[0].check, ...extra },
            },
          ],
        },
      };
      const ok = await preflight({ bots: [bot], team: team() }, deps(gh));
      assert.deepEqual(ok.problems, []);
    }
  });

  it("finds the team's GitHub repos and who pushes", () => {
    assert.deepEqual(
      teamRepos(team()).map((r) => r.slug),
      ["trops/sandbox", "trops/sandbox-2"],
    );
    assert.equal(pushes(prBot), true);
    assert.equal(
      pushes({
        providers: [{ name: "GitHub", tools: ["create_pull_request"] }],
      }),
      true,
    );
    assert.equal(pushes(ticketBot), false);
  });

  it("says its problems as lines", () => {
    assert.equal(preflightText([]), "The team's setup is good.");
    assert.equal(
      preflightText([{ message: "A" }, { message: "B" }]),
      "The team's setup has 2 problems, so the job didn't start:\n- A\n- B",
    );
  });
});

describe("botController: the setup gate before a job (DASH-108)", () => {
  const Module = require("node:module");
  const stub = "__stub_electron_preflight__";
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

  const ticket = { id: "t", name: "Ticket Bot", workspaceId: "ws1" };
  const fakeSelf = ({ uses = true, setup }) => {
    const jobs = [];
    const self = {
      usesHandoffs: () => uses,
      _setupBeforeJob: async () => setup,
      _store: {
        // The Ticket Bot starts a chain: the Triage bot listens to it.
        list: () => [
          ticket,
          {
            id: "tr",
            name: "Triage",
            workspaceId: "ws1",
            subscriptions: [{ eventType: "bot:local/ticket-bot[t].completed" }],
          },
        ],
        get: (id) => (id === "t" ? ticket : null),
      },
      _jobs: {
        startJob: (j) => {
          const job = { id: `job_${jobs.length + 1}`, ...j, steps: [] };
          jobs.push(job);
          return job;
        },
        startStep: (id, s) =>
          jobs.find((j) => j.id === id).steps.push({ ...s, status: "running" }),
        endStep: (id, { record }) => {
          const st = jobs.find((j) => j.id === id).steps[0];
          st.status = record.status;
          st.summary = record.error;
        },
      },
      ran: [],
      _run(botId, opts) {
        this.ran.push({ botId, opts });
        return { botId, started: true };
      },
    };
    return { self, jobs };
  };

  it("a bad setup doesn't start the job: it shows failed, with the problems", async () => {
    const { self, jobs } = fakeSelf({
      setup: {
        ok: false,
        problems: [
          {
            message:
              "The GitHub provider's token can't push to trops/sandbox-2: add the repo to the token",
          },
        ],
      },
    });
    const res = await botController._preflightGate.call(self, "t", ticket, {
      jobId: null,
      willStart: true,
      opts: { trigger: "schedule" },
    });
    assert.equal(res.skipped, true);
    assert.equal(self.ran.length, 0);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].steps[0].status, "failed");
    assert.match(jobs[0].steps[0].summary, /can't push to trops\/sandbox-2/);
  });

  it("a good setup runs the bot, once", async () => {
    const { self } = fakeSelf({ setup: { ok: true, problems: [] } });
    const res = await botController._preflightGate.call(self, "t", ticket, {
      jobId: null,
      willStart: true,
      opts: { trigger: "you" },
    });
    assert.equal(res.started, true);
    assert.equal(self.ran[0].opts.preflighted, true);
  });

  it("nothing to check: a job's later run, a hand-on, a team without the handoff", () => {
    const { self } = fakeSelf({ setup: { ok: false, problems: [] } });
    const gate = (bot, ctx) =>
      botController._preflightGate.call(self, "t", bot, ctx);
    assert.equal(
      gate(ticket, { jobId: "job_9", willStart: true, opts: {} }),
      null,
    );
    assert.equal(
      gate(ticket, {
        jobId: null,
        willStart: true,
        opts: { trigger: "event" },
      }),
      null,
    );
    assert.equal(
      gate(ticket, {
        jobId: null,
        willStart: true,
        opts: { preflighted: true },
      }),
      null,
    );
    const off = fakeSelf({
      uses: false,
      setup: { ok: false, problems: [] },
    }).self;
    assert.equal(
      botController._preflightGate.call(off, "t", ticket, {
        jobId: null,
        willStart: true,
        opts: {},
      }),
      null,
    );
  });

  it("an expired AI login fails the job with a Setup check step (DASH-114)", async () => {
    const message =
      "Ticket Bot runs on Claude Code, which has a login that reached its time limit (2026-11-01T00:00:00.000Z) and can't be renewed: run `claude auth login` in a terminal, then try again";
    const { self, jobs } = fakeSelf({
      setup: { ok: false, problems: [{ kind: "ai-login", message }] },
    });
    const res = await botController._preflightGate.call(self, "t", ticket, {
      jobId: null,
      willStart: true,
      opts: { trigger: "schedule" },
    });
    assert.equal(res.skipped, true);
    assert.equal(self.ran.length, 0);
    assert.equal(jobs[0].steps[0].botName, "Setup check");
    assert.equal(jobs[0].steps[0].status, "failed");
    assert.match(jobs[0].steps[0].summary, /claude auth login/);
  });

  it("checkSetup asks each AI provider once, the default included, and caches like the rest", async () => {
    const asked = [];
    let login = { ok: true };
    const self = {
      _store: {
        list: () => [
          { id: "a", name: "A", workspaceId: "ws1" },
          { id: "b", name: "B", workspaceId: "ws1", provider: "anthropic" },
        ],
        getTeamSettings: () => null,
        getSettings: () => ({}),
      },
      _modelPick: (bot) => ({ providerId: bot.provider || "claude-code" }),
      _gitTokenFor: async () => null,
      _aiLogin: async (id) => (asked.push(id), login),
    };
    self.checkSetup = botController.checkSetup;
    self._setupBeforeJob = botController._setupBeforeJob;
    const realNow = Date.now;
    let t = realNow();
    Date.now = () => t;
    try {
      const good = await self._setupBeforeJob("ws1");
      assert.equal(good.ok, true);
      assert.deepEqual(asked.sort(), ["anthropic", "claude-code"]);
      // Good: kept 10 minutes.
      t += 9 * 60 * 1000;
      await self._setupBeforeJob("ws1");
      assert.equal(asked.length, 2);
      t += 2 * 60 * 1000;
      login = {
        ok: false,
        expired: true,
        problem: "has a login that reached its time limit",
        fix: "run `claude auth login` in a terminal, then try again",
      };
      const bad = await self._setupBeforeJob("ws1");
      assert.equal(asked.length, 4);
      assert.equal(bad.ok, false);
      assert.equal(bad.problems[0].kind, "ai-login");
      assert.match(bad.text, /claude auth login/);
      // Bad: kept 1 minute.
      t += 30 * 1000;
      await self._setupBeforeJob("ws1");
      assert.equal(asked.length, 4);
      t += 31 * 1000;
      await self._setupBeforeJob("ws1");
      assert.equal(asked.length, 6);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("checkAiLogin: one cheap call per AI provider (DASH-114)", () => {
  const now = () => Date.parse("2026-11-27T12:00:00Z");
  const cli = (status) => ({
    resolveCli: () => "/usr/local/bin/claude",
    readAuthStatus: async () => status,
    now,
  });

  it("Claude Code: an expired login, a working one, none, and no CLI", async () => {
    const expired = await checkAiLogin(
      "claude-code",
      cli({ loggedIn: true, loginExpiresAt: "2026-11-20T00:00:00Z" }),
    );
    assert.equal(expired.ok, false);
    assert.equal(expired.expired, true);
    assert.match(expired.fix, /claude auth login/);
    const good = await checkAiLogin(
      "claude-code",
      cli({ loggedIn: true, loginExpiresAt: "2026-12-27T00:00:00Z" }),
    );
    assert.equal(good.ok, true);
    const out = await checkAiLogin("claude-code", cli({ loggedIn: false }));
    assert.equal(out.ok, false);
    assert.match(out.fix, /claude auth login/);
    const missing = await checkAiLogin("claude-code", {
      resolveCli: () => null,
      now,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.missing, true);
    // An older CLI without `auth status`: can't tell, doesn't block.
    assert.equal((await checkAiLogin("claude-code", cli(null))).ok, true);
  });

  it("an API key: refused, working, missing, and GitHub-style hiccups", async () => {
    const calls = [];
    const fetchWith = (status) => async (url, opts) => {
      calls.push({ url, headers: opts.headers });
      if (status === "down") throw new Error("ENOTFOUND");
      return { status };
    };
    const refused = await checkAiLogin("anthropic", {
      apiKey: "sk-old",
      fetch: fetchWith(401),
    });
    assert.equal(refused.ok, false);
    assert.match(refused.problem, /HTTP 401/);
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/models?limit=1");
    assert.equal(calls[0].headers["x-api-key"], "sk-old");
    const good = await checkAiLogin("openai", {
      apiKey: "sk-ok",
      fetch: fetchWith(200),
    });
    assert.equal(good.ok, true);
    assert.equal(calls[1].url, "https://api.openai.com/v1/models");
    assert.equal(calls[1].headers.Authorization, "Bearer sk-ok");
    const missing = await checkAiLogin("xai", { fetch: fetchWith(200) });
    assert.equal(missing.ok, false);
    assert.equal(missing.missing, true);
    assert.equal(calls.length, 2);
    // Can't reach it, or a 5xx: can't tell, doesn't block.
    assert.equal(
      (
        await checkAiLogin("anthropic", {
          apiKey: "k",
          fetch: fetchWith("down"),
        })
      ).ok,
      true,
    );
    assert.equal(
      (await checkAiLogin("anthropic", { apiKey: "k", fetch: fetchWith(529) }))
        .ok,
      true,
    );
    // A provider it doesn't know: nothing to check.
    assert.equal((await checkAiLogin("someday", {})).ok, true);
  });
});

// DASH-116: strict bots — the "What you can do" block, and the setup
// check's warning for a command its instructions name that isn't allowed.
describe("strict bots (DASH-116)", () => {
  const {
    isStrict,
    capabilitiesBlock,
    instructionCommands,
    strictCommandWarnings,
    REFUSED_LINE,
  } = require("./strictMode");
  const { strictWarnings, preflightText } = require("./preflight");

  it("is strict when set, else when its team uses the standard handoff", () => {
    assert.equal(isStrict({ strict: true }, null), true);
    assert.equal(isStrict({ strict: false }, { usesHandoffs: true }), false);
    assert.equal(isStrict({}, { usesHandoffs: true }), true);
    assert.equal(isStrict({}, { usesHandoffs: false }), false);
    assert.equal(isStrict({}, null), false);
  });

  it("the block lists exactly its tools, commands and folders, then the refused line", () => {
    const text = capabilitiesBlock({
      tools: {
        GitHub: ["create_pull_request", "get_pull_request"],
        Atlassian: ["getJiraIssue"],
        Empty: [],
      },
      commands: ["git status", "npm test"],
      folders: ["/Users/me/DashFactory"],
    });
    assert.equal(
      text,
      [
        "WHAT YOU CAN DO (Dash runs this bot strict: only what's listed here works).",
        "Provider tools:",
        "- Atlassian: getJiraIssue",
        "- GitHub: create_pull_request, get_pull_request",
        "Shell commands (each covers the command and anything after it):",
        "- git status",
        "- npm test",
        "Also inside your folders: cd, pwd, ls, test, [, head, tail, wc, echo, true, and 2>/dev/null or 2>&1.",
        "Run one command per call: no &&, ;, || or |. The shell keeps its folder between calls.",
        "Folders (its file tools and commands work only inside these):",
        "- /Users/me/DashFactory",
        REFUSED_LINE,
      ].join("\n"),
    );
    assert.equal(
      REFUSED_LINE,
      "Anything else is refused. If your task needs something not listed, stop and end your answer failed with what you needed. Don't try another way and don't ask.",
    );
  });

  it("says none where it has nothing, and no commands without all its built-ins", () => {
    const text = capabilitiesBlock({
      tools: {},
      commands: ["git"],
      folders: ["/w"],
      builtins: "read-only",
    });
    assert.match(text, /Provider tools:\n- none/);
    assert.match(text, /anything after it\):\n- none/);
    assert.match(text, /only inside these\):\n- \/w/);
  });

  it("finds the commands its instructions name: backticked, or a plain git push", () => {
    assert.deepEqual(
      instructionCommands(
        "Make sure the tests pass: run `npm test`. Then git push the branch and open it with gh pr create. Go to the page.",
      ),
      ["npm test", "git push", "gh pr"],
    );
  });

  it("the setup check warns about a command that isn't allowed, and not for a bot that isn't strict", () => {
    const bot = {
      name: "PR Bot",
      instructions: "Run `npm test`, then git push.",
      commands: { allowed: ["npm test"] },
    };
    const team = { usesHandoffs: true };
    const w = strictCommandWarnings(bot, team);
    assert.deepEqual(
      w.map((x) => x.command),
      ["git push"],
    );
    assert.match(w[0].message, /^PR Bot's instructions use "git push"/);
    assert.deepEqual(
      strictCommandWarnings({ ...bot, strict: false }, team),
      [],
    );
    assert.deepEqual(
      strictCommandWarnings(
        { ...bot, commands: { allowed: ["npm test", "git"] } },
        team,
      ),
      [],
    );
    const all = strictWarnings([bot, null], team);
    assert.equal(all.length, 1);
    assert.match(
      preflightText([], all),
      /^The team's setup is good\.\nWorth a look:\n- PR Bot's instructions use "git push"/,
    );
  });

  it("preflight returns the warnings, and they don't stop a job", async () => {
    const { preflight } = require("./preflight");
    const res = await preflight({
      bots: [
        {
          name: "PR Bot",
          strict: true,
          instructions: "Then `gh pr create`.",
          commands: { allowed: [] },
        },
      ],
      team: null,
    });
    assert.equal(res.ok, true);
    assert.equal(res.warnings[0].command, "gh pr");
  });
});
