/**
 * CreateBuildingStep — building an approved plan (create-entry CRE-004
 * AC1/AC3/AC6, CRE-012 AC3; phase 4d-1).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CreateBuildingStep } from "./CreateBuildingStep";

// The Providers screen (Connect) pulls in the whole app.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: (props) => (
    <div data-testid="providers-section">
      {String(props.initialProviderType)}
    </div>
  ),
}));

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

test("a failed build shows why and the Builder's answer (Create build fixes)", () => {
  const failedBuild = {
    ...finished,
    steps: [
      {
        id: "build:1",
        kind: "build",
        role: "builder",
        label: "Build Index Compare",
        status: "failed",
        error:
          "the Builder didn't build it — build_widget said: Line 3: x is not defined",
        detail: "I tried twice; the import of the config is still wrong.",
      },
    ],
  };
  render(<CreateBuildingStep buildId="b1" initialState={failedBuild} />);
  expect(screen.getByTestId("building-step-error")).toHaveTextContent(
    "build_widget said: Line 3: x is not defined",
  );
  expect(
    screen.getByText(/the import of the config is still wrong/),
  ).toBeInTheDocument();
});

test("saved bots are offered as Run now — never run on their own (4d-2)", async () => {
  window.mainApi.bots.run = jest.fn().mockResolvedValue({ runId: "r1" });
  const withBots = {
    ...finished,
    status: "done",
    bots: { 0: { id: "bot_9", name: "Greeter" } },
    steps: [
      {
        id: "bot:0",
        kind: "bot",
        role: "dash",
        label: "Save the Greeter bot",
        status: "done",
        detail: "Greeter",
      },
      {
        id: "trigger:0:0",
        kind: "trigger",
        role: "dash",
        label: "Start Greeter when Ask sends askClicked",
        status: "done",
      },
    ],
  };
  render(<CreateBuildingStep buildId="b1" initialState={withBots} />);
  expect(window.mainApi.bots.run).not.toHaveBeenCalled();
  expect(screen.getAllByTestId("building-step")[1].textContent).toMatch(
    /Dash.*Start Greeter when Ask sends askClicked.*no AI/,
  );
  fireEvent.click(screen.getByText("Run Greeter now"));
  expect(window.mainApi.bots.run).toHaveBeenCalledWith("bot_9");
  // Bots a build saves start paused (Phase 1d): a pass offers Turn on.
  expect(
    await screen.findByText("It worked — turn it on?"),
  ).toBeInTheDocument();
});

test("no Run now while building", () => {
  render(
    <CreateBuildingStep
      buildId="b1"
      initialState={{
        ...running,
        bots: { 0: { id: "bot_9", name: "Greeter" } },
      }}
    />,
  );
  expect(screen.queryByText("Run Greeter now")).toBeNull();
});

test("an automatic fix says which try it is, then that it was fixed (Create build fixes 2)", () => {
  const fixing = {
    status: "running",
    steps: [
      {
        id: "build:1",
        kind: "build",
        role: "builder",
        label: "Build Hello",
        status: "running",
        fixTry: 1,
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
  const { unmount } = render(
    <CreateBuildingStep buildId="b1" initialState={fixing} />,
  );
  expect(screen.getByTestId("building-step-fixing")).toHaveTextContent(
    "Fixing what went wrong · try 1 of 2",
  );
  unmount();
  const fixed = {
    ...fixing,
    status: "done",
    steps: [
      {
        ...fixing.steps[0],
        status: "done",
        fixTry: 2,
        detail: "@ai-built/hello",
      },
    ],
  };
  render(<CreateBuildingStep buildId="b1" initialState={fixed} />);
  expect(
    screen.getByText(/fixed by the Builder after 2 tries · @ai-built\/hello/),
  ).toBeInTheDocument();
});

describe("readable steps (Create build fixes 2)", () => {
  test("the steps use the theme's main text colour; details stay muted", () => {
    render(
      <CreateBuildingStep
        buildId="b1"
        initialState={finished}
        estimate={null}
      />,
    );
    // No theme in tests → the fallbacks: main text-gray-200, muted text-gray-400.
    expect(screen.getByTestId("create-building")).toHaveClass("text-gray-200");
    expect(screen.getAllByTestId("building-step-usage")[0]).toHaveClass(
      "text-gray-400",
    );
  });

  test("full size, who did it and the AI used share the step's line", () => {
    render(
      <CreateBuildingStep
        buildId="b1"
        initialState={finished}
        estimate={null}
      />,
    );
    const head = screen.getAllByTestId("building-step-head")[1];
    expect(head).toHaveTextContent("Build Hello");
    expect(head).toContainElement(
      screen.getAllByTestId("building-step-usage")[1],
    );
  });

  test("in the dock, the AI used goes on its own line so the step name has room", () => {
    render(
      <CreateBuildingStep
        buildId="b1"
        initialState={finished}
        estimate={null}
        compact
      />,
    );
    const head = screen.getAllByTestId("building-step-head")[1];
    const usage = screen.getAllByTestId("building-step-usage")[1];
    expect(head).toHaveTextContent("Build Hello");
    expect(head).not.toContainElement(usage);
    expect(usage).toHaveTextContent(/Sonnet · 18\.4k tokens/);
  });
});

// Consolidation Phase 1d: bots a build saves start paused; trying one is a
// test run, and a pass offers Turn on.
describe("Try the bots — paused bots (Phase 1d)", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "CreateBuildingStep.js"),
    "utf8",
  );
  it("a skipped run says why; a pass offers Turn on", () => {
    expect(src).toMatch(/res && res\.skipped/);
    expect(src).toMatch(/It worked — turn it on\?/);
    expect(src).toMatch(/resumeBot\(/);
    expect(src).toMatch(/start paused/);
  });
});
