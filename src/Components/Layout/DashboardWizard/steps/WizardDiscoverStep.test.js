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

// Mock useRegistryAuth — the wizard's sign-in CTA reads its state.
// Default is authenticated so existing tests don't render the CTA;
// the dedicated CTA describe block uses a stable static-source check.
jest.mock("../../../../hooks/useRegistryAuth", () => ({
  useRegistryAuth: () => ({
    isAuthenticated: true,
    isAuthenticating: false,
    authFlow: null,
    authError: null,
    checkAuth: jest.fn(),
    initiateAuth: jest.fn(),
    cancelAuth: jest.fn(),
  }),
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    // Switch to Widgets tab first
    fireEvent.click(screen.getByText(/^Widgets/));
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
      refetch: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    // Switch to Widgets tab first
    fireEvent.click(screen.getByText(/^Widgets/));
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
      refetch: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    // Switch to Widgets tab first
    fireEvent.click(screen.getByText(/^Widgets/));
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
      refetch: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    // Switch to Widgets tab first
    fireEvent.click(screen.getByText(/^Widgets/));
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
      refetch: jest.fn(),
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
      refetch: jest.fn(),
    });

    render(<WizardDiscoverStep state={baseState} dispatch={dispatch} />);
    expect(screen.getByText("Ops")).toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
  });
});

/**
 * Layout structure — left-sidebar filter pane.
 *
 * Replaces the previous horizontal Categories/Providers pill walls
 * with a vertical filter sidebar (TYPE / CATEGORIES / PROVIDERS),
 * mirroring the dash-registry homepage style. The Dashboards/Widgets
 * tab bar is folded into a TYPE filter so the right pane is a single
 * result surface (All / Dashboards / Widgets).
 *
 * Static source-presence tests, mirroring the NewProviderPicker
 * pattern. The behavioral tests above continue to cover dispatch
 * wiring, filtering, and result rendering.
 */
describe("WizardDiscoverStep — layout structure (static source)", () => {
  const fs = require("fs");
  const path = require("path");
  const stepPath = path.join(__dirname, "WizardDiscoverStep.js");
  const source = fs.readFileSync(stepPath, "utf8");

  test("Outer layout is a 2-column row (flex-row, sidebar + content)", () => {
    expect(source).toMatch(/flex\s+flex-row/);
  });

  test("Sidebar has uppercase TYPE label", () => {
    expect(source).toMatch(/>\s*TYPE\s*</);
  });

  test("Sidebar has uppercase CATEGORIES label", () => {
    expect(source).toMatch(/>\s*CATEGORIES\s*</);
  });

  test("Sidebar has uppercase PROVIDERS label", () => {
    expect(source).toMatch(/>\s*PROVIDERS\s*</);
  });

  test("TYPE filter is binary: 'dashboards' / 'widgets'", () => {
    // Mutual-exclusion data model: selecting a dashboard clears
    // widget selection (path="prebuilt"), and selecting a widget
    // clears the dashboard (path="custom"). An "All" option would
    // imply you can browse both freely when the first click locks
    // you into one of two paths.
    expect(source).toMatch(/typeFilter/);
    expect(source).toMatch(/["']dashboards["']/);
    expect(source).toMatch(/["']widgets["']/);
  });

  test("Category list is still driven by DASHBOARD_TAGS", () => {
    expect(source).toMatch(/DASHBOARD_TAGS\.map/);
  });

  test("Provider list is still driven by KNOWN_PROVIDERS", () => {
    expect(source).toMatch(/KNOWN_PROVIDERS\.map/);
  });

  test("The previous horizontal Tag2 pill rows are gone", () => {
    // Tag2 was the chip used for the old horizontal Categories /
    // Providers walls. The new sidebar uses plain selectable rows,
    // so the import + usage should both disappear.
    expect(source).not.toMatch(/\bTag2\b/);
  });
});

/**
 * Registry sign-in CTA in the Dashboard Wizard's Discover step.
 *
 * The wizard browses the dash-registry. When the user isn't signed
 * in, the registry only returns public packages — they miss
 * dashboards / widgets they have access to. This describe block
 * locks in:
 *   1. WizardDiscoverStep imports the existing useRegistryAuth hook
 *   2. A "Sign in to registry" CTA renders in the unauthenticated
 *      branch
 *   3. The post-auth callback triggers a registry re-fetch (so the
 *      results refresh once the user signs in without manual reload)
 *   4. useRegistrySearch exposes a `refetch` callback for that
 *      post-auth refresh
 */
describe("WizardDiscoverStep — registry sign-in CTA", () => {
  const fs = require("fs");
  const path = require("path");
  const stepPath = path.join(__dirname, "WizardDiscoverStep.js");
  const hookPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "hooks",
    "useRegistrySearch.js",
  );
  const stepSource = fs.readFileSync(stepPath, "utf8");
  const hookSource = fs.readFileSync(hookPath, "utf8");

  test("WizardDiscoverStep imports useRegistryAuth", () => {
    expect(stepSource).toMatch(
      /from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/hooks\/useRegistryAuth["']/,
    );
    expect(stepSource).toMatch(/useRegistryAuth/);
  });

  test("Sign-in CTA renders 'Sign in to registry' in the unauthenticated branch", () => {
    expect(stepSource).toMatch(/Sign in to registry/);
  });

  test("initiateAuth is called with refetch as the post-auth callback", () => {
    // Hook contract: initiateAuth(onAuthorized) fires onAuthorized
    // once the device-code flow completes. Passing `refetch` makes
    // the registry results auto-refresh on sign-in.
    expect(stepSource).toMatch(/initiateAuth\(\s*refetch\s*\)/);
  });

  test("useRegistrySearch exposes a refetch callback", () => {
    expect(hookSource).toMatch(/\brefetch\b/);
    // refetch is part of the returned object (not just an internal name)
    expect(hookSource).toMatch(/return\s*\{[\s\S]*?\brefetch\b[\s\S]*?\}/);
  });
});
