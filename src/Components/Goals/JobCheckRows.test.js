import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { GoalsView } from "./GoalsView";
import { JobCheckRows, checkRows } from "./JobCheckRows";
import { jobTimeline, checkOutputOf } from "./jobTimeline";
import { mockGoalsApi } from "../../__mocks__/mockGoalsApi";

// DASH-56 (Code Factory G5): a Coder whose check fails once and then passes
// shows, in its job: the check failed (with its output), try 2, the check
// passed, handed on.

const T = Date.now() - 10 * 60 * 1000;
const flow = {
  kind: "bot-checks",
  botId: "coder",
  onFail: "retry",
  handsOn: "answer",
  maxRounds: 3,
  steps: [
    { id: "step_work", kind: "bot", name: "Coder", botId: "coder" },
    {
      id: "step_c1",
      kind: "check",
      name: "Tests pass",
      check: { kind: "command" },
    },
  ],
};
const history = [
  {
    stepId: "step_work",
    status: "passed",
    said: "bot",
    botName: "Coder",
    round: 1,
    at: T + 60000,
    output: { answer: "Opened the branch." },
  },
  {
    stepId: "step_c1",
    status: "failed",
    by: "dash",
    said: "dash",
    round: 1,
    at: T + 61000,
    summary: "The command failed (exit code 1).",
    evidence: [
      { label: "exit code", value: "1" },
      { label: "output", value: "FAIL src/thing.test.js\n  expected 2, got 3" },
    ],
  },
  {
    stepId: "step_work",
    status: "passed",
    said: "bot",
    botName: "Coder",
    round: 2,
    at: T + 120000,
    output: { answer: "Fixed the test. PR #12." },
  },
  {
    stepId: "step_c1",
    status: "passed",
    by: "dash",
    said: "dash",
    round: 2,
    at: T + 121000,
    summary: "The command passed.",
    evidence: [
      { label: "exit code", value: "0" },
      { label: "output", value: "PASS src/thing.test.js" },
    ],
  },
];
const coderJob = {
  id: "goal_coder",
  workspaceId: "7",
  title: "Coder: DASH-1",
  body: "Do DASH-1.",
  status: "done",
  createdAt: T,
  updatedAt: T + 121000,
  source: { kind: "lead", ref: "lead1" },
  createdBy: { botId: "coder", botName: "Coder" },
  flow,
  tasks: [
    {
      id: "task_coder",
      goalId: "goal_coder",
      title: "Coder: DASH-1",
      status: "done",
      stepId: "step_c1",
      round: 2,
      maxRounds: 3,
      history,
    },
  ],
};

afterEach(() => {
  delete window.mainApi;
});

describe("the job timeline's rows (jobTimeline)", () => {
  it("a check's output and exit code come from its record", () => {
    expect(checkOutputOf(history[1])).toEqual({
      output: "FAIL src/thing.test.js\n  expected 2, got 3",
      exitCode: "1",
    });
    expect(checkOutputOf({})).toEqual({ output: null, exitCode: null });
  });

  it("failed with output, try 2 of 3, passed, done", () => {
    const rows = jobTimeline(coderJob);
    expect(rows.map((r) => r.type)).toEqual([
      "asked",
      "try",
      "failed",
      "try",
      "passed",
      "now",
    ]);
    expect(rows[1]).toMatchObject({ n: 1, of: 3 });
    expect(rows[2]).toMatchObject({
      name: "Tests pass",
      reason: "The command failed (exit code 1).",
      then: "back",
      exitCode: "1",
      output: "FAIL src/thing.test.js\n  expected 2, got 3",
    });
    expect(rows[3]).toMatchObject({ n: 2, of: 3 });
    expect(rows[4].names).toEqual([
      { name: "Tests pass", output: "PASS src/thing.test.js" },
    ]);
    expect(rows[5]).toMatchObject({ state: "done" });
  });

  it("checkRows leaves out who asked and where it is now", () => {
    expect(checkRows(coderJob).map((r) => r.type)).toEqual([
      "try",
      "failed",
      "try",
      "passed",
    ]);
  });
});

