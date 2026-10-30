/**
 * planChangeTheme.test.js — a change to a saved theme (theme change round),
 * through the real botController methods and the real themeController.
 * The user's own theme changes in place (its editor changes and registry
 * record stay); a downloaded one is never changed — a remix credits its
 * author. Electron and the registry lookup are stubbed.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "zz-electron-changetheme-"),
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_changetheme__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_changetheme__"] = {
  id: "__stub_electron_changetheme__",
  filename: "__stub_electron_changetheme__",
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

// The registry: what each package allows, and whether it's public.
const registry = {
  "@alexr/dusk": { allowRemix: true, visibility: "public" },
  "@alexr/strict": { allowRemix: false, visibility: "public" },
  "@me/mine": { visibility: "private" },
};
const pkgsPath = require.resolve("../registry/registryPackages");
// The real helpers (nextFreeVersion…), with the registry lookup stubbed.
const realPkgs = require("../registry/registryPackages");
require.cache[pkgsPath] = {
  id: pkgsPath,
  filename: pkgsPath,
  loaded: true,
  exports: {
    ...realPkgs,
    getPackageInfo: async (pkg) => registry[pkg] || null,
  },
};

const botController = require("../controller/botController");
const themeController = require("../controller/themeController");

const colors = {
  primary: "#c2562b",
  secondary: "#d9a441",
  tertiary: "#7c8aa5",
  neutral: "#7a6a5c",
};

let n = 0;
function controller(themes, { username = null } = {}) {
  const self = { _appId: `changetheme-${++n}`, broadcasts: [] };
  self._registryUsername = () => username;
  self._getMainWindow = () => null;
  self._broadcast = (channel, payload) =>
    self.broadcasts.push([channel, payload]);
  for (const name of [
    "_planChangeTheme",
    "_savedThemes",
    "_packageVisibility",
    "_themeUsage",
    "_themeUsageAll",
    "_workspacesUsing",
    "_loadWorkspace",
    "_saveWorkspace",
    "_planRestoreTheme",
    "_themeDetails",
  ]) {
    self[name] = botController[name].bind(self);
  }
  for (const [key, t] of Object.entries(themes)) {
    themeController.saveThemeForApplication(null, self._appId, key, t);
  }
  return self;
}
const saved = (c) =>
  themeController.listThemesForApplication(null, c._appId).themes;

describe("your own theme", () => {
  it("changes in place: new colors, its editor changes kept", async () => {
    const c = controller({
      "theme-1": {
        id: "theme-1",
        name: "Dusk",
        primary: "blue",
        secondary: "slate",
        tertiary: "#7c8aa5",
        neutral: "gray",
        dark: { "font-body": "Inter" },
        light: {},
      },
    });
    const res = await c._planChangeTheme({ name: "dusk", colors });
    assert.equal(res.key, "theme-1");
    assert.equal(res.remix, false);
    assert.equal(res.editorKept, true);
    assert.deepEqual(res.previous, {
      primary: "blue",
      secondary: "slate",
      tertiary: "#7c8aa5",
      neutral: "gray",
    });
    assert.equal(res.published, null);
    const t = saved(c)["theme-1"];
    assert.equal(t.primary, "#c2562b");
    assert.equal(t.name, "Dusk");
    assert.deepEqual(t.dark, { "font-body": "Inter" });
    assert.deepEqual(c.broadcasts, [["themes:changed", { key: "theme-1" }]]);
  });

  it("published from here: its version and visibility, its record kept", async () => {
    const c = controller({
      "theme-2": {
        id: "theme-2",
        name: "Mine",
        primary: "blue",
        registryRef: {
          package: "@me/mine",
          kind: "theme",
          version: "1.2.0",
          origin: "published",
        },
        _registryMeta: {
          packageName: "me/mine",
          lastPublishedVersion: "1.2.0",
        },
      },
    });
    const res = await c._planChangeTheme({ name: "Mine", colors });
    assert.deepEqual(res.published, {
      package: "@me/mine",
      version: "1.2.0",
      visibility: "private",
    });
    assert.equal(saved(c)["theme-2"].registryRef.origin, "published");
  });

  it("Remove puts its old colors back", async () => {
    const c = controller({
      "theme-3": { id: "theme-3", name: "Dusk", primary: "blue" },
    });
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.equal(
      c._planRestoreTheme({
        key: res.key,
        name: res.name,
        previous: res.previous,
      }),
      true,
    );
    const t = saved(c)["theme-3"];
    assert.equal(t.primary, "blue");
    assert.equal(t.secondary, undefined);
  });
});

describe("a theme downloaded from the registry", () => {
  const installed = (pkg) => ({
    id: "theme-dl",
    name: "Dusk",
    author: "Alex R",
    primary: "blue",
    version: "1.2.0",
    dark: { radius: "lg" },
    registryRef: {
      package: pkg,
      kind: "theme",
      version: "1.2.0",
      origin: "installed",
    },
    _registryMeta: { source: "registry", packageName: "dusk" },
  });

  it("is never changed: a remix that credits its author", async () => {
    const c = controller({ "theme-dl": installed("@alexr/dusk") });
    const res = await c._planChangeTheme({
      name: "Dusk",
      colors,
      madeIn: "q_1",
    });
    assert.equal(res.remix, true);
    assert.equal(res.name, "Dusk (remix)");
    assert.notEqual(res.key, "theme-dl");
    assert.deepEqual(res.of, {
      key: "theme-dl",
      name: "Dusk",
      package: "@alexr/dusk",
      author: "Alex R",
    });
    assert.equal(res.allowRemix, true);
    const all = saved(c);
    assert.equal(all["theme-dl"].primary, "blue", "the original is untouched");
    const remix = all[res.key];
    assert.equal(remix.primary, "#c2562b");
    assert.deepEqual(remix.remixedFrom, {
      package: "@alexr/dusk",
      version: "1.2.0",
    });
    assert.equal(remix.registryRef, undefined);
    assert.equal(remix._registryMeta, undefined);
    assert.deepEqual(remix.dark, { radius: "lg" });
  });

  it("carrying on in the same conversation changes the same remix", async () => {
    const c = controller({ "theme-dl": installed("@alexr/dusk") });
    const first = await c._planChangeTheme({
      name: "Dusk",
      colors,
      madeIn: "q_1",
    });
    const again = await c._planChangeTheme({
      name: "Dusk",
      colors: { ...colors, primary: "#aa3311" },
      madeIn: "q_1",
    });
    assert.equal(again.key, first.key);
    assert.equal(again.name, "Dusk (remix)");
    assert.equal(saved(c)[first.key].primary, "#aa3311");
    // Another conversation makes its own.
    const other = await c._planChangeTheme({
      name: "Dusk",
      colors,
      madeIn: "q_2",
    });
    assert.equal(other.name, "Dusk (remix 2)");
  });

  it("an author who doesn't allow remixes: allowRemix false", async () => {
    const c = controller({ "theme-dl": installed("@alexr/strict") });
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.equal(res.allowRemix, false);
  });
});

describe("review fixes", () => {
  it("built again in the same conversation, Remove still brings back the first colors", async () => {
    const c = controller({
      "theme-4": { id: "theme-4", name: "Dusk", primary: "blue" },
    });
    await c._planChangeTheme({ name: "Dusk", colors, madeIn: "q_1" });
    const again = await c._planChangeTheme({
      name: "Dusk",
      colors: { ...colors, primary: "#aa3311" },
      madeIn: "q_1",
    });
    assert.equal(again.previous.primary, "blue");
    c._planRestoreTheme({ key: "theme-4", previous: again.previous });
    const t = saved(c)["theme-4"];
    assert.equal(t.primary, "blue");
    assert.equal(t._planPrevious, undefined);
  });

  it("a remix replaces the original on its dashboards; Remove puts it back", async () => {
    const c = controller({
      "theme-dl": {
        id: "theme-dl",
        name: "Dusk",
        author: "Alex R",
        primary: "blue",
        registryRef: {
          package: "@alexr/dusk",
          kind: "theme",
          version: "1.2.0",
          origin: "installed",
        },
      },
    });
    require("../controller/workspaceController").saveWorkspaceForApplication(
      null,
      c._appId,
      { id: 9, name: "Kitchen Sink", themeKey: "theme-dl", layout: [] },
    );
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.deepEqual(res.replaced, [{ id: "9", name: "Kitchen Sink" }]);
    assert.equal(c._loadWorkspace(9).themeKey, res.key);
    assert.equal(
      c._planRestoreTheme({
        key: res.key,
        name: res.name,
        remix: true,
        of: res.of,
        replaced: res.replaced,
      }),
      true,
    );
    assert.equal(c._loadWorkspace(9).themeKey, "theme-dl");
  });

  it("an original that's gone from the registry: remixes not allowed", async () => {
    const c = controller({
      "theme-gone": {
        id: "theme-gone",
        name: "Gone",
        primary: "blue",
        registryRef: {
          package: "@alexr/gone",
          kind: "theme",
          version: "1.0.0",
          origin: "installed",
        },
      },
    });
    const res = await c._planChangeTheme({ name: "Gone", colors });
    assert.equal(res.allowRemix, false);
  });
});

describe("theme change leftovers", () => {
  it("your own package installed on another computer: changed in place, published", async () => {
    const c = controller(
      {
        "theme-own": {
          id: "theme-own",
          name: "Dusk",
          primary: "blue",
          registryRef: {
            package: "@me/dusk",
            kind: "theme",
            version: "1.2.0",
            origin: "installed",
          },
          _registryMeta: { source: "registry", packageName: "dusk" },
        },
      },
      { username: "me" },
    );
    registry["@me/dusk"] = { visibility: "private", versions: ["1.2.0"] };
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.equal(res.remix, false);
    assert.equal(res.key, "theme-own");
    assert.deepEqual(res.published, {
      package: "@me/dusk",
      version: "1.2.0",
      visibility: "private",
    });
    assert.equal(saved(c)["theme-own"].primary, "#c2562b");
  });

  it("signed out: the same theme is treated as downloaded (a remix)", async () => {
    const c = controller({
      "theme-own": {
        id: "theme-own",
        name: "Dusk",
        primary: "blue",
        registryRef: {
          package: "@me/dusk",
          kind: "theme",
          version: "1.2.0",
          origin: "installed",
        },
      },
    });
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.equal(res.remix, true);
  });

  it("a remix while the app uses the original says so", async () => {
    const c = controller({
      "theme-dl": {
        id: "theme-dl",
        name: "Dusk",
        primary: "blue",
        registryRef: {
          package: "@alexr/dusk",
          kind: "theme",
          version: "1.2.0",
          origin: "installed",
        },
      },
    });
    c._themeUsageAll = () => ({ appKey: "theme-dl", dashboards: [] });
    const res = await c._planChangeTheme({ name: "Dusk", colors });
    assert.equal(res.appUsesOriginal, true);
  });
});

describe("the Publish window's preview (theme change leftovers)", () => {
  const authPath = require.resolve("../controller/registryAuthController");
  it("a published theme: its version, visibility and the next version", async () => {
    const real = require.cache[authPath];
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: { ...(real ? real.exports : {}), getStoredUsername: () => "me" },
    };
    try {
      const trc = require("../controller/themeRegistryController");
      const c = controller({
        "theme-pub": {
          id: "theme-pub",
          name: "Mine",
          primary: "blue",
          registryRef: {
            package: "@me/mine",
            kind: "theme",
            version: "1.2.0",
            origin: "published",
          },
        },
      });
      registry["@me/mine"] = {
        visibility: "private",
        latestVersion: "1.2.0",
        versions: ["1.2.0"],
      };
      const res = await trc.getThemePublishPreview(c._appId, "theme-pub");
      assert.equal(res.success, true);
      assert.deepEqual(res.published, {
        package: "@me/mine",
        version: "1.2.0",
        visibility: "private",
        nextVersion: "1.2.1",
        checked: true,
        gone: false,
      });
      // Never published: nothing to keep.
      const c2 = controller({ "theme-new": { id: "theme-new", name: "New" } });
      const none = await trc.getThemePublishPreview(c2._appId, "theme-new");
      assert.equal(none.published, null);
    } finally {
      if (real) require.cache[authPath] = real;
      else delete require.cache[authPath];
    }
  });
});

describe("list_themes details", () => {
  it("each theme: colors as hex, whose it is", () => {
    const c = controller({
      a: { id: "a", name: "Dusk", primary: "#5B6B8C" },
      b: {
        id: "b",
        name: "Nordic",
        primary: "#112233",
        author: "Alex R",
        registryRef: {
          package: "@alexr/nordic",
          kind: "theme",
          version: "1.0.0",
          origin: "installed",
        },
      },
    });
    const d = c._themeDetails();
    const dusk = d.find((t) => t.name === "Dusk");
    assert.equal(dusk.by, null);
    assert.equal(dusk.colors.primary, "#5b6b8c");
    assert.deepEqual(dusk.usedBy, { app: false, dashboards: [] });
    assert.equal(d.find((t) => t.name === "Nordic").by, "Alex R");
  });

  it("no theme by that name: refused", async () => {
    const c = controller({});
    await assert.rejects(
      () => c._planChangeTheme({ name: "Nope", colors }),
      /no saved theme called "Nope"/,
    );
  });
});
