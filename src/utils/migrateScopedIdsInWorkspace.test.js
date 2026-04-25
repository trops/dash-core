/**
 * migrateScopedIdsInWorkspace.test.js
 *
 * Pins the workspace-level pre-pass that converts legacy bare
 * component refs (and the listener event strings that point at
 * them) to the canonical `scope.package.Component` form.
 *
 * The bug this prevents: a v0.1.434 workspace stored
 *   `component: "EventSenderWidget"` and
 *   `listeners["onMessage"] = ["EventSenderWidget[5].buttonClicked"]`
 * The v0.1.435 LayoutModel migrated `component` to scoped but left
 * the listener string bare. The runtime publisher emits under the
 * scoped form, so subscriptions never matched and listeners stopped
 * firing. Worse, `pruneDeadListenerReferences` saw the bare listener
 * vs scoped live items and removed the wiring as an "orphan" on the
 * next save — silently destroying the user's data.
 */

import { migrateScopedIdsInWorkspace } from "./migrateScopedIdsInWorkspace";

const STUB_REGISTRY = {
  "trops.dash-samples.EventSenderWidget": { type: "widget" },
  "trops.dash-samples.EventReceiverWidget": { type: "widget" },
  "trops.dash-samples.NotificationWidget": { type: "widget" },
};