describe("JobCheckRows (a step of a job)", () => {
  it("shows each try, the failed check with its output, and the pass", () => {
    render(<JobCheckRows goal={coderJob} />);
    const tries = screen.getAllByTestId("check-try");
    expect(tries[0]).toHaveTextContent("Try 1 of 3");
    expect(tries[1]).toHaveTextContent("Try 2 of 3: it tried again");
    const failed = screen.getByTestId("check-failed");
    expect(failed).toHaveTextContent(
      "Tests pass failedThe command failed (exit code 1).",
    );
    expect(failed).toHaveTextContent("exit code 1");
    expect(within(failed).queryByTestId("check-output-text")).toBeNull();
    fireEvent.click(
      within(failed).getByRole("button", { name: "Show output" }),
    );
    expect(within(failed).getByTestId("check-output-text")).toHaveTextContent(
      "expected 2, got 3",
    );
    expect(screen.getByTestId("check-passed")).toHaveTextContent(
      "Tests pass passed",
    );
  });

  it("reads the checks job by its id", async () => {
    mockGoalsApi([coderJob]);
    render(<JobCheckRows goalId="goal_coder" />);
    expect(await screen.findByTestId("check-failed")).toBeInTheDocument();
    expect(window.mainApi.goals.get).toHaveBeenCalledWith("goal_coder");
  });

  it("shows nothing for a job with no checks run", () => {
    const { container } = render(
      <JobCheckRows goal={{ ...coderJob, tasks: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the bot's job (BotJobDetail)", () => {
  it("numbers its tries and shows the failed check's output", async () => {
    mockGoalsApi([coderJob]);
    render(
      <GoalsView
        workspace={{ id: 7 }}
        openGoal={{ goalId: "goal_coder", seq: 1 }}
      />,
    );
    await screen.findByTestId("job-timeline");
    const tries = screen.getAllByTestId("job-try");
    expect(tries[1]).toHaveTextContent("Coder finished, try 2 of 3");
    const failed = screen.getByTestId("job-failed");
    fireEvent.click(
      within(failed).getByRole("button", { name: "Show output" }),
    );
    expect(within(failed).getByTestId("check-output-text")).toHaveTextContent(
      "FAIL src/thing.test.js",
    );
    expect(screen.getByTestId("job-now")).toHaveTextContent(
      "Passed and handed on",
    );
  });
});

describe("See checks in the dashboard's Jobs tab", () => {
  const leadJob = {
    id: "job_1",
    workspaceId: "7",
    title: "Do DASH-1",
    status: "done",
    leadId: "lead1",
    createdAt: new Date(T).toISOString(),
    updatedAt: new Date(T + 121000).toISOString(),
    steps: [
      {
        id: "s1",
        botId: "coder",
        botName: "Coder",
        status: "done",
        goalId: "goal_coder",
        why: { kind: "asked" },
      },
    ],
  };

  it("opens the step's checks in place of the job shown", async () => {
    mockGoalsApi([coderJob]);
    window.mainApi.bots = {
      listJobs: jest.fn(async () => [leadJob]),
      getJob: jest.fn(async () => leadJob),
    };
    const { rerender } = render(<GoalsView workspace={{ id: 7 }} />);
    fireEvent.click(await screen.findByText("Do DASH-1"));
    expect(await screen.findByTestId("job-detail-pane")).toBeInTheDocument();
    // The step lists its checks under it.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("job-detail-pane")).getByTestId(
          "job-step-checks",
        ),
      ).toBeInTheDocument(),
    );
    // See checks: the stage hands GoalsView the goal (dash:open-job).
    rerender(
      <GoalsView
        workspace={{ id: 7 }}
        openGoal={{ goalId: "goal_coder", seq: 1 }}
      />,
    );
    expect(await screen.findByTestId("job-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("job-detail-pane")).toBeNull();
  });
});
