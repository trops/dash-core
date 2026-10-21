/**
 * DashTeamPage — the Dash team as one contact (consolidation Phase 4a,
 * app-navigation NAV-016 AC7): its conversations (one thread per question)
 * and its roles' settings.
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

// The thread itself is AskStep's (AskStep.test.js); here only which one opens.
jest.mock("../Create/AskStep", () => ({
  AskStep: ({ question, recentId, onOpenPlan, onStarted }) => (
    <div data-testid="ask-step">
      {recentId ? `thread ${recentId}` : `new: ${question}`}
      <button onClick={() => onStarted && onStarted("plan_new")}>
        started
      </button>
      <button onClick={() => onOpenPlan({ prompt: "x" })}>open-plan</button>
    </div>
  ),
}));
jest.mock("../AppPages/DashTeamPanel", () => ({
  DashTeamPanel: ({ bot, onEdit }) => (
    <div data-testid="dash-team-panel">
      panel for {bot.name}
      <button onClick={onEdit}>Edit</button>
    </div>
  ),
}));
jest.mock("../Settings/details/BotDetail", () => ({
  BotDetail: ({ bot, onCancel, onDirtyChange }) => (
    <div data-testid="bot-detail">
      form for {bot.name}
      <button onClick={onCancel}>cancel-form</button>
      <button onClick={() => onDirtyChange(true)}>make-dirty</button>
    </div>
  ),
}));
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));

let mockTeam;
const mockRefresh = jest.fn();
jest.mock("../AppPages/useAllBots", () => ({
  useAllBots: () => ({
    loading: false,
    bots: [],
    dashTeam: mockTeam,
    statusOf: () => "Idle",
    lastRunOf: () => null,
    refresh: mockRefresh,
  }),
}));

import { DashTeamPage, roleLine } from "./DashTeamPage";

const ROLES = [
  { id: "t_checker", role: "checker", name: "Checker", summary: "Checks" },
  { id: "t_planner", role: "planner", name: "Planner", summary: "Plans" },
  { id: "t_scout", role: "scout", name: "Scout", summary: "Finds" },
  { id: "t_builder", role: "builder", name: "Builder", summary: "Builds" },
];

beforeEach(() => {
  mockTeam = ROLES;
  mockRefresh.mockClear();
  window.mainApi = {
    bots: {
      listCreateRecent: jest.fn().mockResolvedValue([
        { id: "p1", title: "A plan", status: "draft", updatedAt: 9 },
        {
          id: "q1",
          kind: "question",
          title: "Which bots ran today?",
          updatedAt: 5,
        },
        {
          id: "q2",
          kind: "question",
          title: "Why is Support slow?",
          to: "Support Lead",
          updatedAt: 3,
        },
      ]),
      onCreateRecent: jest.fn(() => 7),
      removeListener: jest.fn(),
      resumeBot: jest.fn().mockResolvedValue(true),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("a header and two tabs; opens on Conversation, ready to ask", async () => {
  render(<DashTeamPage onClose={() => {}} />);
  expect(screen.getByText("Dash team")).toBeInTheDocument();
  expect(
    screen.getByText("Planner · Scout · Builder · Checker"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("dash-team-start")).toHaveTextContent(
    "Ask the Dash team",
  );
  expect(
    screen.getByRole("textbox", { name: "Ask the Dash team" }),
  ).toBeInTheDocument();
});

test("the threads are the questions, newest first; a lead's says so; plans aren't listed", async () => {
  render(<DashTeamPage />);
  await waitFor(() =>
    expect(screen.getAllByTestId("dash-team-thread")).toHaveLength(2),
  );
  const rows = screen.getAllByTestId("dash-team-thread");
  expect(rows[0]).toHaveTextContent("Which bots ran today?");
  expect(rows[1]).toHaveTextContent("Why is Support slow?");
  expect(rows[1]).toHaveTextContent("asked Support Lead");
  expect(screen.queryByText("A plan")).toBeNull();
});

test("a thread opens; New conversation goes back to the box", async () => {
  render(<DashTeamPage />);
  fireEvent.click(await screen.findByText("Which bots ran today?"));
  expect(screen.getByTestId("ask-step")).toHaveTextContent("thread q1");
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(screen.queryByTestId("ask-step")).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Ask the Dash team" }),
  ).toBeInTheDocument();
});

test("asking starts a new thread with the question", async () => {
  render(<DashTeamPage />);
  fireEvent.change(screen.getByRole("textbox", { name: "Ask the Dash team" }), {
    target: { value: "How many dashboards?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByTestId("ask-step")).toHaveTextContent(
    "new: How many dashboards?",
  );
  // Once saved, it stays open (not restarted) as its row is selected.
  fireEvent.click(screen.getByText("started"));
  expect(screen.getByTestId("ask-step")).toHaveTextContent(
    "new: How many dashboards?",
  );
});

test("Open as a plan goes to the host", async () => {
  const onOpenPlan = jest.fn();
  render(<DashTeamPage onOpenPlan={onOpenPlan} />);
  fireEvent.click(await screen.findByText("Which bots ran today?"));
  fireEvent.click(screen.getByText("open-plan"));
  expect(onOpenPlan).toHaveBeenCalledWith({ prompt: "x" });
});

test("a paused Planner: says so, Turn on instead of the box", async () => {
  mockTeam = ROLES.map((r) =>
    r.role === "planner" ? { ...r, paused: true } : r,
  );
  render(<DashTeamPage />);
  expect(screen.getByTestId("dash-team-start")).toHaveTextContent(
    "The Dash team is paused",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
  await waitFor(() =>
    expect(window.mainApi.bots.resumeBot).toHaveBeenCalledWith("t_planner"),
  );
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
});

test("Settings: the four roles in order; one opens its panel, Edit its form", () => {
  render(<DashTeamPage initialTab="settings" />);
  const roles = within(screen.getByTestId("dash-team-roles")).getAllByTestId(
    "dash-team-role",
  );
  expect(roles.map((r) => r.textContent)).toEqual([
    "PlannerOnPlans",
    "ScoutOnFinds",
    "BuilderOnBuilds",
    "CheckerOnChecks",
  ]);
  fireEvent.click(roles[1].querySelector("button"));
  expect(screen.getByTestId("dash-team-panel")).toHaveTextContent(
    "panel for Scout",
  );
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByTestId("bot-detail")).toHaveTextContent("form for Scout");
  fireEvent.click(screen.getByText("cancel-form"));
  expect(screen.getByTestId("dash-team-panel")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to all roles" }));
  expect(screen.getByTestId("dash-team-roles")).toBeInTheDocument();
});

test("Settings with no team: says it isn't set up", () => {
  mockTeam = [];
  render(<DashTeamPage initialTab="settings" />);
  expect(screen.getByText("The Dash team isn't set up.")).toBeInTheDocument();
});

describe("review fixes", () => {
  test("clicking the open thread while it answers doesn't restart it", async () => {
    window.mainApi.bots.listCreateRecent.mockResolvedValue([
      {
        id: "plan_new",
        kind: "question",
        title: "Anything new?",
        updatedAt: 9,
      },
    ]);
    render(<DashTeamPage />);
    await screen.findByText("Anything new?");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Ask the Dash team" }),
      {
        target: { value: "Anything new?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const step = screen.getByTestId("ask-step");
    // Saved as plan_new — its row is selected; clicking it keeps the step.
    fireEvent.click(screen.getByText("started"));
    fireEvent.click(
      screen.getByTestId("dash-team-thread").querySelector("button"),
    );
    expect(screen.getByTestId("ask-step")).toBe(step);
    expect(step).toHaveTextContent("new: Anything new?");
  });

  test("unsaved role edits: the host hears it; leaving asks first", () => {
    const onDirtyChange = jest.fn();
    const onClose = jest.fn();
    render(
      <DashTeamPage
        initialTab="settings"
        onDirtyChange={onDirtyChange}
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getAllByTestId("dash-team-role")[0].querySelector("button"),
    );
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("make-dirty"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    // Another tab: asks; Keep editing stays.
    fireEvent.click(screen.getByText("Conversation"));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("bot-detail")).toBeInTheDocument();
    // Close: asks; Discard closes and clears the host's flag.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  test("role rows say the model and when it last ran", () => {
    mockTeam = [{ ...ROLES[1], runsOn: "claude-opus-4-8" }];
    render(<DashTeamPage initialTab="settings" />);
    expect(screen.getByTestId("dash-team-role")).toHaveTextContent(
      "Plans · Opus",
    );
  });
});

test("roleLine: the job, the model, and when it last ran in words", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const bot = { summary: "Plans", runsOn: "claude-opus-4-8" };
  const at = (min) => ({ endedAt: new Date(now - min * 60000).toISOString() });
  expect(roleLine(bot, null, now)).toBe("Plans · Opus");
  expect(roleLine(bot, at(0), now)).toBe("Plans · Opus · last ran just now");
  expect(roleLine(bot, at(11), now)).toBe("Plans · Opus · last ran 11m ago");
  expect(roleLine(bot, at(180), now)).toBe("Plans · Opus · last ran 3h ago");
  expect(roleLine(bot, at(60 * 24 * 30), now)).toMatch(
    /last ran on \w{3} \d+$/,
  );
});
