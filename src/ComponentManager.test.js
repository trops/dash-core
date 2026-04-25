/**
 * ComponentManager.test.js
 *
 * Pins the `ComponentManager.resolve` and `ComponentManager.config`
 * fallback chain — the renderer's primary entry points for widget
 * lookup. The pure-function tests for `resolveComponentKey` itself
 * live next to the function in `utils/resolveComponentKey.test.js`.
 *
 * Mock the heavy transitive deps that get pulled in via
 * ComponentManager → Models/index → LayoutModel → utils/layout →
 * Components/Layout/Builder/...; we don't render anything in these
 * tests, just exercise the lookup pipeline. `virtual: true` lets jest
 * mock the modules without needing them in node_modules. We have to
 * mock `./Models` itself (not just leaf deps like clsx/headlessui)
 * because the import chain reaches files that aren't reachable from
 * jest's resolver in test mode.
 */

jest.mock("./Models", () => ({
  ComponentConfigModel: class {
    constructor(c) {
      return c;
    }
  },
}));

import { ComponentManager } from "./ComponentManager";

// Reset the module-level registry between tests so leaked state from
// one test can't mask a failure in another.
function freshComponentMap(entries) {
  ComponentManager.setComponentMap(entries);
}

const stubComponent = () => null;

describe("ComponentManager.resolve", () => {
  afterEach(() => freshComponentMap({}));

  test("returns the live registered config (with React component)", () => {
    freshComponentMap({
      "ai-built.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
        providers: [{ type: "filesystem" }],
      },
    });
    const cfg = ComponentManager.resolve("PipelineKanban");
    expect(cfg).not.toBeNull();
    expect(cfg.component).toBe(stubComponent);
    expect(cfg.providers).toEqual([{ type: "filesystem" }]);
  });

  test("returns null when no widget matches", () => {
    freshComponentMap({});
    expect(ComponentManager.resolve("Anything")).toBe(null);
  });

  test("uses packageId from layout item to disambiguate", () => {
    freshComponentMap({
      "ai-built.pipeline.ProspectListColumn": {
        component: stubComponent,
        type: "widget",
        _scope: "pipeline",
      },
      "ai-built.prospectlistcolumn.ProspectListColumn": {
        component: stubComponent,
        type: "widget",
        _scope: "singleton",
      },
    });
    const item = {
      component: "ProspectListColumn",
      packageId: "@ai-built/pipeline",
    };
    const cfg = ComponentManager.resolve(item.component, item);
    expect(cfg._scope).toBe("pipeline");
  });
});

describe("ComponentManager.config — legacy bare-name resolution", () => {
  afterEach(() => freshComponentMap({}));

  test("resolves a bare component name to its scoped registration", () => {
    // This is the production failure mode: legacy dashboards
    // store `component: "ProspectWorkspace"` but post-v0.1.432
    // the registry only has `ai-built.pipeline.ProspectWorkspace`.
    // Before the route-through-resolveComponentKey fix this returned
    // null and Settings → Notifications showed no widgets.
    freshComponentMap({
      "ai-built.pipeline.ProspectWorkspace": {
        component: stubComponent,
        type: "widget",
        userConfig: {},
        providers: [{ type: "filesystem" }],
        notifications: [{ key: "alert", displayName: "Alert" }],
      },
    });
    const cfg = ComponentManager.config("ProspectWorkspace");
    expect(cfg).not.toBeNull();
    // Returned shape is the curated config (notifications, providers,
    // userConfig, etc.). The bare-name lookup succeeded — proven by
    // surfacing the widget's declared notifications.
    expect(cfg.notifications).toEqual([{ key: "alert", displayName: "Alert" }]);
    expect(cfg.providers).toEqual([{ type: "filesystem" }]);
  });
});
