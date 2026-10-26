/**
 * sessionProfiles.test.js — recent dashboards and open tabs are kept per
 * profile. Default keeps the keys used before profiles existed.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-session-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_session__";
  if (request === "electron-store") return "__stub_electron_store_session__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_session__"] = {
  id: "__stub_electron_session__",
  filename: "__stub_electron_session__",
  loaded: true,
  exports: { app: { getPath: () => stubDir } },
};
// electron-store with dotted keys, in memory.
const data = {};
class FakeStore {
  get(key, fallback) {
    const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), data);
    return v === undefined ? fallback : v;
  }
  set(key, value) {
    const parts = key.split(".");
    const last = parts.pop();
    const target = parts.reduce((o, k) => (o[k] = o[k] || {}), data);
    target[last] = value;
  }
  delete(key) {
    const parts = key.split(".");
    const last = parts.pop();
    const target = parts.reduce((o, k) => (o ? o[k] : undefined), data);
    if (target) delete target[last];
  }
}
require.cache["__stub_electron_store_session__"] = {
  id: "__stub_electron_store_session__",
  filename: "__stub_electron_store_session__",
  loaded: true,
  exports: FakeStore,
};

const store = require("./profileStore");
const activeProfile = require("./activeProfile");
const session = require("../controller/sessionController");

const appId = "@test/session-app";

describe("recent dashboards and open tabs per profile", () => {
  it("Default uses the keys from before profiles", () => {
    activeProfile.setAppId(appId);
    session.addRecentDashboard(1, "Home Assistant");
    session.saveSessionState(["1"], "1");
    assert.equal(data.recents[0].name, "Home Assistant");
    assert.deepEqual(data.sessionState, {
      openTabIds: ["1"],
      activeTabId: "1",
    });
  });

  it("another profile has its own recents and tabs", () => {
    const mini = store.create(appId, "Mac Mini", { defaultItems: {} });
    store.setActive(appId, mini.id);
    assert.deepEqual(session.getRecentDashboards(), []);
    assert.equal(session.getSessionState(), null);

    session.addRecentDashboard(7, "Mini Only");
    assert.deepEqual(
      session.getRecentDashboards().map((r) => r.name),
      ["Mini Only"],
    );

    store.setActive(appId, "default");
    assert.deepEqual(
      session.getRecentDashboards().map((r) => r.name),
      ["Home Assistant"],
    );
  });

  it("removes one recent dashboard (the handler dash-electron already calls)", () => {
    session.addRecentDashboard(2, "Sales");
    session.removeRecentDashboard("1");
    assert.deepEqual(
      session.getRecentDashboards().map((r) => r.name),
      ["Sales"],
    );
  });
});
