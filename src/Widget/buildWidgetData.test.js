/**
 * buildWidgetData.test.js
 *
 * Pin for the widget-identity contract that the MCP gate depends on.
 *
 * Background: layout-tree nodes (workspaces.json) carry `component`,
 * `componentName`, `uuid` — but no `name` field. `useMcpProvider` reads
 * `widgetData.name` to compute the gate identity (`widgetIdForGate`).
 * Without `name`, that resolves to null and the runtime gate's legacy
 * `if (!widgetId && !token) return true` bypass silently allows every
 * MCP call. Threading `name` here is what makes the gate fire for
 * ordinary widgets.
 *
 * Runs via Jest (matches src/Api/makeBoundApi.test.js style).
 */
import { buildWidgetData } from "./buildWidgetData";

describe("buildWidgetData", () => {
  test("falls back to component when params has no name (the bug we're fixing)", () => {
    const params = {
      component: "GoogleDriveWidget",
      componentName: "GoogleDriveWidget",
      uuid: "GoogleDriveWidget-1",
    };
    const data = buildWidgetData({
      params,
      component: "GoogleDriveWidget",
      config: {},
      uuidString: "GoogleDriveWidget-1",
    });
    expect(data.name).toBe("GoogleDriveWidget");
  });

  test("honors an explicit name when params already carries one", () => {
    const params = {
      name: "@trops/google-drive",
      component: "GoogleDriveWidget",
      uuid: "x",
    };
    const data = buildWidgetData({
      params,
      component: "GoogleDriveWidget",
      config: {},
      uuidString: "x",
    });
    expect(data.name).toBe("@trops/google-drive");
  });

  test("preserves uuidString, providers, notifications", () => {
    const params = { component: "W", uuid: "u" };
    const data = buildWidgetData({
      params,
      component: "W",
      config: {
        providers: [{ type: "google-drive" }],
        notifications: [{ id: "n1" }],
      },
      uuidString: "u-stringified",
    });
    expect(data.uuidString).toBe("u-stringified");
    expect(data.providers).toEqual([{ type: "google-drive" }]);
    expect(data.notifications).toEqual([{ id: "n1" }]);
  });

  test("spreads params (so component/componentName/uuid remain reachable)", () => {
    const params = {
      component: "W",
      componentName: "W",
      uuid: "u",
      userPrefs: { title: "Hi" },
    };
    const data = buildWidgetData({
      params,
      component: "W",
      config: {},
      uuidString: "u",
    });
    expect(data.component).toBe("W");
    expect(data.componentName).toBe("W");
    expect(data.uuid).toBe("u");
    expect(data.userPrefs).toEqual({ title: "Hi" });
  });

  test("missing config still yields empty arrays for providers/notifications", () => {
    const data = buildWidgetData({
      params: { component: "W", uuid: "u" },
      component: "W",
      config: undefined,
      uuidString: "u",
    });
    expect(data.providers).toEqual([]);
    expect(data.notifications).toEqual([]);
  });
});
