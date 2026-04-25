/**
 * layout.test.js
 *
 * Regression coverage for `isWidgetResolvable`. This is the gate
 * that decides whether the renderer shows the real widget or
 * `WidgetNotFound`. Before v0.1.420 it indexed
 * `ComponentManager.componentMap()` directly by name — fine when the
 * map was keyed by bare names, broken once registration moved to
 * scoped keys (`scope.package.X`). Legacy dashboards still store
 * `component: "ProspectWorkspace"` so the lookup MUST fall back
 * through `resolveComponentKey`.
 *
 * layout.js drags in a lot of heavy renderer chain (Builder/Widget/
 * Models) just to expose a pure-function test, so mock those out at
 * the boundary. We only care that `isWidgetResolvable` correctly
 * routes through `ComponentManager.resolve` for the bare-name case.
 */

jest.mock("@trops/dash-react", () => ({
  SelectMenu: () => null,
  FontAwesomeIcon: () => null,
  deepCopy: (x) => JSON.parse(JSON.stringify(x)),
}));
jest.mock("../Components/Layout/Builder", () => ({
  LayoutBuilderGridItem: () => null,
  LayoutGridContainer: () => null,
  LayoutBuilderConfigMenuItem: () => null,
  LayoutBuilderConfigContainerMenuItem: () => null,
}));
jest.mock("../Widget", () => ({
  WidgetFactory: () => null,
}));
jest.mock("../Widget/WidgetNotFound", () => ({
  WidgetNotFound: () => null,
}));
jest.mock("../Models", () => ({
  DashboardModel: class {},
  LayoutModel: class {},
  ComponentConfigModel: (c) => c,
}));

import { isWidgetResolvable } from "./layout";
import { ComponentManager } from "../ComponentManager";

const stubComponent = () => null;

describe("isWidgetResolvable — strict scoped lookup", () => {
  afterEach(() => ComponentManager.setComponentMap({}));

  test("scoped layout id resolves directly", () => {
    ComponentManager.setComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("trops.pipeline.PipelineKanban")).toBe(true);
  });

  test("bare names return false — no fallback (LayoutModel migrates first)", () => {
    // Pre-v0.1.435 a bare name with a single suffix match resolved
    // to true. Post-v0.1.435 it returns false; the renderer shows
    // WidgetNotFound, which is the right signal that the layout
    // never went through LayoutModel migration (or has an ambiguous
    // / unregistered widget).
    ComponentManager.setComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("PipelineKanban")).toBe(false);
  });

  test("unregistered scoped widget returns false", () => {
    ComponentManager.setComponentMap({
      "trops.pipeline.PipelineKanban": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("trops.pipeline.NonExistent")).toBe(false);
  });

  test("registered config without a component function returns false", () => {
    // A registry entry that's missing its React component (e.g. a
    // stub left over from a failed dynamic load) must NOT satisfy
    // the gate — otherwise the renderer tries to mount `undefined`.
    ComponentManager.setComponentMap({
      "trops.pipeline.Broken": {
        type: "widget",
        // no `component` field
      },
    });
    expect(isWidgetResolvable("trops.pipeline.Broken")).toBe(false);
  });
});
