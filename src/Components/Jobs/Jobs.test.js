/**
 * Jobs (DASH-31): the words for a job, the Jobs page across every
 * dashboard, and the strip under a lead's answer.
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
import { useJobs } from "../../hooks/useJobs";
import { JobStrip, jobForConversation, stepsLine } from "./JobStrip";
import {
  JOB_STATUS,
  aheadText,
  filterJobs,
  groupByDashboard,
  jobCounts,
  jobTitleText,
  workspaceText,
  ordinalText,
  queueText,
  startedByText,
  whyText,
} from "./jobText";

const T = "2026-11-21T11:38:00.000Z";
const JOBS = [
  {
    id: "job_a",
    workspaceId: "1",
    leadId: "lead1",
    leadName: "Woodworking Lead",
    title: "Walnut U desk, 60 inches wide",
    startedBy: { kind: "task", label: "slack" },
    conversationId: "conv_1",
    status: "running",
    createdAt: T,
    updatedAt: T,
    steps: [
      {
        id: "s1",
        botId: "lead1",
        botName: "Woodworking Lead",
        status: "done",
        why: { kind: "task", label: "slack" },
      },
      {
        id: "s2",
        botId: "des",
        botName: "Designer",
        status: "done",
        why: { kind: "asked", by: "Woodworking Lead" },
      },
      {
        id: "s3",
        botId: "dra",
        botName: "Drafter",
        status: "running",
        why: { kind: "handon", by: "Designer", label: "Completed" },
      },
    ],
  },
  {
    id: "job_b",
    workspaceId: "1",
    leadId: "lead1",
    leadName: "Woodworking Lead",
    title: "Spool shelf",
    startedBy: { kind: "you" },
    status: "needs-you",
    createdAt: T,
    updatedAt: T,
    steps: [
      {
        id: "s4",
        botId: "dra",
        botName: "Drafter",
        status: "needs-you",
        waiting: "paused",
        summary:
          "Drafter is paused, so it hasn't started. Turn it on and it starts.",
      },
    ],
  },
  {
    id: "job_c",
    request: "Write today's brief from my inbox.",
    workspaceId: "2",
    leadId: "lead2",
    leadName: "Brief Lead",
    title: "Daily brief",
    startedBy: { kind: "you" },
    status: "failed",
    createdAt: T,
    updatedAt: T,
    endedAt: T,
    steps: [
      { id: "s5", botId: "inbox", botName: "Inbox Reader", status: "failed" },
    ],
  },
];
const WORKSPACES = [
  { id: 1, name: "Woodworking Projects" },
  { id: 2, name: "Morning Brief" },
];

function withApi(jobs = JOBS) {
  const calls = { resume: [], stop: [], del: [] };
  window.mainApi = {
    bots: {
      listJobs: jest.fn(async () => jobs),
      getJob: jest.fn(async (id) => {
        const j = jobs.find((x) => x.id === id);
        return (
          j && {
            ...j,
            steps: j.steps.map((s) => ({
              ...s,
              summary: s.summary || `${s.botName} said something.`,
            })),
          }
        );
      }),
      stopJob: jest.fn(async (id) => calls.stop.push(id)),
      deleteJob: jest.fn(async (id) => {
        calls.del.push(id);
        return { ok: true };
      }),
      resumeBot: jest.fn(async (id) => calls.resume.push(id)),
      askLead: jest.fn(async (id, q) => {
        calls.asked = [id, q];
        return { status: "completed" };
      }),
      onJobsChanged: jest.fn(() => "1"),
      removeListener: jest.fn(),
    },
  };
  return calls;
}
afterEach(() => {
  delete window.mainApi;
});

describe("jobText", () => {
  it("says who started a job and why each step ran", () => {
    expect(startedByText(JOBS[0])).toBe("Task from slack");
    expect(startedByText(JOBS[1])).toBe("You, in Woodworking Lead");
    expect(whyText(JOBS[0].steps[1].why)).toBe("Asked by Woodworking Lead");
    // A chain that starts from one of the team's bots (DASH-70).
    expect(
      startedByText({
        leadId: null,
        leadName: "Ticket Bot",
        startedBy: { kind: "schedule", label: "Ticket Bot" },
      }),
    ).toBe("Ticket Bot on its schedule");
    expect(
      startedByText({
        leadId: null,
        startedBy: { kind: "you", label: "Ticket Bot" },
      }),
    ).toBe("You ran Ticket Bot");
    expect(whyText({ kind: "schedule" })).toBe("On its schedule");
    expect(whyText(JOBS[0].steps[2].why)).toBe("Handed on by Designer");
  });
  it("counts, filters and groups by dashboard", () => {
    expect(jobCounts(JOBS)).toMatchObject({
      running: 1,
      needsYou: 1,
      failed: 1,
    });
    expect(filterJobs(JOBS, "needs-you").map((j) => j.id)).toEqual(["job_b"]);
    expect(
      groupByDashboard(JOBS, WORKSPACES).map((g) => [g.name, g.jobs.length]),
    ).toEqual([
      ["Woodworking Projects", 2],
      ["Morning Brief", 1],
    ]);
  });
});

describe("a job's work item (DASH-100)", () => {
  const withItem = {
    ...JOBS[0],
    title: "Ask the Ticket Bot to take the next ticket",
    item: {
      id: "DASH-93",
      title: "Slugs drop accented letters",
      url: "https://example.atlassian.net/browse/DASH-93",
    },
    workspace: { dir: "/w/DashFactory/DASH-93", branch: "fix/DASH-93-x" },
  };

  it("names the job by its item, else what was asked", () => {
    expect(jobTitleText(withItem)).toBe(
      "DASH-93 · Slugs drop accented letters",
    );
    expect(jobTitleText({ ...withItem, item: { id: "DASH-93" } })).toBe(
      "DASH-93 · Ask the Ticket Bot to take the next ticket",
    );
    expect(jobTitleText(JOBS[0])).toBe(JOBS[0].title);
    expect(workspaceText(withItem)).toBe(
      "/w/DashFactory/DASH-93 on fix/DASH-93-x",
    );
    expect(workspaceText(JOBS[0])).toBe("");
  });

  it("the Jobs page shows it, with a link and the workspace", async () => {
    withApi([withItem, ...JOBS.slice(1)]);
    render(<JobsPage workspaces={WORKSPACES} />);
    const rows = await screen.findAllByTestId("job-row");
    expect(
      within(rows[0]).getByText("DASH-93 · Slugs drop accented letters"),
    ).toBeInTheDocument();
    const detail = await screen.findByTestId("job-detail");
    expect(within(detail).getByTestId("job-item-link")).toHaveTextContent(
      "Open DASH-93",
    );
    expect(within(detail).getByTestId("job-workspace")).toHaveTextContent(
      "Workspace: /w/DashFactory/DASH-93 on fix/DASH-93-x",
    );
  });
});

describe("JobsPage", () => {
  it("lists every dashboard's jobs with their chain; the first opens with each step", async () => {
    withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    const rows = await screen.findAllByTestId("job-row");
    expect(rows).toHaveLength(3);
    // A heading per dashboard (the Dashboard filter lists them too).
    const list = screen.getByTestId("jobs-page");
    for (const name of ["Woodworking Projects", "Morning Brief"]) {
      expect(
        within(list)
          .getAllByText(name)
          .some((el) => el.tagName === "SPAN"),
      ).toBe(true);
    }
    expect(within(rows[0]).getByText("Drafter")).toBeInTheDocument();
    const detail = await screen.findByTestId("job-detail");
    await waitFor(() =>
      expect(
        within(detail).getByText("Drafter said something."),
      ).toBeInTheDocument(),
    );
    expect(
      within(detail).getByText("Handed on by Designer"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Running · 1/ }),
    ).toBeInTheDocument();
  });

  it("a job waiting on a paused bot offers to turn it on; a running one can be stopped", async () => {
    const calls = withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    fireEvent.click(await screen.findByText("Spool shelf"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume Drafter" }),
    );
    expect(calls.resume).toEqual(["dra"]);
    fireEvent.click(screen.getByText("Walnut U desk, 60 inches wide"));
    fireEvent.click(await screen.findByRole("button", { name: "Stop job" }));
    expect(calls.stop).toEqual(["job_a"]);
  });

  it("a finished job is deleted only after you say yes", async () => {
    const calls = withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    fireEvent.click(await screen.findByText("Daily brief"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(calls.del).toEqual([]);
    expect(screen.getByText("Delete this job?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.del).toEqual(["job_c"]));
  });

  it("no jobs: says what makes one", async () => {
    withApi([]);
    render(<JobsPage workspaces={WORKSPACES} />);
    expect(await screen.findByText("No jobs yet")).toBeInTheDocument();
  });
});

describe("JobStrip", () => {
  it("finds the conversation's job and says each step", () => {
    expect(jobForConversation(JOBS, "conv_1").id).toBe("job_a");
    expect(jobForConversation(JOBS, "nope")).toBeNull();
    expect(stepsLine(JOBS[0])).toBe(
      "Woodworking Lead done · Designer done · Drafter running",
    );
  });

  it("shows under the lead's answer and opens the job on the Jobs page", async () => {
    withApi();
    const opened = [];
    const onPage = (e) => opened.push(e.detail);
    window.addEventListener("dash:open-page", onPage);
    render(<JobStrip conversationId="conv_1" workspaceId="1" />);
    const strip = await screen.findByTestId("job-strip");
    expect(within(strip).getByText("Running")).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole("button", { name: "See the job" }));
    expect(opened).toEqual([{ page: "jobs", jobId: "job_a" }]);
    window.removeEventListener("dash:open-page", onPage);
  });

  it("nothing when the conversation started no job", async () => {
    withApi();
    const { container } = render(
      <JobStrip conversationId="other" workspaceId="1" />,
    );
    await waitFor(() =>
      expect(window.mainApi.bots.listJobs).toHaveBeenCalled(),
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("useJobs", () => {
  it("refreshes for its own dashboard's changes only — the preload hands over the payload alone", async () => {
    withApi();
    let fire = null;
    window.mainApi.bots.onJobsChanged = jest.fn((cb) => {
      fire = cb;
      return "1";
    });
    const Probe = () => {
      const { jobs } = useJobs("1");
      return <span data-testid="n">{jobs.length}</span>;
    };
    render(<Probe />);
    await waitFor(() =>
      expect(window.mainApi.bots.listJobs).toHaveBeenCalledTimes(1),
    );
    fire({ jobId: "job_x", workspaceId: "2", status: "running" });
    await new Promise((r) => setTimeout(r, 10));
    expect(window.mainApi.bots.listJobs).toHaveBeenCalledTimes(1);
    fire({ jobId: "job_a", workspaceId: "1", status: "done" });
    await waitFor(() =>
      expect(window.mainApi.bots.listJobs).toHaveBeenCalledTimes(2),
    );
  });
});

describe("Search and Run again", () => {
  it("search finds jobs by what was asked or a bot in them", async () => {
    withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    await screen.findAllByTestId("job-row");
    fireEvent.change(screen.getByPlaceholderText("Search jobs…"), {
      target: { value: "inbox reader" },
    });
    const rows = await screen.findAllByTestId("job-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Daily brief")).toBeInTheDocument();
  });

  it("a failed job runs again: its lead is asked the same thing", async () => {
    const calls = withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    fireEvent.click(await screen.findByText("Daily brief"));
    // Its failure header offers its failed step; this runs the whole job.
    fireEvent.click(
      await screen.findByRole("button", { name: "Run the whole job again" }),
    );
    await waitFor(() =>
      expect(calls.asked).toEqual([
        "lead2",
        "Write today's brief from my inbox.",
      ]),
    );
    expect(screen.getByText(/starting on it again/)).toBeInTheDocument();
  });

  it("a running job can't be run again", async () => {
    withApi();
    render(<JobsPage workspaces={WORKSPACES} />);
    await screen.findByTestId("job-detail");
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();
  });
});

describe("Queued jobs (DASH-81)", () => {
  const QUEUED = {
    id: "job_q",
    workspaceId: "1",
    leadId: "lead1",
    leadName: "Woodworking Lead",
    title: "Cherry side table",
    startedBy: { kind: "task", label: "slack" },
    status: "queued",
    queue: {
      position: 2,
      waitingFor: {
        id: "job_a",
        title: "Walnut U desk, 60 inches wide",
        status: "needs-you",
      },
    },
    createdAt: T,
    updatedAt: T,
    steps: [],
  };

  it("says where a queued job is in line, and what's ahead of it", () => {
    expect(queueText(QUEUED)).toBe(
      "2nd in line · after “Walnut U desk, 60 inches wide”, which needs you",
    );
    expect(
      queueText({ ...QUEUED, queue: { position: 1, waitingFor: null } }),
    ).toBe("Next in line");
    expect(queueText(JOBS[0])).toBe("");
    expect(aheadText(QUEUED)).toBe("Queued · 2 ahead");
    expect(ordinalText(11)).toBe("11th");
    expect(ordinalText(23)).toBe("23rd");
    expect(JOB_STATUS.queued).toBe("Queued");
    expect(jobCounts([QUEUED, ...JOBS]).queued).toBe(1);
    expect(filterJobs([QUEUED, ...JOBS], "queued")).toEqual([QUEUED]);
  });

  it("the Jobs page shows it Queued with its place, and it can be taken out of the queue", async () => {
    const calls = withApi([QUEUED, ...JOBS]);
    render(<JobsPage workspaces={WORKSPACES} />);
    // First in the list, so it's the one open.
    const detail = await screen.findByTestId("job-detail");
    expect(within(detail).getByText("Cherry side table")).toBeInTheDocument();
    expect(
      within(detail).getByText(/Waiting its turn: 2nd in line/),
    ).toBeInTheDocument();
    const row = screen
      .getAllByTestId("job-row")
      .find((r) => within(r).queryByText("Cherry side table"));
    expect(within(row).getByTestId("job-queue")).toHaveTextContent(
      "2nd in line",
    );
    expect(screen.getByText(/Queued · 1/)).toBeInTheDocument();
    fireEvent.click(
      within(detail).getByRole("button", { name: "Take out of the queue" }),
    );
    expect(calls.stop).toEqual(["job_q"]);
    expect(
      within(detail).queryByRole("button", { name: "Stop job" }),
    ).toBeNull();
  });
});

describe("a team's self-test job (DASH-109)", () => {
  it("is marked in its title, and lists what it skipped", () => {
    const { jobTitleText, skippedLines } = require("./jobText");
    const job = {
      test: true,
      title: "Test: Ticket Bot on DASH-97",
      item: { id: "DASH-97", title: "Slugs" },
      skippedInTest: [
        {
          botName: "Reporter",
          tool: "addOrEditJiraIssueComment",
          server: "Atlassian MCP",
          args: '{"x":1}',
        },
      ],
    };
    expect(jobTitleText(job)).toBe("Test · DASH-97 · Slugs");
    expect(skippedLines(job)).toEqual([
      'Reporter: addOrEditJiraIssueComment on Atlassian MCP {"x":1}',
    ]);
    expect(skippedLines({ ...job, test: false })).toEqual([]);
  });
});

describe("what a step needs from you, on the job page (DASH-113)", () => {
  const flow = {
    kind: "bot-checks",
    botId: "pr",
    steps: [
      { id: "step_work", kind: "bot", name: "PR Bot", botId: "pr" },
      { id: "step_you", kind: "you", name: "You approve" },
    ],
  };
  const work = {
    stepId: "step_work",
    status: "passed",
    botName: "PR Bot",
    round: 1,
    at: T,
    output: { answer: "Opened the plan." },
  };
  const goalFor = (taskStatus, extra = []) => ({
    id: "g1",
    workspaceId: "1",
    title: "PR Bot: the plan",
    flow,
    createdAt: T,
    tasks: [
      {
        id: "t1",
        status: taskStatus,
        stepId: "step_you",
        round: 1,
        history: [work, ...extra],
      },
    ],
  });
  const jobWith = (step) => ({
    id: "job_x",
    workspaceId: "1",
    leadId: "lead1",
    leadName: "Code Lead",
    title: "Fix the slug",
    startedBy: { kind: "you" },
    status: step.status === "needs-you" ? "needs-you" : "running",
    createdAt: T,
    updatedAt: T,
    steps: [
      {
        id: "s1",
        botId: "pr",
        botName: "PR Bot",
        why: { kind: "handon", by: "Coder" },
        ...step,
      },
    ],
  });

  // A live mainApi: jobs-changed, goals:changed and approvals-changed
  // listeners kept, so a test can move things on while the page is open.
  function liveApi({ job, goal = null, approvals = [] }) {
    const state = { job, goal, approvals };
    const jobFns = [];
    const goalFns = [];
    const apprFns = [];
    const calls = { taskAction: [], approve: [], resume: [] };
    window.mainApi = {
      on: jest.fn((ch, fn) => {
        if (ch === "goals:changed") goalFns.push(fn);
        return String(goalFns.length);
      }),
      removeListener: jest.fn(),
      goals: {
        get: jest.fn(async () => state.goal),
        taskAction: jest.fn(async (taskId, action) => {
          calls.taskAction.push([taskId, action]);
          return { ok: true };
        }),
      },
      bots: {
        listJobs: jest.fn(async () => [state.job]),
        getJob: jest.fn(async () => state.job),
        listApprovals: jest.fn(async () => state.approvals),
        approve: jest.fn(async (id, d) => {
          calls.approve.push([id, d]);
          return { ok: true };
        }),
        resumeBot: jest.fn(async (id) => calls.resume.push(id)),
        get: jest.fn(async (id) => ({
          id,
          name: "PR Bot",
          workspaceId: "1",
          checks: {
            steps: [{ id: "step_you", kind: "you", name: "You approve" }],
          },
        })),
        list: jest.fn(async () => []),
        save: jest.fn(async (d) => {
          calls.save = (calls.save || []).concat([d]);
          return d;
        }),
        onJobsChanged: jest.fn((fn) => {
          jobFns.push(fn);
          return "j";
        }),
        onApprovalsChanged: jest.fn((fn) => {
          apprFns.push(fn);
          return "a";
        }),
        removeListener: jest.fn(),
      },
    };
    const move = async ({ job: j, goal: g, approvals: a }) => {
      const { act } = require("@testing-library/react");
      await act(async () => {
        if (j) state.job = j;
        if (g) state.goal = g;
        if (a) state.approvals = a;
        if (j) jobFns.forEach((fn) => fn({ jobId: j.id, workspaceId: "1" }));
        if (g) goalFns.forEach((fn) => fn({}, { goalId: g.id }));
        if (a) apprFns.forEach((fn) => fn({ approvals: a }));
      });
    };
    return { calls, move };
  }

  it("a step that starts waiting while the page is open shows its action, without remounting", async () => {
    const { move, calls } = liveApi({
      job: jobWith({ status: "checking", goalId: "g1" }),
      goal: goalFor("new"),
    });
    render(<JobsPage workspaces={WORKSPACES} />);
    const detail = await screen.findByTestId("job-detail");
    await within(detail).findByTestId("job-step");
    expect(screen.queryByTestId("job-waiting")).toBeNull();
    expect(screen.queryByTestId("job-needs-you")).toBeNull();
    // Its "you" check comes up: the job and its goal change.
    await move({
      job: jobWith({ status: "needs-you", goalId: "g1" }),
      goal: goalFor("ready"),
    });
    const card = await within(detail).findByTestId("job-waiting");
    // The same detail, not a new one.
    expect(screen.getByTestId("job-detail")).toBe(detail);
    expect(screen.getByTestId("job-needs-you")).toHaveTextContent(
      "Needs you · PR Bot is waiting for you",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.taskAction).toEqual([["t1", "done"]]));
    // Approved: the step updates in place.
    await move({
      job: jobWith({ status: "done", goalId: "g1" }),
      goal: goalFor("done"),
    });
    await waitFor(() => expect(screen.queryByTestId("job-waiting")).toBeNull());
  });

  it("a tool approval that arrives while it runs shows Allow once / Deny on the step", async () => {
    const { move, calls } = liveApi({ job: jobWith({ status: "running" }) });
    render(<JobsPage workspaces={WORKSPACES} />);
    await screen.findByTestId("job-detail");
    expect(screen.queryByTestId("job-approval")).toBeNull();
    await move({
      approvals: [
        {
          id: "appr_1",
          request: {
            botId: "pr",
            serverName: "GitHub",
            toolName: "create_pull_request",
            input: { title: "Fix the slug" },
          },
        },
      ],
    });
    const card = await screen.findByTestId("job-approval");
    expect(screen.getByTestId("job-needs-you")).toHaveTextContent(
      "PR Bot asks to use a tool",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(calls.approve).toEqual([["appr_1", { allow: true }]]),
    );
    await move({ approvals: [] });
    await waitFor(() =>
      expect(screen.queryByTestId("job-approval")).toBeNull(),
    );
    expect(
      within(screen.getByTestId("job-detail")).queryByText("Deny"),
    ).toBeNull();
  });

  it("a handoff ask shows its question and an answer box", async () => {
    const { calls } = liveApi({
      job: jobWith({
        status: "needs-you",
        goalId: "g1",
        summary: "It asks: Which branch?",
      }),
      goal: goalFor("needs-you", [
        {
          stepId: "step_handoff",
          status: "needs-you",
          ask: "Which branch?",
          round: 1,
          at: T,
        },
      ]),
    });
    render(<JobsPage workspaces={WORKSPACES} />);
    const card = await screen.findByTestId("job-asking");
    expect(within(card).getByTestId("job-question")).toHaveTextContent(
      "Which branch?",
    );
    expect(screen.getByTestId("job-needs-you")).toHaveTextContent(
      "PR Bot asks you a question",
    );
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "main" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(calls.taskAction).toEqual([
        ["t1", { type: "answer", reason: "main" }],
      ]),
    );
  });

  it("a 'you' check offers Approve and Send back with a note", async () => {
    const { calls } = liveApi({
      job: jobWith({ status: "needs-you", goalId: "g1" }),
      goal: goalFor("ready"),
    });
    render(<JobsPage workspaces={WORKSPACES} />);
    const card = await screen.findByTestId("job-waiting");
    expect(within(card).getByTestId("job-work")).toHaveTextContent(
      "Opened the plan.",
    );
    expect(card).toHaveTextContent("Your check: is PR Bot's work right?");
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "Smaller." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Send back" }));
    await waitFor(() =>
      expect(calls.taskAction).toEqual([
        ["t1", { type: "send-back", reason: "Smaller." }],
      ]),
    );
  });

  it("Edit <bot>'s checks opens its checks window over the job; Save returns to the same step (DASH-124)", async () => {
    const { calls } = liveApi({
      job: jobWith({ status: "needs-you", goalId: "g1" }),
      goal: goalFor("ready"),
    });
    render(<JobsPage workspaces={WORKSPACES} />);
    const card = await screen.findByTestId("job-waiting");
    // The check it waits at, by name, in its step's checks too.
    expect(card).toHaveTextContent('PR Bot\'s check "You approve"');
    expect(screen.getByTestId("check-yours")).toHaveTextContent(
      "You approve: waiting on you",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "Edit PR Bot's checks ›" }),
    );
    const modal = await screen.findByTestId("bot-checks-modal");
    expect(within(modal).getByTestId("checks-footer-note")).toHaveTextContent(
      "Changes apply from PR Bot's next run.",
    );
    // Only its checks change here.
    expect(within(modal).queryByTestId("hands-on")).toBeNull();
    fireEvent.click(within(modal).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByTestId("bot-checks-modal")).toBeNull(),
    );
    expect(calls.save[0].id).toBe("pr");
    expect(calls.save[0].checks).toBeTruthy();
    // Still on the same step, still waiting on you.
    expect(screen.getByTestId("job-waiting")).toBeInTheDocument();
  });

  it("the team page shows the same card, answered there (DASH-124)", async () => {
    const { calls } = liveApi({
      job: jobWith({ status: "needs-you", goalId: "g1" }),
      goal: goalFor("ready"),
      approvals: [
        {
          id: "a9",
          request: { botId: "rev", toolName: "send", serverName: "Slack" },
        },
      ],
    });
    const { TeamNeedsYouCards } = require("./NeedsYouCards");
    render(
      <TeamNeedsYouCards
        workspaceId="1"
        bots={[
          { id: "pr", name: "PR Bot" },
          { id: "rev", name: "Reviewer" },
        ]}
      />,
    );
    const card = await screen.findByTestId("job-waiting");
    expect(screen.getByTestId("needs-you-job")).toHaveTextContent("PR Bot");
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.taskAction).toEqual([["t1", "done"]]));
    // A bot's tool approval outside a waiting step: its own card.
    fireEvent.click(
      await screen.findByRole("button", { name: "Always allow for Reviewer" }),
    );
    await waitFor(() =>
      expect(calls.approve).toEqual([["a9", { allow: true, remember: true }]]),
    );
  });

  it("a paused bot offers Resume, and the header links to its step", async () => {
    const { calls } = liveApi({
      job: jobWith({ status: "needs-you", waiting: "paused" }),
    });
    render(<JobsPage workspaces={WORKSPACES} />);
    const card = await screen.findByTestId("job-paused");
    const header = screen.getByTestId("job-needs-you");
    expect(header).toHaveTextContent("PR Bot is paused");
    const step = document.getElementById("job-step-s1");
    step.scrollIntoView = jest.fn();
    fireEvent.click(within(header).getByRole("button", { name: "Go to it" }));
    expect(step.scrollIntoView).toHaveBeenCalled();
    fireEvent.click(
      within(card).getByRole("button", { name: "Resume PR Bot" }),
    );
    await waitFor(() => expect(calls.resume).toEqual(["pr"]));
  });
});

describe("a refused command or tool on the job page (DASH-115)", () => {
  const refused = (refusal, extra = {}) => ({
    id: "job_r",
    workspaceId: "1",
    leadId: "lead1",
    leadName: "Code Lead",
    title: "Fix the slug",
    startedBy: { kind: "you" },
    status: "failed",
    createdAt: T,
    updatedAt: T,
    endedAt: T,
    ...extra,
    steps: [
      {
        id: "s1",
        botId: "pr",
        botName: "PR Bot",
        status: "failed",
        summary: refusal.message,
        refusal,
      },
    ],
  });
  const cases = [
    {
      name: "a blocked command",
      refusal: {
        kind: "command",
        what: "git push -u origin feat/DASH-1",
        why: "it's on the bot's blocked commands (\"git push\")",
        fix: 'Take "git push" off the bot\'s Commands, or give it a provider tool that does this.',
        section: "commands",
        message: "PR Bot can't run `git push -u origin feat/DASH-1`: …",
      },
      button: "Open PR Bot's Commands",
      focus: "commands",
    },
    {
      name: "a tool it isn't set up with",
      refusal: {
        kind: "tool",
        what: 'merge_pull_request {"number":4}',
        why: "it isn't one of the bot's tools on GitHub",
        fix: "Add the tool to the bot's GitHub tools, on its Providers.",
        section: "providers",
        message: "PR Bot can't use `merge_pull_request`: …",
      },
      button: "Open PR Bot's Providers",
      focus: "providers",
    },
    {
      name: "a missing provider",
      refusal: {
        kind: "tool",
        what: "create_issue",
        why: "no provider on this computer has that tool",
        fix: "Add or sign in to the provider in Settings › Providers, then give it to the bot on its Providers.",
        section: "providers",
        message: "PR Bot can't use `create_issue`: …",
      },
      button: "Open PR Bot's Providers",
      focus: "providers",
    },
  ];
  for (const c of cases) {
    it(`${c.name}: a Blocked card with what, why, the fix, and its settings`, async () => {
      withApi([refused(c.refusal)]);
      const opened = [];
      const on = (e) => opened.push(e.detail);
      window.addEventListener("dash:open-bot", on);
      try {
        render(<JobsPage workspaces={WORKSPACES} />);
        const card = await screen.findByTestId("job-blocked");
        expect(within(card).getByTestId("job-blocked-what")).toHaveTextContent(
          c.refusal.what,
        );
        expect(within(card).getByTestId("job-blocked-why")).toHaveTextContent(
          `Why: ${c.refusal.why}.`,
        );
        expect(within(card).getByTestId("job-blocked-fix")).toHaveTextContent(
          c.refusal.fix,
        );
        // Nothing to approve: its setup is the answer.
        expect(
          within(card).queryByRole("button", { name: /Allow/ }),
        ).toBeNull();
        fireEvent.click(within(card).getByRole("button", { name: c.button }));
        expect(opened).toEqual([
          { botId: "pr", tab: "settings", focus: c.focus },
        ]);
      } finally {
        window.removeEventListener("dash:open-bot", on);
      }
    });
  }

  it("a self-test's own block isn't a failure: it's listed with what the test skipped", async () => {
    withApi([
      {
        id: "job_t",
        workspaceId: "1",
        leadId: "lead1",
        title: "DASH-1",
        test: true,
        startedBy: { kind: "you" },
        status: "done",
        createdAt: T,
        updatedAt: T,
        skippedInTest: [
          { command: "git push -u origin feat/DASH-1", botName: "PR Bot" },
        ],
        steps: [{ id: "s1", botId: "pr", botName: "PR Bot", status: "done" }],
      },
    ]);
    render(<JobsPage workspaces={WORKSPACES} />);
    const test = await screen.findByTestId("job-self-test");
    expect(test).toHaveTextContent(
      "PR Bot: `git push -u origin feat/DASH-1` (blocked in a test)",
    );
    expect(screen.queryByTestId("job-blocked")).toBeNull();
  });
});
