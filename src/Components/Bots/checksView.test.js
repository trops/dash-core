import {
  addStep,
  cardRows,
  changeKind,
  choiceOf,
  draftError,
  draftOf,
  handsOnChoices,
  handsOnTargets,
  liveChecks,
  moveStep,
  newCheck,
  removeStep,
  savedChecks,
  stepSub,
  stepTone,
  STEP_CHOICES,
  targetChanges,
  updateStep,
} from "./checksView";

const rule = {
  id: "step_c1",
  kind: "check",
  name: "No bananas",
  check: { kind: "rules", rules: [{ type: "banned", field: "input.answer" }] },
};
const cmd = {
  id: "step_c2",
  kind: "check",
  name: "npm test passes",
  check: { kind: "command", command: "npm test" },
};
const rev = {
  id: "step_c3",
  kind: "reviewer",
  name: "Reads well",
  botId: "b2",
};
const you = { id: "step_c4", kind: "you", name: "You approve" };

describe("checksView", () => {
  test("each step's tone: rule, command, reviewer, you", () => {
    expect(stepTone(rule)).toBe("rule");
    expect(stepTone(cmd)).toBe("command");
    expect(stepTone(rev)).toBe("reviewer");
    expect(stepTone(you)).toBe("you");
    expect(stepTone({ kind: "check", check: { kind: "tool" } })).toBe("rule");
  });

  test("the card shows up to 3 rows, then the rest as more", () => {
    expect(cardRows({ steps: [rule, cmd] })).toEqual({
      rows: [
        { key: "step_c1", name: "No bananas", tone: "rule" },
        { key: "step_c2", name: "npm test passes", tone: "command" },
      ],
      more: 0,
      count: 2,
    });
    const four = cardRows({ steps: [rule, cmd, rev, you] });
    expect(four.rows.map((r) => r.key)).toEqual(["step_c1", "step_c2"]);
    expect(four.more).toBe(2);
    expect(four.count).toBe(4);
    expect(cardRows({ steps: [rule, cmd, rev] }).more).toBe(0);
    expect(cardRows(null)).toEqual({ rows: [], more: 0, count: 0 });
  });

  test("a draft is a copy with defaults", () => {
    const saved = { steps: [rule], onFail: "you", maxTries: 5 };
    const d = draftOf(saved);
    expect(d).toEqual({
      steps: [rule],
      onFail: "you",
      maxTries: 5,
      handsOn: "answer",
    });
    d.steps[0].name = "changed";
    expect(rule.name).toBe("No bananas");
    expect(draftOf(null)).toEqual({
      steps: [],
      onFail: "retry",
      maxTries: 3,
      handsOn: "answer",
    });
  });

  test("add, move, change and remove steps", () => {
    let d = draftOf({ steps: [rule] });
    d = addStep(d, 0, newCheck("you"));
    expect(d.steps.map((s) => s.kind)).toEqual(["you", "check"]);
    expect(d.steps[0].id).toMatch(/^step_c\d+$/);
    expect(d.steps[0].id).not.toBe("step_c1");
    d = moveStep(d, 0, 1);
    expect(d.steps.map((s) => s.kind)).toEqual(["check", "you"]);
    d = updateStep(d, 0, { name: "Renamed" });
    expect(d.steps[0].name).toBe("Renamed");
    d = removeStep(d, 1);
    expect(d.steps).toHaveLength(1);
    expect(savedChecks(removeStep(d, 0))).toBeNull();
  });

  test("at most 10 checks", () => {
    let d = draftOf(null);
    for (let i = 0; i < 12; i++)
      d = addStep(d, d.steps.length, newCheck("you"));
    expect(d.steps).toHaveLength(10);
    expect(new Set(d.steps.map((s) => s.id)).size).toBe(10);
  });

  test("changing kind keeps the user's name and the id", () => {
    const named = changeKind({ ...cmd, name: "My test" }, "you");
    expect(named).toEqual({ kind: "you", name: "My test", id: "step_c2" });
    const unnamed = changeKind(
      { ...newCheck("command"), id: "step_c9" },
      "reviewer",
    );
    expect(unnamed.name).toBe("Reviewer");
    expect(unnamed.botId).toBe("");
    expect(choiceOf(changeKind(rule, "compare"))).toBe("compare");
    expect(changeKind(rule, "rules")).toBe(rule);
  });

  test("what the window refuses before saving", () => {
    expect(draftError(draftOf({ steps: [rule, you] }), "b1")).toBeNull();
    expect(
      draftError(draftOf({ steps: [{ ...rev, botId: "" }] }), "b1"),
    ).toMatch(/needs the bot that reviews/);
    expect(draftError(draftOf({ steps: [rev] }), "b2")).toMatch(
      /can't review its own work/,
    );
    expect(draftError(draftOf({ steps: [newCheck("command")] }), "b1")).toMatch(
      /needs a command/,
    );
    expect(draftError(draftOf({ steps: [newCheck("compare")] }), "b1")).toMatch(
      /provider and a tool/,
    );
  });

  test("a step's sub-line", () => {
    expect(stepSub(you)).toMatch(/Waits in Jobs/);
    expect(stepSub(rev, () => "Editor")).toBe("Reviewer bot · Editor");
    expect(stepSub(cmd)).toBe("Command · npm test");
    expect(stepSub(rule)).toBe("1 rule · no AI");
    // Only when a team setting says so (DASH-85).
    expect(stepSub({ ...you, when: "{approvePlans}" })).toMatch(
      /Waits in Jobs .* · only when \{approvePlans\}$/,
    );
  });

  describe("what its checks are doing now", () => {
    const work = (at) => ({ stepId: "step_work", status: "passed", at });
    const failed = { stepId: "step_c1", status: "failed", to: "step_work" };
    // A job of b1's: its task at `stepId` with `status`, after `history`.
    const g = (id, { botId = "b1", status = "new", stepId, history, at }) => ({
      id,
      workspaceId: "ws1",
      createdAt: at || "2026-11-18T10:00:00Z",
      flow: { kind: "bot-checks", botId, maxRounds: 3, steps: [] },
      tasks: [{ status, stepId, history: history || [work()], maxRounds: 3 }],
    });
    const nothing = {
      needs: 0,
      header: null,
      waiting: false,
      stepId: null,
      goalId: null,
      workspaceId: null,
    };

    test("nothing open: nothing to show or open", () => {
      expect(liveChecks([], "b1")).toEqual(nothing);
      expect(liveChecks(null, "b1")).toEqual(nothing);
    });

    test("one job at a check: which try and which check", () => {
      const live = liveChecks([g("j1", { stepId: "step_c2" })], "b1");
      expect(live.header).toBe("Checking · try 1 of 3");
      expect(live.stepId).toBe("step_c2");
      expect(live.goalId).toBe("j1");
      expect(live.workspaceId).toBe("ws1");
      expect(live.needs).toBe(0);
    });

    test("sent back to the bot: the try it's making", () => {
      const live = liveChecks(
        [g("j1", { stepId: "step_work", history: [work(), failed] })],
        "b1",
      );
      expect(live.header).toBe("Sent back · try 2 of 3");
      expect(live.stepId).toBe(null);
    });

    test("waiting for you: counted, and opened first", () => {
      const live = liveChecks(
        [
          g("j1", { stepId: "step_c1", at: "2026-11-18T11:00:00Z" }),
          g("j2", { status: "ready", stepId: "step_c4" }),
          g("j3", { status: "needs-you", stepId: "step_c1" }),
        ],
        "b1",
      );
      expect(live.needs).toBe(2);
      expect(live.header).toBe("Checking · try 1 of 3");
      expect(live.goalId).toBe("j2");
    });

    test("two jobs being worked on: a count, no one check, the newest opens", () => {
      const live = liveChecks(
        [
          g("old", { stepId: "step_c1", at: "2026-11-18T09:00:00Z" }),
          g("new", { stepId: "step_c2", at: "2026-11-18T12:00:00Z" }),
        ],
        "b1",
      );
      expect(live.header).toBe("Checking 2 jobs");
      expect(live.stepId).toBe(null);
      expect(live.goalId).toBe("new");
    });

    test("sent back to a paused bot: it waits, nothing spins", () => {
      const back = (id) =>
        g(id, { stepId: "step_work", history: [work(), failed] });
      const one = liveChecks([back("j1")], "b1", { paused: true });
      expect(one.header).toBe("Paused · try 2 of 3 waits");
      expect(one.waiting).toBe(true);
      expect(one.goalId).toBe("j1");
      const two = liveChecks([back("j1"), back("j2")], "b1", { paused: true });
      expect(two.header).toBe("Paused · 2 jobs wait");
      // Dash's own checks still run while the bot is paused.
      const checking = liveChecks([g("j3", { stepId: "step_c1" })], "b1", {
        paused: true,
      });
      expect(checking.header).toBe("Checking · try 1 of 3");
      expect(checking.waiting).toBe(false);
    });

    test("finished, closed, other bots' and old flow jobs don't count", () => {
      const live = liveChecks(
        [
          g("done", { status: "done", stepId: "step_c1" }),
          { ...g("closed", { status: "ready" }), closed: true },
          g("other", { botId: "b2", status: "ready" }),
          {
            ...g("flow", { status: "ready" }),
            flow: { kind: "flow", botId: "b1" },
          },
        ],
        "b1",
      );
      expect(live).toEqual(nothing);
    });
  });

  describe("hands on", () => {
    const ev = (id, event) => `bot:local/${id}[${id}].${event}`;
    const me = { id: "b1", name: "Writer" };
    const next = {
      id: "b2",
      name: "Sender",
      subscriptions: [{ eventType: ev("b1", "completed") }],
    };
    const onFail = {
      id: "b3",
      name: "Fixer",
      subscriptions: [{ eventType: ev("b1", "failed") }],
    };
    const lead = { id: "L", name: "Lead", role: "lead" };
    const results = {
      key: "dash.bots.BotResults|7",
      component: "dash.bots.BotResults",
      label: "Bot results",
    };
    const other = { key: "x.Board|8", component: "x.Board", label: "Board" };
    const wEdges = [
      { key: "r|7", from: "b1", widget: results.key, kind: "results" },
      {
        key: "w|8|b1|failed",
        from: "b1",
        widget: other.key,
        kind: "failed",
        event: "failed",
      },
    ];

    test("its next bots on completed, and the widgets that show it", () => {
      const t = handsOnTargets(
        me,
        [me, next, onFail],
        [results, other],
        wEdges,
      );
      expect(t.map((x) => x.key)).toEqual(["bot:b2", "widget:r|7"]);
      expect(t[0].eventType).toBe(ev("b1", "completed"));
    });

    test("who listens for its failures: bots and widgets on failed (DASH-12)", () => {
      const t = handsOnTargets(
        me,
        [me, next, onFail],
        [results, other],
        wEdges,
        "failed",
      );
      expect(t.map((x) => x.key)).toEqual(["bot:b3", "widget:w|8|b1|failed"]);
    });

    test("what can be added: other team bots and Bot results widgets", () => {
      const current = handsOnTargets(me, [me, next, onFail], [results], wEdges);
      const c = handsOnChoices(
        me,
        [me, next, onFail, lead],
        [results, other],
        current,
      );
      expect(c.map((x) => x.key)).toEqual(["bot:b3"]);
      const none = handsOnChoices(me, [me], [results, other], []);
      expect(none.map((x) => x.key)).toEqual([`new:${results.key}`]);
      // Another bot's Bot results widget isn't offered (it'd be taken away).
      const taken = handsOnChoices(
        me,
        [me],
        [{ ...results, resultsBotId: "b9" }],
        [],
      );
      expect(taken).toEqual([]);
    });

    test("the changes to make on Save", () => {
      const a = { key: "bot:b2" };
      const b = { key: "widget:r|7" };
      const c = { key: "bot:b3" };
      expect(targetChanges([a, b], [b, c])).toEqual({
        adds: [c],
        removes: [a],
      });
    });
  });
});

