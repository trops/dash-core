/**
 * "Welcome to Dash" only on a real first run (QA 2026-10-24): the check
 * waits for the first workspaces load to come back. Loading starts
 * not-loading, so before that the list is empty even with dashboards saved
 * and the dialog showed after a reload.
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

/** The first-run gate effect. */
function gate() {
  const m = source.match(
    /const onboardingCheckedRef = useRef\(false\);[\s\S]*?\n {2}\}, \[[^\]]*\]\);/,
  );
  return m ? m[0] : null;
}

describe("DashboardStage — first-run dialog", () => {
  test("the gate waits for a load to come back before deciding", () => {
    const body = gate();
    expect(body).not.toBeNull();
    expect(body).toMatch(
      /if \(isLoadingWorkspaces \|\| !workspacesLoaded\) return;\s*onboardingCheckedRef\.current = true;/,
    );
    expect(body).toMatch(/\[[^\]]*workspacesLoaded[^\]]*\]\);$/);
  });

  test("only a successful load marks the workspaces loaded", () => {
    expect(source).toMatch(
      /const \[workspacesLoaded, setWorkspacesLoaded\] = useState\(false\);/,
    );
    expect(fnBody("handleLoadWorkspacesComplete")).toMatch(
      /setWorkspacesLoaded\(true\)/,
    );
    expect(fnBody("handleLoadWorkspacesError")).not.toMatch(
      /setWorkspacesLoaded/,
    );
  });

  test("a check cut short before deciding runs again", () => {
    const body = gate();
    expect(body).toMatch(
      /cancelled = true;[\s\S]*if \(!decided\) onboardingCheckedRef\.current = false;/,
    );
  });

  test("it still opens only with no dashboards and setup not finished", () => {
    const body = gate();
    expect(body).toMatch(/status\.completed === false/);
    expect(body).toMatch(/workspaceConfig\.length === 0/);
  });
});
