const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  collectComponentNames,
  collectComponentNamesFromWorkspace,
  buildWidgetDependencies,
  remapLayoutPackageScopes,
  assertNoLocalScopes,
  generateRegistryManifest,
} = require("./dashboardConfigUtils");

// In-memory stand-in for the electron widget registry. Real
// widgetRegistry.getWidgets() returns entries with { scope, name,
// componentNames, version, author, ... } — these tests mock just the
// shape buildWidgetDependencies reads.
function fakeRegistry(widgets) {
  return { getWidgets: () => widgets };
}

/**
 * The publish flow reads workspaces.json from disk and walks every
 * layout location (main layout, per-page layouts, sidebar layout) to
 * compute the dashboard's widget dependencies. If a widget is only in
 * the sidebar but that walk misses it — or a stale reference is still
 * there after the user replaced it — the publish modal shows the
 * wrong packages. These tests pin the walk against the exact
 * shapes we produce so a regression here surfaces immediately.
 */
describe("collectComponentNamesFromWorkspace — sidebar coverage", () => {
  it("includes widgets only present in sidebarLayout", () => {
    const workspace = {
      layout: [{ id: 1, component: "LayoutGridContainer", type: "grid" }],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "LayoutGridContainer",
              type: "grid",
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 90001,
          component: "LayoutGridContainer",
          type: "grid",
          parent: 0,
        },
        {
          id: 90002,
          component: "ProspectListColumn",
          type: "widget",
          parent: 90001,
        },
      ],
    };
    const names = collectComponentNamesFromWorkspace(workspace);
    assert.ok(
      names.includes("ProspectListColumn"),
      `expected ProspectListColumn in dependencies, got ${JSON.stringify(names)}`,
    );
  });

  it("does NOT include a sidebar widget the user removed (disk state is authoritative)", () => {
    // After a successful save, the publisher's disk state should
    // no longer contain the replaced widget anywhere. This is the
    // post-fix expectation: the publish flow reads disk, so the
    // save path MUST persist the sidebarLayout mutation.
    const workspace = {
      layout: [{ id: 1, component: "LayoutGridContainer", type: "grid" }],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "LayoutGridContainer",
              type: "grid",
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 90001,
          component: "LayoutGridContainer",
          type: "grid",
          parent: 0,
        },
        // Replaced widget — publisher intended `PipelineProspectList`.
        {
          id: 90003,
          component: "PipelineProspectList",
          type: "widget",
          parent: 90001,
        },
      ],
    };
    const names = collectComponentNamesFromWorkspace(workspace);
    assert.ok(
      !names.includes("ProspectListColumn"),
      "disk no longer has ProspectListColumn, publish must not list it",
    );
    assert.ok(names.includes("PipelineProspectList"));
  });

  it("includes widgets from all three locations simultaneously", () => {
    const workspace = {
      layout: [
        { id: 1, component: "LayoutGridContainer", type: "grid" },
        { id: 2, component: "RootWidget", type: "widget", parent: 1 },
      ],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "LayoutGridContainer",
              type: "grid",
            },
            {
              id: 2,
              component: "PageWidget",
              type: "widget",
              parent: 1,
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 90001,
          component: "LayoutGridContainer",
          type: "grid",
          parent: 0,
        },
        {
          id: 90002,
          component: "SidebarWidget",
          type: "widget",
          parent: 90001,
        },
      ],
    };
    const names = collectComponentNamesFromWorkspace(workspace);
    assert.ok(names.includes("RootWidget"));
    assert.ok(names.includes("PageWidget"));
    assert.ok(names.includes("SidebarWidget"));
    assert.ok(!names.includes("LayoutGridContainer"));
  });
});

