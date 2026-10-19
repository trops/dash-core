import { ElectronDashboardApi } from "./ElectronDashboardApi";

/**
 * Regression: Settings → Bots reads `dashApi.bots.*`, and in Electron `dashApi`
 * is an ElectronDashboardApi wrapping window.mainApi. This pins that the wrapper
 * actually exposes the bots namespace — the wiring that shipped broken because
 * the old Settings › Bots section's unit tests mocked `dashApi={{ bots }}` and never touched the
 * real wrapper.
 */
describe("ElectronDashboardApi — bots pass-through", () => {
  it("exposes the wrapped mainApi.bots namespace", () => {
    const bots = { save: jest.fn(), list: jest.fn(), run: jest.fn() };
    const mainApi = { bots };
    const api = new ElectronDashboardApi(mainApi, "@trops/dash-electron");
    expect(api.bots).toBe(bots);
    expect(typeof api.bots.save).toBe("function");
  });

  it("is undefined-safe when the underlying api has no bots", () => {
    const api = new ElectronDashboardApi({}, "app");
    expect(api.bots).toBeUndefined();
  });
});

// Phase 1e: the main process reports a failed write as { error: true } —
// that must reach onError, never onSuccess.
describe("ElectronDashboardApi — saveWorkspace failures", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function apiWith(result) {
    const mainApi = {
      workspace: {
        saveWorkspaceForApplication: jest.fn(() => Promise.resolve(result)),
      },
    };
    return new ElectronDashboardApi(mainApi, "app");
  }

  it("routes a { error } result to onError with its message", async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    apiWith({
      error: true,
      message: "EACCES: permission denied",
      workspaces: [],
    }).saveWorkspace("app", { id: 1 }, onSuccess, onError);
    await flush();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1].message).toBe("EACCES: permission denied");
  });

  it("still calls onSuccess for a good save", async () => {
    const onSuccess = jest.fn();
    const onError = jest.fn();
    apiWith({ success: true, workspaces: [{ id: 1 }] }).saveWorkspace(
      "app",
      { id: 1 },
      onSuccess,
      onError,
    );
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
