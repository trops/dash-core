/**
 * CreateBuildingStep — after a step fails or waits (create-entry CRE-004
 * AC4/AC5, phase 4d-3): Let Builder fix it, Try again, Connect <provider>
 * for waiting steps, Edit plan and Remove what was built.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { CreateBuildingStep, waitingProviders } from "./CreateBuildingStep";

// The Providers screen (Connect) pulls in the whole app.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: (props) => (
    <div data-testid="providers-section">
      {String(props.initialProviderType)}
    </div>
  ),
}));

const step = (over) => ({ role: "dash", status: "done", ...over });

const failed = {
  status: "finished-with-problems",
  dashboard: { id: "77", name: "Ask Test" },
  steps: [
    step({
      id: "install:0",
      kind: "install",
      label: "Install Calendar",
      status: "failed",
      error: "download failed",
      canRetry: true,
      canFix: false,
    }),
    step({
      id: "build:1",
      kind: "build",
      role: "builder",
      label: "Build Ask",
      detail: "@ai-built/ask",
    }),
    step({
      id: "check:1",
      kind: "check",
      role: "checker",
      label: "Check Ask",
      status: "failed",
      error: "the Checker found problems",
      canFix: true,
      fixesLeft: 2,
    }),
    step({
      id: "place:1",
      kind: "place",
      label: "Place Ask",
      status: "skipped",
      error: "Check Ask didn't finish",
    }),
  ],
  bots: { 0: { id: "bot_1", name: "Greeter" } },
  built: {
    dashboard: { id: "77", name: "Ask Test" },
    bots: [{ id: "bot_1", name: "Greeter" }],
    widgets: ["@ai-built/ask"],
    updated: [],
    installs: ["@trops/google-calendar"],
  },
  totals: { tokens: 1000, includedInPlan: true },
};

const waiting = {
  status: "waiting-for-providers",
  dashboard: { id: "77", name: "Ask Test" },
  steps: [
    step({
      id: "bot:0",
      kind: "bot",
      label: "Save the Greeter bot",
      status: "needs-provider",
      waitingFor: ["gmail"],
    }),
    step({
      id: "results:0",
      kind: "results",
      label: "Show Greeter's results",
      status: "needs-provider",
      waitingFor: ["gmail"],
    }),
  ],
  built: { dashboard: { id: "77", name: "Ask Test" }, bots: [], widgets: [] },
  totals: { tokens: 0, includedInPlan: true },
};

beforeEach(() => {
  window.mainApi = {
    bots: {
      onPlanBuild: jest.fn(() => 3),
      removeListener: jest.fn(),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      fixPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      retryPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      resumePlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      removePlanBuild: jest.fn().mockResolvedValue({
        removed: {
          dashboard: "Ask Test",
          bots: ["Greeter"],
          widgets: ["@ai-built/ask"],
        },
        kept: { installs: ["@trops/google-calendar"], updated: [] },
        problems: [],
      }),
    },
    mcp: { getCatalog: jest.fn().mockResolvedValue({ catalog: [] }) },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("a failed step offers Let Builder fix it or Try again", async () => {
  render(<CreateBuildingStep buildId="b1" initialState={failed} />);
  const options = screen.getAllByTestId("building-step-options");
  expect(options).toHaveLength(2);
  expect(options[0]).toHaveTextContent("Try again");
  expect(options[0]).not.toHaveTextContent("Let Builder fix it");
  expect(options[1]).toHaveTextContent("Let Builder fix it");
  fireEvent.click(screen.getByText("Let Builder fix it"));
  await waitFor(() =>
    expect(window.mainApi.bots.fixPlanBuild).toHaveBeenCalledWith(
      "b1",
      "check:1",
    ),
  );
  fireEvent.click(screen.getByText("Try again"));
  await waitFor(() =>
    expect(window.mainApi.bots.retryPlanBuild).toHaveBeenCalledWith(
      "b1",
      "install:0",
    ),
  );
});

test("the Builder's last try, then over to the user", () => {
  const last = JSON.parse(JSON.stringify(failed));
  last.steps[2].fixesLeft = 1;
  const { unmount } = render(
    <CreateBuildingStep buildId="b1" initialState={last} />,
  );
  expect(screen.getByText("The Builder's last try.")).toBeInTheDocument();
  unmount();
  const done = JSON.parse(JSON.stringify(failed));
  Object.assign(done.steps[2], {
    canFix: false,
    fixesLeft: 0,
    fixesUsedUp: true,
  });
  render(<CreateBuildingStep buildId="b1" initialState={done} />);
  expect(screen.queryByText("Let Builder fix it")).toBeNull();
  expect(screen.getByText(/The Builder tried twice/)).toBeInTheDocument();
});

test("a fix that can't start says why", async () => {
  window.mainApi.bots.fixPlanBuild.mockResolvedValue({
    error: "The build is still running.",
  });
  render(<CreateBuildingStep buildId="b1" initialState={failed} />);
  fireEvent.click(screen.getByText("Let Builder fix it"));
  expect(await screen.findByTestId("building-action-error")).toHaveTextContent(
    "The build is still running.",
  );
});

test("Edit plan hands back to the plan", () => {
  const onEditPlan = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={failed}
      onEditPlan={onEditPlan}
    />,
  );
  fireEvent.click(screen.getByText("Edit plan"));
  expect(onEditPlan).toHaveBeenCalled();
});

test("Remove what was built confirms what goes and what stays", async () => {
  const onRemoved = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={failed}
      onRemoved={onRemoved}
    />,
  );
  fireEvent.click(screen.getByText("Remove what was built"));
  const summary = screen.getByTestId("remove-summary");
  expect(summary).toHaveTextContent('The "Ask Test" dashboard');
  expect(summary).toHaveTextContent("The Greeter bot");
  expect(summary).toHaveTextContent("The @ai-built/ask widget");
  expect(summary).toHaveTextContent("@trops/google-calendar — stays installed");
  expect(window.mainApi.bots.removePlanBuild).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  expect(window.mainApi.bots.removePlanBuild).toHaveBeenCalledWith("b1");
  expect(onRemoved.mock.calls[0][0].removed.dashboard).toBe("Ask Test");
});

test("waiting for a provider: says so, Connect, then the waiting steps run", async () => {
  render(<CreateBuildingStep buildId="b1" initialState={waiting} />);
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "Built — waiting for Gmail",
  );
  expect(screen.getAllByTestId("building-step-waiting")[0]).toHaveTextContent(
    "waiting for Gmail",
  );
  expect(screen.queryByTestId("building-step-error")).toBeNull();
  fireEvent.click(screen.getByText("Connect Gmail"));
  expect(await screen.findByTestId("providers-section")).toHaveTextContent(
    "gmail",
  );
  fireEvent.click(screen.getByText("Done"));
  await waitFor(() =>
    expect(window.mainApi.bots.resumePlanBuild).toHaveBeenCalledWith("b1"),
  );
});

test("leftovers from an edited plan are named", () => {
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={{
        ...failed,
        leftovers: [{ kind: "widget", name: "Calendar" }],
      }}
    />,
  );
  expect(screen.getByTestId("building-leftovers")).toHaveTextContent(
    "Still on the dashboard from before: Calendar",
  );
});

test("waitingProviders lists each provider once", () => {
  expect(waitingProviders(waiting.steps)).toEqual(["gmail"]);
  expect(waitingProviders(failed.steps)).toEqual([]);
});

test("nothing to recover from after a clean build", () => {
  act(() => {
    render(
      <CreateBuildingStep
        buildId="b1"
        initialState={{ ...failed, status: "done", steps: [] }}
        onEditPlan={() => {}}
      />,
    );
  });
  expect(screen.queryByTestId("building-recover")).toBeNull();
});

test("an interrupted build (the app closed) offers Continue building, not step fixes", () => {
  const onContinue = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={{ ...failed, status: "interrupted" }}
      onContinue={onContinue}
      onEditPlan={() => {}}
    />,
  );
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "Interrupted — the app closed while it was building",
  );
  expect(screen.queryByText("Let Builder fix it")).toBeNull();
  expect(screen.queryByText("Try again")).toBeNull();
  expect(screen.getByText("Edit plan")).toBeInTheDocument();
  expect(screen.getByText("Remove what was built")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Continue building"));
  expect(onContinue).toHaveBeenCalled();
});
