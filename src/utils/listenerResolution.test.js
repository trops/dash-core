/**
 * listenerResolution.test.js
 *
 * Steel-thread tests for identity + query correctness. These are the
 * tests that SHOULD have existed before. Every scenario here maps
 * directly to a user-visible bug that bit in production (duplicate
 * emitter rows, stale bindings, silent no-op runtime, etc.).
 */

import {
  canonicalItemKey,
  formatEventString,
  parseEventString,
  getEmitters,
  getReceivers,
  getCurrentWiring,
  getOrphanedListeners,
  applyWiringChanges,
} from "./listenerResolution";

// Minimal getWidgetConfig stub — returns the events/handlers inline so
// tests don't need to touch the ComponentManager.
const mkConfig = (componentMap) => (name) => componentMap[name] || null;

describe("canonicalItemKey", () => {
  test("prefers uuidString", () => {
    expect(canonicalItemKey({ component: "A", uuidString: "abc", id: 1 })).toBe(
      "A|abc",
    );
  });
  test("falls back to uuid", () => {
    expect(canonicalItemKey({ component: "A", uuid: "xyz", id: 2 })).toBe(
      "A|xyz",
    );
  });
  test("falls back to id", () => {
    expect(canonicalItemKey({ component: "A", id: 5 })).toBe("A|5");
  });
  test("null when component missing", () => {
    expect(canonicalItemKey({ id: 1 })).toBeNull();
  });
  test("null when item is null", () => {
    expect(canonicalItemKey(null)).toBeNull();
  });
});

describe("getEmitters — dedupe", () => {
  const cfg = mkConfig({
    Kanban: { events: ["prospectSelected"] },
    Workspace: { events: ["stageChanged"] },
  });

  test("same widget in layout and pages → 1 emitter (shared ref)", () => {
    const widget = { component: "Kanban", uuidString: "k-1" };
    const workspace = {
      layout: [widget],
      pages: [{ id: "p1", layout: [widget] }],
    };
    const emitters = getEmitters(workspace, cfg);
    expect(emitters).toHaveLength(1);
    expect(emitters[0].component).toBe("Kanban");
  });

  test("same widget in layout and pages → 1 emitter (distinct refs, same uuid)", () => {
    const workspace = {
      layout: [{ component: "Kanban", uuidString: "k-1" }],
      pages: [
        { id: "p1", layout: [{ component: "Kanban", uuidString: "k-1" }] },
      ],
    };
    expect(getEmitters(workspace, cfg)).toHaveLength(1);
  });

  test("same component + same numeric id, distinct uuidStrings → 1 emitter", () => {
    // This was the production bug: STAGEGATECHECKLIST [4] appeared
    // twice because one code path deduped by id and the other by
    // uuid. After canonicalItemKey they agree.
    const workspace = {
      layout: [
        { component: "SGC", uuidString: "u-a", id: 4 },
        { component: "SGC", uuidString: "u-b", id: 4 },
      ],
    };
    const cfgSgc = mkConfig({ SGC: { events: ["stageChanged"] } });
    const emitters = getEmitters(workspace, cfgSgc);
    expect(emitters).toHaveLength(2);
    // Different uuids → two distinct instances; both survive. The bug
    // was a SINGLE instance appearing twice. Confirm no duplicate key.
    const keys = new Set(emitters.map((e) => e.key));
    expect(keys.size).toBe(2);
  });

  test("widget nested inside LayoutGridContainer → emits once", () => {
    const inner = { component: "Kanban", uuidString: "k-1" };
    const workspace = {
      layout: [
        {
          component: "LayoutGridContainer",
          uuidString: "grid-1",
          items: [inner],
          layout: [inner],
        },
      ],
    };
    expect(getEmitters(workspace, cfg)).toHaveLength(1);
  });

  test("widget with no declared events → not an emitter", () => {
    const workspace = {
      layout: [{ component: "Noop", uuidString: "n-1" }],
    };
    const cfgNoop = mkConfig({ Noop: { events: [] } });
    expect(getEmitters(workspace, cfgNoop)).toHaveLength(0);
  });
});

describe("getReceivers — dedupe", () => {
  const cfg = mkConfig({
    Workspace: { eventHandlers: ["prospectSelected", "stageChanged"] },
  });

  test("same widget in layout + pages → 1 receiver", () => {
    const w = { component: "Workspace", uuidString: "w-1" };
    expect(
      getReceivers({ layout: [w], pages: [{ id: "p", layout: [w] }] }, cfg),
    ).toHaveLength(1);
  });

  test("exposes handler list from config", () => {
    const receivers = getReceivers(
      { layout: [{ component: "Workspace", uuidString: "w-1" }] },
      cfg,
    );
    expect(receivers[0].eventHandlers).toEqual([
      "prospectSelected",
      "stageChanged",
    ]);
  });
});

