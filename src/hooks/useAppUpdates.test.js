/**
 * @jest-environment jsdom
 *
 * useAppUpdates — aggregator surface for widget + dashboard updates.
 * Validates the combined counts, the dashboard IPC wiring, and the
 * absence/presence of the IPC handler.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useAppUpdates } from "./useAppUpdates";

const sampleInstalled = [
  {
    name: "SlackListChannels",
    packageId: "@trops/slack",
    source: "installed",
    version: "0.0.700",
  },
];

const sampleWidgetUpdates = [
  {
    name: "@trops/slack",
    currentVersion: "0.0.700",
    latestVersion: "0.0.735",
    downloadUrl: "https://reg.example/{name}-{version}.zip",
  },
];

const sampleDashboardUpdates = [
  {
    name: "Kitchen Sink",
    packageName: "kitchen-sink",
    installedVersion: "1.0.5",
    latestVersion: "1.0.6",
  },
];

function installMainApi({
  checkWidgets = jest.fn().mockResolvedValue([]),
  checkDashboards = jest.fn().mockResolvedValue({ success: true, updates: [] }),
  install = jest.fn().mockResolvedValue({ ok: true }),
  getProfile = jest.fn().mockResolvedValue({ id: "test" }),
} = {}) {
  window.mainApi = {
    registry: { checkUpdates: checkWidgets },
    registryAuth: { getProfile },
    widgets: { install },
    dashboardConfig: { checkDashboardUpdates: checkDashboards },
  };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useAppUpdates — aggregation", () => {
  test("combines widget + dashboard updates into a single totalUpdates count", async () => {
    installMainApi({
      checkWidgets: jest.fn().mockResolvedValue(sampleWidgetUpdates),
      checkDashboards: jest.fn().mockResolvedValue({
        success: true,
        updates: sampleDashboardUpdates,
      }),
    });
    const { result } = renderHook(() =>
      useAppUpdates({
        appId: "test-app",
        installedWidgets: sampleInstalled,
      }),
    );
    await waitFor(() => {
      expect(result.current.totalUpdates).toBe(2);
    });
    expect(result.current.widgetUpdates).toHaveLength(1);
    expect(result.current.dashboardUpdates).toHaveLength(1);
  });

  test("totalUpdates is 0 when both checks return empty (the 'up to date' state)", async () => {
    installMainApi();
    const { result } = renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(result.current.hasChecked).toBe(true);
    });
    expect(result.current.totalUpdates).toBe(0);
  });

  test("isChecking is true while either check is in flight", async () => {
    // Use a held promise for the dashboard check so we can inspect
    // mid-flight state.
    let resolveDashboards;
    const dashPromise = new Promise((r) => {
      resolveDashboards = r;
    });
    installMainApi({
      checkDashboards: jest.fn().mockReturnValue(dashPromise),
    });
    const { result } = renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(result.current.isChecking).toBe(true);
    });
    await act(async () => {
      resolveDashboards({ success: true, updates: [] });
      await dashPromise;
    });
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
  });
});

describe("useAppUpdates — dashboard IPC contract", () => {
  test("calls checkDashboardUpdates(appId) on mount when appId is provided", async () => {
    const checkDashboards = jest
      .fn()
      .mockResolvedValue({ success: true, updates: [] });
    installMainApi({ checkDashboards });
    renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(checkDashboards).toHaveBeenCalledTimes(1);
    });
    expect(checkDashboards).toHaveBeenCalledWith("test-app");
  });

  test("skips the dashboard check entirely when appId is missing (defensive)", async () => {
    const checkDashboards = jest.fn().mockResolvedValue({
      success: true,
      updates: [],
    });
    installMainApi({ checkDashboards });
    renderHook(() => useAppUpdates({ installedWidgets: sampleInstalled }));
    // Give the effect a tick to fire if it were going to.
    await new Promise((r) => setTimeout(r, 0));
    expect(checkDashboards).not.toHaveBeenCalled();
  });

  test("treats a failed dashboard check as 'no updates' (degrades gracefully)", async () => {
    installMainApi({
      checkDashboards: jest
        .fn()
        .mockResolvedValue({ success: false, error: "boom", updates: [] }),
    });
    const { result } = renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(result.current.hasChecked).toBe(true);
    });
    expect(result.current.dashboardUpdates).toEqual([]);
    expect(result.current.totalUpdates).toBe(0);
  });

  test("treats a thrown dashboard check as 'no updates' (also degrades gracefully)", async () => {
    installMainApi({
      checkDashboards: jest.fn().mockRejectedValue(new Error("network")),
    });
    const { result } = renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(result.current.hasChecked).toBe(true);
    });
    expect(result.current.dashboardUpdates).toEqual([]);
  });

  test("recheck() re-runs the dashboard check on demand", async () => {
    const checkDashboards = jest
      .fn()
      .mockResolvedValue({ success: true, updates: [] });
    installMainApi({ checkDashboards });
    const { result } = renderHook(() =>
      useAppUpdates({ appId: "test-app", installedWidgets: sampleInstalled }),
    );
    await waitFor(() => {
      expect(checkDashboards).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.recheck();
    });
    expect(checkDashboards).toHaveBeenCalledTimes(2);
  });
});

describe("useAppUpdates — re-exports from useWidgetUpdates", () => {
  test("updateWidgetPackages routes through the underlying widget hook's updatePackages", async () => {
    installMainApi({
      checkWidgets: jest.fn().mockResolvedValue(sampleWidgetUpdates),
    });
    const { result } = renderHook(() =>
      useAppUpdates({
        appId: "test-app",
        installedWidgets: sampleInstalled,
      }),
    );
    await waitFor(() => {
      expect(result.current.widgetUpdates.length).toBe(1);
    });
    await act(async () => {
      await result.current.updateWidgetPackages(["@trops/slack"]);
    });
    // After the batch, the widget hook's authoritative clear removed
    // the entry; the aggregator surface reflects that.
    expect(result.current.widgetUpdates).toEqual([]);
  });
});
