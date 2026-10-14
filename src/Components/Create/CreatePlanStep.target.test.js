/**
 * CreatePlanStep — a plan that changes a dashboard the user already has
 * (create-entry 5e-2b), and saying plainly that nothing is made until the
 * user presses the button.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreatePlanStep, removedText } from "./CreatePlanStep";

// The Providers screen (Connect) pulls in the whole app.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

const team = [{ id: "b_planner", role: "planner", name: "Planner" }];

const record = (plan) => ({
  status: "completed",
  model: "claude-opus-4-8",
  usage: { inputTokens: 100, outputTokens: 50 },
  cost: { usd: 0, includedInPlan: true, estimated: false },
  output: `Here's the plan.\n<plan>${JSON.stringify(plan)}</plan>`,
});

const targeted = {
  summary: "Add a clock to Slack Pack and switch its theme",
  dashboard: { id: "17", name: "Slack Pack" },
  pieces: [
    {
      kind: "widget",
      name: "Clock",
      source: "yours",
      package: "@trops/clock",
      sample: ["9:41"],
    },
    { kind: "theme", name: "Nordic Frost", source: "yours" },
  ],
  checks: ["The clock shows on Slack Pack"],
  estimate: { build: "no AI" },
};

const fresh = {
  summary: "A clock dashboard",
  pieces: [
    {
      kind: "widget",
      name: "Clock",
      source: "yours",
      package: "@trops/clock",
      sample: ["9:41"],
    },
  ],
  checks: ["The clock shows"],
  estimate: { build: "no AI" },
};

function setup(plan, props = {}, { slow = false } = {}) {
  let finish;
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn(() =>
        slow
          ? new Promise((resolve) => {
              finish = () => resolve(record(plan));
            })
          : Promise.resolve(record(plan)),
      ),
      startPlanBuild: jest.fn().mockResolvedValue({
        buildId: "build_1",
        state: { status: "running", steps: [], built: {} },
      }),
      onPlanBuild: jest.fn(() => 2),
      getPlanBuild: jest.fn().mockResolvedValue(null),
    },
  };
  render(<CreatePlanStep prompt="add a clock" {...props} />);
  return { api: window.mainApi.bots, finish: () => finish && finish() };
}

afterEach(() => {
  delete window.mainApi;
  delete globalThis.__dashboardDirtyId;
});

test("while it works, the Planner says it's drafting a plan to review", async () => {
  const { finish } = setup(fresh, {}, { slow: true });
  expect(
    await screen.findByText("Drafting a plan for you to review…"),
  ).toBeInTheDocument();
  finish();
  await screen.findByTestId("plan-card");
});

test("a new dashboard's plan says it isn't built yet", async () => {
  setup(fresh);
  expect(await screen.findByTestId("plan-status")).toHaveTextContent(
    "Plan · not built yet",
  );
  expect(screen.getByTestId("plan-ready")).toHaveTextContent(
    "nothing has been built or installed yet",
  );
  expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
  expect(screen.getByTestId("plan-preview")).toBeInTheDocument();
});

test("a plan for a dashboard you have: what changes, where, and nothing until you press it", async () => {
  setup(targeted);
  expect(await screen.findByTestId("plan-status")).toHaveTextContent(
    "Changes to Slack Pack · not made yet",
  );
  expect(screen.getByTestId("plan-counts")).toHaveTextContent(
    "Adds 1 widget to Slack Pack and applies the Nordic Frost theme",
  );
  expect(screen.getByText("One of your saved themes")).toBeInTheDocument();
  expect(screen.getByText("What it adds")).toBeInTheDocument();
  // The sketch draws a new dashboard's grid — not this one.
  expect(screen.queryByTestId("plan-preview")).toBeNull();
  expect(screen.getByTestId("plan-ready")).toHaveTextContent(
    "nothing on Slack Pack changes until you press this",
  );
  expect(
    screen.getByRole("button", { name: "Make these changes" }),
  ).toBeInTheDocument();
});

test("unsaved edits on that dashboard: it says so and doesn't start", async () => {
  const { api } = setup(targeted);
  globalThis.__dashboardDirtyId = 17;
  fireEvent.click(
    await screen.findByRole("button", { name: "Make these changes" }),
  );
  expect(await screen.findByTestId("plan-ready")).toHaveTextContent(
    "Save or cancel your edits to Slack Pack first, then press Make these changes again.",
  );
  expect(api.startPlanBuild).not.toHaveBeenCalled();
  // Saved: it starts.
  globalThis.__dashboardDirtyId = null;
  fireEvent.click(screen.getByRole("button", { name: "Make these changes" }));
  await waitFor(() => expect(api.startPlanBuild).toHaveBeenCalled());
});

test("edits on another dashboard don't hold it up", async () => {
  const { api } = setup(targeted);
  globalThis.__dashboardDirtyId = 99;
  fireEvent.click(
    await screen.findByRole("button", { name: "Make these changes" }),
  );
  await waitFor(() => expect(api.startPlanBuild).toHaveBeenCalled());
});

test("the Planner is told which dashboard the user is looking at", async () => {
  const { api } = setup(fresh, { openDashboardId: 17 });
  await screen.findByTestId("plan-card");
  expect(api.run.mock.calls[0][1]).toBe(
    "add a clock\n\n(The user is looking at the dashboard with id 17.)",
  );
  // What the user typed is what shows.
  expect(screen.getByText("add a clock")).toBeInTheDocument();
});

test("removedText for a dashboard you have says what came off and the theme", () => {
  expect(
    removedText({
      removed: {
        from: "Slack Pack",
        placed: 1,
        bots: ["Greeter"],
        theme: "Dusk",
      },
      problems: [],
    }),
  ).toBe("Took 1 widget and 1 bot off Slack Pack and put its theme back.");
  expect(
    removedText({ removed: { from: "Slack Pack", theme: "the app's theme" } }),
  ).toBe("Put Slack Pack's theme back.");
  expect(removedText({ removed: { from: "Slack Pack", placed: 0 } })).toBe(
    "Nothing was left to take off Slack Pack.",
  );
});

test("unsaved edits are caught before any install is walked through", async () => {
  setup({
    ...targeted,
    pieces: [
      {
        kind: "widget",
        name: "Digital Clock",
        source: "registry",
        package: "@trops/clock",
      },
    ],
    beforeBuilding: [{ kind: "install", what: "@trops/clock" }],
  });
  globalThis.__dashboardDirtyId = "17";
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Approve 1 install & make these changes",
    }),
  );
  expect(await screen.findByTestId("plan-ready")).toHaveTextContent(
    "Save or cancel your edits to Slack Pack first",
  );
  expect(screen.queryByTestId("install-review")).toBeNull();
});