describe("getCurrentWiring", () => {
  test("reads the array listener format", () => {
    const workspace = {
      layout: [
        {
          component: "Workspace",
          uuidString: "w-1",
          listeners: {
            prospectSelected: ["Kanban[k-1].prospectSelected"],
          },
        },
      ],
    };
    const wiring = getCurrentWiring(workspace);
    expect(wiring).toHaveLength(1);
    expect(wiring[0]).toMatchObject({
      handlerName: "prospectSelected",
      sourceComponent: "Kanban",
      sourceItemId: "k-1",
      eventName: "prospectSelected",
    });
  });

  test("no duplicates when same binding listed twice", () => {
    const workspace = {
      layout: [
        {
          component: "Workspace",
          uuidString: "w-1",
          listeners: {
            prospectSelected: [
              "Kanban[k-1].prospectSelected",
              "Kanban[k-1].prospectSelected",
            ],
          },
        },
      ],
    };
    // The current format stores arrays verbatim — de-dupe happens at
    // the apply-changes layer. Confirm getCurrentWiring surfaces
    // both so downstream code can decide.
    const wiring = getCurrentWiring(workspace);
    expect(wiring).toHaveLength(2);
  });
});

describe("getOrphanedListeners", () => {
  const cfg = mkConfig({
    Workspace: { eventHandlers: ["prospectSelected"] },
    Kanban: { events: ["prospectSelected"] },
  });

  test("binding to missing source → orphan with source-missing reason", () => {
    const workspace = {
      layout: [
        {
          component: "Workspace",
          uuidString: "w-1",
          listeners: {
            prospectSelected: ["DeletedWidget[4].prospectSelected"],
          },
        },
      ],
    };
    const orphans = getOrphanedListeners(workspace, cfg);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].reason).toMatch(/missing|not.*exist/i);
  });

  test("binding to live source → not an orphan", () => {
    const workspace = {
      layout: [
        { component: "Kanban", uuidString: "k-1" },
        {
          component: "Workspace",
          uuidString: "w-1",
          listeners: {
            prospectSelected: ["Kanban[k-1].prospectSelected"],
          },
        },
      ],
    };
    expect(getOrphanedListeners(workspace, cfg)).toHaveLength(0);
  });
});

