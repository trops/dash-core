import {
  approvalRows,
  approvalView,
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

// Triage's answer as the bot wrote it: narration, the plan, its json last.
const TRIAGE = [
  "Confirmed. The label is already present. Let me check for existing tests, then comment.",
  "- **Cause**: buildLink drops the title",
  "```json",
  JSON.stringify({
    status: "ok",
    summary: "SANDBOX-58 → sandbox-web: add the title",
    repo: "sandbox-web",
    acceptance: ["Preview shows the title", "No title: the site name"],
    plan: {
      cause: 'buildLink ignores "title"',
      fix: "Add og:title",
      test: "buildLink.test.js",
    },
  }),
  "```",
].join("\n\n");

describe("approvalRows", () => {
  it("labels a plan's fields, opens plan {}, known keys first", () => {
    const rows = approvalRows({
      status: "ok",
      summary: "left out",
      item: { id: "X-1" },
      risk: "Low",
      acceptance: ["A", "B"],
      plan: { cause: "C", fix: "F", test: "T" },
      repo: "web",
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Repo",
      "Cause",
      "Fix",
      "Test",
      "Done when",
      "Risk",
    ]);
    expect(rows.find((r) => r.key === "acceptance").list).toEqual(["A", "B"]);
    expect(rows[0].text).toBe("web");
  });

  it("an object that names a thing is one row, with its why", () => {
    const rows = approvalRows({
      repo: { name: "web", why: "the share code is there", url: "u" },
      files: [{ path: "a.js" }, "b.js", { nothing: 1 }],
      steps: ["one", "two"],
      next_step: "Coder",
      empty: "  ",
      nested: [[1]],
    });
    expect(rows).toEqual([
      {
        key: "repo",
        label: "Repo",
        text: "web",
        note: "the share code is there",
      },
      { key: "steps", label: "Steps", list: ["one", "two"] },
      { key: "files", label: "Files", list: ["a.js", "b.js"] },
      { key: "next_step", label: "Next step", text: "Coder" },
    ]);
  });

  it("two keys with one label keep the first; none for no handoff", () => {
    expect(
      approvalRows({ acceptance: ["a"], acceptance_criteria: ["b"] }),
    ).toEqual([{ key: "acceptance", label: "Done when", list: ["a"] }]);
    expect(approvalRows(null)).toEqual([]);
    expect(approvalRows({ status: "ok", summary: "s" })).toEqual([]);
  });
});

describe("approvalView", () => {
  it("reads the json block out of the answer, never as prose", () => {
    const v = approvalView(TRIAGE);
    expect(v.prose).not.toMatch(/```|"status"/);
    expect(v.prose).toMatch(/Cause/);
    expect(v.handoff.repo).toBe("sandbox-web");
    expect(v.rows.map((r) => r.label)).toEqual([
      "Repo",
      "Cause",
      "Fix",
      "Test",
      "Done when",
    ]);
    expect(v.rows[1].text).toBe('buildLink ignores "title"');
    expect(v.cut).toBe(false);
  });

  it("a cut-off block falls back to the step's saved handoff", () => {
    const v = approvalView('Plan.\n\n```json\n{"status": "ok", "re', {
      repo: "web",
    });
    expect(v.prose).toBe("Plan.");
    expect(v.rows).toEqual([{ key: "repo", label: "Repo", text: "web" }]);
    expect(v.cut).toBe(false);
    expect(approvalView('Plan.\n\n```json\n{"a').cut).toBe(true);
  });

  it("plain prose has no rows", () => {
    expect(approvalView("Opened the plan.")).toEqual({
      prose: "Opened the plan.",
      handoff: null,
      rows: [],
      cut: false,
    });
  });
});
