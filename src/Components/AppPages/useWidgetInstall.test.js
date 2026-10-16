import { renderHook, act } from "@testing-library/react";
import { useWidgetInstall } from "./useWidgetInstall";

function setup({ zip, folder, results, fail } = {}) {
  const widgets = {
    installLocal: fail
      ? jest.fn().mockRejectedValue(new Error("bad zip"))
      : jest.fn().mockResolvedValue(true),
    loadFolder: jest.fn().mockResolvedValue(results || []),
  };
  window.mainApi = {
    dialog: {
      chooseFile: jest.fn((isFile) =>
        Promise.resolve(isFile ? (zip ?? null) : (folder ?? null)),
      ),
    },
    widgets,
  };
  const refresh = jest.fn().mockResolvedValue();
  const hook = renderHook(() => useWidgetInstall(refresh));
  return { ...hook, widgets, refresh };
}

afterEach(() => {
  delete window.mainApi;
});

describe("useWidgetInstall (app-navigation NAV-008)", () => {
  it("installs a ZIP and reports success", async () => {
    const { result, widgets, refresh } = setup({ zip: "/tmp/weather.zip" });
    await act(async () => result.current.installFromZip());
    expect(widgets.installLocal).toHaveBeenCalledWith(
      "weather",
      "/tmp/weather.zip",
    );
    expect(refresh).toHaveBeenCalled();
    expect(result.current.result).toEqual({
      status: "success",
      message: 'Widget "weather" installed successfully.',
    });
    expect(result.current.progress.open).toBe(true);
    expect(result.current.progress.complete).toBe(true);
    expect(result.current.progress.widgets[0].status).toBe("installed");
  });

  it("reports a failed ZIP install", async () => {
    const { result } = setup({ zip: "/tmp/x.zip", fail: true });
    await act(async () => result.current.installFromZip());
    expect(result.current.result).toEqual({
      status: "error",
      message: "bad zip",
    });
    expect(result.current.progress.widgets[0].status).toBe("failed");
  });

  it("does nothing when the file dialog is cancelled", async () => {
    const { result, widgets } = setup({ zip: null });
    await act(async () => result.current.installFromZip());
    expect(widgets.installLocal).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });

  it("loads a folder of widgets", async () => {
    const results = [
      { name: "a", displayName: "A" },
      { name: "b", displayName: "B" },
    ];
    results.skipped = 1;
    const { result } = setup({ folder: "/tmp/w", results });
    await act(async () => result.current.loadFolder());
    expect(result.current.result.status).toBe("success");
    expect(result.current.result.message).toBe(
      "Loaded 2 widgets from folder. (1 non-widget folder skipped)",
    );
    expect(result.current.progress.widgets.map((w) => w.displayName)).toEqual([
      "A",
      "B",
    ]);
  });

  it("says when a folder has no widgets", async () => {
    const { result } = setup({ folder: "/tmp/empty", results: [] });
    await act(async () => result.current.loadFolder());
    expect(result.current.result.status).toBe("error");
    expect(result.current.result.message).toMatch(/^No widgets found/);
  });

  // Install gate (consolidation Phase 1a): a refusal says why, plainly.
  it("shows a refused ZIP's reason without the IPC wrapper", async () => {
    const { result, widgets } = setup({ zip: "/tmp/x.zip" });
    widgets.installLocal.mockRejectedValue(
      new Error(
        "Error invoking remote method 'widget:install-local': Error: x wasn't installed — it didn't pass its checks:\n- Hello: one",
      ),
    );
    await act(async () => result.current.installFromZip());
    const reason =
      "x wasn't installed — it didn't pass its checks:\n- Hello: one";
    expect(result.current.result).toEqual({ status: "error", message: reason });
    expect(result.current.progress.widgets[0].error).toBe(reason);
  });

  it("lists each package a folder load refused, with its reason", async () => {
    const results = [{ name: "good", displayName: "Good" }];
    results.skipped = 2; // one non-widget folder + one refused
    results.refused = ["bad"];
    results.refusedReasons = {
      bad: "bad wasn't installed — it didn't pass its checks:\n- Hello: two",
    };
    const { result } = setup({ folder: "/tmp/w", results });
    await act(async () => result.current.loadFolder());
    expect(result.current.progress.widgets).toEqual([
      { packageName: "good", displayName: "Good", status: "installed" },
      {
        packageName: "bad",
        displayName: "bad",
        status: "failed",
        error:
          "bad wasn't installed — it didn't pass its checks:\n- Hello: two",
      },
    ]);
    expect(result.current.result.message).toBe(
      "Loaded 1 widget from folder. (1 non-widget folder skipped) 1 didn't pass its checks — see why above.",
    );
  });

  it("reads the folder load's object form (as it arrives over IPC)", async () => {
    const results = {
      widgets: [{ name: "good", displayName: "Good" }],
      skipped: 1,
      refused: ["bad"],
      refusedReasons: { bad: "bad wasn't installed" },
    };
    const { result } = setup({ folder: "/tmp/w", results });
    await act(async () => result.current.loadFolder());
    expect(result.current.progress.widgets.map((w) => w.status)).toEqual([
      "installed",
      "failed",
    ]);
    expect(result.current.result.message).toBe(
      "Loaded 1 widget from folder. 1 didn't pass its checks — see why above.",
    );
  });

  it("says so when every package in a folder was refused", async () => {
    const results = [];
    results.skipped = 1;
    results.refused = ["bad"];
    results.refusedReasons = { bad: "bad wasn't installed" };
    const { result } = setup({ folder: "/tmp/w", results });
    await act(async () => result.current.loadFolder());
    expect(result.current.result.status).toBe("error");
    expect(result.current.result.message).toBe(
      "Nothing was loaded — 1 package didn't pass its checks. See why above.",
    );
    expect(result.current.progress.widgets[0].error).toBe(
      "bad wasn't installed",
    );
  });

  it("closes the progress modal and clears the result", async () => {
    const { result } = setup({ zip: "/tmp/weather.zip" });
    await act(async () => result.current.installFromZip());
    act(() => result.current.closeProgress());
    expect(result.current.progress.open).toBe(false);
    act(() => result.current.clearResult());
    expect(result.current.result).toBeNull();
  });
});
