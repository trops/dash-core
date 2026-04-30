/**
 * handleSelectProvider must propagate the new workspace to the
 * parent (DashboardStage) via onWorkspaceChangeRef.current — not
 * just LayoutBuilder's local setCurrentWorkspace.
 *
 * Bug repro: user opens an individual widget's settings, unsets the
 * provider, then opens the dashboard config bulk-edit modal. The
 * bulk modal still shows the OLD provider as set because:
 *   - setCurrentWorkspace(newWorkspace) updated LayoutBuilder's
 *     local state (so the widget re-rendered), but
 *   - onWorkspaceChange was never fired, so DashboardStage's
 *     `workspaceSelected` (which the bulk modal reads from) stayed
 *     stale.
 *
 * Every other workspace-mutating handler in LayoutBuilder pairs the
 * two calls — AI placement (~line 225-227), remix (~line 264-267),
 * delete/move/etc. handleSelectProvider was the odd one out.
 *
 * Static source-presence test mirroring the LayoutBuilder.test
 * pattern. Extracts just the handleSelectProvider block so the
 * assertions can't accidentally match a sibling function.
 */
const fs = require("fs");
const path = require("path");

describe("LayoutBuilder.handleSelectProvider — workspace propagation", () => {
  const layoutBuilderPath = path.join(__dirname, "LayoutBuilder.js");
  const source = fs.readFileSync(layoutBuilderPath, "utf8");

  // Capture the function body. The handler closes the function with
  // a `}` at the start of a line followed by the next `function`
  // keyword, so we match up to (but not including) the next
  // top-level function definition.
  const handlerMatch = source.match(
    /function handleSelectProvider\([\s\S]*?\n  \}\n/,
  );

  test("handleSelectProvider function block exists in the source", () => {
    expect(handlerMatch).not.toBeNull();
  });

  test("handleSelectProvider updates LayoutBuilder local state via setCurrentWorkspace", () => {
    expect(handlerMatch[0]).toMatch(/setCurrentWorkspace\(/);
  });

  test("handleSelectProvider propagates the workspace to the parent via onWorkspaceChangeRef.current", () => {
    // Without this call, DashboardStage's workspaceSelected stays
    // stale and the dashboard config bulk-edit modal opens with
    // out-of-date provider bindings.
    expect(handlerMatch[0]).toMatch(/onWorkspaceChangeRef\.current/);
  });
});
