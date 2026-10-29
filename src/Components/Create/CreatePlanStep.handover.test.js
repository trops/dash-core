/**
 * A plan handed over from the Dash team chat (AskStep → Create): the
 * conversation shows as it was, the Planner isn't asked again, its questions
 * are taps, and the next answer carries what was said in the chat.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CreatePlanStep } from "./CreatePlanStep";
import { handoverSeed } from "./askThread";

const mockRunTeamRole = jest.fn();
jest.mock("../../utils/teamRoles", () => {
  const actual = jest.requireActual("../../utils/teamRoles");
  return { ...actual, runTeamRole: (...a) => mockRunTeamRole(...a) };
});
jest.mock("./CreateBuildingStep", () => ({
  CreateBuildingStep: () => <div data-testid="building-stub" />,
}));
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const CHAT = [
  { who: "you", text: "I want a Home Assistant dashboard" },
  {
    who: "planner",
    text: "A few choices before I write the full plan:",
    meta: "Opus · 1k tokens",
  },
];
const ASKING = {
  summary: "Home dashboard",
  questions: [{ question: "Include sprinklers?", options: ["Yes", "No"] }],
  pieces: [],
};
const READY = {
  summary: "Home dashboard",
  pieces: [
    {
      kind: "widget",
      name: "Rules",
      source: "yours",
      package: "@trops/algolia",
    },
  ],
  estimate: { build: "small" },
};

function setup(plan) {
  mockRunTeamRole.mockReset();
  mockRunTeamRole.mockResolvedValue({ status: "completed", output: "Sure." });
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      listDashTeam: jest.fn().mockResolvedValue([]),
    },
  };
  render(<CreatePlanStep prompt="" seed={handoverSeed(CHAT, plan)} />);
}

afterEach(() => {
  delete window.mainApi;
});

test("questions before a plan: the chat shows as it was, the questions are taps", async () => {
  setup(ASKING);
  expect(
    await screen.findByText("I want a Home Assistant dashboard"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("A few choices before I write the full plan:"),
  ).toBeInTheDocument();
  expect(await screen.findByTestId("plan-questions")).toHaveTextContent(
    "Include sprinklers?",
  );
  expect(mockRunTeamRole).not.toHaveBeenCalled();
  expect(screen.queryByText(/Ready to build as it is/)).toBeNull();
  // Saved whole from the start, under what was first asked — a reopen from
  // Recent shows it, rather than asking the Planner again.
  expect(window.mainApi.bots.saveCreateRecent.mock.calls[0][0]).toEqual({
    prompt: "I want a Home Assistant dashboard",
    conversation: { messages: CHAT, plan: ASKING },
  });

  fireEvent.click(screen.getByRole("button", { name: "No" }));
  await waitFor(() => expect(mockRunTeamRole).toHaveBeenCalled());
  const request = mockRunTeamRole.mock.calls[0][1];
  expect(request).toMatch(/^Earlier in this conversation:\nMe: I want a Home/);
  expect(request).toContain("The plan as it stands");
  expect(request).toContain("Now: Include sprinklers? — No");
});

test("a finished plan: Build is right there, nothing asked again", async () => {
  setup(READY);
  const note = await screen.findByTestId("plan-ready");
  expect(note.parentElement.querySelector("button")).not.toBeDisabled();
  expect(mockRunTeamRole).not.toHaveBeenCalled();
});

test("a plan from the lead workspace keeps what was done before building there (release 3a)", async () => {
  mockRunTeamRole.mockReset();
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_1" }),
      listDashTeam: jest.fn().mockResolvedValue([]),
    },
  };
  const plan = {
    ...READY,
    beforeBuilding: [
      { kind: "approve", what: "Turn on the lights-off bot" },
      { kind: "approve", what: "Allow the weekly report" },
    ],
  };
  render(
    <CreatePlanStep
      prompt=""
      seed={{
        plan,
        label: "Home",
        checks: { "approve:Turn on the lights-off bot": "done" },
      }}
    />,
  );
  const items = await screen.findAllByTestId("checklist-item");
  expect(items[0]).toHaveTextContent("Done");
  expect(items[1]).toHaveTextContent("To do");
  // The Planner isn't asked again: the plan is ready as it is.
  expect(mockRunTeamRole).not.toHaveBeenCalled();
});
