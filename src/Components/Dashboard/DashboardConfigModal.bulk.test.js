/**
 * Bulk-apply retargets every widget of the matching provider type.
 *
 * Bug repro (the one this file currently pins): in the dashboard
 * config modal's Providers tab, the user opens a dashboard whose
 * widgets all share one provider (e.g. all 8 Slack widgets bound to
 * "Slack"), changes the "Bulk assign" dropdown to a different provider
 * ("Slack Dash Comms"), and expects every per-widget row to retarget.
 *
 * Previously stageBulk filtered to "rows that don't already have a
 * provider" — so every row got skipped (they all had "Slack") and the
 * dropdown silently no-op'd; Save stayed disabled. The header text
 * above the dropdown reads "Apply one provider to every widget of
 * this type, or adjust per-widget below," so the fill-blanks
 * semantics fought both the UI and user expectation.
 *
 * The fix: bulk retargets ALL rows of the matching provider type.
 * Per-row overrides happen AFTER bulk if the user wants exceptions —
 * matches spreadsheet-style bulk-edit conventions.
 *
 * Static source-presence test mirroring the NewProviderPicker
 * pattern. `stageBulk` is internal to the modal — extracting it for
 * unit testing would be more churn than the fix itself.
 */
const fs = require("fs");
const path = require("path");

