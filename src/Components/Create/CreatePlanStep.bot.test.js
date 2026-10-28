/**
 * The plan screen for one bot (consolidation Phase 2c-1): the Planner is
 * told it's one new bot for that dashboard (or none); the plan says where it
 * goes, keeps its one bot, and Build starts a bot build. A bot the Scout
 * found shows at once, without asking the Planner.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CreatePlanStep } from "./CreatePlanStep";

const mockRunTeamRole = jest.fn();
jest.mock("../../utils/teamRoles", () => {
  const actual = jest.requireActual("../../utils/teamRoles");
  return { ...actual, runTeamRole: (...a) => mockRunTeamRole(...a) };
});
let mockBuildProps;
jest.mock("./CreateBuildingStep", () => ({
  CreateBuildingStep: (props) => {
    mockBuildProps = props;
    return <div data-testid="building-stub">{props.buildId}</div>;
  },
}));
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const BRIEF = { id: "7", name: "Morning Brief" };
const BOT = {
  kind: "bot",
  name: "Morning Email Summary",
  source: "new",
  instructions: "Summarize my unread email.",
  schedule: { cron: "30 7 * * 1-5" },
  showResults: true,
};

function setup(props, output = "Sure.") {
  mockRunTeamRole.mockReset();
  mockRunTeamRole.mockResolvedValue({ status: "completed", output });
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      listDashTeam: jest.fn().mockResolvedValue([]),
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "b1", state: { status: "running" } }),
    },
  };
  render(<CreatePlanStep prompt="" {...props} />);
}

afterEach(() => {
  delete window.mainApi;
  mockBuildProps = null;
});

test("the Planner is told: exactly one new bot, on that dashboard", async () => {
  setup({ prompt: "Summarize my email", bot: { where: BRIEF } });
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  const [role, request] = mockRunTeamRole.mock.calls[0];
  expect(role).toBe("planner");
  expect(request).toMatch(/^Summarize my email\n\n\(Plan exactly one new bot/);
  expect(request).toMatch(/"Morning Brief" dashboard/);
});

test("the plan goes where Where says, says so, and keeps its one bot", async () => {
  // The Planner put it somewhere else: Where wins.
  const plan = {
    summary: "A morning email summary",
    dashboard: { id: "9", name: "Other" },
    pieces: [BOT],
  };
  setup(
    { prompt: "Summarize my email", bot: { where: BRIEF } },
    `Here it is.\n<plan>${JSON.stringify(plan)}</plan>`,
  );
  expect(await screen.findByTestId("plan-counts")).toHaveTextContent(
    "1 bot · goes on: Morning Brief",
  );
  expect(
    screen.queryByRole("button", {
      name: "Remove Morning Email Summary from the plan",
    }),
  ).toBeNull();
  expect(screen.getByTestId("plan-expect-bot")).toHaveTextContent(
    "It's checked, then saved paused.",
  );
  // Build stays in view: pinned below the plan.
  const build = screen.getByRole("button", { name: "Build" });
  expect(screen.getByTestId("plan-build-bar")).toContainElement(build);
  fireEvent.click(build);
  await waitFor(() =>
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
  );
  const [built, opts] = window.mainApi.bots.startPlanBuild.mock.calls[0];
  expect(built.dashboard).toEqual(BRIEF);
  expect(opts).toEqual({ bot: true, recentId: "plan_1" });
  expect(await screen.findByTestId("building-stub")).toBeInTheDocument();
  expect(mockBuildProps.bot).toEqual({
    where: BRIEF,
    piece: expect.objectContaining({ name: "Morning Email Summary" }),
  });
});

test("no dashboard: its results stay in the Bots view", async () => {
  const plan = { summary: "s", pieces: [BOT] };
  setup(
    { prompt: "Summarize my email", bot: { where: null } },
    `<plan>${JSON.stringify(plan)}</plan>`,
  );
  expect(await screen.findByTestId("plan-counts")).toHaveTextContent(
    "1 bot · on no dashboard — its results stay in the Bots view",
  );
});

test("a bot the Scout found shows at once — the Planner isn't asked", async () => {
  const plan = {
    summary: "Use Inbox Digest on Morning Brief",
    dashboard: BRIEF,
    pieces: [BOT],
  };
  setup({
    bot: { where: BRIEF },
    seed: { plan, request: null, label: plan.summary },
  });
  expect(await screen.findByTestId("plan-card")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Build" })).not.toBeDisabled();
  expect(mockRunTeamRole).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Ready to build as it is — or ask the Planner/),
  ).toBeInTheDocument();
});

test("kept in Recent as a bot plan, so it reopens as one", async () => {
  jest.useFakeTimers();
  try {
    setup({ prompt: "Summarize my email", bot: { where: BRIEF } });
    await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
    jest.advanceTimersByTime(400);
    const saved = window.mainApi.bots.saveCreateRecent.mock.calls
      .map((c) => c[0])
      .filter((r) => r && r.conversation);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[saved.length - 1].conversation.bot).toEqual({ where: BRIEF });
  } finally {
    jest.useRealTimers();
  }
});
