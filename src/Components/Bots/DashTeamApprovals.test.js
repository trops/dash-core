/**
 * The Dash team's approvals, answerable where the user is working with the
 * team (QA 2026-10-28: the Builder waited on an approval nobody could see).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DashTeamApprovals, approvalText } from "./DashTeamApprovals";

const team = [
  { id: "b_builder", role: "builder", name: "Builder" },
  { id: "b_planner", role: "planner", name: "Planner" },
];

function mount(approvals) {
  let changed = null;
  window.mainApi = {
    bots: {
      listApprovals: jest.fn().mockResolvedValue(approvals),
      listDashTeam: jest.fn().mockResolvedValue(team),
      approve: jest.fn().mockResolvedValue({ ok: true }),
      onApprovalPending: jest.fn(() => 1),
      onApprovalsChanged: jest.fn((cb) => {
        changed = cb;
        return 2;
      }),
      removeListener: jest.fn(),
    },
  };
  const view = render(<DashTeamApprovals />);
  return { ...view, changed: () => changed && changed() };
}

afterEach(() => {
  delete window.mainApi;
});

const builderAsks = {
  id: "ap1",
  request: {
    botId: "b_builder",
    toolName: "build_widget",
    serverName: "dash-team-build",
    input: { name: "Smart Lights" },
  },
};

test("a Dash team bot's approval: what it wants, and Allow once / Always allow / Deny", async () => {
  mount([builderAsks]);
  expect(await screen.findByTestId("dash-team-approval")).toHaveTextContent(
    "Builder wants to build and install a widget: Smart Lights.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  await waitFor(() =>
    expect(window.mainApi.bots.approve).toHaveBeenCalledWith("ap1", {
      allow: true,
    }),
  );
});

test("the team's build tools: Allow once or Deny — never a saved grant", async () => {
  mount([builderAsks]);
  await screen.findByTestId("dash-team-approval");
  expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
});

test("Always allow and Deny send their answers", async () => {
  mount([
    {
      ...builderAsks,
      request: { ...builderAsks.request, serverName: "some-provider" },
    },
  ]);
  fireEvent.click(await screen.findByRole("button", { name: "Always allow" }));
  await waitFor(() =>
    expect(window.mainApi.bots.approve).toHaveBeenLastCalledWith("ap1", {
      allow: true,
      remember: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() =>
    expect(window.mainApi.bots.approve).toHaveBeenLastCalledWith("ap1", {
      allow: false,
    }),
  );
});

test("other bots' approvals aren't shown here; nothing waiting, nothing shown", async () => {
  const { container } = mount([
    { id: "ap2", request: { botId: "b_mine", toolName: "send" } },
  ]);
  await waitFor(() =>
    expect(window.mainApi.bots.listApprovals).toHaveBeenCalled(),
  );
  expect(container).toBeEmptyDOMElement();
});

test("approvalText", () => {
  expect(approvalText({ toolName: "place_widget" }, "Builder")).toBe(
    "Builder wants to put a widget on a dashboard.",
  );
  expect(
    approvalText(
      {
        toolName: "place_widget",
        input: { widget: "Clock", dashboard: "Home" },
      },
      "Builder",
    ),
  ).toBe("Builder wants to put a widget on a dashboard: Clock on Home.");
  expect(approvalText({ toolName: "x" })).toBe(
    "A Dash team bot wants to use x.",
  );
});
