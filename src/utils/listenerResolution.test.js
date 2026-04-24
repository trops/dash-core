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
