import React from "react";
import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useWizardState, widgetCountToTemplate } from "./useWizardState";

// --- widgetCountToTemplate ---

describe("widgetCountToTemplate", () => {
  test.each([
    [0, "single"],
    [1, "single"],
    [2, "two-columns"],
    [3, "three-columns"],
    [4, "two-by-two"],
    [5, "two-by-three"],
    [6, "two-by-three"],
    [7, "three-by-three"],
    [12, "three-by-three"],
  ])("maps count %i to '%s'", (count, expected) => {
    expect(widgetCountToTemplate(count)).toBe(expected);
  });
});

// --- useWizardState ---

describe("useWizardState", () => {
  let result;

  beforeEach(() => {
    const hook = renderHook(() => useWizardState());
    result = hook.result;
  });

  test("returns initial state at step 0", () => {
    expect(result.current.state.step).toBe(0);
    expect(result.current.state.filters).toEqual({
      categories: [],
      providers: [],
      query: "",
    });
    expect(result.current.state.selectedWidgets).toEqual([]);
    expect(result.current.state.selectedDashboard).toBeNull();
    expect(result.current.state.path).toBeNull();
    expect(result.current.canProceed).toBe(false);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isPrebuiltPath).toBe(false);
    expect(result.current.isCustomPath).toBe(false);
  });

  // --- Filter actions ---

  test("SET_FILTERS merges into filters", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_FILTERS",
        payload: { categories: ["reporting", "monitoring"] },
      });
    });
    expect(result.current.state.filters.categories).toEqual([
      "reporting",
      "monitoring",
    ]);
    expect(result.current.state.filters.providers).toEqual([]);
    expect(result.current.state.filters.query).toBe("");
  });

  test("TOGGLE_FILTER_CATEGORY adds then removes a category", () => {
    act(() => {
      result.current.dispatch({
        type: "TOGGLE_FILTER_CATEGORY",
        payload: "reporting",
      });
    });
    expect(result.current.state.filters.categories).toEqual(["reporting"]);

    act(() => {
      result.current.dispatch({
        type: "TOGGLE_FILTER_CATEGORY",
        payload: "reporting",
      });
    });
    expect(result.current.state.filters.categories).toEqual([]);
  });

  test("TOGGLE_FILTER_PROVIDER adds then removes a provider", () => {
    act(() => {
      result.current.dispatch({
        type: "TOGGLE_FILTER_PROVIDER",
        payload: "github",
      });
    });
    expect(result.current.state.filters.providers).toEqual(["github"]);

    act(() => {
      result.current.dispatch({
        type: "TOGGLE_FILTER_PROVIDER",
        payload: "github",
      });
    });
    expect(result.current.state.filters.providers).toEqual([]);
  });

  test("SET_SEARCH_QUERY updates query", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_SEARCH_QUERY",
        payload: "slack",
      });
    });
    expect(result.current.state.filters.query).toBe("slack");
  });

  // --- Widget actions ---

  test("SET_SELECTED_WIDGETS replaces widgets", () => {
    const widgets = [{ name: "WidgetA" }, { name: "WidgetB" }];
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_WIDGETS",
        payload: widgets,
      });
    });
    expect(result.current.state.selectedWidgets).toEqual(widgets);
    expect(result.current.selectedCount).toBe(2);
  });

  test("TOGGLE_WIDGET adds and removes by name", () => {
    act(() => {
      result.current.dispatch({
        type: "TOGGLE_WIDGET",
        payload: { name: "WidgetA" },
      });
    });
    expect(result.current.state.selectedWidgets).toEqual([{ name: "WidgetA" }]);

    act(() => {
      result.current.dispatch({
        type: "TOGGLE_WIDGET",
        payload: { name: "WidgetA" },
      });
    });
    expect(result.current.state.selectedWidgets).toEqual([]);
  });

  // --- Dashboard & path actions ---

  test("SET_SELECTED_DASHBOARD sets dashboard", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_DASHBOARD",
        payload: { id: "dash-1" },
      });
    });
    expect(result.current.state.selectedDashboard).toEqual({
      id: "dash-1",
    });
  });

  test("SET_PATH sets path and updates derived flags", () => {
    act(() => {
      result.current.dispatch({ type: "SET_PATH", payload: "prebuilt" });
    });
    expect(result.current.isPrebuiltPath).toBe(true);
    expect(result.current.isCustomPath).toBe(false);

    act(() => {
      result.current.dispatch({ type: "SET_PATH", payload: "custom" });
    });
    expect(result.current.isPrebuiltPath).toBe(false);
    expect(result.current.isCustomPath).toBe(true);
  });

  // --- Layout actions ---

  test("SET_LAYOUT replaces layout object", () => {
    const layout = {
      templateKey: "two-columns",
      widgetOrder: ["A", "B"],
    };
    act(() => {
      result.current.dispatch({ type: "SET_LAYOUT", payload: layout });
    });
    expect(result.current.state.layout).toEqual(layout);
  });

  test("REORDER_WIDGETS updates widgetOrder only", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_LAYOUT",
        payload: {
          templateKey: "two-columns",
          widgetOrder: ["A", "B"],
        },
      });
    });
    act(() => {
      result.current.dispatch({
        type: "REORDER_WIDGETS",
        payload: ["B", "A"],
      });
    });
    expect(result.current.state.layout.templateKey).toBe("two-columns");
    expect(result.current.state.layout.widgetOrder).toEqual(["B", "A"]);
  });

  // --- Customization ---

  test("SET_CUSTOMIZATION merges into customization", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { name: "My Dashboard" },
      });
    });
    expect(result.current.state.customization.name).toBe("My Dashboard");
    expect(result.current.state.customization.menuId).toBeNull();

    act(() => {
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { menuId: "folder-1" },
      });
    });
    expect(result.current.state.customization.name).toBe("My Dashboard");
    expect(result.current.state.customization.menuId).toBe("folder-1");
  });

  // --- RESET ---

  test("RESET returns to initial state", () => {
    act(() => {
      result.current.dispatch({
        type: "TOGGLE_FILTER_CATEGORY",
        payload: "reporting",
      });
      result.current.dispatch({ type: "SET_STEP", payload: 1 });
    });
    act(() => {
      result.current.dispatch({ type: "RESET" });
    });
    expect(result.current.state.step).toBe(0);
    expect(result.current.state.filters.categories).toEqual([]);
  });

  // --- Step navigation ---

  test("nextStep advances when canProceed is true", () => {
    // Step 0 requires a dashboard or widget selection
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_DASHBOARD",
        payload: { id: "d1" },
      });
    });
    expect(result.current.canProceed).toBe(true);

    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(1);
  });

  test("nextStep does nothing when canProceed is false", () => {
    // Step 0 with no selection
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(0);
  });

  test("prevStep goes back but not below 0", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 1 });
    });
    act(() => {
      result.current.prevStep();
    });
    expect(result.current.state.step).toBe(0);

    act(() => {
      result.current.prevStep();
    });
    expect(result.current.state.step).toBe(0);
  });

  test("goToStep navigates to valid steps only (0..4)", () => {
    act(() => {
      result.current.goToStep(1);
    });
    expect(result.current.state.step).toBe(1);

    act(() => {
      result.current.goToStep(-1);
    });
    expect(result.current.state.step).toBe(1);

    // 5 is out of range — total steps are 0..4
    act(() => {
      result.current.goToStep(5);
    });
    expect(result.current.state.step).toBe(1);

    // 4 is the final step (Review)
    act(() => {
      result.current.goToStep(4);
    });
    expect(result.current.state.step).toBe(4);
  });

  test("nextStep does not exceed max step (4 = Review)", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 4 });
    });
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(4);
  });

  // --- canProceed per step ---
  // Steps: 0 = Discover, 1 = Name, 2 = Folder, 3 = Theme, 4 = Review.
  // The wizard restructure (Cycle 2) splits the old "Customize" step
  // into four discrete steps so the user has to land on each one and
  // make an explicit choice before Create fires from Review.

  test("step 0 (Discover) canProceed requires dashboard or widget selection", () => {
    expect(result.current.canProceed).toBe(false);

    // Dashboard selection satisfies
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_DASHBOARD",
        payload: { id: "d1" },
      });
    });
    expect(result.current.canProceed).toBe(true);

    // Clear dashboard, add widget
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_DASHBOARD",
        payload: null,
      });
      result.current.dispatch({
        type: "TOGGLE_WIDGET",
        payload: { name: "W1" },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 1 (Name) canProceed requires non-empty name", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 1 });
    });
    expect(result.current.canProceed).toBe(false);

    act(() => {
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { name: "Dashboard" },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 1 (Name) whitespace-only name does not pass", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 1 });
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { name: "   " },
      });
    });
    expect(result.current.canProceed).toBe(false);
  });

  test("step 2 (Folder) canProceed requires menuId set", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 2 });
    });
    expect(result.current.canProceed).toBe(false);

    act(() => {
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { menuId: 1 },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 3 (Theme) canProceed requires theme set", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 3 });
    });
    expect(result.current.canProceed).toBe(false);

    act(() => {
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { theme: "default-1" },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 4 (Review) canProceed is always true — Create is the action", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 4 });
    });
    // Review step: the footer's Create button replaces Next; the gate
    // for *firing* Create is the modal-side `canCreate` (which checks
    // earlier-step state), not canProceed.
    expect(result.current.canProceed).toBe(true);
  });

  // --- Unknown action ---

  test("unknown action returns state unchanged", () => {
    const before = result.current.state;
    act(() => {
      result.current.dispatch({ type: "UNKNOWN_ACTION" });
    });
    expect(result.current.state).toEqual(before);
  });
});