describe("collectComponentNames — grid cell component references", () => {
  it("picks up widgets referenced by grid cells (string component names)", () => {
    const layout = [
      {
        id: 1,
        component: "LayoutGridContainer",
        type: "grid",
        grid: {
          rows: 1,
          cols: 1,
          1.1: { component: "PipelineKanban", hide: false },
        },
      },
    ];
    const names = collectComponentNames(layout);
    assert.ok(names.includes("PipelineKanban"));
  });

  it("uses the layout item's packageId authoritatively when present", () => {
    // New adds stamp the source packageId on the layout item so
    // publish-time attribution is exact, not inferred. If two
    // installed packages both provide `ProspectListColumn`, the
    // layout item's `packageId` decides which one wins.
    const refs = [
      { component: "ProspectListColumn", packageId: "@ai-built/pipeline" },
    ];
    const registry = fakeRegistry([
      {
        scope: "ai-built",
        name: "@ai-built/prospectlistcolumn",
        componentNames: ["ProspectListColumn"],
        version: "1.0.0",
      },
      {
        scope: "ai-built",
        name: "@ai-built/pipeline",
        componentNames: ["ProspectListColumn"],
        version: "1.0.0",
      },
    ]);
    const deps = buildWidgetDependencies(refs, registry, null);
    assert.equal(deps[0].packageName, "pipeline");
    assert.equal(deps[0].scope, "ai-built");
  });

  it("routes a shared component to the bundle when the bundle's componentNames are fresh", () => {
    // Regression for the observed publish bug: `@ai-built/pipeline`
    // gained `ProspectListColumn` in its `dash.json`, but the
    // registry cache wasn't refreshed from disk, so pipeline's
    // componentNames was missing that entry — and the singleton
    // `@ai-built/prospectlistcolumn` won by default. With the cache
    // refresh in place (see widgetRegistry.backfillMetadataFromDisk),
    // pipeline's componentNames includes ProspectListColumn and the
    // coverage-ranking fallback routes correctly.
    const refs = [
      { component: "PipelineKanban", packageId: null },
      { component: "PipelineSummary", packageId: null },
      { component: "ProspectListColumn", packageId: null },
      { component: "MeddpiccScorecard", packageId: null },
    ];
    const registry = fakeRegistry([
      {
        scope: "ai-built",
        name: "@ai-built/prospectlistcolumn",
        componentNames: ["ProspectListColumn"],
        version: "1.0.0",
      },
      {
        scope: "ai-built",
        name: "@ai-built/pipeline",
        componentNames: [
          "PipelineKanban",
          "PipelineSummary",
          "ProspectListColumn",
          "MeddpiccScorecard",
        ],
        version: "1.0.0",
      },
    ]);
    const deps = buildWidgetDependencies(refs, registry, null);
    const prospect = deps.find((d) => d.widgetName === "ProspectListColumn");
    assert.equal(prospect.packageName, "pipeline");
    assert.equal(deps.length, 4);
    assert.equal(new Set(deps.map((d) => d.packageName)).size, 1);
  });

  it("falls back to coverage-ranked resolution when packageId is missing (legacy data)", () => {
    // Regression for the Pipeline File publish bug: the dashboard
    // uses 6 widgets that `@ai-built/pipeline` provides AND a 7th
    // (ProspectListColumn) that lives in both `@ai-built/pipeline`
    // AND a legacy `@ai-built/prospectlistcolumn` singleton. When
    // ranked, pipeline covers 7/7 and prospectlistcolumn covers 1/7,
    // so pipeline must win the attribution for ProspectListColumn.
    const componentNames = [
      "PipelineKanban",
      "PipelineSummary",
      "PipelineSummaryAggregate",
      "ProspectWorkspace",
      "MeddpiccScorecard",
      "StageGateChecklist",
      "ProspectListColumn",
    ];
    const registry = fakeRegistry([
      // Ordered so the singleton comes first — this was the bug:
      // first-match won, so singleton used to win the attribution.
      {
        scope: "ai-built",
        name: "@ai-built/prospectlistcolumn",
        componentNames: ["ProspectListColumn"],
        version: "1.0.0",
        author: "test",
      },
      {
        scope: "ai-built",
        name: "@ai-built/pipeline",
        componentNames: componentNames,
        version: "1.0.0",
        author: "test",
      },
    ]);
    const deps = buildWidgetDependencies(componentNames, registry, null);
    const prospect = deps.find((d) => d.widgetName === "ProspectListColumn");
    assert.equal(
      prospect.packageName,
      "pipeline",
      `expected ProspectListColumn attributed to pipeline (which provides ${componentNames.length} of the dashboard's widgets), got ${prospect.packageName}`,
    );
    // All 7 widgets should resolve to the same package → only one
    // dependency entry per package, not a split across both.
    const uniquePackages = new Set(deps.map((d) => d.packageName));
    assert.equal(
      uniquePackages.size,
      1,
      `expected a single package for all 7 widgets, got ${[...uniquePackages].join(", ")}`,
    );
  });

  it("ignores numeric grid cell component values (layout item IDs)", () => {
    // When a widget is placed in a cell, the cell's component key
    // is set to that widget's numeric id — the actual widget
    // lives as a separate layout item with the same id. Walking
    // should not treat the number as a component name.
    const layout = [
      {
        id: 1,
        component: "LayoutGridContainer",
        type: "grid",
        grid: {
          rows: 1,
          cols: 1,
          1.1: { component: 42, hide: false },
        },
      },
      {
        id: 42,
        component: "PipelineKanban",
        type: "widget",
        parent: 1,
      },
    ];
    const names = collectComponentNames(layout);
    assert.ok(names.includes("PipelineKanban"));
    assert.ok(!names.some((n) => typeof n === "number"));
  });
});

