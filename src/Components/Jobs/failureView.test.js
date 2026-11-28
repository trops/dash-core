/**
 * failureView (DASH-122): a failed job says where and why it failed, and
 * offers the button that fixes it — one test per kind of failure.
 */
import {
  failedSteps,
  failureStep,
  failureThenText,
  failureTitle,
  failureView,
  plainReason,
  quoted,
  settingLabel,
} from "./failureView";

const job = (steps, extra = {}) => ({
  id: "job_1",
  status: "failed",
  leadId: "lead",
  steps,
  ...extra,
});

/** A bot's checks job: `fails` failed tries of "validate", then closed. */
const checksGoal = ({ fails = 2, maxRounds = 2, held = false } = {}) => {
  const history = [];
  for (let i = 1; i <= fails; i += 1) {
    history.push({ stepId: "step_work", status: "built", at: `t${i}` });
    history.push({
      stepId: "c1",
      status: "failed",
      summary: `${4 - i} tests fail`,
      to: i < fails ? "step_work" : "needs-you",
      evidence: [{ label: "output", value: "FAIL formatDate" }],
      at: `t${i}b`,
    });
  }
  if (fails) history.push({ by: "you", status: "close", dash: true });
  return {
    id: "goal_1",
    flow: {
      kind: "bot-checks",
      maxRounds,
      steps: [
        { id: "step_work", kind: "bot", name: "Coder" },
        held
          ? { id: "c1", kind: "you", name: "npm test (off)" }
          : { id: "c1", kind: "check", name: "validate" },
      ],
    },
    tasks: [
      {
        status: held ? "ready" : "closed",
        stepId: held ? "c1" : "step_work",
        maxRounds,
        history: held
          ? [{ stepId: "step_work", status: "built", at: "t1" }]
          : history,
      },
    ],
    closed: !held,
  };
};

