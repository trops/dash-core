/**
 * dashboardCopy: Duplicate's copy, shared by the Dashboards page and
 * Create's "Copy one of your dashboards".
 */
import { dashboardCopy } from "./dashboardCopy";

describe("dashboardCopy", () => {
  const ws = {
    id: 3,
    name: "Smart Home",
    registryRef: "trops/smart-home",
    layout: [{ id: 1, component: "Clock" }],
    _dashboardConfig: {
      registryPackage: "smart-home",
      registryScope: "trops",
      version: "1.0.0",
      installedVersion: "1.0.0",
      author: "trops",
    },
  };
  test("a new dashboard with the same widgets, not the registry package", () => {
    const copy = dashboardCopy(ws, 123);
    expect(copy).toMatchObject({
      id: 123,
      version: 123,
      name: "Smart Home (Copy)",
      layout: [{ id: 1, component: "Clock" }],
      _dashboardConfig: { author: "trops" },
    });
    expect(copy.registryRef).toBeUndefined();
    expect(copy._dashboardConfig.registryPackage).toBeUndefined();
    expect(copy._dashboardConfig.installedVersion).toBeUndefined();
  });
  test("changing the copy never changes the original", () => {
    const copy = dashboardCopy(ws, 1);
    copy.layout[0].component = "Weather";
    expect(ws.layout[0].component).toBe("Clock");
  });
});
