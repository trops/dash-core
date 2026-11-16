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

const at = (h) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};

const record = (o) => ({
  botId: "bot_b",
  botName: "Builder",
  status: "passed",
  round: 1,
  summary: "",
  evidence: [],
  said: "bot",
  at: at(9),
  ...o,
});

const working = {
  id: "goal_working",
  workspaceId: "7",
  title: "Count conversations per lead",
  status: "working",
  source: { kind: "ticket", label: "DASH-421", ref: "" },
  createdAt: at(8),
  updatedAt: at(9),
  tasks: [
    {
      id: "task_build",
      goalId: "goal_working",
      title: "Build it",
      status: "built",
      round: 1,
      maxRounds: 3,
      holder: null,
      history: [
        record({
          summary: "Opened the PR",
          evidence: [{ label: "PR", value: "https://example.com/pr/1" }],
        }),
      ],
    },
  ],
};

const stopped = {
  id: "goal_stopped",
  workspaceId: "7",
  title: "Sort leads by recent activity",
  status: "needs-you",
  source: { kind: "bot" },
  conversationId: "plan_1",
  createdAt: at(7),
  updatedAt: at(8),
  tasks: [
    {
      id: "task_sort",
      goalId: "goal_stopped",
      title: "Sort leads",
      status: "needs-you",
      round: 2,
      maxRounds: 2,
      holder: null,
      history: [
        record({ status: "failed", round: 1, summary: "Ties not sorted" }),
        record({
          status: "failed",
          round: 2,
          summary: "Still on top",
          stopped: true,
        }),
      ],
    },
  ],
};

const ready = {
  id: "goal_ready",
  workspaceId: "7",
  title: "Morning brief",
  status: "ready",
  source: { kind: "schedule" },
  createdAt: at(6),
  updatedAt: at(7),
  tasks: [
    {
      id: "task_brief",
      goalId: "goal_ready",
      title: "Write the brief",
      status: "ready",
      round: 1,
      maxRounds: 3,
      holder: null,
      history: [],
    },
  ],
};

const elsewhere = { ...working, id: "goal_other", workspaceId: "8" };

let mock;
beforeEach(() => {
  mock = mockGoalsApi([working, stopped, ready, elsewhere]);
});
afterEach(() => {
  delete window.mainApi;
});

const rows = () => screen.getAllByTestId("goal-row");
const renderView = () => render(<GoalsView workspace={{ id: 7 }} />);

test("lists this dashboard's goals with status, source, line and task pills", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  const first = rows()[0];
  expect(
    within(first).getByText("Count conversations per lead"),
  ).toBeInTheDocument();
  expect(within(first).getByText("Ticket DASH-421")).toBeInTheDocument();
  expect(
    within(first).getByText("Builder: passed — Opened the PR"),
  ).toBeInTheDocument();
  expect(within(first).getByText("Build it")).toBeInTheDocument();
  expect(within(first).getByText("Round 1 of 3")).toBeInTheDocument();
  expect(
    within(rows()[1]).getByText("Stopped after 2 rounds: Sort leads"),
  ).toBeInTheDocument();
});

test("filters by Needs you", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[0]);
  await screen.findByTestId("goal-detail");
  fireEvent.click(screen.getByRole("radio", { name: /Needs you 2/ }));
  expect(rows()).toHaveLength(2);
  // The open goal isn't in this filter, so its detail closes.
  expect(screen.queryByTestId("goal-detail")).not.toBeInTheDocument();
});

test("a closed goal offers no moves on its tasks", async () => {
  mock = mockGoalsApi([
    { ...stopped, id: "goal_closed", closed: true, status: "closed" },
  ]);
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(rows()[0]);
  await screen.findByTestId("goal-detail");
  expect(screen.queryByTestId("goal-waiting")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Give it one more round" }),
  ).not.toBeInTheDocument();
});

test("a goal opens beside the list with its records, labelled as said by the bot", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[0]);
  const detail = await screen.findByTestId("goal-detail");
  expect(within(detail).getByText("Opened the PR")).toBeInTheDocument();
  expect(within(detail).getByText("said by the bot")).toBeInTheDocument();
  expect(
    within(detail).getByText("PR: https://example.com/pr/1"),
  ).toBeInTheDocument();
});

test("a stopped task shows its rounds and gets one more round", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[1]);
  const waiting = await screen.findByTestId("goal-waiting");
  expect(waiting).toHaveTextContent("“Sort leads” stopped after 2 rounds");
  expect(waiting).toHaveTextContent(
    "Round 1: Builder: failed — Ties not sorted",
  );
  fireEvent.click(
    within(waiting).getByRole("button", { name: "Give it one more round" }),
  );
  await waitFor(() =>
    expect(mock.api.taskAction).toHaveBeenCalledWith(
      "task_sort",
      "one-more-round",
    ),
  );
});

test("a ready task is marked done by you", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[2]);
  const detail = await screen.findByTestId("goal-detail");
  fireEvent.click(within(detail).getByRole("button", { name: "Mark done" }));
  await waitFor(() =>
    expect(mock.api.taskAction).toHaveBeenCalledWith("task_brief", "done"),
  );
});

test("Delete goal asks first, then removes it", async () => {
  renderView();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[0]);
  const detail = await screen.findByTestId("goal-detail");
  fireEvent.click(within(detail).getByRole("button", { name: "Delete goal" }));
  expect(screen.getByTestId("goal-delete-confirm")).toHaveTextContent(
    "Its 1 task, 0 runs, proof and work files are removed",
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(mock.api.delete).toHaveBeenCalledWith(["goal_working"]),
  );
  await waitFor(() => expect(rows()).toHaveLength(2));
});

test("a dashboard with no goals says how they get here", async () => {
  render(<GoalsView workspace={{ id: 99 }} />);
  expect(await screen.findByText("No goals yet")).toBeInTheDocument();
});
