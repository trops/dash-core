/**
 * applyBulkUserPrefs.test.js
 *
 * Pins the Widgets-tab "Apply to all" → Save flow. The bug this
 * prevents: bulk-edit appears to do nothing because the widget
 * identity used to stage the change doesn't match the identity used
 * to walk the workspace, so the patch silently fails to land on
 * any item.
 *
 * Identity rules (must match `WidgetsTab.widgets[].id` resolution):
 *   - prefer uuidString
 *   - then uuid
 *   - then numeric id
 * String/number coercion is also exercised — React state
 * sometimes serializes the numeric id to a string and back.
 */

import { applyBulkUserPrefs } from "./applyBulkUserPrefs";

const WIDGET = (overrides = {}) => ({
  id: 1,
  component: "trops.pkg.W",
  type: "widget",
  userPrefs: {},
  ...overrides,
});

describe("applyBulkUserPrefs — happy path", () => {
  test("patches userPrefs on every matched widget by uuidString", () => {
    const ws = {
      layout: [
        WIDGET({ id: 1, uuidString: "uuid-1" }),
        WIDGET({ id: 2, uuidString: "uuid-2" }),
      ],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "uuid-1", key: "title", value: "A" },
      { widgetId: "uuid-2", key: "title", value: "B" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("A");
    expect(out.layout[1].userPrefs.title).toBe("B");
  });

  test("patches via uuid when uuidString is absent", () => {
    const ws = {
      layout: [WIDGET({ id: 1, uuid: "u-1" })],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "Hello" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("Hello");
  });

  test("patches via numeric id when uuidString and uuid are absent", () => {
    const ws = {
      layout: [WIDGET({ id: 5 })],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: 5, key: "title", value: "FromNumericId" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("FromNumericId");
  });

  test("string widgetId matches numeric item.id and vice versa", () => {
    // The exact symptom of the production bug: WidgetsTab stores
    // `id: 5` (number), staging coerces to `"5"` somewhere, and
    // the walker compares `byWidget.has(5)` to a "5" key — Map
    // strict equality fails. Both directions must work.
    const ws = {
      layout: [WIDGET({ id: 5 }), WIDGET({ id: 7 })],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "5", key: "title", value: "stringKey" },
      { widgetId: 7, key: "title", value: "numericKey" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("stringKey");
    expect(out.layout[1].userPrefs.title).toBe("numericKey");
  });

  test("merges multiple field patches for the same widget", () => {
    const ws = {
      layout: [WIDGET({ id: 1, uuidString: "u-1" })],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "T" },
      { widgetId: "u-1", key: "subtitle", value: "S" },
    ]);
    expect(out.layout[0].userPrefs).toEqual({ title: "T", subtitle: "S" });
  });

  test("preserves untouched userPrefs fields when patching one field", () => {
    const ws = {
      layout: [
        WIDGET({
          id: 1,
          uuidString: "u-1",
          userPrefs: { title: "old", color: "red" },
        }),
      ],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "new" },
    ]);
    expect(out.layout[0].userPrefs).toEqual({
      title: "new",
      color: "red",
    });
  });
});

describe("applyBulkUserPrefs — walks the whole workspace", () => {
  test("patches widgets nested in pages[].layout", () => {
    const ws = {
      layout: [],
      pages: [
        {
          id: "p1",
          layout: [WIDGET({ id: 10, uuidString: "u-10" })],
        },
      ],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-10", key: "title", value: "Paged" },
    ]);
    expect(out.pages[0].layout[0].userPrefs.title).toBe("Paged");
  });

  test("patches widgets in sidebarLayout", () => {
    const ws = {
      sidebarLayout: [WIDGET({ id: 99, uuidString: "u-99" })],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-99", key: "title", value: "Side" },
    ]);
    expect(out.sidebarLayout[0].userPrefs.title).toBe("Side");
  });

  test("patches widgets nested in grid container `items`", () => {
    const ws = {
      layout: [
        {
          id: 100,
          component: "LayoutGridContainer",
          items: [WIDGET({ id: 1, uuidString: "u-1" })],
        },
      ],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "Nested" },
    ]);
    expect(out.layout[0].items[0].userPrefs.title).toBe("Nested");
  });
});

describe("applyBulkUserPrefs — purity + edge cases", () => {
  test("does not mutate the input workspace", () => {
    const ws = {
      layout: [WIDGET({ id: 1, uuidString: "u-1" })],
    };
    const before = JSON.stringify(ws);
    applyBulkUserPrefs(ws, [{ widgetId: "u-1", key: "title", value: "X" }]);
    expect(JSON.stringify(ws)).toBe(before);
  });

  test("widgets with no matching id are left untouched", () => {
    const ws = {
      layout: [
        WIDGET({ id: 1, uuidString: "u-1" }),
        WIDGET({ id: 2, uuidString: "u-2" }),
      ],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "only-1" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("only-1");
    expect(out.layout[1].userPrefs.title).toBeUndefined();
  });

  test("returns input verbatim for empty / malformed change set", () => {
    const ws = { layout: [WIDGET({ id: 1 })] };
    expect(applyBulkUserPrefs(ws, [])).toBe(ws);
    expect(applyBulkUserPrefs(ws, null)).toBe(ws);
    expect(applyBulkUserPrefs(ws, undefined)).toBe(ws);
    // Changes missing widgetId or key are ignored — if all are
    // ignored, the workspace passes through unchanged.
    expect(applyBulkUserPrefs(ws, [{ key: "title", value: "x" }])).toBe(ws);
    expect(applyBulkUserPrefs(ws, [{ widgetId: "u-1", value: "x" }])).toBe(ws);
  });

  test("null / undefined workspace returns the input verbatim", () => {
    expect(applyBulkUserPrefs(null, [])).toBe(null);
    expect(applyBulkUserPrefs(undefined, [])).toBe(undefined);
  });

  test("a widget without prior userPrefs gets one created", () => {
    const ws = {
      layout: [{ id: 1, component: "trops.pkg.W", type: "widget" }],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: 1, key: "title", value: "first" },
    ]);
    expect(out.layout[0].userPrefs).toEqual({ title: "first" });
  });

  test("forEachWidget dedupe: a workspace where pages[0].layout aliases workspace.layout patches each widget once", () => {
    // WorkspaceModel sets `page.layout = workspace.layout` when
    // pages is empty; the deep-clone breaks the alias, but the
    // walker's dedupe must still ensure no item is patched twice
    // (which would still produce the correct value but might
    // double-count in counters added later).
    const sharedItem = WIDGET({ id: 1, uuidString: "u-1" });
    const ws = {
      layout: [sharedItem],
      pages: [{ id: "p1", layout: [sharedItem] }],
    };
    const out = applyBulkUserPrefs(ws, [
      { widgetId: "u-1", key: "title", value: "Once" },
    ]);
    expect(out.layout[0].userPrefs.title).toBe("Once");
    expect(out.pages[0].layout[0].userPrefs.title).toBe("Once");
  });
});
