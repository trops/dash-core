/**
 * The failed job's header on the Jobs page (DASH-122): where and why, the
 * button that fixes it, and the checks' tries inline on the step.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { JobsPage } from "./JobsPage";

const T = "2026-11-27T14:12:00.000Z";

const base = (steps, extra = {}) => ({
  id: "job_f",
  workspaceId: "1",
  leadId: "lead",
  leadName: "Lead",
  title: "Format dates in the footer",
  request: "Format dates in the footer",
  startedBy: { kind: "you" },
  status: "failed",
  createdAt: T,
  updatedAt: T,
  steps,
  ...extra,
});

const GOAL = {
  id: "goal_1",
  flow: {
    kind: "bot-checks",
    maxRounds: 2,
    steps: [
      { id: "step_work", kind: "bot", name: "Coder" },
      { id: "c1", kind: "check", name: "validate" },
    ],
  },
  tasks: [
    {
      status: "closed",
      stepId: "step_work",
      maxRounds: 2,
      history: [
        { stepId: "step_work", status: "built", at: T },
        {
          stepId: "c1",
          status: "failed",
          summary: "3 tests fail",
          to: "step_work",
          at: T,
        },
        { stepId: "step_work", status: "built", at: T },
        {
          stepId: "c1",
          status: "failed",
          summary: "2 tests fail",
          to: "needs-you",
          evidence: [{ label: "output", value: "FAIL formatDate" }],
          at: T,
        },
        { by: "you", status: "close", dash: true, at: T },
      ],
    },
  ],
  closed: true,
};

function withApi(job, { rerun = true, goal = null } = {}) {
  const calls = { rerun: [], run: [], setup: [] };
  window.mainApi = {
    bots: {
      listJobs: jest.fn(async () => [job]),
      getJob: jest.fn(async () => job),
      askLead: jest.fn(async () => ({})),
      run: jest.fn(async (...a) => calls.run.push(a)),
      checkSetup: jest.fn(async (ws) => {
        calls.setup.push(ws);
        return {
          ok: false,
          problems: [
            { message: "Coder runs on Claude Code, which isn't logged in" },
          ],
        };
      }),
      ...(rerun === true
        ? {
            rerunStep: jest.fn(async (...a) => {
              calls.rerun.push(a);
              return { ok: true };
            }),
          }
        : rerun === "no-handler"
          ? {
              rerunStep: jest.fn(async () => {
                throw new Error(
                  "Error invoking remote method 'bots-rerun-step': Error: No handler registered for 'bots-rerun-step'",
                );
              }),
            }
          : {}),
      onJobsChanged: jest.fn(() => "1"),
      removeListener: jest.fn(),
    },
    goals: { get: jest.fn(async () => goal) },
  };
  return calls;
}
afterEach(() => {
  delete window.mainApi;
});

const coderStep = {
  id: "s2",
  botId: "coder",
  botName: "Coder",
  status: "failed",
  goalId: "goal_1",
  why: { kind: "handon", by: "Planner" },
  summary: "Changed formatDate in src/footer.js.",
  failed: 'Didn\'t pass "validate" on try 2: 2 tests fail',
};

describe("FailureHeader on the Jobs page", () => {
  it("failed checks: where, why, the tries inline, Run the job again", async () => {
    const calls = withApi(base([coderStep]), { goal: GOAL });
    render(<JobsPage workspaces={[{ id: "1", name: "Factory" }]} />);
    const header = await screen.findByTestId("job-failure");
    await waitFor(() =>
      expect(within(header).getByTestId("job-failure-title")).toHaveTextContent(
        "Failed at Coder: its check “validate” still fails after 2 tries",
      ),
    );
    expect(within(header).getByText("2 tests fail")).toBeInTheDocument();
    // The checks' tries and reasons are on the step, no "See checks" needed.
    const step = screen.getByTestId("job-step");
    expect(
      within(step).getByText("Coder was told what failed and tried again."),
    ).toBeInTheDocument();
    expect(
      within(step).getByText("No tries left, so the job failed."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(header).getByRole("button", { name: "Run the job again" }),
    );
    // An older preload's rerunStep: the same IPC, the whole job (DASH-165).
    await waitFor(() => expect(calls.rerun).toEqual([["job_f", "s2", ""]]));
    expect(
      await screen.findByText(
        "The job is running again from Coder, in this job.",
      ),
    ).toBeInTheDocument();
    // The Jobs page's own Run again (a new job) isn't offered beside it.
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();
  });

  it("rerunJob when the preload has it, naming the first bot", async () => {
    const job = base([coderStep]);
    withApi(job, { goal: GOAL, rerun: false });
    const calls = [];
    window.mainApi.bots.rerunJob = jest.fn(async (...a) => {
      calls.push(a);
      return { ok: true, try: 2, firstBot: "Ticket Bot" };
    });
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    fireEvent.click(
      within(header).getByRole("button", { name: "Run the job again" }),
    );
    await waitFor(() => expect(calls).toEqual([["job_f", ""]]));
    expect(
      await screen.findByText(
        "The job is running again from Ticket Bot, in this job.",
      ),
    ).toBeInTheDocument();
  });

  it("Run again with a note runs the job again with it", async () => {
    const calls = withApi(base([coderStep]), { goal: GOAL });
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    fireEvent.click(
      within(header).getByRole("button", {
        name: "Run again with a note",
      }),
    );
    fireEvent.change(within(header).getByRole("textbox"), {
      target: { value: "Mind the null date" },
    });
    fireEvent.click(
      within(header).getByRole("button", { name: "Run the job again" }),
    );
    await waitFor(() =>
      expect(calls.rerun).toEqual([["job_f", "s2", "Mind the null date"]]),
    );
  });

  it("an app without the rerun handler starts the first bot as a new job", async () => {
    const calls = withApi(base([coderStep], { leadId: null }), {
      rerun: "no-handler",
    });
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    fireEvent.click(
      within(header).getByRole("button", { name: "Run the job again" }),
    );
    await waitFor(() => expect(calls.run).toHaveLength(1));
    expect(calls.run[0][0]).toBe("coder");
    expect(calls.run[0][1]).toMatch(
      /The last try failed: its check “validate” still fails after 2 tries/,
    );
    expect(await screen.findByText(/shows as a new job/)).toBeInTheDocument();
  });

  it("a missing setting opens that bot's Settings tab", async () => {
    withApi(
      base([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          summary: "The team's setup has 1 problem, so the job didn't start.",
          problems: [
            {
              kind: "setting",
              bot: "Workspace Bot",
              botId: "wb",
              message:
                "Workspace Bot uses Work folder ({workFolder}), which has no value",
            },
          ],
        },
      ]),
    );
    const opened = [];
    const onOpen = (e) => opened.push(e.detail);
    window.addEventListener("dash:open-bot", onOpen);
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    expect(within(header).getByTestId("job-failure-title")).toHaveTextContent(
      "Failed at Workspace Bot: its Work folder has no value",
    );
    // Its fix is the setup; Run the job again is there for after (its
    // setup is checked again first), but not as the main button.
    expect(
      within(header).getByRole("button", { name: "Run the job again" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(header).getByRole("button", {
        name: "Open Workspace Bot's settings",
      }),
    );
    window.removeEventListener("dash:open-bot", onOpen);
    expect(opened).toEqual([{ botId: "wb", tab: "settings" }]);
  });

  it("an expired login: Check setup lists the team's problems", async () => {
    const calls = withApi(
      base([
        {
          id: "s1",
          botId: "tb",
          botName: "Setup check",
          status: "failed",
          problems: [
            {
              kind: "ai-login",
              bot: "Ticket Bot",
              message:
                "Ticket Bot runs on Claude Code, which isn't logged in: run `claude auth login`",
            },
          ],
        },
      ]),
    );
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    fireEvent.click(
      within(header).getByRole("button", { name: "Check setup" }),
    );
    await waitFor(() => expect(calls.setup).toEqual(["1"]));
    expect(
      await within(header).findByText("1 problem to fix:"),
    ).toBeInTheDocument();
  });

  it("over budget: Stopped at the bot, and Raise budget opens its Spending", async () => {
    withApi(
      base(
        [
          {
            id: "s1",
            botId: "rev",
            botName: "Reviewer",
            status: "needs-you",
            waiting: "budget",
            summary: "Reviewer is over its budget, so it hasn't started.",
          },
        ],
        { status: "needs-you" },
      ),
    );
    const opened = [];
    const onOpen = (e) => opened.push(e.detail);
    window.addEventListener("dash:open-bot", onOpen);
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    expect(header).toHaveTextContent(
      "Stopped at Reviewer: it's over its monthly budget",
    );
    // It takes the generic "Needs you" header's place.
    expect(screen.queryByTestId("job-needs-you")).toBeNull();
    fireEvent.click(
      within(header).getByRole("button", { name: "Raise budget" }),
    );
    window.removeEventListener("dash:open-bot", onOpen);
    expect(opened).toEqual([{ botId: "rev", tab: "spending" }]);
  });

  it("a refusal keeps its Blocked card on the step, and names the section", async () => {
    withApi(
      base([
        {
          id: "s1",
          botId: "coder",
          botName: "Coder",
          status: "failed",
          summary: "Coder can't run `git push`.",
          refusal: {
            kind: "command",
            what: "git push",
            why: "it isn't in the bot's allowed commands",
            fix: "Add it on the bot's Commands.",
            section: "commands",
          },
        },
      ]),
    );
    render(<JobsPage workspaces={[]} />);
    const header = await screen.findByTestId("job-failure");
    expect(header).toHaveTextContent(
      "Failed at Coder: it can't run `git push`: it isn't in the bot's allowed commands",
    );
    expect(
      within(header).getByRole("button", { name: "Open Coder's Commands" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("job-blocked")).toBeInTheDocument();
  });

  it("leads with the first failure; an On Failure bot that failed too is a line (John's self-test)", async () => {
    const reporter = {
      id: "s3",
      botId: "reporter",
      botName: "Reporter",
      status: "failed",
      why: { kind: "handon", by: "Coder", label: "Failed" },
      goalId: "goal_r",
      summary: "Posted the failure.",
      failed:
        'Didn\'t pass "The ticket got its comment" on try 2: No comment on the ticket',
    };
    const coder = {
      id: "s2",
      botId: "coder",
      botName: "Coder",
      status: "failed",
      summary: "Coder can't run `cd repo && npm test`…",
      refusal: {
        kind: "command",
        what: "cd repo && npm test",
        why: "a strict bot runs one command per call (no &&, ;, || or |)",
        fix: "Change the bot's instructions so it runs each step as its own command.",
        section: "instructions",
      },
    };
    withApi(base([coder, reporter]));
    render(<JobsPage workspaceId="1" />);
    const header = await screen.findByTestId("job-failure");
    await waitFor(() =>
      expect(within(header).getByTestId("job-failure-title")).toHaveTextContent(
        "Failed at Coder: it can't run `cd repo && npm test`",
      ),
    );
    expect(within(header).getByTestId("job-failure-then")).toHaveTextContent(
      "Then Reporter failed too: its check “The ticket got its comment” still fails after 2 tries",
    );
    expect(
      within(header).getByRole("button", { name: "Open Coder's Instructions" }),
    ).toBeInTheDocument();
    expect(header).not.toHaveTextContent(/Failed at Reporter/);
  });
});
