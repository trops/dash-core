/**
 * WidgetErrorBoundary — friendlier UI + "Open in AI Builder" action.
 *
 * Static source-presence test asserting:
 *   1. The bright-red `bg-red-900` panic card is GONE (the soften
 *      regression guard — keeps a future PR from re-introducing the
 *      louder UI).
 *   2. The boundary uses an amber tone instead.
 *   3. For `@ai-built/*` widgets, an "Open in AI Builder" button is
 *      rendered.
 *   4. That button dispatches `dash:edit-widget-with-ai` so
 *      dash-electron's existing listener can reopen the failing
 *      widget for editing.
 *   5. The boundary detects ai-built packages (string-presence is
 *      enough for this test).
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

describe("WidgetErrorBoundary — friendlier UI + Open in AI Builder", () => {
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

  test("ai-built detection is wired", () => {
    expect(source).toMatch(/ai-built/);
  });

  test('"Open in AI Builder" button text is present', () => {
    expect(source).toMatch(/Open in AI Builder/);
  });
});
