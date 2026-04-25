/**
 * migrateBareComponentName.test.js
 *
 * One-shot legacy bare-name → scoped-id migration. Lives in
 * LayoutModel's hot path on workspace load; this is the ONLY
 * suffix-scan call site in the codebase post-v0.1.435.
 */

import { migrateBareComponentName } from "./migrateBareComponentName";

describe("migrateBareComponentName", () => {
  test("scoped id is returned verbatim (fast path)", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "trops.pipeline.PipelineKanban")).toBe(
      "trops.pipeline.PipelineKanban",
    );
  });

  test("bare name with exactly one matching scoped key → migrates", () => {
    // Production case: legacy dashboard says
    // `component: "ProspectWorkspace"`; registry has only the
    // scoped form post-v0.1.432.
    const map = {
      "trops.pipeline.ProspectWorkspace": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "ProspectWorkspace")).toBe(
      "trops.pipeline.ProspectWorkspace",
    );
  });

  test("bare name with multiple matches → returns input unchanged", () => {
    // Ambiguous — two packages provide the same component name.
    // Migration refuses to guess; renderer shows WidgetNotFound.
    // Republishing the dashboard fixes it (the publisher records
    // the correct packageId on each layout item).
    const map = {
      "trops.pipeline.ProspectListColumn": { type: "widget" },
      "trops.prospectlistcolumn.ProspectListColumn": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "ProspectListColumn")).toBe(
      "ProspectListColumn",
    );
  });

  test("bare name with no matches → returns input unchanged", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "NonExistent")).toBe("NonExistent");
  });

  test("idempotent — already-migrated names pass through", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    const once = migrateBareComponentName(map, "PipelineKanban");
    const twice = migrateBareComponentName(map, once);
    expect(twice).toBe(once);
  });

  test("null/undefined inputs return input unchanged without throwing", () => {
    expect(migrateBareComponentName(null, "X")).toBe("X");
    expect(migrateBareComponentName({}, null)).toBe(null);
    expect(migrateBareComponentName({}, undefined)).toBe(undefined);
    expect(migrateBareComponentName({}, "")).toBe("");
  });

  test("layout container names pass through (Container, LayoutGridContainer)", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "Container")).toBe("Container");
    expect(migrateBareComponentName(map, "LayoutGridContainer")).toBe(
      "LayoutGridContainer",
    );
  });

  test("two-part dotted forms migrate via suffix scan when unambiguous", () => {
    // A `pkg.Component` shape is non-canonical; the suffix scan
    // picks up the only matching scoped key.
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(migrateBareComponentName(map, "pipeline.PipelineKanban")).toBe(
      "trops.pipeline.PipelineKanban",
    );
  });
});