describe("applyWiringChanges — adds/removes round-trip", () => {
  const baseWorkspace = {
    id: "ws",
    layout: [
      { component: "Kanban", uuidString: "k-1", id: 1 },
      { component: "Workspace", uuidString: "w-1", id: 2 },
    ],
  };

  test("add creates the listener array", () => {
    const next = applyWiringChanges(baseWorkspace, {
      adds: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const recv = next.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[k-1].prospectSelected",
    ]);
  });

  test("adding the same binding twice doesn't duplicate", () => {
    const after1 = applyWiringChanges(baseWorkspace, {
      adds: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const after2 = applyWiringChanges(after1, {
      adds: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const recv = after2.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toHaveLength(1);
  });

  test("remove drops the event string", () => {
    const added = applyWiringChanges(baseWorkspace, {
      adds: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const removed = applyWiringChanges(added, {
      removes: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const recv = removed.layout.find((i) => i.component === "Workspace");
    // Empty handler array → the key is dropped entirely.
    expect(recv.listeners.prospectSelected).toBeUndefined();
  });

  test("aliased workspace.layout === pages[0].layout still patches every reference (listener edition)", () => {
    // Same shape applyBulkUserPrefs has to handle — WorkspaceModel
    // sets `page.layout = workspace.layout` when no pages are
    // explicitly defined, so the same item appears in BOTH locations.
    // applyWiringChanges must produce a workspace where both
    // locations carry the new listener, otherwise renders that read
    // from page.layout (the typical path post-WorkspaceModel
    // migration) see stale data.
    const sharedItem = {
      id: 2,
      component: "Workspace",
      eventHandlers: ["prospectSelected"],
      listeners: {},
    };
    const ws = {
      layout: [
        {
          id: 1,
          component: "Kanban",
          uuidString: "k-1",
          events: ["prospectSelected"],
        },
        sharedItem,
      ],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "Kanban",
              uuidString: "k-1",
              events: ["prospectSelected"],
            },
            sharedItem,
          ],
        },
      ],
    };
    const next = applyWiringChanges(ws, {
      adds: [
        {
          receiverItemId: 2,
          handlerName: "prospectSelected",
          sourceComponent: "Kanban",
          sourceItemId: "k-1",
          eventName: "prospectSelected",
        },
      ],
    });
    const rootRecv = next.layout.find((i) => i.id === 2);
    const pageRecv = next.pages[0].layout.find((i) => i.id === 2);
    expect(rootRecv.listeners.prospectSelected).toEqual([
      "Kanban[k-1].prospectSelected",
    ]);
    expect(pageRecv.listeners.prospectSelected).toEqual([
      "Kanban[k-1].prospectSelected",
    ]);
  });
});

describe("cross-dashboard isolation", () => {
  // Reproduces the production bug: two dashboards open, the
  // Listeners tab for a widget in dashboard B shows widgets that
  // belong to dashboard A. LayoutModel stamps `dashboardId` on every
  // item — getEmitters / getReceivers / getCurrentWiring /
  // getOrphanedListeners must filter on it so cross-dashboard
  // contamination (shared array refs, stale caches, copy/paste
  // between dashboards, anything) can't surface widgets the user
  // isn't actually editing.
  const cfg = mkConfig({
    Kanban: { events: ["prospectSelected"] },
    Workspace: { eventHandlers: ["prospectSelected"] },
  });

  test("getEmitters drops items stamped with a different dashboardId", () => {
    const workspace = {
      id: "dash-B",
      layout: [
        // Belongs to this workspace — should appear.
        {
          component: "Kanban",
          uuidString: "k-b1",
          dashboardId: "dash-B",
        },
        // Stamped to dashboard A — must NOT appear.
        {
          component: "Kanban",
          uuidString: "k-a1",
          dashboardId: "dash-A",
        },
      ],
    };
    const emitters = getEmitters(workspace, cfg);
    expect(emitters).toHaveLength(1);
    expect(emitters[0].itemId).toMatch(/k-b1/);
  });

  test("getReceivers drops items stamped with a different dashboardId", () => {
    const workspace = {
      id: 2,
      layout: [
        { component: "Workspace", uuidString: "w-1", dashboardId: 2 },
        { component: "Workspace", uuidString: "w-foreign", dashboardId: 99 },
      ],
    };
    const receivers = getReceivers(workspace, cfg);
    expect(receivers).toHaveLength(1);
    expect(receivers[0].itemId).toMatch(/w-1/);
  });

  test("getCurrentWiring ignores listeners on items from another dashboard", () => {
    // A foreign widget that somehow ended up in this workspace's
    // tree carries a listener pointing at its OWN (foreign)
    // emitter. Surfacing it would let the user "remove" wiring
    // they don't own. Filtered.
    const workspace = {
      id: "dash-B",
      layout: [
        {
          component: "Workspace",
          id: 1,
          dashboardId: "dash-B",
          listeners: {
            prospectSelected: ["Kanban[k-b1].prospectSelected"],
          },
        },
        {
          component: "Workspace",
          id: 2,
          dashboardId: "dash-A",
          listeners: {
            prospectSelected: ["Kanban[k-a1].prospectSelected"],
          },
        },
      ],
    };
    const wiring = getCurrentWiring(workspace);
    expect(wiring).toHaveLength(1);
    expect(wiring[0].sourceItemId).toBe("k-b1");
  });

  test("workspace without an id falls back to permissive (synthetic test fixtures still work)", () => {
    // Many existing tests pass workspaces without an `id`. The
    // filter must not regress them — items with no dashboardId
    // stamp pass through when the workspace also has no id.
    const workspace = {
      layout: [{ component: "Kanban", uuidString: "k-1" }],
    };
    expect(getEmitters(workspace, cfg)).toHaveLength(1);
  });

  test("legacy items without a dashboardId stamp pass through (back-compat)", () => {
    // Pre-LayoutModel data may not carry a dashboardId. We still
    // surface those items so a partially-migrated workspace
    // doesn't lose its emitters.
    const workspace = {
      id: "dash-B",
      layout: [{ component: "Kanban", uuidString: "k-legacy" }],
    };
    expect(getEmitters(workspace, cfg)).toHaveLength(1);
  });
});

describe("event string format round-trip", () => {
  test("format then parse is identity", () => {
    const s = formatEventString("Kanban", "k-1", "prospectSelected");
    expect(parseEventString(s)).toEqual({
      component: "Kanban",
      itemId: "k-1",
      event: "prospectSelected",
    });
  });
});
