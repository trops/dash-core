import { ElectronDashboardApi } from "./ElectronDashboardApi";

/**
 * Regression: Settings → Bots reads `dashApi.bots.*`, and in Electron `dashApi`
 * is an ElectronDashboardApi wrapping window.mainApi. This pins that the wrapper
 * actually exposes the bots namespace — the wiring that shipped broken because
 * BotsSection's unit tests mocked `dashApi={{ bots }}` and never touched the
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
