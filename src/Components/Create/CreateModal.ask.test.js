/**
 * Ask a question inside Create (consolidation Phase 2a — it was the right
 * rail's Create panel, whose "+" is gone): to the Dash team or a team lead;
 * it opens as a step here, and an answer can open as a plan.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));
jest.mock("./AskStep", () => ({
  AskStep: ({ question, recentId, recipient, onOpenPlan }) => (
    <div data-testid="ask-step">
      <span data-testid="ask-question">{question}</span>
      <span data-testid="ask-recent">{String(recentId)}</span>
      <span data-testid="ask-to">
        {recipient ? recipient.leadName : "Dash team"}
      </span>
      <button onClick={() => onOpenPlan({ plan: { summary: "From Ask" } })}>
        Open as a plan
      </button>
    </div>
  ),
}));
jest.mock("./CreatePlanStep", () => ({
  CreatePlanStep: ({ seed }) => (
    <div data-testid="plan-step">
      {seed && seed.plan ? seed.plan.summary : "no seed"}
    </div>
  ),
  withoutPlan: (t) => t,
}));

const LEAD = {
  botId: "lead_7",
  leadName: "Kitchen Lead",
  dashboardName: "Kitchen Sink",
};

function setup({ recent = [], leads = [] } = {}) {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    drafts: { list: jest.fn().mockResolvedValue([]) },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listLeads: jest.fn().mockResolvedValue(leads),
      listCreateRecent: jest.fn().mockResolvedValue(recent),
      onCreateRecent: jest.fn(() => 9),
      removeListener: jest.fn(),
    },
  };
  const setIsOpen = jest.fn();
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: {}, settings: {} }}>
        <CreateModal open setIsOpen={setIsOpen} initialType="auto" />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return { setIsOpen };
}

const askBox = () =>
  screen.getByRole("textbox", { name: "Ask about your dashboards and bots" });

afterEach(() => {
  delete window.mainApi;
});

test("the start screen has an Ask box; a question opens as a step here", () => {
  setup();
  expect(screen.getByTestId("create-ask")).toHaveTextContent(
    "Or ask a question",
  );
  fireEvent.change(askBox(), { target: { value: "Which bots ran today?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByTestId("ask-question")).toHaveTextContent(
    "Which bots ran today?",
  );
  expect(screen.getByTestId("ask-to")).toHaveTextContent("Dash team");
  // The header says where you are, with a way back.
  expect(
    screen.getByRole("navigation", { name: "Where you are" }),
  ).toHaveTextContent("Which bots ran today?");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.queryByTestId("ask-step")).toBeNull();
  expect(askBox()).toBeInTheDocument();
});

test("an answer that plans something opens as a plan, in Create", () => {
  setup();
  fireEvent.change(askBox(), { target: { value: "Add a digest bot" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.click(screen.getByText("Open as a plan"));
  expect(screen.getByTestId("plan-step")).toHaveTextContent("From Ask");
  expect(screen.queryByTestId("ask-step")).toBeNull();
});

test("To: sends it to a team lead when there are leads", async () => {
  setup({ leads: [LEAD] });
  // The To: picker shows once the leads load.
  await waitFor(() => expect(screen.getByText("To:")).toBeInTheDocument());
  const to = screen.getByRole("combobox");
  fireEvent.change(to, { target: { value: "lead_7" } });
  fireEvent.change(askBox(), { target: { value: "What failed?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByTestId("ask-to")).toHaveTextContent("Kitchen Lead");
});

test("a question in Recent opens here, not in a side panel", async () => {
  const folds = [];
  const onFold = (e) => folds.push(e.detail);
  window.addEventListener("dash:create-fold", onFold);
  const { setIsOpen } = setup({
    recent: [
      {
        id: "ask_1",
        kind: "question",
        title: "Which bots ran?",
        status: "answered",
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  fireEvent.click(await screen.findByText("Which bots ran?"));
  window.removeEventListener("dash:create-fold", onFold);
  await waitFor(() =>
    expect(screen.getByTestId("ask-recent")).toHaveTextContent("ask_1"),
  );
  expect(folds).toEqual([]);
  expect(setIsOpen).not.toHaveBeenCalledWith(false);
});