describe("remapLayoutPackageScopes — publish-time scope remap", () => {
  it("remaps @ai-built/foo to @<callerScope>/foo on layout items", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          component: "PipelineKanban",
          packageId: "@ai-built/pipeline",
          _sourcePackage: "@ai-built/pipeline",
        },
      ],
    };
    const out = remapLayoutPackageScopes(workspace, "trops");
    assert.equal(out.layout[0].packageId, "@trops/pipeline");
    assert.equal(out.layout[0]._sourcePackage, "@trops/pipeline");
  });

  it("does not touch packageIds under non-local scopes", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          component: "ChatAnthropicWidget",
          packageId: "@trops/chat",
        },
      ],
    };
    const out = remapLayoutPackageScopes(workspace, "alice");
    // Already under a registry scope; remap is a no-op.
    assert.equal(out.layout[0].packageId, "@trops/chat");
  });

  it("walks pages[].layout, sidebarLayout, and nested items/layout", () => {
    const workspace = {
      layout: [],
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              component: "PipelineKanban",
              packageId: "@ai-built/pipeline",
            },
          ],
        },
      ],
      sidebarLayout: [
        {
          id: 90001,
          component: "LayoutGridContainer",
          items: [
            {
              id: 90002,
              component: "ProspectListColumn",
              packageId: "@ai-built/pipeline",
            },
          ],
        },
      ],
    };
    const out = remapLayoutPackageScopes(workspace, "trops");
    assert.equal(out.pages[0].layout[0].packageId, "@trops/pipeline");
    assert.equal(out.sidebarLayout[0].items[0].packageId, "@trops/pipeline");
  });

  it("is a no-op when callerScope is empty", () => {
    const workspace = {
      layout: [{ id: 1, component: "Foo", packageId: "@ai-built/foo" }],
    };
    const out = remapLayoutPackageScopes(workspace, "");
    assert.equal(out.layout[0].packageId, "@ai-built/foo");
  });

  it("remaps scoped component refs on layout items", () => {
    // Layout items now carry the canonical scoped form
    // `scope.package.Component`. Publish-time remap MUST rewrite the
    // leading scope segment for any local-only scope so the installer
    // — which registers widgets under the published scope — finds an
    // exact match for `item.component` in ComponentManager.
    const workspace = {
      layout: [
        { id: 1, component: "ai-built.pipeline.PipelineKanban" },
        { id: 2, component: "ai-built.pipeline.MeddpiccScorecard" },
      ],
      sidebarLayout: [
        { id: 90002, component: "ai-built.pipeline.ProspectListColumn" },
      ],
    };
    const out = remapLayoutPackageScopes(workspace, "trops");
    assert.equal(out.layout[0].component, "trops.pipeline.PipelineKanban");
    assert.equal(out.layout[1].component, "trops.pipeline.MeddpiccScorecard");
    assert.equal(
      out.sidebarLayout[0].component,
      "trops.pipeline.ProspectListColumn",
    );
  });

  it("leaves bare component refs alone (legacy layouts)", () => {
    const workspace = {
      layout: [{ id: 1, component: "PipelineKanban" }],
    };
    const out = remapLayoutPackageScopes(workspace, "trops");
    assert.equal(out.layout[0].component, "PipelineKanban");
  });

  it("leaves non-local scope component refs alone", () => {
    const workspace = {
      layout: [{ id: 1, component: "trops.chat.ChatAnthropicWidget" }],
    };
    const out = remapLayoutPackageScopes(workspace, "alice");
    assert.equal(out.layout[0].component, "trops.chat.ChatAnthropicWidget");
  });
});

