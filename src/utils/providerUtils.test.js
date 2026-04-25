/**
 * providerUtils.test.js
 *
 * Regression coverage for getUserConfigurableProviders. This function
 * is called from tight spots like WidgetsSection's `uniqueProviders`
 * useMemo — a single undefined entry in a widget's `providers` array
 * used to throw `Cannot read properties of undefined (reading
 * 'providerClass')` and take the entire Settings → Widgets pane down
 * right after installing a new widget package. These tests lock the
 * null-tolerance so that can't happen again.
 */

import { getUserConfigurableProviders } from "./providerUtils";

describe("getUserConfigurableProviders", () => {
  test("returns empty for null / undefined / non-array input", () => {
    expect(getUserConfigurableProviders(null)).toEqual([]);
    expect(getUserConfigurableProviders(undefined)).toEqual([]);
    expect(getUserConfigurableProviders({})).toEqual([]);
    expect(getUserConfigurableProviders("not-an-array")).toEqual([]);
  });

  test("drops undefined / null entries without throwing", () => {
    // Regression for the 'Cannot read properties of undefined
    // (reading providerClass)' crash observed right after
    // installing @ai-built/pipeline on a clean machine.
    const providers = [
      { type: "google-drive", providerClass: "credential" },
      undefined,
      null,
      { type: "claude", providerClass: "api" },
    ];
    const result = getUserConfigurableProviders(providers);
    expect(result).toEqual([
      { type: "google-drive", providerClass: "credential" },
    ]);
  });

  test("filters out providerClass === 'api'", () => {
    const providers = [
      { type: "algolia", providerClass: "api" },
      { type: "google-drive", providerClass: "credential" },
      { type: "slack", providerClass: "mcp" },
    ];
    const result = getUserConfigurableProviders(providers);
    expect(result.map((p) => p.type)).toEqual(["google-drive", "slack"]);
  });

  test("keeps entries missing providerClass (treated as user-configurable)", () => {
    // Older widget configs predate the providerClass field. They
    // default to credential-style behavior and should not be
    // accidentally filtered out.
    const providers = [
      { type: "google-drive" },
      { type: "claude", providerClass: "api" },
    ];
    const result = getUserConfigurableProviders(providers);
    expect(result.map((p) => p.type)).toEqual(["google-drive"]);
  });

  test("combines null-drop and providerClass=api filter (both apply)", () => {
    // The interesting case: a widget that declares ONLY an api
    // provider with a stray null entry should produce [] (not
    // [null], not crash). This is what WidgetSidebar's
    // `uniqueProviders` saw before the fix.
    const providers = [{ type: "claude", providerClass: "api" }, null];
    expect(getUserConfigurableProviders(providers)).toEqual([]);
  });
});
