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
import { mockGoalsApi } from "../../__mocks__/mockGoalsApi";

// A bot's job in Jobs, read top to bottom (bot-checks PRD CHK-003, frame 4).

const T = Date.now() - 10 * 60 * 1000;
const flow = {
  kind: "bot-checks",
  botId: "coord",
  onFail: "retry",
  handsOn: "answer",
  maxRounds: 3,
  steps: [
    { id: "step_work", kind: "bot", name: "Coordinator", botId: "coord" },
    { id: "step_c1", kind: "check", name: "Every event is in it" },
    { id: "step_c2", kind: "you", name: "You approve" },
  ],
};
const job = {
  id: "goal_job",
  workspaceId: "7",
  title: "Coordinator: tomorrow's brief",
  body: "Put together tomorrow's brief.",
  status: "ready",
  createdAt: T,
  updatedAt: T + 120000,
  source: { kind: "lead", ref: "lead1" },
  createdBy: { botId: "coord", botName: "Coordinator" },
  flow,
  tasks: [
    {
      id: "task_job",
      goalId: "goal_job",
      title: "Coordinator: tomorrow's brief",
      status: "ready",
      stepId: "step_c2",
      round: 2,
      maxRounds: 3,
      history: [
        {
          stepId: "step_work",
          status: "passed",
          said: "bot",
          botName: "Coordinator",
          round: 1,
          at: T + 60000,
          output: { answer: "Tomorrow: school 8:15." },
        },
        {
          stepId: "step_c1",
          status: "failed",
          by: "dash",
          said: "dash",
          round: 1,
          at: T + 61000,
          summary: 'Missing "Dentist 3:30".',
        },
        {
          stepId: "step_work",
          status: "passed",
          said: "bot",
          botName: "Coordinator",
          round: 2,
          at: T + 110000,
          output: { answer: "Tomorrow: school 8:15. Dentist 3:30." },
        },
        {
          stepId: "step_c1",
          status: "passed",
          by: "dash",
          said: "dash",
          round: 2,
          at: T + 111000,
        },
      ],
    },
  ],
};

let mock;
beforeEach(() => {
  mock = mockGoalsApi([job]);
});
afterEach(() => {
  delete window.mainApi;
});

async function openJob() {
  render(<GoalsView workspace={{ id: 7 }} />);
  const row = await screen.findByTestId("goal-row");
  expect(row).toHaveTextContent(
    "Coordinator · the lead asked · waiting for you",
  );
  expect(row).toHaveTextContent("Try 2 of 3");
  fireEvent.click(row);
  return screen.findByTestId("job-timeline");
}

test("reads top to bottom: asked, tries, the failed check, the passed one, waiting", async () => {
  await openJob();
  expect(screen.getByTestId("job-asked")).toHaveTextContent(
    "The lead asked Coordinator",
  );
  expect(screen.getByTestId("job-asked")).toHaveTextContent(
    '"Put together tomorrow\'s brief."',
  );
  const tries = screen.getAllByTestId("job-try");
  expect(tries).toHaveLength(2);
  expect(tries[0]).toHaveTextContent("Coordinator finished, try 1");
  expect(screen.getByTestId("job-failed")).toHaveTextContent(
    'Every event is in it failedMissing "Dentist 3:30".Sent back to Coordinator with that.',
  );
  expect(screen.getByTestId("job-passed")).toHaveTextContent(
    "Every event is in it passed",
  );
  expect(screen.getByTestId("job-next")).toHaveTextContent(
    "Next: the lead tells you.",
  );
});

test("the waiting row shows the work being approved, and Approve hands it on", async () => {
  await openJob();
  expect(screen.getByTestId("job-work")).toHaveTextContent(
    "Tomorrow: school 8:15. Dentist 3:30.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(mock.api.taskAction).toHaveBeenCalledWith("task_job", "done"),
  );
});

test("Send back asks why, and sends the reason", async () => {
  await openJob();
  fireEvent.click(screen.getByRole("button", { name: "Send back…" }));
  const send = screen.getByRole("button", { name: "Send back" });
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Why\? Coordinator gets this/), {
    target: { value: "Add the weather" },
  });
  fireEvent.click(send);
  await waitFor(() =>
    expect(mock.api.taskAction).toHaveBeenCalledWith("task_job", {
      type: "send-back",
      reason: "Add the weather",
    }),
  );
});

test("View its work opens a try's answer", async () => {
  await openJob();
  const first = screen.getAllByTestId("job-try")[0];
  fireEvent.click(within(first).getByRole("button", { name: "View its work" }));
  expect(within(first).getByTestId("job-try-work")).toHaveTextContent(
    "Tomorrow: school 8:15.",
  );
});