describe("failureView", () => {
  it("is null for a job that didn't fail and doesn't wait on a fix", () => {
    expect(failureView(job([], { status: "done" }))).toBeNull();
    expect(
      failureView(
        job([{ id: "s", botId: "b", status: "needs-you", waiting: "paused" }], {
          status: "needs-you",
        }),
      ),
    ).toBeNull();
    expect(failureView(null)).toBeNull();
  });

  it("a missing setting: Failed at its bot, and Open <bot>'s settings", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          summary: "The team's setup has 1 problem, so the job didn't start: …",
          problems: [
            {
              kind: "setting",
              bot: "Workspace Bot",
              botId: "wb",
              setting: "workFolder",
              message:
                "Workspace Bot uses Work folder ({workFolder}), which has no value: fill it in on the team's page",
            },
          ],
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Workspace Bot: its Work folder has no value",
    );
    expect(v.kind).toBe("setting");
    expect(v.action).toEqual({
      type: "settings",
      label: "Open Workspace Bot's settings",
      botId: "wb",
    });
    // Its fix is the setup; then the whole job runs again (DASH-165),
    // its setup checked again first.
    expect(v.rerun).toBe(true);
  });

  it("a bot's own setting (DASH-136): its words, its bot's settings", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          problems: [
            {
              kind: "setting",
              bot: "Workspace Bot",
              botId: "wb",
              message:
                "Workspace Bot: Work folder has no value: fill it in on its Settings tab",
            },
          ],
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Workspace Bot: its Work folder has no value",
    );
    expect(v.action.label).toBe("Open Workspace Bot's settings");
    // From the summary's text alone, too.
    const old = failureView(
      job([
        { id: "s0", botId: "wb", botName: "Workspace Bot", status: "skipped" },
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          summary:
            "The team's setup has 1 problem, so the job didn't start: - Workspace Bot: Repos has no rows: fill it in on its Settings tab",
        },
      ]),
    );
    expect(failureTitle(old)).toBe(
      "Failed at Workspace Bot: its Repos table has no rows",
    );
    expect(old.action.botId).toBe("wb");
  });

  it("an older Setup check step: its problems from the summary's lines", () => {
    const v = failureView(
      job([
        { id: "s0", botId: "wb", botName: "Workspace Bot", status: "skipped" },
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          summary:
            "The team's setup has 2 problems, so the job didn't start: - Workspace Bot uses {workFolder}, which has no value: fill it in on the team's page - Coder runs on Claude Code, which isn't logged in: run `claude auth login`",
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Workspace Bot: its workFolder has no value (and 1 more)",
    );
    expect(v.action.type).toBe("settings");
    expect(v.action.botId).toBe("wb");
    expect(v.lines).toHaveLength(2);
  });

  it("an expired login: Check setup", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          summary: "setup",
          problems: [
            {
              kind: "ai-login",
              provider: "claude-code",
              bot: "Ticket Bot",
              message:
                "Ticket Bot runs on Claude Code, which has a login that reached its time limit and can't be renewed: run `claude auth login`",
            },
          ],
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Ticket Bot: it runs on Claude Code, which has a login that reached its time limit and can't be renewed",
    );
    expect(v.detail).toBe("run `claude auth login`");
    expect(v.action).toEqual({ type: "check-setup", label: "Check setup" });
  });

  it("a login error in a run: Check setup, and it can run again", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          summary: "Claude Code isn't logged in. Run claude auth login.",
        },
      ]),
    );
    expect(v.kind).toBe("login");
    expect(v.reason).toBe("claude Code isn't logged in");
    expect(v.action.type).toBe("check-setup");
    expect(v.rerun).toBe(true);
  });

  it("a provider that isn't working: Check setup", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          problems: [
            {
              kind: "provider",
              bot: "Reporter",
              botId: "r",
              provider: "Atlassian",
              message:
                "Reporter's provider Atlassian isn't working (it didn't start): fix it on the Providers page",
            },
          ],
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Reporter: its provider Atlassian isn't working",
    );
    expect(v.action.type).toBe("check-setup");
  });

  it("a refusal reuses its exact reason and opens that settings section", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          summary: "Coder can't run `git push`…",
          refusal: {
            kind: "command",
            what: "git push origin main",
            why: "it's on the bot's blocked commands (\"git push\")",
            fix: 'Take "git push" off the bot\'s Commands.',
            section: "commands",
          },
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Coder: it can't run `git push origin main`: it's on the bot's blocked commands (\"git push\")",
    );
    expect(v.action).toEqual({
      type: "settings",
      label: "Open Coder's Commands",
      botId: "c",
      section: "commands",
    });
  });

  it("checks out of tries: the check, how many tries, its reason and output", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          goalId: "goal_1",
          summary: "Changed formatDate.",
          failed: 'Didn\'t pass "validate" on try 2: 2 tests fail',
        },
      ]),
      { goal: checksGoal() },
    );
    expect(failureTitle(v)).toBe(
      "Failed at Coder: its check “validate” still fails after 2 tries",
    );
    expect(v.detail).toBe("2 tests fail");
    expect(v.output).toEqual({
      name: "validate",
      output: "FAIL formatDate",
      exitCode: null,
    });
    expect(v.action).toEqual({ type: "rerun", label: "Run the job again" });
    expect(v.rerun).toBe(true);
  });

  it("checks failed, its goal not read yet: the step's own why", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          failed: 'Didn\'t pass "validate" on try 1: 3 tests fail',
        },
      ]),
    );
    expect(v.kind).toBe("checks");
    expect(v.reason).toBe("its check “validate” failed");
    expect(v.detail).toBe("3 tests fail");
  });

  it("a package command that's off: Waiting at, and Turn on <check>", () => {
    const v = failureView(
      job(
        [
          {
            id: "s1",
            botId: "c",
            botName: "Coder",
            status: "needs-you",
            goalId: "goal_1",
          },
        ],
        { status: "needs-you" },
      ),
      { goal: checksGoal({ held: true }) },
    );
    expect(failureTitle(v)).toBe(
      "Waiting at Coder: its check “npm test” came with the package and is off",
    );
    expect(v.action).toEqual({
      type: "turn-on",
      label: "Turn on “npm test”",
      botId: "c",
      check: "npm test",
    });
    expect(v.rerun).toBe(false);
  });

  it("a package command that's off says its command, and Turn on <command> (DASH-125)", () => {
    const goal = checksGoal({ held: true });
    goal.flow.steps[1] = {
      id: "c1",
      kind: "you",
      name: "Tests pass (off)",
      offCommand: "npm test",
    };
    const v = failureView(
      job(
        [
          {
            id: "s1",
            botId: "c",
            botName: "Coder",
            status: "needs-you",
            goalId: "goal_1",
          },
        ],
        { status: "needs-you" },
      ),
      { goal },
    );
    expect(failureTitle(v)).toBe(
      "Waiting at Coder: its check “Tests pass” (npm test) came with the package and is off",
    );
    expect(v.action).toEqual({
      type: "turn-on",
      label: "Turn on npm test",
      botId: "c",
      check: "Tests pass",
      command: "npm test",
    });
  });

  it("over budget: Stopped at, and Raise budget (waiting or failed)", () => {
    const waiting = failureView(
      job(
        [
          {
            id: "s1",
            botId: "r",
            botName: "Reviewer",
            status: "needs-you",
            waiting: "budget",
            summary: "Reviewer is over its budget, so it hasn't started.",
          },
        ],
        { status: "needs-you" },
      ),
    );
    expect(failureTitle(waiting)).toBe(
      "Stopped at Reviewer: it's over its monthly budget",
    );
    expect(waiting.action).toEqual({
      type: "budget",
      label: "Raise budget",
      botId: "r",
    });
    const failed = failureView(
      job([
        {
          id: "s1",
          botId: "r",
          botName: "Reviewer",
          status: "failed",
          summary: "It didn't run: this bot is over its budget.",
        },
      ]),
    );
    expect(failed.kind).toBe("budget");
  });

  it("a missing setting in a run's own error opens that bot's settings", () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          summary:
            "This team's setting Repo ({repo}) has no value: fill it in on the dashboard (Bots › Team settings), then run again.",
        },
      ]),
    );
    expect(failureTitle(v)).toBe("Failed at Coder: its Repo has no value");
    expect(v.action.label).toBe("Open Coder's settings");
  });

  it('a handoff that said "status": "failed": its own reason in the header (DASH-165)', () => {
    const v = failureView(
      job([
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          failed:
            "Didn't pass \"Handoff\" on try 1: It said it couldn't do it: My workspace ~/W/DASH-147 is gone.",
        },
      ]),
    );
    expect(v.kind).toBe("bot-failed");
    expect(failureTitle(v)).toBe(
      "Failed at Coder: it couldn't do its work: My workspace ~/W/DASH-147 is gone",
    );
    expect(v.action).toEqual({ type: "rerun", label: "Run the job again" });
    expect(v.rerun).toBe(true);
  });

  it("anything else: its first sentence, and Run the job again", () => {
    const v = failureView(
      job([
        { id: "s0", botId: "p", botName: "Planner", status: "done" },
        {
          id: "s1",
          botId: "c",
          botName: "Coder",
          status: "failed",
          summary: "**Tool error**: the disk is full. More text here.",
        },
      ]),
    );
    expect(failureTitle(v)).toBe(
      "Failed at Coder: tool error: the disk is full",
    );
    expect(v.action.type).toBe("rerun");
    expect(failureStep(job([{ id: "a", status: "failed" }])).id).toBe("a");
  });
});

