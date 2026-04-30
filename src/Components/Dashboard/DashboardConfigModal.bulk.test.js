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
