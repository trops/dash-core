/**
 * computeDashboardPreflight.test.js
 *
 * Pin for the dashboard pre-flight permissions scanner. Inputs:
 *   - workspace.layout (array of grid containers + widgets)
 *   - widgetMcp.listAll() snapshot (per-widget declared + granted)
 *   - registry snapshot (Map<packageId, {componentNames, ...}>)
 *
 * Output: array of widgets present on this workspace whose declared
 * permissions are NOT yet covered by their granted permissions —
 * with the missing piece broken out so the modal can render
 * per-widget Allow/Deny rows.
 *
 * Widgets without a manifest (no `declared`) are skipped — they fall
 * through to runtime JIT prompts. Widgets with `declared` fully
 * covered by `granted` are skipped (nothing to ask).
 */
import { computeDashboardPreflight } from "./computeDashboardPreflight";

const widget = (component, id = component) => ({
  id,
  type: "widget",
  component,
  componentName: component,
});

const grid = (id) => ({ id, type: "grid", component: "LayoutGridContainer" });

// Test fixture for the registry — keyed by package id, lists every
// widget component name in that package.
const REGISTRY = new Map([
  [
    "@trops/google-drive",
    {
      packageId: "@trops/google-drive",
      componentNames: [
        "GDriveFileList",
        "GDriveFilePreview",
        "GDriveFileSearch",
      ],
    },
  ],
  [
    "@ai-built/pipeline",
    {
      packageId: "@ai-built/pipeline",
      componentNames: ["PipelineKanban", "PipelineSummary"],
    },
  ],
]);

// Make a listAll() row with a declared block.
const row = ({
  widgetId,
  declared = null,
  granted = null,
  hasManifest = !!declared,
}) => ({
  widgetId,
  declared,
  granted,
  hasManifest,
  grantOrigin: granted ? "live" : null,
});

describe("computeDashboardPreflight — basics", () => {
  test("widget with declared but no granted → reported as needing all of declared", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: { servers: { "google-drive": { tools: ["search"] } } },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets.length).toBe(1);
    expect(out.widgets[0].widgetId).toBe("trops.google-drive.GDriveFileList");
    expect(out.widgets[0].packageId).toBe("@trops/google-drive");
    expect(out.widgets[0].displayName).toBe("GDriveFileList");
    expect(out.widgets[0].missing.servers["google-drive"].tools).toEqual([
      "search",
    ]);
  });

  test("widget fully granted → NOT in result", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: { servers: { "google-drive": { tools: ["search"] } } },
        granted: { servers: { "google-drive": { tools: ["search"] } } },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets).toEqual([]);
  });

  test("widget partially granted → only the uncovered tools/paths are reported", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: {
          servers: { "google-drive": { tools: ["search", "list_folder"] } },
        },
        granted: {
          servers: { "google-drive": { tools: ["search"] } },
        },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets.length).toBe(1);
    expect(out.widgets[0].missing.servers["google-drive"].tools).toEqual([
      "list_folder",
    ]);
  });

  test("widget without manifest → skipped (falls through to runtime JIT)", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: null,
        hasManifest: false,
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets).toEqual([]);
  });

  test("widget present in listAll but NOT on this dashboard → skipped", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: { servers: { "google-drive": { tools: ["search"] } } },
      }),
      // PipelineKanban is installed but not on this workspace
      row({
        widgetId: "ai-built.pipeline.PipelineKanban",
        declared: { servers: { "google-drive": { tools: ["list_folder"] } } },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    // Only the GDriveFileList one — Pipeline isn't on the dashboard.
    expect(out.widgets.length).toBe(1);
    expect(out.widgets[0].widgetId).toBe("trops.google-drive.GDriveFileList");
  });

  test("multiple widgets across packages — all included", () => {
    const layout = [
      grid(1),
      widget("GDriveFileList"),
      widget("PipelineKanban"),
    ];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: { servers: { "google-drive": { tools: ["search"] } } },
      }),
      row({
        widgetId: "ai-built.pipeline.PipelineKanban",
        declared: { servers: { "google-drive": { tools: ["list_folder"] } } },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets.length).toBe(2);
    expect(out.widgets.map((w) => w.widgetId).sort()).toEqual([
      "ai-built.pipeline.PipelineKanban",
      "trops.google-drive.GDriveFileList",
    ]);
  });
});

describe("computeDashboardPreflight — fs domain", () => {
  test("declared fs paths not granted → reported", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: {
          servers: {},
          domains: {
            fs: { actions: ["saveData"], readPaths: [], writePaths: ["/tmp"] },
          },
        },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets.length).toBe(1);
    expect(out.widgets[0].missing.domains.fs.writePaths).toEqual(["/tmp"]);
    expect(out.widgets[0].missing.domains.fs.actions).toEqual(["saveData"]);
  });

  test("declared fs already covered → not reported", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: {
          servers: {},
          domains: { fs: { actions: ["saveData"], writePaths: ["/tmp"] } },
        },
        granted: {
          servers: {},
          domains: { fs: { actions: ["saveData"], writePaths: ["/tmp"] } },
        },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: REGISTRY,
    });
    expect(out.widgets).toEqual([]);
  });
});

describe("computeDashboardPreflight — defensive", () => {
  test("missing layout → empty result", () => {
    expect(
      computeDashboardPreflight({
        layout: null,
        allRows: [],
        registry: REGISTRY,
      }),
    ).toEqual({ widgets: [] });
  });

  test("layout with no widgets → empty result", () => {
    expect(
      computeDashboardPreflight({
        layout: [grid(1)],
        allRows: [],
        registry: REGISTRY,
      }),
    ).toEqual({ widgets: [] });
  });

  test("empty registry → no rows resolve to a packageId; everything skipped", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "GDriveFileList", // bare name — no dotted form
        declared: { servers: { "google-drive": { tools: ["search"] } } },
      }),
    ];
    const out = computeDashboardPreflight({
      layout,
      allRows,
      registry: new Map(),
    });
    expect(out.widgets).toEqual([]);
  });

  test("no registry passed at all → falls back to dotted-form parsing", () => {
    const layout = [grid(1), widget("GDriveFileList")];
    const allRows = [
      row({
        widgetId: "trops.google-drive.GDriveFileList",
        declared: { servers: { "google-drive": { tools: ["search"] } } },
      }),
    ];
    // No registry argument — helper parses widgetId directly.
    const out = computeDashboardPreflight({ layout, allRows });
    expect(out.widgets.length).toBe(1);
    expect(out.widgets[0].packageId).toBe("@trops/google-drive");
  });
});