describe("plain words", () => {
  it("settingLabel and plainReason", () => {
    expect(settingLabel("Work folder ({workFolder})")).toBe("Work folder");
    expect(settingLabel("{workFolder}")).toBe("workFolder");
    expect(plainReason("It failed.")).toBe("It failed");
    expect(plainReason("")).toBe("");
    expect(plainReason("x".repeat(300))).toHaveLength(200);
  });
});

// John's Code Factory self-test (dash-electron 0.0.1153): the Coder's
// chained command was refused, then the Reporter ran On Failure and its own
// check failed too. The header must lead with the Coder.
const selfTest = () =>
  job([
    {
      id: "s1",
      botId: "lead",
      botName: "Planner",
      status: "done",
      startedAt: "2026-11-27T10:00:00.000Z",
      endedAt: "2026-11-27T10:01:00.000Z",
    },
    {
      id: "s2",
      botId: "coder",
      botName: "Coder",
      status: "failed",
      why: { kind: "handon", by: "Planner", label: "Planned" },
      startedAt: "2026-11-27T10:01:00.000Z",
      endedAt: "2026-11-27T10:03:00.000Z",
      summary: "Coder can't run `cd repo && npm test`…",
      refusal: {
        kind: "command",
        what: "cd repo && npm test",
        why: "a strict bot runs one command per call (no &&, ;, || or |)",
        fix: "Change the bot's instructions so it runs each step as its own command.",
        section: "instructions",
      },
    },
    {
      id: "s3",
      botId: "reporter",
      botName: "Reporter",
      status: "failed",
      why: { kind: "handon", by: "Coder", label: "Failed" },
      goalId: "goal_r",
      startedAt: "2026-11-27T10:03:01.000Z",
      endedAt: "2026-11-27T10:05:00.000Z",
      summary: "Posted the failure.",
      failed:
        'Didn\'t pass "The ticket got its comment" on try 2: No comment on the ticket',
    },
  ]);

