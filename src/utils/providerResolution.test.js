/**
 * forEachWidget walk order — pages must win over the legacy
 * `workspace.layout` alias.
 *
 * Bug it pins: WorkspaceModel auto-migrates a workspace that has no
 * persisted `pages` field by wrapping the layout into a synthetic
 * `pages[0]` that SHARES the same array reference as
 * `workspace.layout`. After any per-page edit (per-widget Providers
 * panel save → handlePageWorkspaceChange → setOpenTabs), the page's
 * layout is replaced with a new array containing the fresh items,
 * but `workspace.layout` is left pointing at the original (stale)
 * array. `forEachWidget` was walking `workspace.layout` first and
 * deduping by stableId, so it visited the stale top-level item and
 * skipped the fresh page version. Every consumer downstream
 * (getAllProviderBindings, the bulk-edit modal's OVERRIDE badge,
 * getUnresolvedProviders) read pre-edit data as a result.
 *
 * Fix: walk pages first. The pages array is the source of truth;
 * `workspace.layout` is a legacy fallback (still walked so AI-place
 * events that only touch `workspace.layout` remain visible).
 */
import { forEachWidget } from "./providerResolution";

describe("forEachWidget — walk order pins fresh page data over stale workspace.layout", () => {
  test("page-fresh selectedProviders win over auto-migration alias that diverged on edit", () => {
    // Step 1: simulate a freshly-loaded workspace that had no `pages`
    // persisted, so WorkspaceModel auto-migrated by aliasing
    // `pages[0].layout` to `workspace.layout`.
    const sharedItem = {
      id: 12,
      uuid: "ws-trops.google-drive.GDriveFilePreview-12",
      component: "trops.google-drive.GDriveFilePreview",
      selectedProviders: { "google-drive": "Google Drive" },
    };
    const aliasedLayout = [
      { id: 1, component: "LayoutGridContainer", selectedProviders: {} },
      sharedItem,
    ];
    const workspace = {
      id: 9999,
      layout: aliasedLayout,
      pages: [
        {
          id: "page-9999",
          name: "Page 1",
          order: 0,
          layout: aliasedLayout, // SAME reference as workspace.layout
        },
      ],
      selectedProviders: {},
    };

    // Step 2: simulate a per-widget Providers-panel save. The panel
    // produces a new layout array (replaceItemInLayout returns a new
    // array) and handlePageWorkspaceChange writes only to
    // `pages[0].layout`. `workspace.layout` is left stale.
    const freshItem = { ...sharedItem, selectedProviders: {} };
    workspace.pages[0].layout = aliasedLayout.map((it) =>
      it.id === sharedItem.id ? freshItem : it,
    );
    // workspace.layout still points at `aliasedLayout` — the divergent
    // state that triggers the bug.
    expect(workspace.layout[1].selectedProviders).toEqual({
      "google-drive": "Google Drive",
    });
    expect(workspace.pages[0].layout[1].selectedProviders).toEqual({});

    // Step 3: walking the workspace must visit the fresh (page) item,
    // not the stale (top-level) one.
    const visited = [];
    forEachWidget(workspace, (item) => {
      if (item.component === "trops.google-drive.GDriveFilePreview") {
        visited.push(item);
      }
    });

    expect(visited).toHaveLength(1);
    expect(visited[0].selectedProviders).toEqual({});
  });

  test("widgets that only exist in workspace.layout (e.g. AI-place fallback) are still visited", () => {
    // Regression guard: walking pages first must NOT cause us to skip
    // widgets that live only in `workspace.layout`. Some flows (legacy
    // single-page save paths, AI-place into a page-less section) leave
    // a widget in `workspace.layout` without a matching pages entry.
    const onlyInTopLevel = {
      id: 99,
      uuid: "ws-extra-99",
      component: "ExtraWidget",
      selectedProviders: { foo: "Foo Provider" },
    };
    const workspace = {
      id: 1,
      layout: [
        { id: 1, component: "LayoutGridContainer", selectedProviders: {} },
        onlyInTopLevel,
      ],
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          order: 0,
          layout: [
            { id: 1, component: "LayoutGridContainer", selectedProviders: {} },
          ],
        },
      ],
      selectedProviders: {},
    };

    const visited = [];
    forEachWidget(workspace, (item) => {
      if (item.component === "ExtraWidget") visited.push(item);
    });

    expect(visited).toHaveLength(1);
    expect(visited[0]).toBe(onlyInTopLevel);
  });

  test("a widget shared by reference between page and top-level is visited exactly once", () => {
    // Object-identity dedupe must still kick in. Two arrays that
    // contain the same item object should produce one visit.
    const sharedRef = {
      id: 7,
      uuid: "ws-shared-7",
      component: "SharedWidget",
      selectedProviders: {},
    };
    const workspace = {
      id: 2,
      layout: [
        { id: 1, component: "LayoutGridContainer", selectedProviders: {} },
        sharedRef,
      ],
      pages: [
        {
          id: "page-2",
          name: "Page 1",
          order: 0,
          layout: [
            { id: 1, component: "LayoutGridContainer", selectedProviders: {} },
            sharedRef,
          ],
        },
      ],
      selectedProviders: {},
    };

    const visited = [];
    forEachWidget(workspace, (item) => {
      if (item.component === "SharedWidget") visited.push(item);
    });

    expect(visited).toHaveLength(1);
  });
});
