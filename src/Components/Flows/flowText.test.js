import {
  checkSummary,
  graphSteps,
  graphEdges,
  stepPills,
  flowCount,
  betweenText,
  inputStepOf,
  youModeOf,
} from "./flowText";

const flow = {
  id: "flow_1",
  name: "Ticket to PR",
  maxRounds: 3,
  steps: [
    { id: "src", kind: "source", name: "Ticket reader", note: "Every 15 min" },
    { id: "b", kind: "bot", name: "Builder" },
    {
      id: "ci",
      kind: "check",
      name: "GitHub CI",
      check: {
        kind: "tool",
        server: "GitHub",
        tool: "get_pull_request_status",
      },
    },
    { id: "r", kind: "bot", name: "Reviewer", judgment: true },
    { id: "you", kind: "you", name: "You", note: "Merge the PR" },
  ],
  edges: [
    { from: "src", to: "b", kind: "next", label: "new" },
    { from: "b", to: "ci", kind: "next", label: "built" },
    { from: "ci", to: "r", kind: "next", label: "passed" },
    { from: "r", to: "you", kind: "next", label: "ready" },
    { from: "ci", to: "b", kind: "fail" },
    { from: "r", to: "b", kind: "fail" },
  ],
  where: {
    counts: {
      b: { goals: 1, rounds: [2], ready: 0, stopped: 0 },
      you: { goals: 1, rounds: [1], ready: 1, stopped: 0 },
    },
    total: 4,
    running: 0,
  },
};

describe("checkSummary", () => {
  it("names the ticked rules", () => {
    expect(
      checkSummary({
        kind: "rules",
        rules: [
          { type: "linksWork", on: true },
          { type: "words", on: true },
          { type: "banned", on: false },
          { type: "everyIncluded", on: true },
        ],
      }),
    ).toBe("Links · length · every item used");
  });
  it("says what a tool call asks", () => {
    expect(checkSummary(flow.steps[2].check)).toBe(
      "Asks GitHub: get_pull_request_status",
    );
  });
});

describe("graphSteps / graphEdges", () => {
  it("shows where jobs are now, and the stop note under you", () => {
    const steps = graphSteps(flow);
    expect(steps.find((s) => s.id === "b").badge).toEqual({
      state: "info",
      label: "1 job · round 2",
    });
    expect(steps.find((s) => s.id === "you").badge).toEqual({
      state: "warning",
      label: "1 ready",
    });
    expect(steps.find((s) => s.id === "you").below.text).toBe(
      "or stopped at round 3",
    );
  });
  it("labels the fix rounds: a check's in red, a reviewer's in amber", () => {
    const edges = graphEdges(flow);
    const ci = edges.find((e) => e.from === "ci" && e.kind === "fail");
    const r = edges.find((e) => e.from === "r" && e.kind === "fail");
    expect(ci.state).toBe("error");
    expect(ci.label).toBe("failed → fix list · up to 3 rounds");
    expect(r.state).toBe("warning");
  });
});

describe("stepPills", () => {
  it("passed steps green, the one it's at in progress, the rest plain", () => {
    const goal = {
      flow,
      tasks: [
        {
          stepId: "ci",
          status: "built",
          history: [
            { stepId: "src", status: "passed" },
            { stepId: "b", status: "passed" },
          ],
        },
      ],
    };
    expect(stepPills(goal).map((p) => `${p.label}:${p.state}`)).toEqual([
      "Builder:success",
      "GitHub CI:info",
      "Reviewer:neutral",
      "You:neutral",
    ]);
  });
  it("a failed check where it is shows red; waiting for you, amber", () => {
    const failed = {
      flow,
      tasks: [
        {
          stepId: "b",
          status: "new",
          history: [{ stepId: "b", status: "failed" }],
        },
      ],
    };
    expect(stepPills(failed)[0].state).toBe("error");
    const ready = {
      flow,
      tasks: [{ stepId: "you", status: "ready", history: [] }],
    };
    expect(stepPills(ready).at(-1).state).toBe("warning");
  });
});

describe("small helpers", () => {
  it("flowCount, betweenText, inputStepOf", () => {
    expect(flowCount(flow)).toEqual({ state: "info", label: "4 jobs" });
    expect(betweenText(flow, "b", "ci")).toBe("between Builder and GitHub CI");
    expect(betweenText(flow, "r", null)).toBe("after Reviewer");
    expect(inputStepOf(flow, "r").name).toBe("Builder");
  });
});

test("youModeOf reads steps saved before modes the way the flow model does", () => {
  expect(youModeOf({ kind: "you", action: "Merge the PR" })).toBe("custom");
  expect(youModeOf({ kind: "you", action: "Approve the send" })).toBe(
    "approve",
  );
  expect(youModeOf({ kind: "you", action: "Read it" })).toBe("read");
  expect(youModeOf({ kind: "you" })).toBe("approve");
  expect(youModeOf({ kind: "you", mode: "read", action: "Approve" })).toBe(
    "read",
  );
});