/**
 * Defense-in-depth tests for the publish-time guard. The `remap`
 * function silently no-ops when no callerScope is available — this
 * guard catches that and any other code path that might leave an
 * `@ai-built/...` reference in the workspace before it ships to the
 * registry.
 */
describe("assertNoLocalScopes — publish-time guard", () => {
  it("passes silently for a clean trops-scoped workspace", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          packageId: "@trops/pipeline",
          component: "trops.pipeline.PipelineKanban",
        },
      ],
    };
    assert.doesNotThrow(() => assertNoLocalScopes(workspace));
  });

  it("passes when input is null/undefined/empty", () => {
    assert.doesNotThrow(() => assertNoLocalScopes(null));
    assert.doesNotThrow(() => assertNoLocalScopes(undefined));
    assert.doesNotThrow(() => assertNoLocalScopes({}));
    assert.doesNotThrow(() => assertNoLocalScopes({ layout: [] }));
  });

  it("throws when packageId still references @ai-built/ after remap-noop", () => {
    // Production failure mode: remap was called with empty callerScope
    // and silently returned the workspace untouched. Guard must catch.
    const workspace = {
      layout: [
        {
          id: 1,
          packageId: "@ai-built/pipeline",
          component: "PipelineKanban",
        },
      ],
    };
    assert.throws(
      () => assertNoLocalScopes(workspace),
      /Refusing to publish.*ai-built.*packageId.*@ai-built\/pipeline/s,
    );
  });

  it("throws when scoped component still references ai-built.*", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          component: "ai-built.pipeline.PipelineKanban",
        },
      ],
    };
    assert.throws(
      () => assertNoLocalScopes(workspace),
      /Refusing to publish.*ai-built\.pipeline\.PipelineKanban/s,
    );
  });

  it("throws when _sourcePackage still references @ai-built/", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          _sourcePackage: "@ai-built/pipeline",
          component: "trops.pipeline.PipelineKanban",
        },
      ],
    };
    assert.throws(
      () => assertNoLocalScopes(workspace),
      /Refusing to publish.*_sourcePackage.*@ai-built\/pipeline/s,
    );
  });

  it("walks pages[].layout and reports nested violations", () => {
    const workspace = {
      layout: [],
      pages: [
        {
          name: "p1",
          layout: [
            {
              id: 1,
              items: [
                {
                  id: 2,
                  packageId: "@ai-built/pipeline",
                  component: "PipelineKanban",
                },
              ],
            },
          ],
        },
      ],
    };
    assert.throws(
      () => assertNoLocalScopes(workspace),
      /pages\[0\]\.layout\[0\][^\n]*items\[0\][^\n]*@ai-built\/pipeline/s,
    );
  });

  it("walks sidebarLayout and reports violations", () => {
    const workspace = {
      sidebarLayout: [
        {
          id: 1,
          component: "ai-built.pipeline.SidebarWidget",
        },
      ],
    };
    assert.throws(
      () => assertNoLocalScopes(workspace),
      /sidebarLayout\[0\].*ai-built\.pipeline\.SidebarWidget/s,
    );
  });

  it("collects multiple violations and caps at 10 in the error message", () => {
    const layout = [];
    for (let i = 0; i < 15; i += 1) {
      layout.push({
        id: i,
        packageId: "@ai-built/pipeline",
        component: "X",
      });
    }
    assert.throws(
      () => assertNoLocalScopes({ layout }),
      /15 layout item.*and 5 more/s,
    );
  });

  it("respects custom localOnlyScopes — flags @sandbox/ but not @ai-built/", () => {
    const workspace = {
      layout: [
        { id: 1, packageId: "@ai-built/pipeline" },
        { id: 2, packageId: "@sandbox/foo" },
      ],
    };
    // Custom guard: only @sandbox is local. The @ai-built entry must
    // pass through; only @sandbox should fail.
    assert.throws(
      () => assertNoLocalScopes(workspace, ["sandbox"]),
      /sandbox.*@sandbox\/foo/s,
    );
  });

  it("ignores unscoped/short/non-string component fields without throwing", () => {
    const workspace = {
      layout: [
        { id: 1, component: "PipelineKanban" }, // bare, no scope segment
        { id: 2, component: "" },
        { id: 3, component: null },
        { id: 4 }, // no component at all
      ],
    };
    assert.doesNotThrow(() => assertNoLocalScopes(workspace));
  });

  it("integrates with remapLayoutPackageScopes — clean post-remap workspace passes", () => {
    const workspace = {
      layout: [
        {
          id: 1,
          packageId: "@ai-built/pipeline",
          component: "ai-built.pipeline.PipelineKanban",
        },
      ],
    };
    const remapped = remapLayoutPackageScopes(workspace, "trops");
    assert.doesNotThrow(() => assertNoLocalScopes(remapped));
  });
});

