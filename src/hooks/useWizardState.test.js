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
    expect(result.current.state.intent).toEqual([]);
    expect(result.current.state.providers).toEqual([]);
    expect(result.current.state.selectedWidgets).toEqual([]);
    expect(result.current.state.selectedDashboard).toBeNull();
    expect(result.current.state.path).toBeNull();
    expect(result.current.canProceed).toBe(false);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isPrebuiltPath).toBe(false);
    expect(result.current.isCustomPath).toBe(false);
  });

  // --- Intent actions ---

  test("SET_INTENT replaces intent array", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_INTENT",
        payload: ["reporting", "monitoring"],
      });
    });
    expect(result.current.state.intent).toEqual(["reporting", "monitoring"]);
  });

  test("TOGGLE_INTENT adds then removes a category", () => {
    act(() => {
      result.current.dispatch({ type: "TOGGLE_INTENT", payload: "reporting" });
    });
    expect(result.current.state.intent).toEqual(["reporting"]);

    act(() => {
      result.current.dispatch({ type: "TOGGLE_INTENT", payload: "reporting" });
    });
    expect(result.current.state.intent).toEqual([]);
  });

  // --- Provider actions ---

  test("SET_PROVIDERS replaces providers array", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_PROVIDERS",
        payload: ["github", "slack"],
      });
    });
    expect(result.current.state.providers).toEqual(["github", "slack"]);
  });

  test("TOGGLE_PROVIDER adds then removes a provider", () => {
    act(() => {
      result.current.dispatch({ type: "TOGGLE_PROVIDER", payload: "github" });
    });
    expect(result.current.state.providers).toEqual(["github"]);

    act(() => {
      result.current.dispatch({ type: "TOGGLE_PROVIDER", payload: "github" });
    });
    expect(result.current.state.providers).toEqual([]);
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
    expect(result.current.state.selectedDashboard).toEqual({ id: "dash-1" });
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
    const layout = { templateKey: "two-columns", widgetOrder: ["A", "B"] };
    act(() => {
      result.current.dispatch({ type: "SET_LAYOUT", payload: layout });
    });
    expect(result.current.state.layout).toEqual(layout);
  });

  test("REORDER_WIDGETS updates widgetOrder only", () => {
    act(() => {
      result.current.dispatch({
        type: "SET_LAYOUT",
        payload: { templateKey: "two-columns", widgetOrder: ["A", "B"] },
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
      result.current.dispatch({ type: "TOGGLE_INTENT", payload: "reporting" });
      result.current.dispatch({ type: "SET_STEP", payload: 3 });
    });
    act(() => {
      result.current.dispatch({ type: "RESET" });
    });
    expect(result.current.state.step).toBe(0);
    expect(result.current.state.intent).toEqual([]);
  });

  // --- Step navigation ---

  test("nextStep advances when canProceed is true", () => {
    // Step 0 requires intent
    act(() => {
      result.current.dispatch({ type: "TOGGLE_INTENT", payload: "reporting" });
    });
    expect(result.current.canProceed).toBe(true);

    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(1);
  });

  test("nextStep does nothing when canProceed is false", () => {
    // Step 0 with empty intent
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(0);
  });

  test("prevStep goes back but not below 0", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 2 });
    });
    act(() => {
      result.current.prevStep();
    });
    expect(result.current.state.step).toBe(1);

    act(() => {
      result.current.prevStep();
    });
    expect(result.current.state.step).toBe(0);

    act(() => {
      result.current.prevStep();
    });
    expect(result.current.state.step).toBe(0);
  });

  test("goToStep navigates to valid steps only", () => {
    act(() => {
      result.current.goToStep(4);
    });
    expect(result.current.state.step).toBe(4);

    act(() => {
      result.current.goToStep(-1);
    });
    expect(result.current.state.step).toBe(4);

    act(() => {
      result.current.goToStep(6);
    });
    expect(result.current.state.step).toBe(4);
  });

  test("nextStep does not exceed max step", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 5 });
    });
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.state.step).toBe(5);
  });

  // --- canProceed per step ---

  test("step 0 canProceed requires intent", () => {
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.dispatch({ type: "TOGGLE_INTENT", payload: "reporting" });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 1 canProceed requires providers", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 1 });
    });
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.dispatch({ type: "TOGGLE_PROVIDER", payload: "github" });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 2 prebuilt path requires selectedDashboard", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 2 });
      result.current.dispatch({ type: "SET_PATH", payload: "prebuilt" });
    });
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.dispatch({
        type: "SET_SELECTED_DASHBOARD",
        payload: { id: "d1" },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 2 custom path requires selectedWidgets", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 2 });
      result.current.dispatch({ type: "SET_PATH", payload: "custom" });
    });
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.dispatch({
        type: "TOGGLE_WIDGET",
        payload: { name: "W1" },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 3 canProceed requires layout templateKey", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 3 });
    });
    expect(result.current.canProceed).toBe(false);
    act(() => {
      result.current.dispatch({
        type: "SET_LAYOUT",
        payload: { templateKey: "single", widgetOrder: [] },
      });
    });
    expect(result.current.canProceed).toBe(true);
  });

  test("step 4 canProceed requires non-empty name", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 4 });
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

  test("step 4 whitespace-only name does not pass", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 4 });
      result.current.dispatch({
        type: "SET_CUSTOMIZATION",
        payload: { name: "   " },
      });
    });
    expect(result.current.canProceed).toBe(false);
  });

  test("step 5 always canProceed", () => {
    act(() => {
      result.current.dispatch({ type: "SET_STEP", payload: 5 });
    });
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