describe("migrateScopedIdsInWorkspace — happy path", () => {
  test("migrates bare component on a root layout item", () => {
    const ws = {
      layout: [{ id: 1, component: "EventSenderWidget" }],
    };
    const counts = migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[0].component).toBe("trops.dash-samples.EventSenderWidget");
    expect(counts.components).toBe(1);
    expect(counts.listeners).toBe(0);
  });

  test("migrates bare source component inside a listener event string", () => {
    const ws = {
      layout: [
        { id: 1, component: "EventSenderWidget" },
        {
          id: 2,
          component: "EventReceiverWidget",
          listeners: {
            onMessage: ["EventSenderWidget[1].buttonClicked"],
          },
        },
      ],
    };
    const counts = migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[1].listeners.onMessage[0]).toBe(
      "trops.dash-samples.EventSenderWidget[1].buttonClicked",
    );
    expect(counts.components).toBe(2);
    expect(counts.listeners).toBe(1);
  });

  test("walks pages — items in pages[].layout migrate too", () => {
    const ws = {
      layout: [],
      pages: [
        {
          id: "page-1",
          layout: [
            { id: 1, component: "EventSenderWidget" },
            {
              id: 2,
              component: "EventReceiverWidget",
              listeners: {
                onMessage: ["EventSenderWidget[1].buttonClicked"],
              },
            },
          ],
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.pages[0].layout[0].component).toBe(
      "trops.dash-samples.EventSenderWidget",
    );
    expect(ws.pages[0].layout[1].listeners.onMessage[0]).toBe(
      "trops.dash-samples.EventSenderWidget[1].buttonClicked",
    );
  });

  test("walks sidebarLayout", () => {
    const ws = {
      sidebarLayout: [{ id: 9, component: "NotificationWidget" }],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.sidebarLayout[0].component).toBe(
      "trops.dash-samples.NotificationWidget",
    );
  });

  test("walks nested grid items recursively", () => {
    const ws = {
      layout: [
        {
          id: 100,
          component: "LayoutGridContainer",
          items: [
            {
              id: 1,
              component: "EventSenderWidget",
            },
          ],
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[0].items[0].component).toBe(
      "trops.dash-samples.EventSenderWidget",
    );
  });
});

describe("migrateScopedIdsInWorkspace — idempotency + edge cases", () => {
  test("already-scoped items pass through unchanged", () => {
    const ws = {
      layout: [
        {
          id: 1,
          component: "trops.dash-samples.EventSenderWidget",
          listeners: {
            onTick: ["trops.dash-samples.EventReceiverWidget[2].buttonClicked"],
          },
        },
      ],
    };
    const counts = migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(counts.components).toBe(0);
    expect(counts.listeners).toBe(0);
    expect(ws.layout[0].component).toBe("trops.dash-samples.EventSenderWidget");
  });

  test("calling twice produces the same result as calling once", () => {
    const ws = {
      layout: [
        {
          id: 2,
          component: "EventReceiverWidget",
          listeners: {
            onMessage: ["EventSenderWidget[1].buttonClicked"],
          },
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    const after1 = JSON.stringify(ws);
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    const after2 = JSON.stringify(ws);
    expect(after2).toBe(after1);
  });

  test("ambiguous bare names (multiple matches) stay bare", () => {
    // Two registry entries end in `.Foo` — migration refuses to
    // guess. The renderer surfaces WidgetNotFound rather than a
    // wrong widget. A republish of the source dashboard adds
    // explicit packageId metadata that disambiguates.
    const ambiguousRegistry = {
      "trops.alpha.Foo": { type: "widget" },
      "trops.beta.Foo": { type: "widget" },
    };
    const ws = { layout: [{ id: 1, component: "Foo" }] };
    const counts = migrateScopedIdsInWorkspace(ws, ambiguousRegistry);
    expect(ws.layout[0].component).toBe("Foo");
    expect(counts.components).toBe(0);
  });

  test("unregistered widgets stay bare (no false-positive migration)", () => {
    const ws = { layout: [{ id: 1, component: "MissingWidget" }] };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[0].component).toBe("MissingWidget");
  });

  test("malformed listener strings are skipped, not corrupted", () => {
    const ws = {
      layout: [
        {
          id: 2,
          component: "EventReceiverWidget",
          listeners: {
            onMessage: [
              "garbage-no-bracket",
              "EventSenderWidget[1].buttonClicked",
              "",
              null,
            ],
          },
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    const list = ws.layout[0].listeners.onMessage;
    // Only the well-formed string was migrated; everything else
    // is preserved as-is so manual repair is still possible.
    expect(list[0]).toBe("garbage-no-bracket");
    expect(list[1]).toBe(
      "trops.dash-samples.EventSenderWidget[1].buttonClicked",
    );
    expect(list[2]).toBe("");
    expect(list[3]).toBe(null);
  });

  test("listener handler entry that isn't an array is left alone", () => {
    const ws = {
      layout: [
        {
          id: 2,
          component: "EventReceiverWidget",
          listeners: {
            onLegacy: "EventSenderWidget[1].buttonClicked",
          },
        },
      ],
    };
    const counts = migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[0].listeners.onLegacy).toBe(
      "EventSenderWidget[1].buttonClicked",
    );
    expect(counts.listeners).toBe(0);
  });

  test("null/empty inputs return zero counts without throwing", () => {
    expect(migrateScopedIdsInWorkspace(null, STUB_REGISTRY)).toEqual({
      components: 0,
      listeners: 0,
    });
    expect(migrateScopedIdsInWorkspace({}, STUB_REGISTRY)).toEqual({
      components: 0,
      listeners: 0,
    });
    expect(migrateScopedIdsInWorkspace({ layout: [] }, STUB_REGISTRY)).toEqual({
      components: 0,
      listeners: 0,
    });
    // Missing registry: no migration is possible.
    expect(
      migrateScopedIdsInWorkspace(
        { layout: [{ id: 1, component: "Foo" }] },
        null,
      ),
    ).toEqual({ components: 0, listeners: 0 });
  });

  test("does not migrate event names containing dots that look like scoped ids", () => {
    // A widget could (in theory) emit an event with a dotted name
    // like `nav.changed`. The `[id].evt` regex requires a literal
    // bracket-id between the component and the event, so the dot
    // in the event name is preserved untouched.
    const ws = {
      layout: [
        {
          id: 2,
          component: "EventReceiverWidget",
          listeners: {
            onMessage: ["EventSenderWidget[1].nav.changed"],
          },
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);
    expect(ws.layout[0].listeners.onMessage[0]).toBe(
      "trops.dash-samples.EventSenderWidget[1].nav.changed",
    );
  });
});

describe("migrateScopedIdsInWorkspace — protects pruneDeadListenerReferences", () => {
  test("a listener referencing a now-scoped emitter survives a subsequent prune", () => {
    // Reproduces the v0.1.435 data-loss scenario:
    //   1. Workspace loaded with bare `component` + bare listener.
    //   2. LayoutModel scoped the components.
    //   3. pruneDeadListenerReferences ran and pruned the bare
    //      listener as an orphan because no live item matched.
    // After this fix, migration runs first; the listener now
    // references the scoped emitter and prune leaves it intact.
    const ws = {
      layout: [
        { id: 1, component: "EventSenderWidget", events: ["click"] },
        {
          id: 2,
          component: "EventReceiverWidget",
          eventHandlers: ["onClick"],
          listeners: {
            onClick: ["EventSenderWidget[1].click"],
          },
        },
      ],
    };
    migrateScopedIdsInWorkspace(ws, STUB_REGISTRY);

    // Manually reproduce the prune walk's identity check post-migration
    const liveKeys = new Set(ws.layout.map((it) => `${it.component}|${it.id}`));
    const listener = ws.layout[1].listeners.onClick[0];
    const m = listener.match(/^([^[]+)\[([^\]]+)\]\..+$/);
    expect(m).not.toBeNull();
    expect(liveKeys.has(`${m[1]}|${m[2]}`)).toBe(true);
  });
});