describe("DashboardConfigModal — stageBulk retargets all rows of the provider type", () => {
  const modalPath = path.join(__dirname, "DashboardConfigModal.js");
  const source = fs.readFileSync(modalPath, "utf8");

  // Pull just the stageBulk function body so the assertions can't
  // accidentally match a different function with similar text.
  const stageBulkMatch = source.match(
    /function stageBulk\([^)]*\)\s*\{([\s\S]*?)\n  \}/,
  );

  test("stageBulk function block exists in the source", () => {
    expect(stageBulkMatch).not.toBeNull();
  });

  test("stageBulk filters by providerType ONLY — no row exclusion based on prior value", () => {
    // The fix: every row whose providerType matches gets retargeted,
    // regardless of whether it already had an explicit pick. The
    // filter must NOT reference staged[...] or layoutItem.selectedProviders
    // inside its decision — those were the gates that caused the
    // no-op.
    const body = stageBulkMatch[1];
    // Must filter by providerType
    expect(body).toMatch(/b\.providerType\s*===\s*providerType/);
    // The filter must not gate on a stagedValue truthiness short-
    // circuit (the old fill-blanks pattern).
    expect(body).not.toMatch(/!\s*stagedValue/);
    // The filter must not gate on layoutItem.selectedProviders — that
    // was the original layer-1 gate that caused rows with inherited
    // defaults to be skipped.
    expect(body).not.toMatch(/!\s*b\.layoutItem\?\.selectedProviders/);
  });

  test("stageBulk writes to setStaged for every matching widget", () => {
    const body = stageBulkMatch[1];
    // The setter must run; iteration over affected rows must call
    // through to next[widgetId] = { ..., [providerType]: providerName }.
    expect(body).toMatch(/setStaged\(/);
    expect(body).toMatch(/\[providerType\]:\s*providerName/);
  });

  test("stageBulk normalizes a missing providerName to empty string", () => {
    // The "unset bulk" case (user picks blank) writes "" not undefined
    // so the staged overlay distinguishes "explicitly unset" from
    // "no staged entry" — the rest of the modal relies on this
    // (effectiveBindings overlay logic).
    const body = stageBulkMatch[1];
    expect(body).toMatch(/providerName\s*\|\|\s*["']\s*["']/);
  });
});

/**
 * Notifications tab in the dashboard bulk-edit modal.
 *
 * Adds a dashboard-scoped view of every widget instance that declares
 * notifications, with bulk Enable/Disable controls so a user managing
 * a busy dashboard doesn't have to drill into Settings → Notifications
 * and toggle one widget at a time. Toggles persist immediately via
 * `mainApi.notifications.setPreferences` — same path the Settings
 * panel uses, so the two views stay consistent.
 */
describe("DashboardConfigModal — Notifications tab", () => {
  const modalPath = path.join(__dirname, "DashboardConfigModal.js");
  const source = fs.readFileSync(modalPath, "utf8");

  test("notifications tab is registered as a value", () => {
    expect(source).toMatch(/setActiveTab\(\s*["']notifications["']\s*\)/);
    expect(source).toMatch(/activeTab\s*===\s*["']notifications["']/);
  });

  test("notifications tab has a visible label/button", () => {
    // Tab labels are rendered as plain text inside the tab buttons —
    // expect the word "Notifications" to appear at least once near
    // the tab block.
    expect(source).toMatch(/>\s*Notifications\s*</);
  });

  test('"Enable all" and "Disable all" bulk controls exist', () => {
    expect(source).toMatch(/Enable all/);
    expect(source).toMatch(/Disable all/);
  });

  test("notifications tab has its own search input", () => {
    // Either a SearchInput component or a placeholder text that
    // identifies the search box.
    expect(source).toMatch(/Search widgets|Search notifications/);
  });

  test("toggles persist via mainApi.notifications.setPreferences", () => {
    // Same IPC the Settings → Notifications panel uses; bulk and
    // single-toggle paths must both call it so state stays in sync.
    expect(source).toMatch(/mainApi\?\.notifications\?\.setPreferences/);
  });

  test("widget instances are alphabetized by title", () => {
    // The .sort with localeCompare in the bulk modal is the signal —
    // a sort already exists for providers, so allow >= 1 match. Pair
    // with a presence check on `title.localeCompare` specifically.
    expect(source).toMatch(/title[^.]*\.localeCompare/);
  });

  test("each row carries the scoped component id (item.component)", () => {
    // When two widgets share a title (e.g. two GitHub widgets), the
    // user can only distinguish them by the scoped component id +
    // the layout instance id. Make sure the collection captures
    // item.component as a field on the row data.
    expect(source).toMatch(/component:\s*item\.component/);
  });

  test("each row carries the layout instance id (item.id)", () => {
    // The numeric instance id is what disambiguates two rows with
    // the SAME component name (e.g. two GitHub widgets in the same
    // dashboard). Mirror the Listeners tab convention.
    expect(source).toMatch(/itemId:\s*item\.id/);
  });

  test("the rendered row displays the component id + instance id", () => {
    // The row's secondary line (under the title) must surface both
    // the scoped component id and the instance id so the user can
    // tell duplicates apart at a glance.
    // Look for a JSX expression that interpolates both fields.
    expect(source).toMatch(/wi\.component/);
    expect(source).toMatch(/wi\.itemId/);
  });

  // ── Dedup ──────────────────────────────────────────────────────────
  //
  // WorkspaceModel auto-migrates legacy non-paged workspaces by
  // aliasing pages[0].layout = workspace.layout (same reference). The
  // visit walks both, so without dedup the same widget gets pushed
  // twice. Mirror the stable-id Set pattern from providerResolution.js
  // forEachWidget.

  test("widget collection tracks a 'seen' Set to dedupe", () => {
    // Pull the widgetInstances useMemo block specifically.
    const memoMatch = source.match(
      /const widgetInstances = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[workspace\]\);/,
    );
    expect(memoMatch).not.toBeNull();
    const body = memoMatch[1];
    expect(body).toMatch(/new Set\(\)/);
    expect(body).toMatch(/seen\.has\(/);
    expect(body).toMatch(/seen\.add\(/);
  });

  test("dedup key combines component + uuid/uuidString/id", () => {
    // Mirrors providerResolution.js forEachWidget stableId formula.
    const memoMatch = source.match(
      /const widgetInstances = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[workspace\]\);/,
    );
    const body = memoMatch[1];
    // Expect a template literal that interpolates item.component with
    // one of uuidString / uuid / id.
    expect(body).toMatch(/item\.component/);
    expect(body).toMatch(/uuidString|uuid/);
  });
});
