import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardResultsStep } from "./WizardResultsStep";

// Mock resolveIcon
jest.mock("../../../../utils/resolveIcon", () => ({
  resolveIcon: (name) => name,
}));

// Mock useRegistrySearch
const mockUseRegistrySearch = jest.fn();
jest.mock("../../../../hooks/useRegistrySearch", () => ({
  useRegistrySearch: (...args) => mockUseRegistrySearch(...args),
}));

describe("WizardResultsStep", () => {
  let dispatch;
  let baseState;
  const originalMainApi = global.window.mainApi;

  beforeEach(() => {
    dispatch = jest.fn();
    baseState = {
      intent: ["reporting"],
      providers: ["github"],
      selectedWidgets: [],
      selectedDashboard: null,
      path: null,
    };

    // Default: useRegistrySearch returns empty
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [],
      isLoading: false,
      error: null,
    });

    // Default: no mainApi
    delete window.mainApi;
  });

  afterEach(() => {
    if (originalMainApi) {
      window.mainApi = originalMainApi;
    } else {
      delete window.mainApi;
    }
  });

  test("renders step header", () => {
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Choose your starting point")).toBeInTheDocument();
  });

  test("renders both tab triggers", () => {
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByTestId("tab-trigger-prebuilt")).toBeInTheDocument();
    expect(screen.getByTestId("tab-trigger-custom")).toBeInTheDocument();
  });

  test("sets initial path to prebuilt on mount", () => {
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PATH",
      payload: "prebuilt",
    });
  });

  test("does not re-dispatch path if already set", () => {
    baseState.path = "prebuilt";
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_PATH" }),
    );
  });

  // --- Pre-built tab (Tab A) ---

  test("shows empty message when no dashboards found", () => {
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    expect(
      screen.getByText("No pre-built dashboards match your selections."),
    ).toBeInTheDocument();
  });

  test("shows loading state for dashboard search", async () => {
    window.mainApi = {
      registry: {
        searchDashboards: () => new Promise(() => {}), // never resolves
      },
    };

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    await waitFor(() => {
      expect(screen.getByText("Searching dashboards...")).toBeInTheDocument();
    });
  });

  test("shows error when dashboard search fails", async () => {
    window.mainApi = {
      registry: {
        searchDashboards: jest
          .fn()
          .mockRejectedValue(new Error("Network error")),
      },
    };

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  test("renders dashboard cards when results are available", async () => {
    window.mainApi = {
      registry: {
        searchDashboards: jest.fn().mockResolvedValue({
          packages: [
            {
              name: "ops-dashboard",
              displayName: "Ops Dashboard",
              description: "Ops monitoring",
              widgets: [{ name: "w1" }, { name: "w2" }],
              providers: [{ type: "github", name: "GitHub" }],
            },
          ],
        }),
      },
    };

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    await waitFor(() => {
      expect(screen.getByText("Ops Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Ops monitoring")).toBeInTheDocument();
      expect(screen.getByText("2 widgets")).toBeInTheDocument();
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  test("clicking a dashboard dispatches SET_SELECTED_DASHBOARD", async () => {
    const dashboard = {
      name: "ops-dashboard",
      displayName: "Ops Dashboard",
      widgets: [],
      providers: [],
    };

    window.mainApi = {
      registry: {
        searchDashboards: jest.fn().mockResolvedValue({
          packages: [dashboard],
        }),
      },
    };

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    await waitFor(() => {
      expect(screen.getByText("Ops Dashboard")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ops Dashboard").closest("button"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SELECTED_DASHBOARD",
      payload: dashboard,
    });
  });

  // --- Build Your Own tab (Tab B) ---

  test("switching to custom tab dispatches SET_PATH custom", () => {
    baseState.path = "prebuilt";
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    fireEvent.click(screen.getByTestId("tab-trigger-custom"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PATH",
      payload: "custom",
    });
  });

  test("shows widgets on Build Your Own tab", () => {
    baseState.path = "custom";
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [
        {
          name: "git-widget",
          key: "git-widget",
          description: "Git stats",
          packageCategory: "reporting",
          providers: [{ type: "github" }],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    // Switch to custom tab
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(screen.getByText("git-widget")).toBeInTheDocument();
    expect(screen.getByText("Git stats")).toBeInTheDocument();
  });

  test("filters widgets by intent categories", () => {
    baseState.path = "custom";
    baseState.intent = ["monitoring"];
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [
        {
          name: "uptime-widget",
          key: "uptime",
          packageCategory: "monitoring",
          providers: [{ type: "github" }],
        },
        {
          name: "report-widget",
          key: "report",
          packageCategory: "reporting",
          providers: [{ type: "github" }],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(screen.getByText("uptime-widget")).toBeInTheDocument();
    expect(screen.queryByText("report-widget")).not.toBeInTheDocument();
  });

  test("clicking a widget dispatches TOGGLE_WIDGET", () => {
    baseState.path = "custom";
    const widget = {
      name: "git-widget",
      key: "git-widget",
      packageCategory: "reporting",
      providers: [{ type: "github" }],
    };
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [widget],
      isLoading: false,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));
    fireEvent.click(screen.getByText("git-widget").closest("button"));

    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_WIDGET",
      payload: widget,
    });
  });

  test("shows widget loading state", () => {
    baseState.path = "custom";
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [],
      isLoading: true,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(screen.getByText("Searching widgets...")).toBeInTheDocument();
  });

  test("shows widget error state", () => {
    baseState.path = "custom";
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [],
      isLoading: false,
      error: "Registry unavailable",
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(screen.getByText("Registry unavailable")).toBeInTheDocument();
  });

  test("shows empty widget state", () => {
    baseState.path = "custom";
    baseState.intent = ["reporting"];
    baseState.providers = ["github"];
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [],
      isLoading: false,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(
      screen.getByText("No widgets match your selections."),
    ).toBeInTheDocument();
  });

  test("shows selected widget count badge", () => {
    baseState.selectedWidgets = [{ name: "w1" }, { name: "w2" }];
    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("shows selected count text on widget tab", () => {
    baseState.path = "custom";
    baseState.selectedWidgets = [{ name: "w1" }, { name: "w2" }];
    mockUseRegistrySearch.mockReturnValue({
      flatWidgets: [
        {
          name: "w1",
          key: "w1",
          packageCategory: "reporting",
          providers: [{ type: "github" }],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<WizardResultsStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByTestId("tab-trigger-custom"));

    expect(screen.getByText("2 widgets selected")).toBeInTheDocument();
  });
});
