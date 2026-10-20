/**
 * Create for one cell (consolidation Phase 2b): opened from an empty cell's
 * Build with AI while editing — widget only, the Scout first, Use in this
 * cell or a Dash team plan, and the finished widget handed to the editor.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import {
  CreateModal,
  cellPieceFromMatch,
  cellStepIndex,
  CELL_STEPS,
} from "./CreateModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));
let mockScoutProps;
jest.mock("./CreateScoutStep", () => ({
  CreateScoutStep: (props) => {
    mockScoutProps = props;
    return <div data-testid="scout">{props.prompt}</div>;
  },
}));
let mockPlanProps;
jest.mock("./CreatePlanStep", () => ({
  CreatePlanStep: (props) => {
    mockPlanProps = props;
    return <div data-testid="plan-step">{props.prompt}</div>;
  },
  withoutPlan: (t) => t,
}));

const CELL = {
  workspaceId: 7,
  gridItemId: 1,
  cellNumber: "2.2",
  pageId: "p1",
  scope: "main",
};

function setup() {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    drafts: { list: jest.fn().mockResolvedValue([]) },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listLeads: jest.fn().mockResolvedValue([]),
      listDashTeam: jest.fn().mockResolvedValue([]),
      listCreateRecent: jest.fn().mockResolvedValue([]),
      onCreateRecent: jest.fn(() => 9),
      removeListener: jest.fn(),
    },
  };
  const setIsOpen = jest.fn();
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: {}, settings: {} }}>
        <CreateModal
          open
          setIsOpen={setIsOpen}
          initialType="widget"
          cell={CELL}
          workspaces={[{ id: 7, name: "Slack Pack" }]}
        />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return { setIsOpen };
}

const describeIt = () =>
  fireEvent.change(
    screen.getByRole("textbox", { name: "What do you want to make?" }),
    { target: { value: "Unread Slack threads" } },
  );

afterEach(() => {
  delete window.mainApi;
});

test("widget only: no Type menu, Ask box, starters or Recent", () => {
  setup();
  expect(screen.getByText("What should this cell show?")).toBeInTheDocument();
  expect(screen.getByTestId("create-cell-type")).toHaveTextContent(
    "Type: Widget",
  );
  expect(screen.queryByTestId("create-ask")).toBeNull();
  expect(screen.getByTestId("create-hint")).toHaveTextContent(
    "You see it running before it's installed",
  );
  expect(screen.queryByText(/Widget Builder/)).toBeNull();
  expect(screen.queryByText("Recent")).toBeNull();
  // The no-AI starts for a widget stay; dashboard ones don't.
  expect(screen.getByTestId("create-no-ai")).toHaveTextContent(
    "Browse widgets",
  );
  expect(screen.queryByText("Blank dashboard")).toBeNull();
});

test("Send: the Scout looks first, in cell mode", () => {
  setup();
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByTestId("scout")).toHaveTextContent("Unread Slack threads");
  expect(mockScoutProps.cell).toBe(true);
  expect(
    screen.getByRole("navigation", { name: "Where you are" }),
  ).toHaveTextContent("Looking first · cell 2.2 on Slack Pack");
});

test("nothing fits: the Dash team plans it for the cell", () => {
  setup();
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  expect(screen.getByTestId("plan-step")).toHaveTextContent(
    "Unread Slack threads",
  );
  expect(mockPlanProps.cell).toEqual({ label: "cell 2.2 on Slack Pack" });
  expect(mockPlanProps.openDashboardId).toBeNull();
});

test("Use in this cell: a build of that one widget, at once", () => {
  setup();
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() =>
    mockScoutProps.onUse({
      source: "Registry",
      name: "Threads Inbox",
      package: "trops/threads-inbox",
    }),
  );
  expect(mockPlanProps.seed).toEqual({
    plan: {
      summary: "Use Threads Inbox in cell 2.2 on Slack Pack",
      pieces: [
        {
          kind: "widget",
          name: "Threads Inbox",
          source: "registry",
          package: "@trops/threads-inbox",
        },
      ],
    },
    request: null,
    label: "Use Threads Inbox in cell 2.2 on Slack Pack",
    autoBuild: true,
  });
});

test("done: the widget goes into the cell, with the picks, and Create closes", () => {
  const { setIsOpen } = setup();
  const placed = [];
  const onPlace = (e) => placed.push(e.detail);
  window.addEventListener("dash:place-widget-in-cell", onPlace);
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  act(() =>
    mockPlanProps.onCellDone({
      component: "ai-built.slackthreads.SlackThreads",
      inputs: { providers: { slack: "Work Slack" }, settings: { rows: 5 } },
    }),
  );
  window.removeEventListener("dash:place-widget-in-cell", onPlace);
  expect(placed).toEqual([
    {
      widgetComponentName: "ai-built.slackthreads.SlackThreads",
      cellNumber: "2.2",
      gridItemId: 1,
      workspaceId: 7,
      pageId: "p1",
      scope: "main",
      userPrefs: { rows: 5 },
      selectedProviders: { slack: "Work Slack" },
    },
  ]);
  expect(setIsOpen).toHaveBeenCalledWith(false);
});

test("closing Create stops a cell build that's still going", () => {
  setup();
  window.mainApi.bots.stopPlanBuild = jest.fn().mockResolvedValue({ ok: true });
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  act(() =>
    mockPlanProps.onState({ recentId: null, busy: false, buildId: "b9" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(window.mainApi.bots.stopPlanBuild).toHaveBeenCalledWith("b9");
});

describe("cellPieceFromMatch", () => {
  it.each([
    [
      "Yours",
      "ai-built.slack-pack.SlackUnreads",
      "yours",
      "@ai-built/slack-pack",
    ],
    ["AI-built", "@ai-built/slack-pack", "ai-built", "@ai-built/slack-pack"],
    ["Registry", "trops/threads-inbox", "registry", "@trops/threads-inbox"],
  ])("%s %s → %s %s", (source, pkg, want, wantPkg) => {
    expect(
      cellPieceFromMatch({ source, name: "W", package: pkg }),
    ).toMatchObject({
      kind: "widget",
      name: "W",
      source: want,
      package: wantPkg,
    });
  });
  it("keeps a component id, which names the very widget", () => {
    expect(
      cellPieceFromMatch({
        source: "Yours",
        name: "Unreads",
        package: "ai-built.slack-pack.SlackUnreads",
      }).component,
    ).toBe("ai-built.slack-pack.SlackUnreads");
    expect(
      cellPieceFromMatch({
        source: "Registry",
        name: "T",
        package: "trops/threads",
      }).component,
    ).toBeUndefined();
  });
  it("no package: none (the Planner works it out)", () => {
    expect(cellPieceFromMatch({ source: "Registry", name: "W" })).toBeNull();
  });
});

describe("the step bar (a wizard for a cell)", () => {
  it("names the six steps", () => {
    expect(CELL_STEPS).toEqual([
      "Describe",
      "Find",
      "Plan",
      "Build",
      "Preview",
      "Place",
    ]);
  });
  it.each([
    [{}, 0],
    [{ scout: true }, 1],
    [{ plan: true }, 2],
    [{ plan: true, buildStatus: "running" }, 3],
    [{ plan: true, buildStatus: "waiting-for-you" }, 4],
    [{ plan: true, buildStatus: "done" }, 5],
  ])("%o → step %i", (where, step) => {
    expect(cellStepIndex(where)).toBe(step);
  });
  it("shows in cell mode, and follows the flow", () => {
    setup();
    // (The test stub renders only the current step.)
    const current = () =>
      screen
        .getByTestId("create-cell-steps")
        .querySelector('[data-testid="step-label"]').textContent;
    expect(current()).toBe("Describe");
    describeIt();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(current()).toBe("Find");
    act(() => mockScoutProps.onBuildNew());
    expect(current()).toBe("Plan");
  });
});

// Review (mockup frames 5–6): the header names the widget being made.
test("the header names the widget once the plan has one", () => {
  setup();
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  expect(
    screen.getByText("Plan a widget for cell 2.2 on Slack Pack"),
  ).toBeInTheDocument();
  act(() =>
    mockPlanProps.onState({
      recentId: null,
      busy: false,
      buildId: "b9",
      widgetName: "New Year Countdown",
    }),
  );
  expect(
    screen.getByText(
      "Building · New Year Countdown for cell 2.2 on Slack Pack",
    ),
  ).toBeInTheDocument();
});
