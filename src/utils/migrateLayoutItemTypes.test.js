/**
 * migrateLayoutItemTypes.test.js
 *
 * Pins the legacy-data correction. Pre-v0.1.444 LayoutModel
 * defaulted `type: "layout"` for items that didn't set type
 * explicitly — almost every user widget. The new default infers
 * type from the component name; this migration applies the same
 * inference to ALREADY-PERSISTED data so existing workspaces.json
 * heals on the next load+save cycle.
 */

import { migrateLayoutItemTypes } from "./migrateLayoutItemTypes";

describe("migrateLayoutItemTypes — corrects user widgets typed as 'layout'", () => {
  test("user widget with persisted type:'layout' → type:'widget'", () => {
    const ws = {
      layout: [
        {
          id: 2,
          component: "trops.algolia-se-tools.IndexSelector",
          type: "layout",
        },
      ],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(ws.layout[0].type).toBe("widget");
    expect(summary.corrected).toBe(1);
  });

  test("user widget with no type field → type:'widget'", () => {
    const ws = {
      layout: [{ id: 2, component: "trops.algolia.SearchWidget" }],
    };
    migrateLayoutItemTypes(ws);
    expect(ws.layout[0].type).toBe("widget");
  });

  test("explicit type:'widget' is left alone", () => {
    const ws = {
      layout: [
        { id: 2, component: "trops.algolia.SearchWidget", type: "widget" },
      ],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(summary.corrected).toBe(0);
  });
});

describe("migrateLayoutItemTypes — corrects framework containers", () => {
  test("LayoutGridContainer with wrong type → 'grid'", () => {
    const ws = {
      layout: [{ id: 1, component: "LayoutGridContainer", type: "widget" }],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(ws.layout[0].type).toBe("grid");
    expect(summary.corrected).toBe(1);
  });

  test("LayoutGridContainer already typed 'grid' is left alone", () => {
    const ws = {
      layout: [{ id: 1, component: "LayoutGridContainer", type: "grid" }],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(summary.corrected).toBe(0);
  });

  test("Container component → 'layout'", () => {
    const ws = {
      layout: [{ id: 1, component: "Container", type: "widget" }],
    };
    migrateLayoutItemTypes(ws);
    expect(ws.layout[0].type).toBe("layout");
  });
});

describe("migrateLayoutItemTypes — walks the whole workspace", () => {
  test("fixes items in pages[].layout and sidebarLayout", () => {
    const ws = {
      layout: [],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "trops.algolia.SearchWidget",
              type: "layout",
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 2,
          component: "trops.clock.AnalogClockWidget",
          type: "layout",
        },
      ],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(ws.pages[0].layout[0].type).toBe("widget");
    expect(ws.sidebarLayout[0].type).toBe("widget");
    expect(summary.corrected).toBe(2);
  });

  test("recurses into nested grid container `items`", () => {
    const ws = {
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          type: "grid",
          items: [
            {
              id: 2,
              component: "trops.clock.FlipClockWidget",
              type: "layout",
            },
          ],
        },
      ],
    };
    migrateLayoutItemTypes(ws);
    expect(ws.layout[0].items[0].type).toBe("widget");
  });
});

describe("migrateLayoutItemTypes — idempotent + defensive", () => {
  test("running twice produces the same result", () => {
    const ws = {
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          type: "widget",
        },
        {
          id: 2,
          component: "trops.algolia.SearchWidget",
          type: "layout",
        },
      ],
    };
    migrateLayoutItemTypes(ws);
    const after1 = JSON.stringify(ws);
    const summary2 = migrateLayoutItemTypes(ws);
    expect(JSON.stringify(ws)).toBe(after1);
    expect(summary2.corrected).toBe(0);
  });

  test("null / undefined / empty returns zero summary", () => {
    expect(migrateLayoutItemTypes(null)).toEqual({ corrected: 0 });
    expect(migrateLayoutItemTypes(undefined)).toEqual({ corrected: 0 });
    expect(migrateLayoutItemTypes({})).toEqual({ corrected: 0 });
  });

  test("does not disturb items with intentional non-default types", () => {
    // A widget intentionally typed `workspace` (rare, but legal in
    // older data) should NOT be silently retyped to `widget` — the
    // migration only corrects the `type: "layout"` / missing-type
    // case, since those are the ones produced by the old default.
    const ws = {
      layout: [
        {
          id: 1,
          component: "trops.algolia.SearchWidget",
          type: "workspace",
        },
      ],
    };
    const summary = migrateLayoutItemTypes(ws);
    expect(ws.layout[0].type).toBe("workspace");
    expect(summary.corrected).toBe(0);
  });
});

describe("migrateLayoutItemTypes — production scenario", () => {
  test("Demo & Relevance dashboard heals — 3 widgets correctly typed", () => {
    // Mirrors the workspaces.json output for the user's Demo &
    // Relevance dashboard. The grid container was typed correctly,
    // but the three widgets were all persisted with the old default
    // `type: "layout"` and disappeared from the WidgetsTab.
    const demoRelevance = {
      id: 1774955610868,
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          type: "grid",
        },
        {
          id: 2,
          component: "trops.algolia-se-tools.RelevanceTester",
          type: "layout",
        },
        {
          id: 3,
          component: "trops.algolia-se-tools.SearchPlayground",
          type: "layout",
        },
        {
          id: 4,
          component: "trops.algolia-se-tools.IndexSelector",
          type: "layout",
        },
      ],
    };
    const summary = migrateLayoutItemTypes(demoRelevance);
    expect(summary.corrected).toBe(3);
    expect(demoRelevance.layout[0].type).toBe("grid");
    expect(demoRelevance.layout[1].type).toBe("widget");
    expect(demoRelevance.layout[2].type).toBe("widget");
    expect(demoRelevance.layout[3].type).toBe("widget");
  });
});