test("See its checks opens the bot's checks on the Bots tab", async () => {
  await openJob();
  const seen = jest.fn();
  window.addEventListener("dash:open-bots-view", seen);
  fireEvent.click(
    screen.getByRole("button", { name: "See Coordinator's checks" }),
  );
  window.removeEventListener("dash:open-bots-view", seen);
  expect(seen.mock.calls[0][0].detail).toEqual({
    workspaceId: "7",
    botId: "coord",
    tab: "checks",
  });
});

test("a job opened from elsewhere is selected", async () => {
  render(
    <GoalsView
      workspace={{ id: 7 }}
      openGoal={{ goalId: "goal_job", seq: 1 }}
    />,
  );
  expect(await screen.findByTestId("job-timeline")).toBeInTheDocument();
});

describe("sent back to a paused bot (DASH-12)", () => {
  // After the failed check: the work went back to the bot, try 2 not
  // started.
  const history = job.tasks[0].history.slice(0, 2);
  const sentBack = {
    ...job,
    status: "working",
    tasks: [{ ...job.tasks[0], status: "new", stepId: "step_work", history }],
  };
  const withBots = (pause) => {
    mock = mockGoalsApi([sentBack]);
    const bots = {
      list: jest.fn(() => Promise.resolve([])),
      getPauseState: jest.fn(() => Promise.resolve(pause)),
      resumeBot: jest.fn(() => Promise.resolve({ success: true })),
      resumeAll: jest.fn(() => Promise.resolve({ success: true })),
    };
    window.mainApi.bots = bots;
    return bots;
  };
  const open = async () => {
    render(<GoalsView workspace={{ id: 7 }} />);
    fireEvent.click(await screen.findByTestId("goal-row"));
    return screen.findByTestId("job-timeline");
  };

  test("the bot paused on its own: it still finishes, so it's trying again (try 2 of 3)", async () => {
    withBots({ global: false, bots: ["coord"] });
    const timeline = await open();
    expect(timeline).toHaveTextContent("Coordinator's checks · try 2 of 3");
    expect(
      await screen.findByText("Coordinator is trying again (try 2)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Waiting:/)).toBeNull();
  });

  test("all bots paused: it waits, and Resume all bots resumes them", async () => {
    const bots = withBots({ global: true, bots: [] });
    const seen = jest.fn();
    window.addEventListener("dash:bots-pause-changed", seen);
    await open();
    await screen.findByText(
      "Waiting: all bots are paused, so try 2 hasn't started",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume all bots" }));
    await waitFor(() => expect(bots.resumeAll).toHaveBeenCalled());
    await waitFor(() => expect(seen).toHaveBeenCalled());
    window.removeEventListener("dash:bots-pause-changed", seen);
  });

  test("not paused: it's trying again", async () => {
    withBots({ global: false, bots: [] });
    await open();
    expect(
      await screen.findByText("Coordinator is trying again (try 2)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Waiting:/)).toBeNull();
  });
});

test("a bot that asked a question in its handoff gets your answer (DASH-101)", async () => {
  const asking = {
    ...job,
    id: "goal_ask",
    status: "needs-you",
    flow: {
      ...flow,
      steps: [
        flow.steps[0],
        { id: "step_handoff", kind: "check", name: "Handoff" },
      ],
    },
    tasks: [
      {
        ...job.tasks[0],
        id: "task_ask",
        goalId: "goal_ask",
        status: "needs-you",
        stepId: "step_handoff",
        round: 1,
        history: [
          job.tasks[0].history[0],
          {
            stepId: "step_handoff",
            status: "needs-you",
            by: "dash",
            said: "dash",
            round: 1,
            at: T + 61000,
            summary: "It asks: Which repo is this for?",
            ask: "Which repo is this for?",
          },
        ],
      },
    ],
  };
  delete window.mainApi;
  mock = mockGoalsApi([asking]);
  render(<GoalsView workspace={{ id: 7 }} />);
  const row = await screen.findByTestId("goal-row");
  expect(row).toHaveTextContent("asks you a question");
  fireEvent.click(row);
  const box = await screen.findByTestId("job-asking");
  expect(within(box).getByTestId("job-question")).toHaveTextContent(
    "Which repo is this for?",
  );
  const send = within(box).getByRole("button", { name: "Send answer" });
  expect(send).toBeDisabled();
  fireEvent.change(within(box).getByRole("textbox"), {
    target: { value: "code-factory-sandbox" },
  });
  fireEvent.click(send);
  await waitFor(() =>
    expect(mock.api.taskAction).toHaveBeenCalledWith("task_ask", {
      type: "answer",
      reason: "code-factory-sandbox",
    }),
  );
});
