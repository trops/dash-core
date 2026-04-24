/**
 * workspaceReconciliation.test.js
 *
 * The steel thread the user asked for: when a widget is removed from
 * a dashboard, every other widget's listener bindings that reference
 * it MUST drop, and the workspace.selectedProviders map MUST drop its
 * entry. If these tests pass we can guarantee the in-app delete flow
 * doesn't leave ghost state behind.
 */

import { reconcileWorkspaceAfterLayoutChange } from "./workspaceReconciliation";

function mkEmitter(component, id) {
  return { component, uuidString: id, id };
}

function mkReceiver(component, id, listeners) {
  return { component, uuidString: id, id, listeners };
}

describe("reconcileWorkspaceAfterLayoutChange — delete-widget steel thread", () => {
  test("drops listener entries that reference a removed widget", () => {
    const workspace = {
      layout: [
        // The emitter ("Kanban[k-1]") has already been removed.
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-1].prospectSelected"],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout[0];
    // Entire handler array only referenced the deleted widget → drop
    // the key, AND drop the now-empty listeners field.
    expect(recv.listeners).toBeUndefined();
  });

  test("keeps listener entries that reference a live widget", () => {
    const workspace = {
      layout: [
        mkEmitter("Kanban", "k-1"),
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-1].prospectSelected"],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[k-1].prospectSelected",
    ]);
  });

  test("mixed handler array keeps live refs, drops dead refs", () => {
    const workspace = {
      layout: [
        mkEmitter("Kanban", "k-live"),
        mkReceiver("Workspace", "w-1", {
          prospectSelected: [
            "Kanban[k-live].prospectSelected",
            "Kanban[k-dead].prospectSelected",
          ],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[k-live].prospectSelected",
    ]);
  });

  test("empty handler array drops the handler key", () => {
    const workspace = {
      layout: [
        // Kanban[k-live] stays so listeners object isn't wiped entirely.
        mkEmitter("Kanban", "k-live"),
        mkReceiver("Workspace", "w-1", {
          stageChanged: ["Kanban[k-dead].stageChanged"],
          prospectSelected: ["Kanban[k-live].prospectSelected"],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.stageChanged).toBeUndefined();
    expect(recv.listeners.prospectSelected).toBeDefined();
  });

  test("drops selectedProviders entries keyed by removed widgets", () => {
    const workspace = {
      layout: [mkEmitter("Kanban", "k-live")],
      selectedProviders: {
        "k-live": { filesystem: "Local" },
        "k-dead": { filesystem: "Stale" },
      },
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    expect(out.selectedProviders["k-live"]).toEqual({ filesystem: "Local" });
    expect(out.selectedProviders["k-dead"]).toBeUndefined();
  });

  test("prunes pages[].layout too", () => {
    const workspace = {
      layout: [mkEmitter("Kanban", "k-live")],
      pages: [
        {
          id: "p1",
          layout: [
            mkReceiver("Workspace", "w-1", {
              prospectSelected: [
                "Kanban[k-live].prospectSelected",
                "Kanban[k-dead].prospectSelected",
              ],
            }),
          ],
        },
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.pages[0].layout[0];
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[k-live].prospectSelected",
    ]);
  });

  test("prunes sidebarLayout too", () => {
    const workspace = {
      layout: [mkEmitter("Kanban", "k-live")],
      sidebarLayout: [
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-dead].prospectSelected"],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    expect(out.sidebarLayout[0].listeners).toBeUndefined();
  });

  test("prunes inside nested LayoutGridContainer items/layout", () => {
    const workspace = {
      layout: [
        mkEmitter("Kanban", "k-live"),
        {
          component: "LayoutGridContainer",
          uuidString: "grid-1",
          items: [
            mkReceiver("Workspace", "w-1", {
              prospectSelected: ["Kanban[k-dead].prospectSelected"],
            }),
          ],
        },
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const grid = out.layout.find((i) => i.component === "LayoutGridContainer");
    expect(grid.items[0].listeners).toBeUndefined();
  });
});

describe("reconcileWorkspaceAfterLayoutChange — LayoutModel-shape identity", () => {
  // Simulates what LayoutModel produces on workspace load: numeric `id`
  // plus a composite `uuid = ${dashboardId}-${component}-${id}`. No
  // `uuidString` — that's a WidgetFactory runtime-only field. Event
  // strings on persisted listeners use the numeric `id`, so the
  // reconciler must recognize this item by `component|id` even though
  // `uuid` is set to a different-looking string.
  function mkLayoutModelWidget(component, id, extras = {}) {
    const dashboardId = 42;
    return {
      component,
      id,
      uuid: `${dashboardId}-${component}-${id}`,
      ...extras,
    };
  }

  test("preserves listener bound by numeric id when emitter has composite uuid", () => {
    const workspace = {
      layout: [
        mkLayoutModelWidget("Kanban", 123),
        mkLayoutModelWidget("Workspace", 456, {
          listeners: {
            prospectSelected: ["Kanban[123].prospectSelected"],
          },
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[123].prospectSelected",
    ]);
  });

  test("drops listener bound to a widget that is truly absent", () => {
    const workspace = {
      layout: [
        mkLayoutModelWidget("Workspace", 456, {
          listeners: {
            prospectSelected: ["Kanban[999].prospectSelected"],
          },
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout.find((i) => i.component === "Workspace");
    expect(recv.listeners).toBeUndefined();
  });

  test("preserves listener across pages[].layout for LayoutModel-shape items", () => {
    const workspace = {
      layout: [],
      pages: [
        {
          id: "p1",
          layout: [
            mkLayoutModelWidget("Kanban", 123),
            mkLayoutModelWidget("Workspace", 456, {
              listeners: {
                prospectSelected: ["Kanban[123].prospectSelected"],
              },
            }),
          ],
        },
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.pages[0].layout.find((i) => i.component === "Workspace");
    expect(recv.listeners.prospectSelected).toEqual([
      "Kanban[123].prospectSelected",
    ]);
  });
});

describe("reconcileWorkspaceAfterLayoutChange — invariants", () => {
  test("idempotent: reconcile(reconcile(ws)) deep-equals reconcile(ws)", () => {
    const workspace = {
      layout: [
        mkEmitter("Kanban", "k-live"),
        mkReceiver("Workspace", "w-1", {
          prospectSelected: [
            "Kanban[k-live].prospectSelected",
            "Kanban[k-dead].prospectSelected",
          ],
        }),
      ],
      selectedProviders: { "k-live": {}, "k-dead": {} },
    };
    const once = reconcileWorkspaceAfterLayoutChange(workspace);
    const twice = reconcileWorkspaceAfterLayoutChange(once);
    expect(twice).toEqual(once);
  });

  test("no-op on clean workspace returns SAME reference", () => {
    const workspace = {
      layout: [
        mkEmitter("Kanban", "k-live"),
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-live].prospectSelected"],
        }),
      ],
      selectedProviders: { "k-live": {} },
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    // Same reference — no stale state, no work done, memoizers can
    // short-circuit on reference equality.
    expect(out).toBe(workspace);
  });

  test("returns a NEW reference when pruning anything", () => {
    const workspace = {
      layout: [
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-dead].prospectSelected"],
        }),
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    // New reference → React memos recompute downstream.
    expect(out).not.toBe(workspace);
  });

  test("never mutates the input", () => {
    const workspace = {
      layout: [
        mkReceiver("Workspace", "w-1", {
          prospectSelected: ["Kanban[k-dead].prospectSelected"],
        }),
      ],
      selectedProviders: { "k-dead": {} },
    };
    const before = JSON.stringify(workspace);
    reconcileWorkspaceAfterLayoutChange(workspace);
    expect(JSON.stringify(workspace)).toBe(before);
  });

  test("handles null / undefined / non-object gracefully", () => {
    expect(reconcileWorkspaceAfterLayoutChange(null)).toBeNull();
    expect(reconcileWorkspaceAfterLayoutChange(undefined)).toBeUndefined();
    expect(reconcileWorkspaceAfterLayoutChange("nope")).toBe("nope");
  });

  test("leaves unparseable listener entries alone (back-compat)", () => {
    // Legacy workspaces may carry non-array values under a handler
    // key, or a string that isn't in Component[id].event form.
    // Reconciliation only prunes what it can parse; the rest passes
    // through untouched so a bad saved format doesn't cause data
    // loss during cleanup.
    const workspace = {
      layout: [
        {
          component: "Workspace",
          uuidString: "w-1",
          listeners: {
            legacyString: "Kanban",
            legacyObj: { source: "Kanban" },
            prospectSelected: ["bogus-event-string"],
          },
        },
      ],
    };
    const out = reconcileWorkspaceAfterLayoutChange(workspace);
    const recv = out.layout[0];
    expect(recv.listeners.legacyString).toBe("Kanban");
    expect(recv.listeners.legacyObj).toEqual({ source: "Kanban" });
    expect(recv.listeners.prospectSelected).toEqual(["bogus-event-string"]);
  });
});
