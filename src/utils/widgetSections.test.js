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

describe("panelSections", () => {
  const { panelSections } = require("./widgetSections");
  const widget = { type: "widget", eventHandlers: ["onQueryChanged"] };

  test("what a full widget has", () => {
    expect(
      panelSections(widget, {
        userConfig: { hitTemplate: { type: "text" } },
        providers: [{ type: "algolia", providerClass: "credential" }],
        notifications: [{ key: "ready" }],
        scheduledTasks: [{ key: "refresh" }],
      }),
    ).toEqual({
      settings: true,
      connections: true,
      listeners: true,
      notifications: true,
      schedule: true,
    });
  });

  test("an empty widget, and settings written as a list", () => {
    expect(panelSections({ type: "widget" }, {})).toEqual({
      settings: false,
      connections: false,
      listeners: false,
      notifications: false,
      schedule: false,
    });
    expect(
      panelSections({ type: "widget" }, { userConfig: [{ key: "title" }] })
        .settings,
    ).toBe(true);
  });

  test("handlers from the config when the item has none", () => {
    expect(
      panelSections({ type: "widget" }, { eventHandlers: ["onX"] }).listeners,
    ).toBe(true);
  });
});
