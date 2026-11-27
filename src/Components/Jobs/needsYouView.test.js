import {
  botPassText,
  botPassesOf,
  canAlwaysAllow,
  jobsNeedingYou,
  looseApprovals,
  youCheckLine,
  youCheckOf,
  youCheckTitle,
} from "./needsYouView";

// A bot's checks job (DASH-124): an approval is just a "You approve" check.
const flow = (last) => ({
  kind: "bot-checks",
  botId: "pl",
  steps: [
    { id: "step_work", kind: "bot", name: "Planner", botId: "pl" },
    { id: "step_handoff", kind: "check", name: "Handoff" },
    last,
  ],
});
const goal = (last, task) => ({
  id: "g1",
  flow: flow(last),
  createdAt: 1,
  tasks: [{ id: "t1", round: 1, ...task }],
});
const work = { stepId: "step_work", status: "passed", at: 2 };

describe("youCheckOf", () => {
  const you = { id: "step_c1", kind: "you", name: "Plan approved" };
  it("names the 'You approve' check the job waits at", () => {
    expect(
      youCheckOf(goal(you, { status: "ready", stepId: "step_c1" })),
    ).toEqual({ id: "step_c1", name: "Plan approved" });
  });
  it("no such check, or not waiting: nothing", () => {
    expect(youCheckOf(goal(you, { status: "new", stepId: "step_c1" }))).toBe(
      null,
    );
    expect(
      youCheckOf(
        goal(
          { id: "step_c1", kind: "check", name: "Lint" },
          { status: "ready", stepId: "step_c1" },
        ),
      ),
    ).toBe(null);
    expect(youCheckOf(null)).toBe(null);
  });
  it("the card's words", () => {
    expect(youCheckTitle("Planner")).toBe(
      "Your check: is Planner's work right?",
    );
    expect(youCheckLine("Planner", "Plan approved")).toBe(
      'Planner\'s check "Plan approved"',
    );
    expect(youCheckLine("Planner", null)).toBe("");
  });
});

describe("botPassesOf", () => {
  const reviewer = {
    id: "step_c1",
    kind: "bot",
    name: "Plan approved",
    botId: "rv",
  };
  const passed = {
    stepId: "step_c1",
    status: "passed",
    botName: "Reviewer",
    summary: "3 steps, acceptance covered.",
    at: 4,
  };
  it("a reviewer's pass on the latest try", () => {
    const g = goal(reviewer, {
      status: "done",
      stepId: "step_c1",
      history: [
        work,
        { stepId: "step_handoff", status: "passed", at: 3 },
        passed,
      ],
    });
    expect(botPassesOf(g)).toEqual([
      {
        name: "Plan approved",
        reviewer: "Reviewer",
        said: "3 steps, acceptance covered.",
      },
    ]);
    expect(botPassText(botPassesOf(g)[0], "Planner")).toBe(
      "Plan approved: Reviewer passed Planner's check",
    );
  });
  it("only rule checks passed, or a later try: no line", () => {
    expect(
      botPassesOf(
        goal(reviewer, {
          status: "done",
          history: [work, { stepId: "step_handoff", status: "passed", at: 3 }],
        }),
      ),
    ).toEqual([]);
    expect(
      botPassesOf(
        goal(reviewer, {
          status: "running",
          history: [work, passed, { ...work, at: 5 }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("canAlwaysAllow", () => {
  it("a provider's tool or a web page fetch, not the Dash team's build tools", () => {
    expect(
      canAlwaysAllow({ botId: "b", toolName: "send", serverName: "Slack" }),
    ).toBe(true);
    expect(
      canAlwaysAllow({
        botId: "b",
        toolName: "WebFetch",
        input: { url: "https://example.com/a" },
      }),
    ).toBe(true);
    expect(canAlwaysAllow({ botId: "b", toolName: "Bash" })).toBe(false);
    expect(
      canAlwaysAllow({
        botId: "b",
        toolName: "build_widget",
        serverName: "dash-team-build",
      }),
    ).toBe(false);
  });
});

describe("jobsNeedingYou / looseApprovals", () => {
  const step = (id, status, botId) => ({ id, status, botId });
  const jobs = [
    {
      id: "j2",
      leadId: "l1",
      status: "needs-you",
      createdAt: "2026-11-27T09:00:00Z",
      steps: [step("s1", "done", "tb"), step("s2", "needs-you", "pl")],
    },
    {
      id: "j1",
      leadId: "l2",
      status: "needs-you",
      createdAt: "2026-11-27T08:00:00Z",
      steps: [step("s3", "needs-you", "co")],
    },
    { id: "j3", status: "running", steps: [step("s4", "running", "co")] },
  ];
  it("waiting jobs, oldest first, with the step that waits", () => {
    expect(jobsNeedingYou(jobs).map((w) => [w.job.id, w.step.id])).toEqual([
      ["j1", "s3"],
      ["j2", "s2"],
    ]);
    expect(jobsNeedingYou(jobs, { leadId: "l1" }).map((w) => w.job.id)).toEqual(
      ["j2"],
    );
  });
  it("the team's approvals no shown step holds", () => {
    const approvals = [
      { id: "a1", request: { botId: "pl" } },
      { id: "a2", request: { botId: "pr" } },
      { id: "a3", request: { botId: "other" } },
    ];
    expect(
      looseApprovals(approvals, ["pl", "pr"], ["pl"]).map((a) => a.id),
    ).toEqual(["a2"]);
  });
});
