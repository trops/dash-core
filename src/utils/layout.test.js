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
  ComponentConfigModel: class {
    constructor(c) {
      return c;
    }
  },
}));

import { isWidgetResolvable } from "./layout";
import { ComponentManager } from "../ComponentManager";

const stubComponent = () => null;

describe("isWidgetResolvable", () => {
  afterEach(() => ComponentManager.setComponentMap({}));

  test("legacy bare-name layout resolves to its scoped registration", () => {
    // The exact production failure mode: layout says
    // "ProspectWorkspace" but registry only has the scoped form.
    // Pre-fix this returned false → `WidgetNotFound` for every
    // widget on the dashboard.
    ComponentManager.setComponentMap({
      "ai-built.pipeline.ProspectWorkspace": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("ProspectWorkspace")).toBe(true);
  });

  test("scoped layout resolves directly", () => {
    ComponentManager.setComponentMap({
      "ai-built.pipeline.ProspectWorkspace": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("ai-built.pipeline.ProspectWorkspace")).toBe(
      true,
    );
  });

  test("unregistered widget returns false", () => {
    ComponentManager.setComponentMap({
      "ai-built.pipeline.ProspectWorkspace": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(isWidgetResolvable("NonExistentWidget")).toBe(false);
  });

  test("registered config without a component function returns false", () => {
    // A registry entry that's missing its React component (e.g.
    // a stub left over from a failed dynamic load) must NOT
    // satisfy the gate — otherwise the renderer tries to mount
    // `undefined` and throws.
    ComponentManager.setComponentMap({
      "ai-built.pipeline.Broken": {
        type: "widget",
        // no `component` field
      },
    });
    expect(isWidgetResolvable("Broken")).toBe(false);
  });

  test("packageId on the layout item disambiguates between two scoped registrations", () => {
    ComponentManager.setComponentMap({
      "ai-built.pipeline.ProspectListColumn": {
        component: stubComponent,
        type: "widget",
      },
      "ai-built.prospectlistcolumn.ProspectListColumn": {
        component: stubComponent,
        type: "widget",
      },
    });
    expect(
      isWidgetResolvable("ProspectListColumn", {
        packageId: "@ai-built/pipeline",
      }),
    ).toBe(true);
  });
});
