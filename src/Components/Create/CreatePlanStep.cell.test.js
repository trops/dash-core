/**
 * The plan screen for a cell (consolidation Phase 2b): Use in this cell
 * builds at once (no Planner), a planned one tells the Planner it's one
 * widget for that cell, and builds start in cell mode.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
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

const CELL = { label: "cell 2.2 on Slack Pack" };

function setup(props) {
  mockRunTeamRole.mockReset();
  mockRunTeamRole.mockResolvedValue({ status: "completed", output: "Sure." });
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      listDashTeam: jest.fn().mockResolvedValue([]),
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "b1", state: { status: "running" } }),
    },
    registryAuth: { getProfile: jest.fn().mockResolvedValue({ id: "me" }) },
  };
  render(<CreatePlanStep prompt="" {...props} />);
}

afterEach(() => {
  delete window.mainApi;
});

test("Use in this cell: builds at once in cell mode — no Planner", async () => {
  const plan = {
    summary: "Use Threads Inbox in cell 2.2 on Slack Pack",
    pieces: [
      {
        kind: "widget",
        name: "Threads Inbox",
        source: "registry",
        package: "@trops/threads-inbox",
      },
    ],
  };
  const onCellDone = jest.fn();
  setup({
    cell: CELL,
    onCellDone,
    seed: { plan, request: null, label: plan.summary, autoBuild: true },
  });
  expect(await screen.findByTestId("building-stub")).toHaveTextContent("b1");
  // Not kept in Recent (it ends in the editor).
  expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(plan, {
    cell: true,
  });
  expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalled();
  expect(mockRunTeamRole).not.toHaveBeenCalled();
  expect(mockBuildProps.cell).toEqual(CELL);
  expect(mockBuildProps.onCellDone).toBe(onCellDone);
});

test("a planned one: the Planner is told it's one widget for that cell", async () => {
  setup({ cell: CELL, prompt: "Unread Slack threads" });
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  const [role, request] = mockRunTeamRole.mock.calls[0];
  expect(role).toBe("planner");
  expect(request).toMatch(/^Unread Slack threads/);
  expect(request).toMatch(
    /Plan exactly one widget for cell 2\.2 on Slack Pack/,
  );
  expect(request).toMatch(/don't set "dashboard"/);
});

// Review (mockup Plan frame): a cell's plan says where it goes, keeps its
// one widget (Swap, no remove) and leaves the sample sketch to the real
// preview later.
test("a cell's plan: where it goes, Swap but no remove", async () => {
  const plan = {
    summary: "A countdown to New Year",
    pieces: [{ kind: "widget", name: "New Year Countdown", source: "new" }],
  };
  setup({
    cell: CELL,
    seed: { plan, request: null, label: plan.summary },
  });
  expect(await screen.findByTestId("plan-counts")).toHaveTextContent(
    "Goes into: cell 2.2 on Slack Pack",
  );
  expect(screen.getByRole("button", { name: "Swap…" })).toBeInTheDocument();
  // Build in view without scrolling: pinned below the plan; no Recent.
  const build = screen.getByRole("button", { name: "Build" });
  expect(screen.getByTestId("plan-build-bar")).toContainElement(build);
  expect(screen.getByTestId("plan-card")).not.toContainElement(build);
  expect(screen.getByTestId("plan-ready")).toHaveTextContent(
    "Nothing goes into cell 2.2 on Slack Pack until you've seen it running.",
  );
  expect(
    screen.queryByRole("button", {
      name: "Remove New Year Countdown from the plan",
    }),
  ).toBeNull();
});
