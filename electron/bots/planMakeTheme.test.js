/**
 * planMakeTheme.test.js — a plan's new theme (lead-workspace theme round):
 * the real botController._planMakeTheme saves it through the real
 * themeController, made by Dash's theme generator (dark and light), and the
 * app is told to reload its themes. Electron stubbed, like
 * botProfiles.test.js.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "zz-electron-maketheme-"),
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_maketheme__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_maketheme__"] = {
  id: "__stub_electron_maketheme__",
  filename: "__stub_electron_maketheme__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: function () {},
    shell: {},
    dialog: {},
  },
};

const botController = require("../controller/botController");
const themeController = require("../controller/themeController");

const colors = {
  primary: "#c2562b",
  secondary: "#d9a441",
  tertiary: "#6b7f3a",
  neutral: "#7a6a5c",
};

let n = 0;
function controller() {
  const self = { _appId: `maketheme-${++n}`, broadcasts: [] };
  self._getMainWindow = () => null;
  self._broadcast = (channel, payload) =>
    self.broadcasts.push([channel, payload]);
  for (const name of ["_planMakeTheme", "_savedThemes"]) {
    self[name] = botController[name].bind(self);
  }
  return self;
}

describe("botController._planMakeTheme", () => {
  it("saves the generated theme under a new key, with its name", () => {
    const c = controller();
    const res = c._planMakeTheme({ name: " Autumn ", colors });
    assert.equal(res.name, "Autumn");
    assert.match(res.key, /^theme-\d+$/);
    const listed = themeController.listThemesForApplication(null, c._appId);
    const saved = listed.themes[res.key];
    assert.ok(saved, "it's in the user's themes");
    assert.equal(saved.name, "Autumn");
    assert.equal(saved.id, res.key);
    assert.equal(saved.primary, colors.primary);
    assert.equal(saved.neutral, colors.neutral);
    assert.ok(saved.dark && saved.light, "dark and light are made");
    assert.deepEqual(c.broadcasts, [["themes:changed", { key: res.key }]]);
  });

  it("a name the user already has is refused, nothing saved", () => {
    const c = controller();
    c._planMakeTheme({ name: "Autumn", colors });
    const before = Object.keys(
      themeController.listThemesForApplication(null, c._appId).themes,
    ).length;
    assert.throws(
      () => c._planMakeTheme({ name: "autumn", colors }),
      /already a theme called "autumn"/,
    );
    const after = Object.keys(
      themeController.listThemesForApplication(null, c._appId).themes,
    ).length;
    assert.equal(after, before);
  });

  it("no name: refused", () => {
    assert.throws(
      () => controller()._planMakeTheme({ name: "  ", colors }),
      /no name/,
    );
  });
});

describe("a theme a conversation made (review fix)", () => {
  it("is made again under the same key there, and isn't taken there", () => {
    const c = controller();
    const first = c._planMakeTheme({ name: "Autumn", colors, madeIn: "q_1" });
    const again = c._planMakeTheme({
      name: "Autumn",
      colors: { ...colors, primary: "#aa3311" },
      madeIn: "q_1",
    });
    assert.equal(again.key, first.key);
    const saved = themeController.listThemesForApplication(null, c._appId)
      .themes[first.key];
    assert.equal(saved.primary, "#aa3311");
    assert.equal(saved.madeIn, "q_1");
    c._themeNames = botController._themeNames.bind(c);
    assert.ok(!c._themeNames("q_1").includes("Autumn"));
    assert.ok(c._themeNames("q_2").includes("Autumn"));
    assert.ok(c._themeNames().includes("Autumn"));
  });
  it("another conversation can't take its name", () => {
    const c = controller();
    c._planMakeTheme({ name: "Autumn", colors, madeIn: "q_1" });
    assert.throws(
      () => c._planMakeTheme({ name: "Autumn", colors, madeIn: "q_2" }),
      /already a theme called/,
    );
  });
});