describe("a check kept in the repo (DASH-102)", () => {
  it("is offered, starts as validate, and shows its file", () => {
    expect(STEP_CHOICES.map((c) => c.value)).toContain("repo");
    const step = newCheck("repo");
    expect(step.check).toEqual({
      kind: "repo",
      name: "validate",
      ifMissing: "fail",
    });
    expect(choiceOf(step)).toBe("repo");
    expect(stepTone(step)).toBe("command");
    expect(stepSub(step)).toBe("Repo · .dash/checks/validate");
    expect(stepSub({ ...step, held: true })).toBe(
      "Off · came with the package · Repo · .dash/checks/validate",
    );
  });

  it("needs a file name Dash can use", () => {
    const step = { ...newCheck("repo"), id: "a" };
    expect(draftError({ steps: [step] }, "me")).toBeNull();
    expect(
      draftError(
        { steps: [{ ...step, check: { kind: "repo", name: "" } }] },
        "me",
      ),
    ).toMatch(/needs the name of its file/);
    expect(
      draftError(
        { steps: [{ ...step, check: { kind: "repo", name: "../x" } }] },
        "me",
      ),
    ).toMatch(/can't be a check's name/);
  });
});

describe("the built-in factory checks (DASH-103)", () => {
  it("are offered by name and say what they check", () => {
    const values = STEP_CHOICES.map((c) => c.value);
    for (const k of [
      "git-on-branch",
      "git-committed",
      "pr-ci",
      "handoff-has",
    ]) {
      expect(values).toContain(k);
      expect(newCheck(k).check.kind).toBe(k);
      expect(choiceOf(newCheck(k))).toBe(k);
    }
    expect(stepSub(newCheck("git-committed"))).toBe(
      "Built in · committed past the base branch · no AI",
    );
    expect(
      stepSub({
        ...newCheck("handoff-has"),
        check: { kind: "handoff-has", keys: ["prUrl", "pr"] },
      }),
    ).toBe("Built in · the handoff has prUrl, pr · no AI");
  });

  it("a handoff-has check needs its keys", () => {
    const step = {
      ...newCheck("handoff-has"),
      id: "a",
      check: { kind: "handoff-has", keys: [] },
    };
    expect(draftError({ steps: [step] }, "me")).toMatch(/needs the keys/);
  });
});

describe("a check package step (DASH-106)", () => {
  it("is offered, says its package, and needs one", () => {
    expect(STEP_CHOICES.map((c) => c.value)).toContain("package");
    const step = { ...newCheck("package"), id: "a" };
    expect(step.check).toEqual({ kind: "package", package: "", inputs: {} });
    expect(stepSub(step)).toBe("Package · pick one · no AI");
    expect(draftError({ steps: [step] }, "me")).toMatch(/needs a package/);
    const set = {
      ...step,
      check: { ...step.check, package: "plan-has-sections" },
    };
    expect(draftError({ steps: [set] }, "me")).toBeNull();
    expect(stepSub(set)).toBe("Package · plan-has-sections · no AI");
  });
});
