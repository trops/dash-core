/**
 * CreatePlanStep and Recent (create-entry CRE-003 AC4, CRE-007 AC2; phase
 * 4e-1): a plan conversation is kept as it goes, with its plan memory, and
 * reopens as it was left.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreatePlanStep, reopenedRequest } from "./CreatePlanStep";
import { recentRows, recentStatus, recentLine } from "./recentRows";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

const team = [
  {
    id: "b_planner",
    role: "planner",
    name: "Planner",
    runsOn: "claude-opus-4-8",
  },
];
const PLAN = {
  summary: "Ask and greet",
  pieces: [
    { kind: "widget", name: "Ask", source: "new" },
    { kind: "layout", name: "Ask Test", source: "new" },
  ],
};
const planned = {
  status: "completed",
  model: "claude-opus-4-8",
  usage: { inputTokens: 1000, outputTokens: 100 },
  cost: { usd: 0, includedInPlan: true },
  output: `Here's the plan.\n<plan>${JSON.stringify(PLAN)}</plan>`,
};

function api(over = {}) {
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn().mockResolvedValue(planned),
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_7" }),
      getCreateRecent: jest.fn().mockResolvedValue(null),
      onPlanBuild: jest.fn(() => 2),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      startPlanBuild: jest.fn().mockResolvedValue({
        buildId: "b2",
        state: { status: "running", steps: [] },
      }),
      ...over,
    },
  };
  return window.mainApi.bots;
}

afterEach(() => {
  delete window.mainApi;
});

test("a new conversation is kept in Recent first; the Planner works with its memory", async () => {
  const bots = api();
  render(<CreatePlanStep prompt="A greeter dashboard" />);
  await screen.findByTestId("plan-card");
  expect(bots.saveCreateRecent).toHaveBeenNthCalledWith(1, {
    prompt: "A greeter dashboard",
  });
  expect(bots.run).toHaveBeenCalledWith(
    "b_planner",
    "A greeter dashboard",
    false,
    { planId: "plan_7" },
  );
  // Then saved as it goes: the messages and the plan.
  await waitFor(() =>
    expect(bots.saveCreateRecent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "plan_7",
        conversation: expect.objectContaining({ plan: PLAN }),
      }),
    ),
  );
  expect(screen.getByTestId("plan-ready")).toHaveTextContent(
    "Kept in Recent · nothing has been built or installed yet.",
  );
});

test("reopened from Recent: as it was, no new question; the next one re-introduces the plan", async () => {
  const bots = api({
    getCreateRecent: jest.fn().mockResolvedValue({
      id: "plan_3",
      prompt: "A greeter dashboard",
      conversation: {
        messages: [
          { who: "you", text: "A greeter dashboard" },
          { who: "planner", text: "Here's the plan." },
        ],
        plan: PLAN,
        checks: {},
        planningTokens: 1100,
      },
      build: null,
    }),
  });
  render(<CreatePlanStep prompt="" recentId="plan_3" />);
  await screen.findByTestId("plan-card");
  expect(screen.getByText("Here's the plan.")).toBeInTheDocument();
  expect(bots.run).not.toHaveBeenCalled();
  expect(bots.saveCreateRecent).not.toHaveBeenCalledWith({ prompt: "" });

  fireEvent.change(screen.getByLabelText("Reply to the Planner"), {
    target: { value: "Add a clock" },
  });
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(bots.run).toHaveBeenCalled());
  const [botId, request, cont, opts] = bots.run.mock.calls[0];
  expect(botId).toBe("b_planner");
  expect(cont).toBe(false);
  expect(opts).toEqual({ planId: "plan_3" });
  expect(request).toMatch(/^You're picking up a saved plan/);
  expect(request).toMatch(/"summary":"Ask and greet"/);
  expect(request).toMatch(/Now: Add a clock$/);
});

test("reopened mid-build: the build's last state, and Continue building resumes it", async () => {
  const bots = api({
    getCreateRecent: jest.fn().mockResolvedValue({
      id: "plan_4",
      prompt: "x",
      conversation: { messages: [], plan: PLAN },
      build: {
        buildId: "b1",
        state: {
          status: "interrupted",
          steps: [
            {
              id: "dashboard",
              kind: "dashboard",
              role: "dash",
              label: "Create",
              status: "done",
            },
          ],
          built: { dashboard: { id: "77", name: "Ask Test" } },
          totals: { tokens: 0, includedInPlan: true },
        },
      },
    }),
  });
  render(<CreatePlanStep prompt="" recentId="plan_4" />);
  expect(await screen.findByTestId("building-status")).toHaveTextContent(
    "Interrupted",
  );
  fireEvent.click(screen.getByText("Continue building"));
  await waitFor(() =>
    expect(bots.startPlanBuild).toHaveBeenCalledWith(PLAN, {
      resumeFrom: "b1",
      recentId: "plan_4",
    }),
  );
});

test("reopenedRequest without a plan yet", () => {
  expect(reopenedRequest("A brief", null, "go")).toBe(
    `You're picking up a saved plan. It started from: "A brief".\nThis plan's memory has what was asked, answered and built so far.\nThere's no plan yet.\nNow: go`,
  );
});

describe("recentRows", () => {
  test("status words", () => {
    expect(recentStatus({ status: "draft" })).toBe("Draft plan");
    expect(
      recentStatus({ status: "building", progress: { done: 2, total: 5 } }),
    ).toBe("Building 2/5");
    expect(recentStatus({ status: "problems" })).toBe("Built, with problems");
    expect(
      recentStatus({ status: "waiting", waitingFor: ["gmail", "slack"] }),
    ).toBe("Waiting for Gmail and Slack");
    expect(recentStatus({ status: "interrupted" })).toBe("Interrupted");
  });
  test("plans and drafts, newest first, at most the limit", () => {
    const rows = recentRows(
      [
        {
          id: "p",
          title: "Plan",
          status: "built",
          updatedAt: "2026-10-12T10:00:00Z",
        },
      ],
      [
        {
          id: "d",
          name: "Draft",
          updatedAt: Date.parse("2026-10-12T11:00:00Z"),
        },
        { id: "e", name: "", updatedAt: Date.parse("2026-10-11T11:00:00Z") },
      ],
      2,
    );
    expect(rows.map((r) => r.key)).toEqual(["draft:d", "plan:p"]);
    expect(recentLine(rows[1], Date.parse("2026-10-12T10:05:00Z"))).toBe(
      "Plan · Built · 5m ago",
    );
  });
});
