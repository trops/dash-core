/**
 * resolveComponentKey.test.js
 *
 * Pins the strict exact-match contract. Pre-v0.1.435 this function
 * had a suffix-scan + packageId-hint fallback chain; that turned out
 * to silently resolve the wrong widget when bundles changed or
 * layouts referenced unregistered widgets. Post-v0.1.435 the only
 * legitimate input is a fully scoped id; legacy bare names are
 * migrated by `LayoutModel` (via `migrateBareComponentName`) before
 * they ever reach the resolver.
 */

import { resolveComponentKey } from "./resolveComponentKey";

describe("resolveComponentKey — strict exact match", () => {
  test("scoped id present in registry → returns the same key", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(resolveComponentKey(map, "trops.pipeline.PipelineKanban")).toBe(
      "trops.pipeline.PipelineKanban",
    );
  });

  test("scoped id NOT in registry → returns null (no scan)", () => {
    // The previous behavior would have suffix-scanned and silently
    // resolved this to any registered key ending in `.X`. Now it
    // returns null — the renderer shows WidgetNotFound rather than
    // mounting the wrong React component.
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
      "trops.pipeline.ProspectListColumn": { type: "widget" },
    };
    expect(resolveComponentKey(map, "PipelineKanban")).toBe(null);
    expect(resolveComponentKey(map, "ProspectListColumn")).toBe(null);
  });

  test("bare name with single match → returns null (no fallback)", () => {
    // Even a SINGLE-match bare name does not fallback. Legacy
    // bare names must be migrated upstream by LayoutModel; if
    // they survive to the resolver, something else is wrong.
    const map = { "trops.pipeline.PipelineKanban": { type: "widget" } };
    expect(resolveComponentKey(map, "PipelineKanban")).toBe(null);
  });

  test("missing widget returns null", () => {
    const map = { "trops.pipeline.PipelineKanban": { type: "widget" } };
    expect(resolveComponentKey(map, "NonExistent")).toBe(null);
  });

  test("null/undefined inputs return null without throwing", () => {
    expect(resolveComponentKey(null, "X")).toBe(null);
    expect(resolveComponentKey({}, null)).toBe(null);
    expect(resolveComponentKey({}, undefined)).toBe(null);
  });

  test("non-string component returns null", () => {
    expect(resolveComponentKey({}, 42)).toBe(null);
    expect(resolveComponentKey({}, {})).toBe(null);
    expect(resolveComponentKey({}, [])).toBe(null);
  });

  test("the previous packageId hint is ignored — exact match still required", () => {
    // Pre-v0.1.435, passing `data.packageId` would let a bare name
    // resolve via `makeScopedComponentId`. New API takes no `data`.
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    // Even if a third arg sneaks in via legacy callers, behavior
    // must be the same — strict exact match.
    // eslint-disable-next-line no-extra-args
    expect(
      resolveComponentKey(map, "PipelineKanban", {
        packageId: "@trops/pipeline",
      }),
    ).toBe(null);
  });

  test("non-canonical input forms (4 parts, leading dots) → null", () => {
    const map = {
      "trops.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(resolveComponentKey(map, "trops.pipeline.sub.PipelineKanban")).toBe(
      null,
    );
    expect(resolveComponentKey(map, ".trops.pipeline.PipelineKanban")).toBe(
      null,
    );
  });
});
