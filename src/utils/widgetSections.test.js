import { showsListeners } from "./widgetSections";

describe("showsListeners", () => {
  test("every widget, whatever its workspace says", () => {
    expect(showsListeners({ type: "widget", workspace: "layout" })).toBe(true);
    expect(showsListeners({ type: "widget" })).toBe(true);
    expect(showsListeners({ type: "widget", workspace: "algolia" })).toBe(true);
  });

  test("containers keep the old rule", () => {
    expect(showsListeners({ type: "grid", workspace: "layout" })).toBe(false);
    expect(showsListeners({ type: "layout", workspace: "layout" })).toBe(false);
    expect(showsListeners({ type: "workspace", workspace: "algolia" })).toBe(
      true,
    );
    expect(showsListeners(null)).toBe(false);
  });

  test("a widget the Dash team placed (no type, no workspace) keeps them", () => {
    // electron/utils/placeWidget.js wrote neither; LayoutModel then gives it
    // type "widget" (from its component) and workspace "layout"
    // (LayoutModel.js — the type and workspace defaults).
    const afterLayoutModel = {
      id: 3,
      component: "ai-built.counter.Counter",
      type: "widget",
      workspace: "layout",
    };
    expect(showsListeners(afterLayoutModel)).toBe(true);
  });
});
