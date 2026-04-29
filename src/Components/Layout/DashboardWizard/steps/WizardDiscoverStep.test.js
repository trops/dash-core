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

/**
 * Wizard layout polish — sticky sidebar + sign-in banner placement +
 * Summary block lifted above the Customize sub-steps.
 *
 * The user feedback was:
 *   - The sign-in CTA looked awkward in the sidebar; it should sit
 *     horizontally at the top of the step (matching the Settings →
 *     Dashboards banner).
 *   - The filter sidebar scrolled with the result list, which was
 *     disorienting when scanning through dozens of widgets.
 *   - The Summary panel appeared *below* the Customize sub-step
 *     content, so the user had to scroll past the form to see what
 *     they were about to create.
 *
 * Static source-presence tests covering all three.
 */
describe("Wizard layout polish — sticky sidebar, banner, Summary", () => {
  const fs = require("fs");
  const path = require("path");
  const stepPath = path.join(__dirname, "WizardDiscoverStep.js");
  const customizePath = path.join(__dirname, "WizardCustomizeStep.js");
  const stepSource = fs.readFileSync(stepPath, "utf8");
  const customizeSource = fs.readFileSync(customizePath, "utf8");

  test("Discover sidebar is sticky (stays fixed while results scroll)", () => {
    // The aside element must use Tailwind sticky positioning so it
    // doesn't scroll along with the result grid.
    expect(stepSource).toMatch(/<aside[^>]*className=["'][^"']*\bsticky\b/);
  });

  test("Sign-in CTA renders OUTSIDE the filter sidebar (above the 2-column row)", () => {
    // The sign-in CTA used to live inside the <aside>. The user wants
    // it horizontal at the top of the step. Assert: the "Sign in to
    // registry" banner appears in the source BEFORE the <aside> tag,
    // so it sits above the 2-column flex-row layout.
    const ctaIndex = stepSource.indexOf("Sign in to registry");
    const asideIndex = stepSource.indexOf("<aside");
    expect(ctaIndex).toBeGreaterThan(-1);
    expect(asideIndex).toBeGreaterThan(-1);
    expect(ctaIndex).toBeLessThan(asideIndex);
  });

  test("Customize step renders Summary above the Name input", () => {
    // The Summary block lifted out from the bottom of the substep
    // container so the user sees what they're creating before they
    // start filling in fields.
    const summaryIndex = customizeSource.indexOf(">Summary<");
    const nameInputIndex = customizeSource.indexOf("Dashboard Name");
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(nameInputIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeLessThan(nameInputIndex);
  });

  test("Customize step shows '(default)' indicator on the active theme", () => {
    expect(customizeSource).toMatch(/\(default\)/);
  });
});

/**
 * Wizard step restructure — Discover (browse) → 1.Name → 2.Folder →
 * 3.Theme → 4.Review.
 *
 * The Customize step's internal subStep state is replaced by direct
 * use of state.step, and the mini-stepper is gone (modal footer's
 * Next/Back drive advancement). The modal hides its top-level
 * Stepper while in Discover and shows the 4-entry numbered Stepper
 * thereafter. Create only fires from the Review step (step 4) and
 * is gated on the full customization (name + folder + theme), with
 * any failure surfaced inline so the click never silently no-ops.
 */
describe("Wizard step restructure — Discover + 4 numbered steps", () => {
  const fs = require("fs");
  const path = require("path");
  const customizePath = path.join(__dirname, "WizardCustomizeStep.js");
  const modalPath = path.join(__dirname, "..", "DashboardWizardModal.js");
  const customizeSource = fs.readFileSync(customizePath, "utf8");
  const modalSource = fs.readFileSync(modalPath, "utf8");

  test("Customize step routes by state.step (1=Name, 2=Folder, 3=Theme, 4=Review)", () => {
    expect(customizeSource).toMatch(/state\.step\s*===\s*1/);
    expect(customizeSource).toMatch(/state\.step\s*===\s*2/);
    expect(customizeSource).toMatch(/state\.step\s*===\s*3/);
    expect(customizeSource).toMatch(/state\.step\s*===\s*4/);
  });

  test("Customize step's internal subStep state is removed", () => {
    // The mini-stepper from DASH-188 is gone; the modal footer's
    // Next/Back drives advancement now.
    expect(customizeSource).not.toMatch(/\bsubStep\b/);
    expect(customizeSource).not.toMatch(/\bsetSubStep\b/);
  });

  test("Customize step renders an inline error banner so handleCreate failures are visible", () => {
    // Without an inline surface, errors land in console.error which
    // is stripped by rollup-strip in the dash-core dist — making the
    // Create click look like a no-op. The banner must be in the
    // step's source so prod users see the failure.
    expect(customizeSource).toMatch(
      /\{error\s*&&[\s\S]{0,400}circle-exclamation/,
    );
  });

  test("Modal hides the Stepper on step 0 (Discover is a browse phase)", () => {
    // When state.step === 0, the modal renders the Discover step on
    // its own — no numbered Stepper above it. The 4-entry Stepper
    // appears for steps 1..4.
    expect(modalSource).toMatch(/isDiscover/);
    expect(modalSource).toMatch(/isDiscover\s*\?/);
  });

  test("Modal's STEP_LABELS list has 4 entries (Name/Folder/Theme/Review)", () => {
    expect(modalSource).toMatch(/Name/);
    expect(modalSource).toMatch(/Folder/);
    expect(modalSource).toMatch(/Theme/);
    expect(modalSource).toMatch(/Review/);
    // 4 numbered steps means STEP_LABELS.length === 4 — assert the
    // modal computes its 'Step X of 4' counter against that.
    expect(modalSource).toMatch(/STEP_LABELS\.length/);
  });

  test("Modal computes canCreate from full customization (name + folder + theme)", () => {
    // Cycle 2: canCreate must NOT be canProceed alone (canProceed
    // for step 4 is always true by design). The modal re-checks the
    // underlying customization fields so a click on Review's Create
    // button can't fire when an earlier step's data is missing.
    expect(modalSource).toMatch(/customizationComplete/);
    expect(modalSource).toMatch(/customization\.name/);
    expect(modalSource).toMatch(/customization\.menuId/);
    expect(modalSource).toMatch(/customization\.theme/);
  });
});
