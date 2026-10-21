/**
 * The plan screen for a change to one widget (consolidation Phase 3): the
 * Planner gets the change's request, its plan is held to that widget, the
 * card says what it adds and keeps, and the build starts as a change.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const TARGET = {
  package: "inbox",
  component: "jg.inbox.Inbox",
  componentName: "Inbox",
  displayName: "Inbox",
};
const EDIT = {
  target: TARGET,
  mode: "update",
  request:
    "Add a date filter\n\n(A change to one widget the user has: Inbox …)",
  usedOn: "Morning Brief and Sales",
  cellLabel: "this cell on Morning Brief",
  inputs: { settings: { maxMessages: 10 }, providers: { gmail: "Work Gmail" } },
  original: { componentCode: "a", configCode: "b" },
};
// The Planner wrote a new widget with another package: held to the change.
const PLANNED = `Here's the plan. <plan>${JSON.stringify({
  summary: "Inbox gets a date filter",
  pieces: [
    {
      kind: "widget",
      name: "Inbox",
      source: "new",
      package: "@someone/else",
      adds: "A date filter above the list.",
      keeps: ["Max messages", "Gmail", "messageSelected"],
    },
  ],
  checks: ["The filter changes the list"],
})}</plan>`;

function setup(edit = EDIT) {
  mockRunTeamRole.mockReset();
  mockRunTeamRole.mockResolvedValue({ status: "completed", output: PLANNED });
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      listDashTeam: jest.fn().mockResolvedValue([]),
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "b1", state: { status: "running" } }),
    },
  };
  const onCellDone = jest.fn();
  render(
    <CreatePlanStep
      prompt="Add a date filter"
      edit={edit}
      onCellDone={onCellDone}
    />,
  );
  return { onCellDone };
}

afterEach(() => {
  delete window.mainApi;
});

test("the Planner gets the change's request; nothing goes to Recent", async () => {
  setup();
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  expect(mockRunTeamRole.mock.calls[0][0]).toBe("planner");
  expect(mockRunTeamRole.mock.calls[0][1]).toBe(EDIT.request);
  expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalled();
});

test("the card: a change to Inbox, what it adds and keeps, its files — no Swap", async () => {
  setup();
  expect(await screen.findByTestId("plan-counts")).toHaveTextContent(
    "1 widget · changes Inbox in place · used on Morning Brief and Sales",
  );
  expect(
    screen.getByText("Change to Inbox · not made yet"),
  ).toBeInTheDocument();
  expect(screen.getByText("Change")).toBeInTheDocument();
  const details = screen.getByTestId("plan-edit-details");
  expect(details).toHaveTextContent("A date filter above the list.");
  expect(details).toHaveTextContent("Max messages · Gmail · messageSelected");
  expect(details).toHaveTextContent("widgets/Inbox.js, widgets/Inbox.dash.js");
  expect(screen.queryByRole("button", { name: "Swap…" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Remove Inbox/ })).toBeNull();
  expect(screen.queryByTestId("plan-errors")).toBeNull();
  expect(screen.getByTestId("plan-ready")).toHaveTextContent(
    "Nothing changes until you've seen it running and said OK.",
  );
});

test("Build starts a change: the component, how, and the cell's inputs", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Build" }));
  await screen.findByTestId("building-stub");
  const [plan, opts] = window.mainApi.bots.startPlanBuild.mock.calls[0];
  expect(plan.pieces[0]).toMatchObject({ source: "update", package: "inbox" });
  expect(opts).toEqual({
    edit: {
      component: "jg.inbox.Inbox",
      mode: "update",
      displayName: "Inbox",
      settings: { maxMessages: 10 },
      providers: { gmail: "Work Gmail" },
    },
  });
  expect(mockBuildProps.edit).toMatchObject({
    mode: "update",
    approveLabel: "Looks good — update Inbox",
    discardLabel: "Discard — keep Inbox as it is",
    original: { componentCode: "a", configCode: "b" },
  });
});

test("as a new widget from a cell: the card and the preview say so", async () => {
  setup({ ...EDIT, mode: "new" });
  expect(await screen.findByTestId("plan-counts")).toHaveTextContent(
    "1 widget · a new widget · goes into this cell on Morning Brief · Inbox isn't changed",
  );
  expect(screen.getByText("New widget")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  await screen.findByTestId("building-stub");
  const [plan] = window.mainApi.bots.startPlanBuild.mock.calls[0];
  expect(plan.pieces[0].source).toBe("new");
  expect("package" in plan.pieces[0]).toBe(false);
  expect(mockBuildProps.edit.approveLabel).toBe(
    "Looks good — put it in this cell",
  );
});