describe("generateRegistryManifest — slice 13c permissions aggregation", () => {
  const baseConfig = {
    name: "Test Dashboard",
    version: "1.0.0",
    description: "x",
    icon: "grip",
    tags: [],
    widgets: [
      {
        id: "trops.gmail.GmailCompose",
        scope: "trops",
        packageName: "gmail",
        widgetName: "GmailCompose",
        package: "@trops/gmail",
        version: "1.2.0",
      },
      {
        id: "trops.filesystem.FilesystemWidget",
        scope: "trops",
        packageName: "filesystem",
        widgetName: "FilesystemWidget",
        package: "@trops/filesystem",
        version: "0.5.0",
      },
    ],
    providers: [],
    eventWiring: [],
  };

  it("embeds per-widget permissions on manifest.widgets[i].permissions", () => {
    const widgetPermissions = [
      {
        packageId: "@trops/gmail",
        version: "1.2.0",
        permissions: { gmail: { tools: ["send_email"] } },
      },
      {
        packageId: "@trops/filesystem",
        version: "0.5.0",
        permissions: { filesystem: { tools: ["read_file"] } },
      },
    ];
    const m = generateRegistryManifest(baseConfig, {
      githubUser: "trops",
      callerScope: "trops",
      widgetPermissions,
    });
    const gmail = m.widgets.find((w) => w.package === "@trops/gmail");
    const fs = m.widgets.find((w) => w.package === "@trops/filesystem");
    assert.deepEqual(gmail.permissions.gmail.tools, ["send_email"]);
    assert.deepEqual(fs.permissions.filesystem.tools, ["read_file"]);
  });

  it("computes top-level aggregated permissions from widgetPermissions input", () => {
    const widgetPermissions = [
      {
        packageId: "@trops/gmail",
        version: "1.2.0",
        permissions: { gmail: { tools: ["send_email"] } },
      },
      {
        packageId: "@trops/filesystem",
        version: "0.5.0",
        permissions: { filesystem: { tools: ["read_file"] } },
      },
    ];
    const m = generateRegistryManifest(baseConfig, {
      githubUser: "trops",
      callerScope: "trops",
      widgetPermissions,
    });
    assert.deepEqual(Object.keys(m.permissions).sort(), [
      "filesystem",
      "gmail",
    ]);
    assert.deepEqual(m.permissions.gmail.tools, ["send_email"]);
  });

  it("omits manifest.permissions when widgetPermissions is empty/absent", () => {
    const m = generateRegistryManifest(baseConfig, { githubUser: "trops" });
    assert.equal(m.permissions, undefined);
  });

  it("widgets without a matching permissions entry get no permissions field", () => {
    const widgetPermissions = [
      {
        packageId: "@trops/gmail",
        version: "1.2.0",
        permissions: { gmail: { tools: ["send_email"] } },
      },
      // no entry for @trops/filesystem
    ];
    const m = generateRegistryManifest(baseConfig, {
      githubUser: "trops",
      callerScope: "trops",
      widgetPermissions,
    });
    const gmail = m.widgets.find((w) => w.package === "@trops/gmail");
    const fs = m.widgets.find((w) => w.package === "@trops/filesystem");
    assert.ok(gmail.permissions);
    assert.equal(fs.permissions, undefined);
  });
});
