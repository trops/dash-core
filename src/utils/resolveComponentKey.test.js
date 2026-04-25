/**
 * resolveComponentKey.test.js
 *
 * Pure-function tests for the registry lookup fallback chain.
 *
 * The renderer's lookup pipeline ALWAYS has to find a registered
 * widget when:
 *   - layout has the canonical scoped form (`scope.package.X`)
 *   - layout has a legacy bare name and the registry has only the
 *     scoped form (post-v0.1.432 migration)
 *   - layout has a legacy bare name and the registry has BOTH scoped
 *     forms — packageId hint disambiguates
 * If any of these fail the entire dashboard renders WidgetNotFound.
 *
 * Lives in utils/ (not next to ComponentManager) so we can test it
 * without dragging in Models → LayoutModel → utils/layout →
 * Components/Layout/... and the React/clsx/headlessui chain that
 * ComponentManager pulls.
 */

import { resolveComponentKey } from "./resolveComponentKey";

describe("resolveComponentKey", () => {
  test("exact scoped match wins", () => {
    const map = {
      "ai-built.pipeline.PipelineKanban": { type: "widget" },
    };
    expect(resolveComponentKey(map, "ai-built.pipeline.PipelineKanban")).toBe(
      "ai-built.pipeline.PipelineKanban",
    );
  });

  test("bare name resolves to a single registered scoped key (legacy layouts)", () => {
    // This is the production failure mode the v0.1.432 migration
    // introduced: layout still says `component: "ProspectWorkspace"`
    // but the registry only has the scoped form.
    const map = {
      "ai-built.pipeline.ProspectWorkspace": { type: "widget" },
    };
    expect(resolveComponentKey(map, "ProspectWorkspace")).toBe(
      "ai-built.pipeline.ProspectWorkspace",
    );
  });

  test("bare name with multiple matches uses packageId hint to disambiguate", () => {
    const map = {
      "ai-built.pipeline.ProspectListColumn": { type: "widget" },
      "ai-built.prospectlistcolumn.ProspectListColumn": { type: "widget" },
    };
    expect(
      resolveComponentKey(map, "ProspectListColumn", {
        packageId: "@ai-built/pipeline",
      }),
    ).toBe("ai-built.pipeline.ProspectListColumn");
    expect(
      resolveComponentKey(map, "ProspectListColumn", {
        packageId: "@ai-built/prospectlistcolumn",
      }),
    ).toBe("ai-built.prospectlistcolumn.ProspectListColumn");
  });

  test("bare name with multiple matches uses _sourcePackage as a hint", () => {
    const map = {
      "ai-built.pipeline.ProspectListColumn": { type: "widget" },
      "ai-built.prospectlistcolumn.ProspectListColumn": { type: "widget" },
    };
    // Some legacy items carry _sourcePackage instead of packageId
    // — the resolver checks both.
    expect(
      resolveComponentKey(map, "ProspectListColumn", {
        _sourcePackage: "@ai-built/pipeline",
      }),
    ).toBe("ai-built.pipeline.ProspectListColumn");
  });

  test("bare name with multiple matches and no hint falls back to first match + warns", () => {
    const map = {
      "ai-built.pipeline.ProspectListColumn": { type: "widget" },
      "ai-built.prospectlistcolumn.ProspectListColumn": { type: "widget" },
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const got = resolveComponentKey(map, "ProspectListColumn");
    // Either match is acceptable as long as the warning fires —
    // both are valid registrations, just ambiguous without a hint.
    expect(got).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("missing widget returns null", () => {
    const map = { "ai-built.pipeline.PipelineKanban": { type: "widget" } };
    expect(resolveComponentKey(map, "NonExistent")).toBe(null);
  });

  test("null/undefined inputs return null without throwing", () => {
    expect(resolveComponentKey(null, "X")).toBe(null);
    expect(resolveComponentKey({}, null)).toBe(null);
    expect(resolveComponentKey({}, undefined)).toBe(null);
  });

  test("scoped lookup takes precedence over bare-suffix scan", () => {
    // If a layout already carries the scoped form, never scan —
    // an exact scoped match wins regardless of how many other
    // packages share the trailing component name.
    const map = {
      "ai-built.pipeline.ProspectListColumn": { type: "widget" },
      "ai-built.prospectlistcolumn.ProspectListColumn": { type: "widget" },
    };
    expect(
      resolveComponentKey(map, "ai-built.pipeline.ProspectListColumn"),
    ).toBe("ai-built.pipeline.ProspectListColumn");
  });

  test("dotted component name with no exact match returns null (no scan)", () => {
    // A scoped-form name that doesn't match anything must NOT
    // fall through to the bare-name suffix scan — that would let
    // a typo silently resolve to the wrong widget.
    const map = {
      "ai-built.pipeline.ProspectListColumn": { type: "widget" },
    };
    expect(
      resolveComponentKey(map, "ai-built.othrpkg.ProspectListColumn"),
    ).toBe(null);
  });
});
