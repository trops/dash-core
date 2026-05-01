/**
 * NotificationsSection — pins the master-detail layout.
 *
 * Bug it fixes: the original NotificationsSection rendered every
 * widget's notification toggles inline as a long flat scrollable
 * list, with multiple identical-looking section headers (one per
 * widget instance) when the user had several widgets from the same
 * package (e.g. three Slack widgets). With many providers the list
 * was unscannable.
 *
 * Fix mirrors the WidgetsSection master-detail pattern:
 *   - Left list: alphabetical, searchable; one row per widget
 *     instance plus a pinned "Global" entry with the master + DND
 *     toggles.
 *   - Right detail: shows ONLY the selected widget's notification
 *     toggles (or the Global panel when Global is selected).
 *
 * Static source-presence test: dash-core's existing test pattern
 * is static checks against the source file. Behavior verification
 * happens post-publish in dash-electron.
 */
const fs = require("fs");
const path = require("path");

describe("NotificationsSection — master-detail layout", () => {
  const sectionPath = path.join(__dirname, "NotificationsSection.js");
  const source = fs.readFileSync(sectionPath, "utf8");

  test("uses SectionLayout (the master-detail container)", () => {
    expect(source).toMatch(/import\s*\{[^}]*SectionLayout[^}]*\}\s*from/);
    expect(source).toMatch(/<SectionLayout/);
  });

  test("imports SearchInput + Sidebar from @trops/dash-react", () => {
    // Same imports WidgetsSection uses for the searchable list.
    expect(source).toMatch(
      /import\s*\{[^}]*SearchInput[^}]*\}\s*from\s*["']@trops\/dash-react["']/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*Sidebar[^}]*\}\s*from\s*["']@trops\/dash-react["']/,
    );
  });

  test("renders Sidebar.Item for each row", () => {
    expect(source).toMatch(/<Sidebar\.Item\b/);
  });

  test("sorts the list alphabetically", () => {
    // Either an explicit .sort() call on the list array, or use of
    // a localeCompare comparator — both are acceptable evidence
    // the list is alphabetized rather than insertion-ordered.
    const hasSort =
      /\.sort\(\s*\(/.test(source) ||
      /\.sort\(\)/.test(source) ||
      /localeCompare/.test(source);
    expect(hasSort).toBe(true);
  });

  test("tracks selection state for the master-detail switch", () => {
    // Selected widget id / instance is held in state so the detail
    // panel can render the matching widget's toggles. Look for a
    // useState that names something like 'selected'.
    expect(source).toMatch(
      /const\s*\[\s*selected[A-Za-z]*\s*,\s*set[A-Za-z]+\s*\]\s*=\s*useState/,
    );
  });

  test("preserves the global notification + DND wiring", () => {
    // The rewrite must not drop the master notifications-enabled
    // and do-not-disturb toggles — they're how the user
    // temporarily silences everything. Wire-up should still call
    // setGlobal with the same shape.
    expect(source).toMatch(/notifications\?\.setGlobal/);
    expect(source).toMatch(/globalEnabled/);
    expect(source).toMatch(/doNotDisturb/);
  });

  // ── Filter dropdowns ────────────────────────────────────────────

  test("holds filter state for Dashboard + Package", () => {
    // Both filters need to be useState so the user can swap them
    // independently. Match either single-letter or full names.
    expect(source).toMatch(
      /const\s*\[\s*filterDashboard\s*,\s*setFilterDashboard\s*\]\s*=\s*useState/,
    );
    expect(source).toMatch(
      /const\s*\[\s*filterPackage\s*,\s*setFilterPackage\s*\]\s*=\s*useState/,
    );
  });

  test("offers an 'All Dashboards' option (default)", () => {
    expect(source).toMatch(/All Dashboards/);
  });

  test("offers an 'All Packages' option (default)", () => {
    expect(source).toMatch(/All Packages/);
  });

  test("renders a Clear link when filters are active", () => {
    // Mirror WidgetsSection: when any filter is set away from
    // "all", a Clear link resets all of them.
    expect(source).toMatch(/Clear/);
    expect(source).toMatch(/hasActiveFilters|hasFilters/);
  });

  test("filter options are alphabetical", () => {
    // Both option lists should be derived via .sort() so the
    // dropdowns don't shuffle as the underlying workspaces /
    // widgets array changes order.
    const sortHits = (source.match(/\.sort\(/g) || []).length;
    // We expect at least three sorts now: instances list,
    // dashboard options, package options.
    expect(sortHits).toBeGreaterThanOrEqual(3);
  });
});
