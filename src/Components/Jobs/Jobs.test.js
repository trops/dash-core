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
  filterJobs,
  groupByDashboard,
  jobCounts,
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
    expect(whyText(JOBS[0].steps[2].why)).toBe(
      "Started by Designer › Completed",
    );
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
      within(detail).getByText("Started by Designer › Completed"),
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
      await screen.findByRole("button", { name: "Turn on Drafter" }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
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
