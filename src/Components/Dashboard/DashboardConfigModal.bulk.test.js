/**
 * Bulk-apply override-protection check: must consult staged state.
 *
 * Bug repro: in the dashboard config modal's Providers tab, the user
 * could
 *   1) toggle a widget's per-widget override OFF (staged unset)
 *   2) click the Bulk action to apply a provider to every widget
 *      that lacks an override
 * and the widget they just unset wouldn't be bulked. Reason:
 * stageBulk filtered by `b.layoutItem.selectedProviders[type]`
 * — the *original* layer-1 — ignoring the staged unset.
 *
 * The fix consults the staged state first: if the user staged any
 * value for this widget+type, that's the source of truth. An empty
 * staged value ("I unset it") counts as "no override" so the bulk
 * picks the widget up; a non-empty staged value ("I picked something
 * explicit") is preserved.
 *
 * Static source-presence test mirroring the NewProviderPicker
 * pattern. The `stageBulk` function is internal to the modal —
 * extracting it for unit testing would be more churn than the
 * fix itself.
 */
const fs = require("fs");
const path = require("path");

describe("DashboardConfigModal — stageBulk consults staged state", () => {
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

  test("stageBulk reads staged[widgetId]?.[providerType] inside its filter", () => {
    const body = stageBulkMatch[1];
    // Must reference the staged state map, indexed by the widget's id.
    expect(body).toMatch(/staged\[/);
  });

  test("stageBulk preserves explicit staged overrides (non-empty staged value skips the bulk)", () => {
    const body = stageBulkMatch[1];
    // Non-empty staged value → `!stagedValue` must be falsy. Easiest
    // way to express in code is a `return !stagedValue;` short-circuit
    // (or equivalent). We assert the bare-truthy short-circuit pattern.
    expect(body).toMatch(/!\s*stagedValue|stagedValue\s*&&/);
  });

  test("stageBulk has a fallback path that checks layoutItem.selectedProviders", () => {
    // If no staged value exists for this widget+type, fall back to
    // the original layer-1 check that's already in the codebase.
    const body = stageBulkMatch[1];
    expect(body).toMatch(/layoutItem[\s\S]{0,80}selectedProviders/);
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
});
