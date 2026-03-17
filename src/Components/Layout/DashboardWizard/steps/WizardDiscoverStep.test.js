import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardDiscoverStep } from "./WizardDiscoverStep";

// Mock resolveIcon
jest.mock("../../../../utils/resolveIcon", () => ({
  resolveIcon: (name) => name,
}));

// Mock useRegistrySearch
const mockUseRegistrySearch = jest.fn();
jest.mock("../../../../hooks/useRegistrySearch", () => ({
  useRegistrySearch: (...args) => mockUseRegistrySearch(...args),
}));

// Mock DASHBOARD_TAGS
jest.mock("../../../Settings/constants", () => ({
  DASHBOARD_TAGS: ["productivity", "monitoring", "developer"],
}));

describe("WizardDiscoverStep", () => {
  let dispatch;
  let baseState;

  beforeEach(() => {
    dispatch = jest.fn();
    baseState = {
      filters: {
        categories: [],
        providers: [],
        query: "",
      },
      selectedWidgets: [],
      selectedDashboard: null,
      path: null,
    };

    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });
  });

  test("renders search bar", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(
      screen.getByPlaceholderText("Search registry..."),
    ).toBeInTheDocument();
  });

  test("renders category filter chips", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("productivity")).toBeInTheDocument();
    expect(screen.getByText("monitoring")).toBeInTheDocument();
    expect(screen.getByText("developer")).toBeInTheDocument();
  });

  test("renders provider filter chips", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("Google Drive")).toBeInTheDocument();
  });

  test("clicking a category chip dispatches TOGGLE_FILTER_CATEGORY", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByText("monitoring"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_FILTER_CATEGORY",
      payload: "monitoring",
    });
  });

  test("clicking a provider chip dispatches TOGGLE_FILTER_PROVIDER", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByText("GitHub"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_FILTER_PROVIDER",
      payload: "github",
    });
  });

  test("typing in search dispatches SET_SEARCH_QUERY", () => {
    const setSearchQuery = jest.fn();
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery,
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    fireEvent.change(screen.getByPlaceholderText("Search registry..."), {
      target: { value: "slack" },
    });

    expect(setSearchQuery).toHaveBeenCalledWith("slack");
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SEARCH_QUERY",
      payload: "slack",
    });
  });

  test("shows loading state", () => {
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [],
      isLoading: true,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Searching registry...")).toBeInTheDocument();
  });

  test("shows error state", () => {
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [],
      isLoading: false,
      error: "Network error",
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  test("shows empty results message", () => {
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(
      screen.getByText("No results match your search."),
    ).toBeInTheDocument();
  });

  test("shows filter hint when active filters and no results", () => {
    baseState.filters.categories = ["monitoring"];
    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(
      screen.getByText("Try removing some filters to see more results."),
    ).toBeInTheDocument();
  });

  // --- Dashboard results ---

  test("renders dashboard cards", () => {
    mockUseRegistrySearch.mockReturnValue({
      packages: [
        {
          name: "ops-dashboard",
          displayName: "Ops Dashboard",
          description: "Ops monitoring",
          type: "dashboard",
          widgets: [{ name: "w1" }, { name: "w2" }],
          providers: [{ type: "github", name: "GitHub" }],
        },
      ],
      flatWidgets: [],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Ops Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Ops monitoring")).toBeInTheDocument();
    expect(screen.getByText("2 widgets")).toBeInTheDocument();
  });

  test("selecting a dashboard dispatches path + clears widgets", () => {
    const dashboard = {
      name: "ops-dashboard",
      displayName: "Ops Dashboard",
      type: "dashboard",
      widgets: [],
      providers: [],
    };

    mockUseRegistrySearch.mockReturnValue({
      packages: [dashboard],
      flatWidgets: [],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByText("Ops Dashboard").closest("button"));

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SELECTED_DASHBOARD",
      payload: dashboard,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SELECTED_WIDGETS",
      payload: [],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PATH",
      payload: "prebuilt",
    });
  });

  // --- Widget results ---

  test("renders widget cards", () => {
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [
        {
          name: "git-widget",
          key: "git-widget",
          description: "Git stats",
          packageCategory: "",
          providers: [],
          packageProviders: [],
        },
      ],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("git-widget")).toBeInTheDocument();
    expect(screen.getByText("Git stats")).toBeInTheDocument();
  });

  test("selecting a widget dispatches path + clears dashboard", () => {
    const widget = {
      name: "git-widget",
      key: "git-widget",
      description: "Git stats",
      packageCategory: "",
      providers: [],
      packageProviders: [],
    };

    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [widget],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    fireEvent.click(screen.getByText("git-widget").closest("button"));

    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_WIDGET",
      payload: widget,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SELECTED_DASHBOARD",
      payload: null,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PATH",
      payload: "custom",
    });
  });

  // --- Client-side filtering ---

  test("filters widgets by selected category", () => {
    baseState.filters.categories = ["monitoring"];
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [
        {
          name: "uptime",
          key: "uptime",
          packageCategory: "monitoring",
          providers: [],
          packageProviders: [],
        },
        {
          name: "report",
          key: "report",
          packageCategory: "reporting",
          providers: [],
          packageProviders: [],
        },
      ],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("uptime")).toBeInTheDocument();
    expect(screen.queryByText("report")).not.toBeInTheDocument();
  });

  test("filters widgets by selected provider", () => {
    baseState.filters.providers = ["github"];
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [
        {
          name: "git-widget",
          key: "git-widget",
          providers: [{ type: "github" }],
          packageProviders: [],
          packageCategory: "",
        },
        {
          name: "slack-widget",
          key: "slack-widget",
          providers: [{ type: "slack" }],
          packageProviders: [],
          packageCategory: "",
        },
      ],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("git-widget")).toBeInTheDocument();
    expect(screen.queryByText("slack-widget")).not.toBeInTheDocument();
  });

  test("shows selected widget count badge", () => {
    baseState.selectedWidgets = [{ name: "w1" }, { name: "w2" }];
    mockUseRegistrySearch.mockReturnValue({
      packages: [],
      flatWidgets: [
        {
          name: "w1",
          key: "w1",
          providers: [],
          packageProviders: [],
          packageCategory: "",
        },
      ],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  test("filters dashboards by selected category", () => {
    baseState.filters.categories = ["monitoring"];
    mockUseRegistrySearch.mockReturnValue({
      packages: [
        {
          name: "ops",
          displayName: "Ops",
          type: "dashboard",
          category: "monitoring",
          widgets: [],
          providers: [],
        },
        {
          name: "sales",
          displayName: "Sales",
          type: "dashboard",
          category: "sales",
          widgets: [],
          providers: [],
        },
      ],
      flatWidgets: [],
      isLoading: false,
      error: null,
      searchQuery: "",
      setSearchQuery: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Ops")).toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
  });
});
