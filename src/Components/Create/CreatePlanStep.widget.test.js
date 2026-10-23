/**
 * A widget on its own (consolidation Phase 3b): Create › Type: Widget goes
 * through the Dash team — the Planner is told it's one widget for the
 * user's widgets (no dashboard), and it builds like a cell's (preview first,
 * never placed), with its own words.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { CreatePlanStep } from "./CreatePlanStep";
import { builtWidgetName } from "./CreateModal";

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
const mockConfigs = {};
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: (c) => mockConfigs[c] || null },
}));

function setup(props) {
  mockRunTeamRole.mockReset();
  mockRunTeamRole.mockResolvedValue({ status: "completed", output: "Sure." });
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      removeCreateRecent: jest.fn().mockResolvedValue({}),
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
});

test("the Planner is told: one widget for the user's widgets, no dashboard", async () => {
  setup({ widget: true, prompt: "Look up an order by number" });
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  const [role, request] = mockRunTeamRole.mock.calls[0];
  expect(role).toBe("planner");
  expect(request).toMatch(/^Look up an order by number/);
  expect(request).toMatch(
    /Plan exactly one new widget for the user's widgets — it isn't going on a dashboard/,
  );
  expect(request).toMatch(/don't set "dashboard"/);
  // Saved, as a widget plan, so closing it doesn't lose it (QA 2026-10-22).
  expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith({
    prompt: "Look up an order by number",
    conversation: { widget: true },
  });
});

test("it builds as a cell's does, with its own words for the preview", async () => {
  const plan = {
    summary: "Order Lookup",
    pieces: [{ kind: "widget", name: "Order Lookup", source: "new" }],
  };
  const onCellDone = jest.fn();
  setup({
    widget: true,
    onCellDone,
    seed: { plan, request: null, label: plan.summary, autoBuild: true },
  });
  expect(await screen.findByTestId("building-stub")).toHaveTextContent("b1");
  // standalone: the Builder is told it's for the user's widgets, not a cell.
  expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(plan, {
    recentId: "plan_1",
    cell: true,
    standalone: true,
  });
  expect(mockBuildProps.cell).toEqual({
    label: "your widgets",
    approveLabel: "Looks good — add it to my widgets",
    discardLabel: "Discard — nothing is installed",
    inputsNote: "Only for trying it here.",
  });
  // Looks good: the plan is marked done (it leaves Unfinished), then handed on.
  mockBuildProps.onCellDone({ component: "x" });
  expect(window.mainApi.bots.saveCreateRecent).toHaveBeenLastCalledWith({
    id: "plan_1",
    conversation: { widgetAdded: true },
  });
  expect(onCellDone).toHaveBeenCalledWith({ component: "x" });
});

test("Discard forgets a widget plan (nothing is installed)", async () => {
  const plan = {
    summary: "Order Lookup",
    pieces: [{ kind: "widget", name: "Order Lookup", source: "new" }],
  };
  const onDiscard = jest.fn();
  setup({
    widget: true,
    onDiscard,
    seed: { plan, request: null, label: plan.summary, autoBuild: true },
  });
  await screen.findByTestId("building-stub");
  mockBuildProps.onDiscard();
  expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith("plan_1");
  expect(onDiscard).toHaveBeenCalled();
});

test("a cell's build is still not saved", async () => {
  setup({ cell: { label: "cell 1.1" }, prompt: "A clock" });
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalled();
});

describe("builtWidgetName (the Done screen)", () => {
  test("its config's name, else its component as words", () => {
    mockConfigs["ai-built.order-lookup.OrderLookup"] = {
      displayName: "Order Lookup",
    };
    expect(
      builtWidgetName({ component: "ai-built.order-lookup.OrderLookup" }),
    ).toBe("Order Lookup");
    expect(
      builtWidgetName({ component: "ai-built.counter.ClickCounter" }),
    ).toBe("Click Counter");
    expect(builtWidgetName(null)).toBe("Your widget");
  });
});
