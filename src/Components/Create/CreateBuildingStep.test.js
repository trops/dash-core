/**
 * CreateBuildingStep — building an approved plan (create-entry CRE-004
 * AC1/AC3/AC6, CRE-012 AC3; phase 4d-1).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CreateBuildingStep } from "./CreateBuildingStep";

const running = {
  status: "running",
  steps: [
    {
      id: "install:0",
      kind: "install",
      role: "dash",
      label: "Install Calendar",
      status: "done",
      detail: "trops.gcal.Cal",
    },
    {
      id: "build:1",
      kind: "build",
      role: "builder",
      label: "Build Hello",
      status: "running",
    },
    {
      id: "check:1",
      kind: "check",
      role: "checker",
      label: "Check Hello",
      status: "waiting",
    },
  ],
  totals: { tokens: 0, includedInPlan: true },
};
const finished = {
  status: "finished-with-problems",
  dashboard: { id: "77", name: "Morning Brief" },
  steps: [
    {
      id: "install:0",
      kind: "install",
      role: "dash",
      label: "Install Calendar",
      status: "done",
    },
    {
      id: "build:1",
      kind: "build",
      role: "builder",
      label: "Build Hello",
      status: "done",
      model: "claude-sonnet-4-6",
      tokens: 18400,
      detail: "@ai-built/hello",
    },
    {
      id: "check:1",
      kind: "check",
      role: "checker",
      label: "Check Hello",
      status: "failed",
      model: "claude-sonnet-4-6",
      tokens: 6100,
      error: "the Checker found problems",
      detail: "FAIL code checks\nVERDICT: FAILED",
    },
    {
      id: "place:1",
      kind: "place",
      role: "dash",
      label: "Place Hello",
      status: "skipped",
      error: "Check Hello didn't finish",
    },
  ],
  totals: { tokens: 24500, includedInPlan: true },
};

let listener;
beforeEach(() => {
  listener = null;
  window.mainApi = {
    bots: {
      onPlanBuild: jest.fn((cb) => {
        listener = cb;
        return 3;
      }),
      removeListener: jest.fn(),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      stopPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("shows each step with who did it; Stop asks to stop after this step", async () => {
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={running}
      estimate={{ total: 30000 }}
    />,
  );
  expect(screen.getByTestId("building-status")).toHaveTextContent("Building…");
  const rows = screen.getAllByTestId("building-step").map((r) => r.textContent);
  expect(rows[0]).toMatch(/Dash.*Install Calendar.*no AI/);
  expect(rows[1]).toMatch(/Builder.*Build Hello/);
  fireEvent.click(screen.getByText("Stop"));
  expect(window.mainApi.bots.stopPlanBuild).toHaveBeenCalledWith("b1");
  expect(
    await screen.findByText("Stopping after this step…"),
  ).toBeInTheDocument();
});

test("progress updates arrive; the end shows problems, cost vs estimate and Go to dashboard", () => {
  const onOpenDashboard = jest.fn();
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={running}
      estimate={{ total: 30000 }}
      onOpenDashboard={onOpenDashboard}
    />,
  );
  act(() => listener({ buildId: "other", state: finished }));
  expect(screen.getByTestId("building-status")).toHaveTextContent("Building…");
  act(() => listener({ buildId: "b1", state: finished }));
  expect(screen.getByTestId("building-status")).toHaveTextContent(
    "Built, with problems",
  );
  expect(screen.getByText(/Sonnet · 18\.4k tokens/)).toBeInTheDocument();
  expect(screen.getAllByTestId("building-step-error")[0]).toHaveTextContent(
    "the Checker found problems",
  );
  expect(screen.getByText(/FAIL code checks/)).toBeInTheDocument();
  expect(screen.getByTestId("building-total")).toHaveTextContent(
    "24.5k tokens · estimate ~30.0k · included in your plan",
  );
  expect(screen.queryByText("Stop")).toBeNull();
  fireEvent.click(screen.getByText("Go to dashboard"));
  expect(onOpenDashboard).toHaveBeenCalledWith("77");
});
