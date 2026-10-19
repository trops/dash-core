/**
 * Dashboard saves never fail silently (consolidation Phase 1e).
 *
 * Bugs pinned here:
 *  - A failed Save in Edit only logged to the console (stripped from the
 *    build), so the user saw nothing.
 *  - Provider picks and Dashboard Config changes outside Edit showed on screen
 *    even when their save failed.
 *
 * DashboardStage is too large to mount in a unit test, so — like the other
 * DashboardStage pins — these check the source.
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "DashboardStage.js"),
  "utf8",
);

/** The body of `function name(...) { ... }` (top-level, 2-space indent). */
function fnBody(name) {
  const m = source.match(
    new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}\\n`),
  );
  return m ? m[0] : null;
}

describe("DashboardStage — save errors are shown", () => {
  test("a failed Save tells the user and keeps Edit open with the changes", () => {
    const body = fnBody("handleSaveWorkspaceError");
    expect(body).not.toBeNull();
    expect(body).toMatch(/notifySaveError\(/);
    expect(body).toMatch(/still here/);
    // Leaving Edit / clearing dirty only happens on a real save.
    expect(body).not.toMatch(/setIsDirty\(false\)/);
    expect(body).not.toMatch(/setPreviewMode/);
  });

  test("a throw while preparing Save is shown the same way", () => {
    const body = fnBody("saveDashboardWorkspace");
    expect(body).toMatch(
      /catch \(e\) \{\s*handleSaveWorkspaceError\(null, e\);/,
    );
  });

  test("notifySaveError raises an error toast", () => {
    const body = fnBody("notifySaveError");
    expect(body).toMatch(/"dash:notify"/);
    expect(body).toMatch(/type: "error"/);
  });

  test("saveRightAway puts the screen back and tells the user when the save fails", () => {
    const body = fnBody("saveRightAway");
    expect(body).not.toBeNull();
    expect(body).toMatch(/const before = workspaceSelected;/);
    expect(body).toMatch(/updateTabWorkspace\(reconciled\)/);
    expect(body).toMatch(/updateTabWorkspace\(before\)/);
    expect(body).toMatch(/notifySaveError\(/);
    expect(body).toMatch(/dashApi\.saveWorkspace\(/);
  });

  test("no save in DashboardStage is console-only any more", () => {
    expect(source).not.toMatch(/console\.error\(\s*"Failed to save workspace/);
    expect(source).not.toMatch(/console\.error\("Error saving workspace:"/);
  });
});
