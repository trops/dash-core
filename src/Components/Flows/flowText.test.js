import { stepPills } from "./flowText";

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
};

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

  it("a job that failed: its check red, the bot green, the rest grey (DASH-13)", () => {
    const failedOut = {
      flow,
      tasks: [
        {
          stepId: "ci",
          status: "closed",
          history: [
            { stepId: "b", status: "passed" },
            { stepId: "ci", status: "failed", to: "needs-you" },
            {
              stepId: "ci",
              by: "you",
              status: "close",
              dash: true,
              failed: true,
            },
          ],
        },
      ],
    };
    expect(stepPills(failedOut).map((p) => p.state)).toEqual([
      "success",
      "error",
      "neutral",
      "neutral",
    ]);
    // Just closed where it was, not failed there: grey, not running.
    const closed = {
      flow,
      tasks: [
        {
          stepId: "you",
          status: "closed",
          history: [
            { stepId: "b", status: "passed" },
            { stepId: "ci", status: "passed" },
            { stepId: "r", status: "passed" },
            { stepId: "you", by: "you", status: "close" },
          ],
        },
      ],
    };
    expect(stepPills(closed).at(-1).state).toBe("neutral");
  });
});
