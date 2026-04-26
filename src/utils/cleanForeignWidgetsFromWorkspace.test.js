/**
 * cleanForeignWidgetsFromWorkspace.test.js
 *
 * Pins the workspace-load cleanup that strips items whose
 * `dashboardId` doesn't match the workspace's own id. Production
 * scenario this addresses: items from one dashboard's
 * `sidebarLayout` got persisted into ANOTHER dashboard's sidebar
 * (shared array reference somewhere in the sidebar-edit flow), and
 * those foreign items were appearing in every Listeners / Providers
 * / Widgets tab the user opened. UI filtering hides them; this
 * cleanup writes them out so the next save persists the clean state.
 */

import { cleanForeignWidgetsFromWorkspace } from "./cleanForeignWidgetsFromWorkspace";

describe("cleanForeignWidgetsFromWorkspace — happy path", () => {
  test("removes foreign items from sidebarLayout", () => {
    const ws = {
      id: 100,
      sidebarLayout: [
        { id: 1, component: "OwnWidget", dashboardId: 100 },
        { id: 2, component: "ForeignWidget", dashboardId: 999 },
      ],
    };
    const summary = cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.sidebarLayout).toHaveLength(1);
    expect(ws.sidebarLayout[0].component).toBe("OwnWidget");
    expect(summary.removed).toBe(1);
  });

  test("removes foreign items from layout", () => {
    const ws = {
      id: 100,
      layout: [
        { id: 1, component: "OwnWidget", dashboardId: 100 },
        { id: 2, component: "ForeignWidget", dashboardId: 999 },
      ],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.layout).toHaveLength(1);
  });

  test("removes foreign items from pages[].layout", () => {
    const ws = {
      id: 100,
      pages: [
        {
          id: "p1",
          layout: [
            { id: 1, component: "OwnWidget", dashboardId: 100 },
            { id: 2, component: "Foreign", dashboardId: 999 },
          ],
        },
      ],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.pages[0].layout).toHaveLength(1);
    expect(ws.pages[0].layout[0].component).toBe("OwnWidget");
  });

  test("removes foreign items from nested grid containers (`items`)", () => {
    const ws = {
      id: 100,
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          dashboardId: 100,
          items: [
            { id: 2, component: "Own", dashboardId: 100 },
            { id: 3, component: "Foreign", dashboardId: 999 },
          ],
        },
      ],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.layout[0].items).toHaveLength(1);
    expect(ws.layout[0].items[0].component).toBe("Own");
  });

  test("string vs number id mismatch still resolves correctly", () => {
    // workspaces.json sometimes serializes id as number; layout
    // items sometimes carry it as string and vice versa. The
    // gate must coerce.
    const ws = {
      id: "100",
      sidebarLayout: [
        { id: 1, component: "Own", dashboardId: 100 }, // numeric stamp
        { id: 2, component: "Foreign", dashboardId: "999" }, // string stamp
      ],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.sidebarLayout).toHaveLength(1);
    expect(ws.sidebarLayout[0].component).toBe("Own");
  });
});

describe("cleanForeignWidgetsFromWorkspace — stamps unstamped items", () => {
  test("items missing dashboardId are stamped with the workspace id, not removed", () => {
    // Legacy / pre-LayoutModel data may not carry a dashboardId.
    // Stripping them would lose legitimate widgets — instead
    // adopt them into this workspace.
    const ws = {
      id: 100,
      layout: [{ id: 1, component: "Legacy" }],
    };
    const summary = cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.layout[0].dashboardId).toBe(100);
    expect(summary.stamped).toBe(1);
    expect(summary.removed).toBe(0);
  });

  test("running twice is idempotent — second pass is a no-op", () => {
    const ws = {
      id: 100,
      layout: [{ id: 1, component: "Legacy" }],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    const after1 = JSON.stringify(ws);
    const summary2 = cleanForeignWidgetsFromWorkspace(ws);
    expect(JSON.stringify(ws)).toBe(after1);
    expect(summary2).toEqual({ removed: 0, stamped: 0 });
  });
});

describe("cleanForeignWidgetsFromWorkspace — defensive", () => {
  test("workspace without an id returns zero summary (permissive)", () => {
    const ws = { layout: [{ id: 1, component: "X", dashboardId: 999 }] };
    const summary = cleanForeignWidgetsFromWorkspace(ws);
    expect(summary).toEqual({ removed: 0, stamped: 0 });
    expect(ws.layout).toHaveLength(1);
  });

  test("null / undefined inputs return zero summary without throwing", () => {
    expect(cleanForeignWidgetsFromWorkspace(null)).toEqual({
      removed: 0,
      stamped: 0,
    });
    expect(cleanForeignWidgetsFromWorkspace(undefined)).toEqual({
      removed: 0,
      stamped: 0,
    });
    expect(cleanForeignWidgetsFromWorkspace({})).toEqual({
      removed: 0,
      stamped: 0,
    });
  });

  test("preserves layout container chrome (LayoutGridContainer with foreign children)", () => {
    // The grid container itself belongs to this workspace; only
    // its children are foreign. Container survives, children
    // get filtered.
    const ws = {
      id: 100,
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          dashboardId: 100,
          items: [{ id: 2, component: "Foreign", dashboardId: 999 }],
        },
      ],
    };
    cleanForeignWidgetsFromWorkspace(ws);
    expect(ws.layout).toHaveLength(1);
    expect(ws.layout[0].items).toHaveLength(0);
  });
});

describe("cleanForeignWidgetsFromWorkspace — production scenario", () => {
  test("Kitchen Sink with Pipeline File items in sidebar gets cleaned", () => {
    // Reproduces the actual data corruption observed:
    // workspaces.json had a Kitchen Sink dashboard with two
    // items in its sidebarLayout whose dashboardId pointed at
    // Pipeline File's id.
    const kitchenSink = {
      id: 1774291410862,
      name: "Kitchen Sink",
      layout: [
        {
          id: 1,
          component: "LayoutGridContainer",
          dashboardId: 1774291410862,
        },
      ],
      sidebarLayout: [
        {
          id: 90001,
          component: "LayoutGridContainer",
          dashboardId: 1776779423903, // Pipeline File!
        },
        {
          id: 90002,
          component: "ProspectListColumn",
          dashboardId: 1776779423903, // Pipeline File!
        },
      ],
    };
    const summary = cleanForeignWidgetsFromWorkspace(kitchenSink);
    expect(summary.removed).toBe(2);
    expect(kitchenSink.sidebarLayout).toEqual([]);
  });
});
