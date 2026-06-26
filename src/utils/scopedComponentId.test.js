/**
 * scopedComponentId.test.js
 *
 * The canonical scoped component id is the spine of the publish/install
 * loop. ComponentManager registers under it; layout items reference it;
 * publish-time scope remap rewrites it. If this helper drifts, every
 * downstream lookup misses. These tests pin the format so a typo can't
 * silently break installs across machines.
 */

import {
  makeScopedComponentId,
  parseScopedComponentId,
  bareComponentName,
  isScopedComponentId,
  resolveGateWidgetId,
} from "./scopedComponentId";

describe("makeScopedComponentId", () => {
  test("npm-style scope", () => {
    expect(
      makeScopedComponentId("@ai-built/pipeline", "ProspectListColumn"),
    ).toBe("ai-built.pipeline.ProspectListColumn");
  });

  test("bare scope (no @)", () => {
    expect(
      makeScopedComponentId("ai-built/pipeline", "ProspectListColumn"),
    ).toBe("ai-built.pipeline.ProspectListColumn");
  });

  test("returns bare componentName when packageName is missing", () => {
    expect(makeScopedComponentId("", "ProspectListColumn")).toBe(
      "ProspectListColumn",
    );
    expect(makeScopedComponentId(null, "ProspectListColumn")).toBe(
      "ProspectListColumn",
    );
  });

  test("returns empty when componentName is missing", () => {
    expect(makeScopedComponentId("@ai-built/pipeline", "")).toBe("");
    expect(makeScopedComponentId("@ai-built/pipeline", null)).toBe("");
  });
});

describe("parseScopedComponentId", () => {
  test("parses scope.package.componentName", () => {
    expect(
      parseScopedComponentId("ai-built.pipeline.ProspectListColumn"),
    ).toEqual({
      scope: "ai-built",
      packageName: "pipeline",
      componentName: "ProspectListColumn",
    });
  });

  test("returns null for bare names", () => {
    expect(parseScopedComponentId("ProspectListColumn")).toBe(null);
  });

  test("returns null for non-strings", () => {
    expect(parseScopedComponentId(null)).toBe(null);
    expect(parseScopedComponentId(undefined)).toBe(null);
    expect(parseScopedComponentId({})).toBe(null);
  });
});

describe("bareComponentName", () => {
  test("strips scope/package from a scoped id", () => {
    expect(bareComponentName("ai-built.pipeline.ProspectListColumn")).toBe(
      "ProspectListColumn",
    );
  });

  test("returns input verbatim for bare names", () => {
    expect(bareComponentName("ProspectListColumn")).toBe("ProspectListColumn");
  });

  test("handles empty input", () => {
    expect(bareComponentName("")).toBe("");
    expect(bareComponentName(null)).toBe("");
  });
});

describe("isScopedComponentId", () => {
  test("true only for 3-part dotted ids without slashes", () => {
    expect(isScopedComponentId("trops.pipeline.AutomationHub")).toBe(true);
    expect(isScopedComponentId("AutomationHub")).toBe(false);
    expect(isScopedComponentId("@trops/pipeline")).toBe(false);
    expect(isScopedComponentId("trops.pipeline")).toBe(false);
    expect(isScopedComponentId("a.b.c.d")).toBe(false);
    expect(isScopedComponentId(null)).toBe(false);
  });
});

describe("resolveGateWidgetId", () => {
  test("prefers a scoped component over a bare params.name (the bug fix)", () => {
    // The render path passes the scoped id as `component` but a bare
    // `params.name` used to shadow it, making the gate miss the grant.
    expect(
      resolveGateWidgetId("trops.pipeline.AutomationHub", "AutomationHub"),
    ).toBe("trops.pipeline.AutomationHub");
  });

  test("uses a scoped params.name when component is bare", () => {
    expect(
      resolveGateWidgetId("AutomationHub", "trops.pipeline.AutomationHub"),
    ).toBe("trops.pipeline.AutomationHub");
  });

  test("falls back to legacy behavior when nothing is scoped", () => {
    // Built-in/bare widgets keep today's behavior — no regression.
    expect(resolveGateWidgetId("Clock", "Clock")).toBe("Clock");
    expect(resolveGateWidgetId("Clock", undefined)).toBe("Clock");
    expect(resolveGateWidgetId("Clock", "MyClock")).toBe("MyClock");
  });
});