describe("the first failure leads (an On Failure bot that failed too)", () => {
  it("leads with the Coder's refusal and its fix; the Reporter is a line", () => {
    const j = selfTest();
    expect(failureStep(j).id).toBe("s2");
    const v = failureView(j);
    expect(failureTitle(v)).toBe(
      "Failed at Coder: it can't run `cd repo && npm test`: a strict bot runs one command per call (no &&, ;, || or |)",
    );
    expect(v.detail).toBe(
      "Change the bot's instructions so it runs each step as its own command.",
    );
    expect(v.action).toEqual({
      type: "settings",
      label: "Open Coder's Instructions",
      botId: "coder",
      section: "instructions",
    });
    expect(v.rerun).toBe(true);
    expect(v.then).toHaveLength(1);
    expect(failureThenText(v.then[0])).toBe(
      "Then Reporter failed too: its check “The ticket got its comment” still fails after 2 tries",
    );
    expect(v.then[0].botName).toBe("Reporter");
  });

  it("the Reporter's checks job doesn't take the header either", () => {
    // The page reads the first failure's goal; the Coder has none.
    const v = failureView(selfTest(), { goal: null });
    expect(v.botName).toBe("Coder");
    expect(v.kind).toBe("blocked");
  });

  it("never reads 'its The … check'", () => {
    const v = failureView(selfTest());
    const all = [failureTitle(v), ...v.then.map(failureThenText)].join("\n");
    expect(all).not.toMatch(/its The /);
    expect(all).not.toMatch(/ check still fails/);
  });

  it("a step run again starts a new try: failures from before it drop off", () => {
    const j = selfTest();
    // Run again from Coder: it ran fine; then the Tester failed.
    j.steps[1] = {
      ...j.steps[1],
      status: "done",
      retries: 1,
      refusal: undefined,
      startedAt: "2026-11-27T11:00:00.000Z",
      endedAt: "2026-11-27T11:02:00.000Z",
    };
    j.steps.push({
      id: "s4",
      botId: "tester",
      botName: "Tester",
      status: "failed",
      startedAt: "2026-11-27T11:02:01.000Z",
      endedAt: "2026-11-27T11:03:00.000Z",
      failed: 'Didn\'t pass "Tests pass" on try 1: 3 tests fail',
    });
    const { first, then } = failedSteps(j);
    expect(first.id).toBe("s4");
    expect(then).toEqual([]);
    expect(failureTitle(failureView(j))).toBe(
      "Failed at Tester: its check “Tests pass” failed",
    );
  });

  it("check names are quoted, and their full stops don't end a sentence", () => {
    expect(quoted("Tests pass")).toBe("“Tests pass”");
    expect(quoted('"Tests pass"')).toBe("“Tests pass”");
    expect(quoted("")).toBe("");
    expect(plainReason('Didn\'t pass "v1.2 builds" on try 1. More.')).toBe(
      'Didn\'t pass "v1.2 builds" on try 1',
    );
  });
});
