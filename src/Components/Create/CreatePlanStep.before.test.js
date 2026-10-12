/**
 * CreatePlanStep — Before building (phase 4b; CRE-003 AC2/AC3, CRE-009
 * AC4/AC5): the checklist, the Build walk-through, Swap and Remove.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: (props) => (
    <div data-testid="providers-section">
      {String(props.initialProviderType)}:{String(props.initialProviderClass)}
    </div>
  ),
}));

import { CreatePlanStep } from "./CreatePlanStep";

const team = [
  { id: "b_planner", role: "planner", name: "Planner" },
  { id: "b_scout", role: "scout", name: "Scout" },
];
const planText = `Plan.
<plan>{"summary":"Brief","pieces":[{"kind":"widget","name":"Gmail Inbox","source":"registry","package":"@trops/gmail","providers":["gmail"]},{"kind":"widget","name":"Slack channels","source":"ai-built","package":"@ai-built/slack-pack","providers":["slack"]},{"kind":"layout","name":"Brief","source":"new"}],"beforeBuilding":[],"checks":["works"],"access":["Reads only"],"estimate":{"build":"?"}}</plan>`;

function setup({
  scoutOutput = "<matches>[]</matches>",
  providers = { s: { type: "slack" } },
} = {}) {
  const calls = [];
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn(async (botId, prompt, cont) => {
        calls.push({ botId, prompt, cont });
        return botId === "b_scout"
          ? { status: "completed", output: scoutOutput }
          : { status: "completed", output: planText };
      }),
    },
    mcp: {
      getCatalog: jest.fn().mockResolvedValue({ catalog: [{ id: "gmail" }] }),
    },
    registry: {
      fetchPackageManifest: jest.fn().mockResolvedValue({
        packageId: "@trops/gmail",
        version: "1.0.0",
        permissions: { mcp: { gmail: { tools: ["search_messages"] } } },
      }),
    },
  };
  const refreshProviders = jest.fn().mockResolvedValue();
  render(
    <AppContext.Provider value={{ providers, refreshProviders }}>
      <CreatePlanStep prompt="a brief" />
    </AppContext.Provider>,
  );
  return { calls, refreshProviders };
}

afterEach(() => {
  delete window.mainApi;
});

test("the counts line and the checklist from the plan", async () => {
  setup();
  await screen.findByTestId("plan-card");
  expect(screen.getByTestId("plan-counts")).toHaveTextContent(
    "2 widgets: 1 from the registry, 1 AI-built · 1 new layout",
  );
  const items = screen
    .getAllByTestId("checklist-item")
    .map((e) => e.textContent);
  expect(items[0]).toMatch(/Install Gmail Inbox · @trops\/gmail/);
  expect(items[1]).toMatch(/Connect Gmail/);
  expect(items.length).toBe(2); // Slack is already connected
});

test("Build walks through: review the install, approve, then connect", async () => {
  const { refreshProviders } = setup();
  await screen.findByTestId("plan-card");
  fireEvent.click(screen.getByText("Connect Gmail, approve 1 install & build"));
  expect(await screen.findByTestId("install-review")).toBeInTheDocument();
  expect(await screen.findByText("gmail: search_messages")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Approve"));
  // gmail is in the MCP catalog → the catalog opens with it picked.
  expect(await screen.findByTestId("providers-section")).toHaveTextContent(
    "gmail:mcp",
  );
  fireEvent.click(screen.getByText("Done"));
  await waitFor(() => expect(refreshProviders).toHaveBeenCalled());
  expect(screen.getByText("Connect Gmail & build")).toBeInTheDocument();
});

test("when nothing's open, Build starts the build and shows the steps (4d)", async () => {
  setup({ providers: { s: { type: "slack" }, g: { type: "gmail" } } });
  const startPlanBuild = jest.fn().mockResolvedValue({
    buildId: "build_1",
    state: {
      status: "running",
      steps: [
        {
          id: "dashboard",
          kind: "dashboard",
          role: "dash",
          label: 'Create the "Brief" dashboard',
          status: "running",
        },
      ],
      totals: { tokens: 0, includedInPlan: true },
    },
  });
  Object.assign(window.mainApi.bots, {
    startPlanBuild,
    getPlanBuild: jest.fn().mockResolvedValue(null),
    onPlanBuild: jest.fn(() => 9),
  });
  await screen.findByTestId("plan-card");
  fireEvent.click(screen.getByText("Approve 1 install & build"));
  fireEvent.click(await screen.findByText("Approve"));
  expect(await screen.findByTestId("create-building")).toBeInTheDocument();
  expect(startPlanBuild).toHaveBeenCalledWith(
    expect.objectContaining({ summary: "Brief" }),
    {},
  );
  expect(screen.getByText('Create the "Brief" dashboard')).toBeInTheDocument();
});

test("Skip this piece removes it from the plan", async () => {
  setup();
  await screen.findByTestId("plan-card");
  fireEvent.click(screen.getByText("Review & approve"));
  fireEvent.click(await screen.findByText("Skip this piece"));
  expect(screen.queryByText("Gmail Inbox")).toBeNull();
  expect(screen.getByTestId("plan-counts")).toHaveTextContent(
    "1 widget: 1 AI-built",
  );
});

test("Remove and Swap edit the plan, and the next message tells the Planner", async () => {
  const { calls } = setup({
    scoutOutput:
      'Found.<matches>[{"source":"AI-built","name":"Inbox count","package":"@ai-built/inboxcount","why":"a count"}]</matches>',
  });
  await screen.findByTestId("plan-card");
  fireEvent.click(screen.getAllByText("Swap…")[0]);
  fireEvent.click(await screen.findByText("Use"));
  expect(screen.getByText("Inbox count")).toBeInTheDocument();
  // The Gmail install is gone (Inbox count is already yours).
  expect(screen.queryByText(/Install Gmail Inbox/)).toBeNull();
  fireEvent.click(screen.getAllByText("Remove")[2]);
  const box = screen.getByRole("textbox", { name: "Reply to the Planner" });
  fireEvent.change(box, { target: { value: "Looks good" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(calls[calls.length - 1].botId).toBe("b_planner"));
  expect(calls[calls.length - 1].prompt).toBe(
    "(I changed the plan: swapped Gmail Inbox for Inbox count; removed Brief. Keep these changes.)\nLooks good",
  );
});

test("no registry sign-in: the review falls back to the registry listing", async () => {
  setup();
  window.mainApi.registry.fetchPackageManifest = jest
    .fn()
    .mockRejectedValue(new Error("Authentication required"));
  window.mainApi.registry.getPackage = jest.fn().mockResolvedValue({
    version: "2.0.0",
    widgets: [
      {
        name: "GmailInbox",
        permissions: { gmail: { tools: ["list_messages"] } },
      },
    ],
  });
  await screen.findByTestId("plan-card");
  fireEvent.click(screen.getByText("Review & approve"));
  expect(await screen.findByText("gmail: list_messages")).toBeInTheDocument();
  expect(screen.getByTestId("install-review")).toHaveTextContent(
    "(from the registry listing)",
  );
});

test("a planned bot shows what starts it and its instructions on demand (4d-2)", async () => {
  const botPlan =
    '<plan>{"summary":"Ask","pieces":[{"kind":"widget","name":"Ask button","source":"new","events":["askClicked"]},{"kind":"bot","name":"Greeter","source":"new","instructions":"Write a one-line greeting.","on":[{"widget":"Ask button","event":"askClicked"}],"showResults":true}],"checks":["it greets"],"access":["Reads nothing"],"estimate":{"build":"?"}}</plan>';
  setup();
  window.mainApi.bots.run.mockImplementation(async (botId) =>
    botId === "b_scout"
      ? { status: "completed", output: "<matches>[]</matches>" }
      : { status: "completed", output: botPlan },
  );
  // The first plan may already be in; ask again for the bot plan.
  await screen.findByTestId("plan-card");
  const box = screen.getByLabelText("Reply to the Planner");
  fireEvent.change(box, { target: { value: "add a greeter" } });
  fireEvent.keyDown(box, { key: "Enter" });
  const row = await screen.findByTestId("plan-bot");
  expect(row).toHaveTextContent("Starts when Ask button sends askClicked");
  expect(row).toHaveTextContent("Uses no providers");
  expect(row).toHaveTextContent("Shown in a Bot results widget");
  expect(screen.queryByTestId("plan-bot-instructions")).toBeNull();
  fireEvent.click(screen.getByText("Show instructions"));
  expect(screen.getByTestId("plan-bot-instructions")).toHaveTextContent(
    "Write a one-line greeting.",
  );
});
