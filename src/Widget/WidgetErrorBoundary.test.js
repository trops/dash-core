/**
 * WidgetErrorBoundary — friendlier UI + "Fix with AI" action.
 *
 * Static source-presence test asserting:
 *   1. The bright-red `bg-red-900` panic card is GONE (the soften
 *      regression guard — keeps a future PR from re-introducing the
 *      louder UI).
 *   2. The boundary uses an amber tone instead.
 *   3. For installed widgets (a scoped id, or AI-built), a "Fix with AI"
 *      button is rendered (consolidation Phase 3).
 *   4. That button dispatches `dash:edit-widget-with-ai` with the error, so
 *      Create › Change <widget> opens on the failing widget.
 *   5. Which widgets get it is canFixWithAi (tested below on real ids);
 *      new code for the widget clears the box (keyed to its version).
 *
 * Why static rather than RTL: the boundary lives inside WidgetFactory
 * which has many context dependencies (DashboardContext,
 * ComponentManager, dash-react Panel/etc.) that would require deep
 * mocking. The static check verifies the wiring exists; behavior is
 * verified end-to-end via the dash-electron-side hand-off after
 * publish.
 */
const fs = require("fs");
const path = require("path");

describe("WidgetErrorBoundary — friendlier UI + Fix with AI", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "WidgetFactory.js"),
    "utf8",
  );

  test("no bright-red bg-red-900 card", () => {
    expect(source).not.toMatch(/bg-red-900/);
  });

  test("uses amber tone instead", () => {
    expect(source).toMatch(/bg-amber-/);
  });

  test("dispatches dash:edit-widget-with-ai event", () => {
    expect(source).toMatch(/dash:edit-widget-with-ai/);
  });

  test('"Fix with AI" button text is present, not the old builder', () => {
    expect(source).toMatch(/Fix with AI/);
    expect(source).not.toMatch(/Open in AI Builder/);
  });

  test("new code for the widget clears the error box (keyed to its version)", () => {
    expect(source).toMatch(
      /<WidgetErrorBoundary\s+key=\{`boundary-\$\{componentVersion\}`\}/,
    );
  });
});

describe("canFixWithAi", () => {
  test("WidgetFactory uses it", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "WidgetFactory.js"),
      "utf8",
    );
    expect(source).toMatch(/canFixWithAi\(widgetName\)/);
  });

  const { canFixWithAi } = require("./canFixWithAi");

  test("installed widgets: scoped ids and AI-built", () => {
    expect(canFixWithAi("trops.algolia.AlgoliaSearch")).toBe(true);
    expect(canFixWithAi("ai-built.counter.Counter")).toBe(true);
  });

  test("not built-ins, bare names or nothing", () => {
    expect(canFixWithAi("dash.bots.BotResults")).toBe(false);
    expect(canFixWithAi("Counter")).toBe(false);
    expect(canFixWithAi(undefined)).toBe(false);
  });
});

describe("fixRequestDetail", () => {
  const { fixRequestDetail } = require("./canFixWithAi");

  test("a widget in a cell says where it is, like the card's menu", () => {
    const item = {
      id: 3,
      parent: 1,
      dashboardId: 7,
      userPrefs: { title: "My Counter" },
      selectedProviders: { algolia: "Store" },
      packageId: "@ai-built/counter",
    };
    expect(
      fixRequestDetail("ai-built.counter.Counter", "boom", item, "sidebar"),
    ).toEqual({
      widgetComponentName: "ai-built.counter.Counter",
      error: "boom",
      widgetId: 3,
      gridItemId: 1,
      workspaceId: 7,
      scope: "sidebar",
      userPrefs: { title: "My Counter" },
      selectedProviders: { algolia: "Store" },
      sourcePackage: "@ai-built/counter",
    });
  });

  test("anywhere else: just the widget and its error", () => {
    expect(fixRequestDetail("ai-built.counter.Counter", "boom")).toEqual({
      widgetComponentName: "ai-built.counter.Counter",
      error: "boom",
    });
    expect(
      fixRequestDetail("ai-built.counter.Counter", "boom", { id: 3 }),
    ).toEqual({
      widgetComponentName: "ai-built.counter.Counter",
      error: "boom",
    });
  });

  test("the error box sends it with its cell and where it is", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "WidgetFactory.js"),
      "utf8",
    );
    expect(source).toMatch(
      /fixRequestDetail\(widgetName, errorMessage, item, scope\)/,
    );
    expect(source).toMatch(/item=\{params\}\s+scope=\{workspaceScope\}/);
  });
});
