/**
 * applyBulkProviderBindings — pure utility that takes a workspace
 * and a list of provider-binding changes and returns a new workspace
 * with EVERY change reflected in BOTH:
 *   - workspace.selectedProviders[widgetId][type]   (layer 2)
 *   - item.selectedProviders[type] on every matching layout item   (layer 1)
 *
 * Bug it fixes: the bulk-edit modal previously wrote only layer 2.
 * `resolveProviderName` checks layer 1 *first*, so any pre-existing
 * layer-1 value (from a prior single-widget pick or registry import)
 * silently shadowed the bulk-save's layer-2 write — the user picks a
 * provider, hits Save, and the widget renders the OLD value (or
 * nothing) because layer 1 wins.
 *
 * The fix is pure write-through: bulk save updates both layers so a
 * user-driven choice can't be shadowed by stale layer-1 data.
 */
import { applyBulkProviderBindings } from "./applyBulkProviderBindings";

describe("applyBulkProviderBindings", () => {
  function makeWorkspace() {
    return {
      id: 999,
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          type: "grid",
          selectedProviders: {},
        },
        {
          id: 6,
          uuid: "999-trops.algolia-se-tools.IndexSelector-6",
          component: "trops.algolia-se-tools.IndexSelector",
          selectedProviders: { algolia: "Algolia John G Demos" },
        },
        {
          id: 14,
          uuid: "ai-built.alarmclockwidget.AlarmClockWidget-ai-built.alarmclockwidget.AlarmClockWidget",
          component: "ai-built.alarmclockwidget.AlarmClockWidget",
          selectedProviders: {},
        },
      ],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 6,
              uuid: "999-trops.algolia-se-tools.IndexSelector-6",
              component: "trops.algolia-se-tools.IndexSelector",
              selectedProviders: { algolia: "Algolia John G Demos" },
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 90002,
          uuid: "999-trops.algolia-se-tools.IndexSelector-90002",
          component: "trops.algolia-se-tools.IndexSelector",
          selectedProviders: { algolia: "Algolia John G Demos" },
        },
      ],
      selectedProviders: {},
    };
  }

  test("returns input unchanged when changes is empty", () => {
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, []);
    expect(out).toBe(ws);
  });

  test("returns input unchanged when changes is not an array", () => {
    const ws = makeWorkspace();
    expect(applyBulkProviderBindings(ws, null)).toBe(ws);
    expect(applyBulkProviderBindings(ws, undefined)).toBe(ws);
  });

  test("writes layer 2 (workspace.selectedProviders[widgetId][type])", () => {
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: "Algolia Flagship Search",
      },
    ]);
    expect(out.selectedProviders).toEqual({
      "999-trops.algolia-se-tools.IndexSelector-6": {
        algolia: "Algolia Flagship Search",
      },
    });
  });

  test("writes layer 1 (item.selectedProviders[type]) for every matching layout item", () => {
    // The widget appears in workspace.layout AND workspace.pages[0].layout —
    // both must be updated so the bulk pick can't be shadowed by a stale
    // layer-1 value on either copy.
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: "Algolia Flagship Search",
      },
    ]);
    const fromLayout = out.layout.find((it) => it.id === 6);
    const fromPage = out.pages[0].layout.find((it) => it.id === 6);
    expect(fromLayout.selectedProviders.algolia).toBe(
      "Algolia Flagship Search",
    );
    expect(fromPage.selectedProviders.algolia).toBe("Algolia Flagship Search");
  });

  test("writes layer 1 in sidebarLayout too", () => {
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-90002",
        providerType: "algolia",
        providerName: "Algolia Flagship Search",
      },
    ]);
    const sidebarItem = out.sidebarLayout.find((it) => it.id === 90002);
    expect(sidebarItem.selectedProviders.algolia).toBe(
      "Algolia Flagship Search",
    );
  });

  test("clears the binding (both layers) when providerName is null", () => {
    const ws = makeWorkspace();
    // First populate layer 2 directly so we have something to clear.
    ws.selectedProviders = {
      "999-trops.algolia-se-tools.IndexSelector-6": { algolia: "Old Provider" },
    };
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: null,
      },
    ]);
    // Layer 2: entry deleted (falls back to default on next resolve)
    expect(
      out.selectedProviders["999-trops.algolia-se-tools.IndexSelector-6"],
    ).toBeUndefined();
    // Layer 1: type key removed from item.selectedProviders
    const fromLayout = out.layout.find((it) => it.id === 6);
    expect(fromLayout.selectedProviders.algolia).toBeUndefined();
  });

  test("clears the binding when providerName is empty string", () => {
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: "",
      },
    ]);
    const fromLayout = out.layout.find((it) => it.id === 6);
    expect(fromLayout.selectedProviders.algolia).toBeUndefined();
  });

  test("layer 1 is the authoritative read source — write-through prevents shadowing", () => {
    // This is the bug repro: layer 1 had a stale value, layer 2 update
    // wouldn't be visible until reload. After the fix, both layers
    // update together so the pick is immediately effective.
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: "Algolia Flagship Search",
      },
    ]);
    const item = out.layout.find((it) => it.id === 6);
    // Mirror resolveProviderName's layer-1-first lookup:
    const layer1 = item.selectedProviders?.algolia;
    const layer2 =
      out.selectedProviders?.["999-trops.algolia-se-tools.IndexSelector-6"]
        ?.algolia;
    const resolved = layer1 || layer2;
    expect(resolved).toBe("Algolia Flagship Search");
  });

  test("matches by uuidString OR uuid OR id (canonical fallback chain)", () => {
    // The widget id:14 has its uuid set but no uuidString. The bulk
    // change comes in with the uuid string — the helper must find it
    // via the same chain `getAllProviderBindings` uses.
    const ws = makeWorkspace();
    const out = applyBulkProviderBindings(ws, [
      {
        widgetId:
          "ai-built.alarmclockwidget.AlarmClockWidget-ai-built.alarmclockwidget.AlarmClockWidget",
        providerType: "alarm-config",
        providerName: "My Config",
      },
    ]);
    const item = out.layout.find((it) => it.id === 14);
    expect(item.selectedProviders["alarm-config"]).toBe("My Config");
    expect(
      out.selectedProviders[
        "ai-built.alarmclockwidget.AlarmClockWidget-ai-built.alarmclockwidget.AlarmClockWidget"
      ]["alarm-config"],
    ).toBe("My Config");
  });

  test("does not mutate the input workspace", () => {
    const ws = makeWorkspace();
    const wsBefore = JSON.parse(JSON.stringify(ws));
    applyBulkProviderBindings(ws, [
      {
        widgetId: "999-trops.algolia-se-tools.IndexSelector-6",
        providerType: "algolia",
        providerName: "Algolia Flagship Search",
      },
    ]);
    expect(ws).toEqual(wsBefore);
  });
});
