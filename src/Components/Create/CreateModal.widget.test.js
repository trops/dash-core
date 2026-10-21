/**
 * A widget on its own through the Dash team (consolidation Phase 3b):
 * Create › Type: Widget → the Scout → the Planner (widget mode) → built,
 * previewed, installed → a Done screen. Back or Close stops a build that's
 * still going.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: {
    config: (c) =>
      c === "ai-built.order-lookup.OrderLookup"
        ? { displayName: "Order Lookup" }
        : null,
  },
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

function setup() {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listLeads: jest.fn().mockResolvedValue([]),
      listDashTeam: jest.fn().mockResolvedValue([]),
      stopPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
  const setIsOpen = jest.fn();
  const onStartWithoutAi = jest.fn();
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: {}, settings: {} }}>
        <CreateModal
          open
          setIsOpen={setIsOpen}
          initialType="widget"
          onStartWithoutAi={onStartWithoutAi}
        />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return { setIsOpen, onStartWithoutAi };
}

// Send → the Scout → Build it → the Planner, in widget mode.
async function toPlan() {
  await screen.findByRole("button", { name: /^AI: Claude Code/ });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What do you want to make?" }),
    { target: { value: "Look up an order" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByTestId("scout")).toHaveTextContent("Look up an order");
  act(() => mockScoutProps.onBuildNew());
}

const where = () => screen.getByRole("navigation", { name: "Where you are" });

afterEach(() => {
  delete window.mainApi;
});

test("Build it goes to the Planner for one widget for your widgets — no dashboard", async () => {
  await setup();
  await toPlan();
  expect(screen.getByTestId("plan-step")).toHaveTextContent("Look up an order");
  expect(mockPlanProps.widget).toBe(true);
  expect(mockPlanProps.cell).toBeFalsy();
  expect(mockPlanProps.openDashboardId).toBeNull();
  expect(where()).toHaveTextContent("Create›Plan a widget");
});

test("the header follows the build: Building, then Preview", async () => {
  setup();
  await toPlan();
  act(() =>
    mockPlanProps.onState({
      recentId: null,
      busy: false,
      buildId: "b9",
      widgetName: "Order Lookup",
    }),
  );
  expect(where()).toHaveTextContent("Create›Building · Order Lookup");
});

test("installed: a Done screen names it; See it on the Widgets page and Done", async () => {
  const { setIsOpen, onStartWithoutAi } = setup();
  await toPlan();
  act(() =>
    mockPlanProps.onCellDone({
      component: "ai-built.order-lookup.OrderLookup",
    }),
  );
  expect(
    screen.getByText("Order Lookup is in your widgets"),
  ).toBeInTheDocument();
  expect(where()).toHaveTextContent("Create›Done");
  fireEvent.click(
    screen.getByRole("button", { name: "See it on the Widgets page" }),
  );
  expect(setIsOpen).toHaveBeenCalledWith(false);
  expect(onStartWithoutAi).toHaveBeenCalledWith("open-widgets");
});

test("Back from the Done screen goes to the start, not a blank Done", async () => {
  setup();
  await toPlan();
  act(() =>
    mockPlanProps.onCellDone({
      component: "ai-built.order-lookup.OrderLookup",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.queryByText(/is in your widgets/)).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "What do you want to make?" }),
  ).toBeInTheDocument();
});

test.each(["Back", "Close"])(
  "%s while it builds stops the build",
  async (button) => {
    setup();
    await toPlan();
    act(() =>
      mockPlanProps.onState({ recentId: null, busy: false, buildId: "b9" }),
    );
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(window.mainApi.bots.stopPlanBuild).toHaveBeenCalledWith("b9");
  },
);
