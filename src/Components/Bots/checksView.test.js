import {
  addStep,
  cardRows,
  changeKind,
  choiceOf,
  draftError,
  draftOf,
  handsOnChoices,
  handsOnTargets,
  moveStep,
  newCheck,
  removeStep,
  savedChecks,
  stepSub,
  stepTone,
  targetChanges,
  updateStep,
  waitingJobs,
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
  });

  test("jobs that wait for you, per bot", () => {
    const g = (botId, status, extra = {}) => ({
      flow: { kind: "bot-checks", botId },
      tasks: [{ status }],
      ...extra,
    });
    const goals = [
      g("b1", "ready"),
      g("b1", "needs-you"),
      g("b1", "new"),
      g("b1", "ready", { closed: true }),
      g("b2", "ready"),
      { flow: { kind: "flow", botId: "b1" }, tasks: [{ status: "ready" }] },
    ];
    expect(waitingJobs(goals, "b1")).toBe(2);
    expect(waitingJobs(goals, "b2")).toBe(1);
    expect(waitingJobs(null, "b1")).toBe(0);
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
