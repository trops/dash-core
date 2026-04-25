/**
 * ComponentManager.test.js
 *
 * Pins:
 *   1. Strict scoped-id resolution via `.resolve` and `.config`.
 *   2. Origin-stamping in `registerWidget` — every widget that enters
 *      the registry has a canonical `scope.package.Component` id, or
 *      the call throws.
 *   3. The augmented `.config` return shape carries identity fields
 *      (id/scope/package/_sourcePackage/...) so consumers don't fall
 *      back to `item.workspace` for the package label.
 *
 * Mocks `./Models` to break the heavy Models → LayoutModel →
 * Components/Layout chain that ComponentManager pulls in normally.
 */

jest.mock("./Models", () => ({
  ComponentConfigModel: (c) => c,
}));

import { ComponentManager } from "./ComponentManager";

function freshComponentMap(entries) {
  ComponentManager.setComponentMap(entries);
}

const stubComponent = () => null;

describe("ComponentManager.resolve — strict scoped lookup", () => {
  afterEach(() => freshComponentMap({}));

  test("returns the live registered config for an exact scoped match", () => {
    freshComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
        providers: [{ type: "filesystem" }],
      },
    });
    const cfg = ComponentManager.resolve("trops.pipeline.PipelineKanban");
    expect(cfg).not.toBeNull();
    expect(cfg.component).toBe(stubComponent);
  });

  test("bare names return null — no fallback", () => {
    freshComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(ComponentManager.resolve("PipelineKanban")).toBe(null);
  });

  test("missing widget returns null", () => {
    freshComponentMap({});
    expect(ComponentManager.resolve("anything.scoped.X")).toBe(null);
  });
});

describe("ComponentManager.registerWidget — canonical scoped id", () => {
  afterEach(() => freshComponentMap({}));

  test("uses config.id when it is already scoped (3 dot parts)", () => {
    freshComponentMap({});
    ComponentManager.registerWidget(
      {
        id: "trops.pipeline.PipelineKanban",
        name: "PipelineKanban",
        component: stubComponent,
        type: "widget",
      },
      "ignored-key",
    );
    const map = ComponentManager.componentMap();
    expect(map["trops.pipeline.PipelineKanban"]).toBeTruthy();
  });

  test("derives scoped id from scope + packageName + name", () => {
    freshComponentMap({});
    ComponentManager.registerWidget(
      {
        scope: "local",
        packageName: "dash-samples",
        name: "EventSenderWidget",
        component: stubComponent,
        type: "widget",
      },
      null,
    );
    const map = ComponentManager.componentMap();
    expect(map["local.dash-samples.EventSenderWidget"]).toBeTruthy();
  });

  test("strips a leading @ on scope when deriving the id", () => {
    freshComponentMap({});
    ComponentManager.registerWidget(
      {
        scope: "@trops",
        packageName: "pipeline",
        name: "PipelineKanban",
        component: stubComponent,
        type: "widget",
      },
      null,
    );
    const map = ComponentManager.componentMap();
    expect(map["trops.pipeline.PipelineKanban"]).toBeTruthy();
  });

  test("throws when origin metadata is missing", () => {
    freshComponentMap({});
    expect(() =>
      ComponentManager.registerWidget(
        {
          name: "Bare",
          component: stubComponent,
          type: "widget",
        },
        "Bare",
      ),
    ).toThrow(/missing origin metadata/);
  });

  test("falls back to widgetKey only when it is itself scoped", () => {
    freshComponentMap({});
    ComponentManager.registerWidget(
      {
        name: "Bare",
        component: stubComponent,
        type: "widget",
      },
      "trops.pipeline.Bare",
    );
    const map = ComponentManager.componentMap();
    expect(map["trops.pipeline.Bare"]).toBeTruthy();
  });

  test("config.id wins over widgetKey when both are scoped", () => {
    freshComponentMap({});
    ComponentManager.registerWidget(
      {
        id: "trops.pipeline.A",
        name: "A",
        component: stubComponent,
        type: "widget",
      },
      "trops.other.A",
    );
    const map = ComponentManager.componentMap();
    expect(map["trops.pipeline.A"]).toBeTruthy();
    expect(map["trops.other.A"]).toBeUndefined();
  });
});

describe("ComponentManager.config — identity fields surfaced to consumers", () => {
  afterEach(() => freshComponentMap({}));

  test("returns id, scope, packageName, package, _sourcePackage", () => {
    // Without these fields, downstream consumers (Dependencies tab,
    // Layout footer, Card header) fall back to `item.workspace`,
    // which is a category — not a package — and produce labels
    // like `@DashSamples-workspace`.
    freshComponentMap({
      "trops.dash-samples.NotificationWidget": {
        component: stubComponent,
        type: "widget",
        userConfig: {},
        scope: "trops",
        packageName: "dash-samples",
        package: "Dash Samples",
        _sourcePackage: "@trops/dash-samples",
        author: "Dash Team",
        displayName: "Notifications",
      },
    });
    const cfg = ComponentManager.config(
      "trops.dash-samples.NotificationWidget",
    );
    expect(cfg).not.toBeNull();
    expect(cfg.id).toBe("trops.dash-samples.NotificationWidget");
    expect(cfg.scope).toBe("trops");
    expect(cfg.packageName).toBe("dash-samples");
    expect(cfg.package).toBe("Dash Samples");
    expect(cfg._sourcePackage).toBe("@trops/dash-samples");
    expect(cfg.author).toBe("Dash Team");
    expect(cfg.displayName).toBe("Notifications");
  });

  test("returns null for a bare-name lookup (strict)", () => {
    freshComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
        userConfig: {},
      },
    });
    expect(ComponentManager.config("PipelineKanban")).toBe(null);
  });
});
