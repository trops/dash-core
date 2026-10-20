/**
 * A bot build that's done (consolidation Phase 2c-1): saved paused — Try it
 * now is a test run whose answer shows here, Turn on starts its schedule,
 * Open its page goes to the bot. A build with problems keeps the usual
 * steps and Edit plan.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { CreateBuildingStep } from "./CreateBuildingStep";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const BRIEF = { id: "7", name: "Morning Brief" };
const PIECE = {
  kind: "bot",
  name: "Morning Email Summary",
  schedule: { cron: "30 7 * * 1-5" },
};
const done = {
  status: "done",
  steps: [
    {
      id: "checkbot:0",
      kind: "checkbot",
      role: "dash",
      label: "Check the bot",
      status: "done",
      detail: "schedule is valid",
    },
    {
      id: "bot:0",
      kind: "bot",
      role: "dash",
      label: "Save Morning Email Summary — paused",
      status: "done",
    },
  ],
  bots: { 0: { id: "bot_9", name: "Morning Email Summary" } },
  results: { 0: { widgetId: "w1" } },
  totals: { tokens: 0, includedInPlan: true },
};

function setup(state = done, props = {}) {
  window.mainApi = {
    bots: {
      onPlanBuild: jest.fn(() => 1),
      getPlanBuild: jest.fn().mockResolvedValue({ state }),
      removeListener: jest.fn(),
      getPauseState: jest.fn().mockResolvedValue({ bots: ["bot_9"] }),
      run: jest.fn().mockResolvedValue({
        status: "completed",
        output: "6 unread. Needs a reply: **Dana**.",
        model: "claude-haiku-4-5",
        usage: { inputTokens: 1500, outputTokens: 400 },
      }),
      resumeBot: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
  const onOpenBot = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={state}
      bot={{ where: BRIEF, piece: PIECE }}
      onOpenBot={onOpenBot}
      onEditPlan={jest.fn()}
      {...props}
    />,
  );
  return { onOpenBot };
}

afterEach(() => {
  delete window.mainApi;
});

test("done: it's saved, paused — Try it now, Turn on, Open its page", async () => {
  setup();
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "It's saved, paused",
  );
  // The build is quick — what it did stays in view.
  expect(screen.getByTestId("building-done-so-far")).toHaveTextContent(
    "Check the bot ✓ (schedule is valid) · Save Morning Email Summary — paused ✓",
  );
  expect(
    screen.getByText(
      /Try it once to see what it writes\. Turn it on when you're happy — then it runs every weekday at 7:30/i,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Try it now" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open its page" }),
  ).toBeInTheDocument();
});

test("Try it now runs it once and shows what it wrote", async () => {
  setup();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try it now" }));
  });
  expect(window.mainApi.bots.run).toHaveBeenCalledWith("bot_9");
  const box = screen.getByTestId("bot-test-run");
  expect(box).toHaveTextContent("Test run");
  expect(box).toHaveTextContent("6 unread. Needs a reply: Dana.");
  expect(box).toHaveTextContent(
    "Also shown in its results card on Morning Brief.",
  );
});

test("Turn on starts it; Open its page opens the bot", async () => {
  const { onOpenBot } = setup();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
  });
  expect(window.mainApi.bots.resumeBot).toHaveBeenCalledWith("bot_9");
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "Morning Email Summary is on",
  );
  expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
  // On now — the summary no longer says paused.
  expect(screen.getByTestId("building-done-so-far")).toHaveTextContent(
    "Save Morning Email Summary ✓",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open its page" }));
  expect(onOpenBot).toHaveBeenCalledWith("bot_9");
});

test("a test run that fails, or Turn on that fails, says so as an error", async () => {
  setup();
  window.mainApi.bots.run.mockResolvedValue({
    status: "failed",
    error: "The AI didn't answer.",
  });
  window.mainApi.bots.resumeBot.mockResolvedValue({ error: "not allowed" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try it now" }));
  });
  expect(screen.getByTestId("bot-test-run")).toHaveTextContent(
    "The AI didn't answer.",
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
  });
  expect(screen.getByTestId("bot-done-error")).toHaveTextContent(
    "Couldn't turn it on: not allowed",
  );
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "It's saved, paused",
  );
});

test("a failed check keeps the steps, why, and Edit plan", () => {
  setup({
    ...done,
    status: "finished-with-problems",
    bots: {},
    steps: [
      {
        ...done.steps[0],
        status: "failed",
        error: '"bad" isn\'t a valid schedule',
        canRetry: true,
      },
      { ...done.steps[1], status: "skipped" },
    ],
  });
  expect(screen.queryByTestId("bot-done")).toBeNull();
  expect(screen.getByText('"bad" isn\'t a valid schedule')).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit plan" })).toBeInTheDocument();
});
