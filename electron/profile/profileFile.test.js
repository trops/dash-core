/**
 * profileFile.test.js — saving a profile to a .dashprofile file (PR 4).
 * Only the profile's things go in, never secrets; every widget is checked
 * against the registry by exact version, and anything the registry can't
 * supply is copied into the file.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-pfile-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_pfile__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_pfile__"] = {
  id: "__stub_electron_pfile__",
  filename: "__stub_electron_pfile__",
  loaded: true,
  exports: {
    app: { getPath: () => stubDir, getVersion: () => "9.9.9" },
    dialog: {},
  },
};

const AdmZip = require("adm-zip");
const store = require("./profileStore");
const {
  classifyWidget,
  buildProfileFiles,
  dashboardHash,
  gatherProfile,
  saveProfileToFile,
} = require("./profileFile");

const dep = (pkg, version = "1.0.0") => ({ package: pkg, version });

describe("classifyWidget — exact version, registry-installed, or into the file", () => {
  const reg = (versions, latestVersion = versions[0]) => ({
    versions,
    latestVersion,
  });

  it("@ai-built widgets are always copied into the file", () => {
    const w = classifyWidget(dep("@ai-built/pipeline"), null, null);
    assert.equal(w.source, "bundled");
    assert.equal(w.status, "not-in-registry");
  });

  it("the exact version installed from the registry is referenced", () => {
    const w = classifyWidget(
      dep("@trops/chat", "0.0.882"),
      { version: "0.0.882", installSource: "registry" },
      reg(["0.0.882", "0.0.881"]),
    );
    assert.equal(w.source, "registry");
    assert.equal(w.status, "in-registry");
    assert.equal(w.updateAvailable, false);
  });

  it("an older install still references its own exact version, noting the update", () => {
    const w = classifyWidget(
      dep("@trops/chat", "0.0.880"),
      { version: "0.0.880", installSource: "registry" },
      reg(["0.0.882", "0.0.880"]),
    );
    assert.equal(w.source, "registry");
    assert.equal(w.version, "0.0.880");
    assert.equal(w.updateAvailable, true);
  });

  it("newer here than the registry → copied", () => {
    const w = classifyWidget(
      dep("@trops/kitchen-sink", "1.4.0"),
      { version: "1.4.0" },
      reg(["1.3.2"]),
    );
    assert.equal(w.source, "bundled");
    assert.equal(w.status, "newer-here");
    assert.equal(w.registryVersion, "1.3.2");
  });

  it("same version but a local build (folder copy / local install) → copied", () => {
    for (const installed of [
      { version: "1.0.0", copiedFromFolder: true },
      { version: "1.0.0", installSource: "local" },
      { version: "1.0.0", installSource: "url" },
    ]) {
      const w = classifyWidget(dep("@me/w"), installed, reg(["1.0.0"]));
      assert.equal(w.source, "bundled");
      assert.equal(w.status, "local-build");
    }
  });

  it("not in the registry (or not yours) → copied", () => {
    const w = classifyWidget(dep("@me/secret"), { version: "1.0.0" }, null);
    assert.equal(w.source, "bundled");
    assert.equal(w.status, "not-in-registry");
  });

  it("installed before installSource existed: referenced, marked assumed", () => {
    const w = classifyWidget(
      dep("@trops/chat", "0.0.882"),
      { version: "0.0.882" },
      reg(["0.0.882"]),
    );
    assert.equal(w.source, "registry");
    assert.equal(w.status, "assumed-registry");
  });

  it("registry unreachable → referenced but marked unchecked", () => {
    const w = classifyWidget(
      dep("@trops/chat"),
      { version: "1.0.0" },
      "unreachable",
    );
    assert.equal(w.source, "registry");
    assert.equal(w.status, "unchecked");
  });
});

describe("dashboardHash", () => {
  it("ignores fields that change by themselves, not real edits", () => {
    const a = { id: 1, name: "HA", layout: [{ id: 1 }], dateEdited: "x" };
    const b = { layout: [{ id: 1 }], name: "HA", id: 1, dateEdited: "y" };
    assert.equal(dashboardHash(a), dashboardHash(b));
    assert.notEqual(dashboardHash(a), dashboardHash({ ...a, name: "HA 2" }));
  });
});

describe("buildProfileFiles", () => {
  it("writes the profile's records, no secrets, bot sessions left out", () => {
    const { files, manifest } = buildProfileFiles({
      profile: { id: "p-mini", name: "Mac Mini" },
      dashboards: [{ id: 1, name: "HA", layout: [{ userPrefs: { room: 1 } }] }],
      bots: [{ id: "b1", name: "memo", session: { id: "s" } }],
      providers: [{ name: "ha", type: "home-assistant" }],
      settings: {
        theme: "refresh",
        checkForUpdatesOnLaunch: true,
        debug: true,
        mcpDashServer: { token: "SECRET" },
      },
      widgets: [{ package: "@ai-built/x", source: "bundled" }],
      revision: 3,
      createdOn: "Johns-Laptop",
    });
    assert.equal(manifest.kind, "dash-profile");
    assert.equal(manifest.revision, 3);
    assert.equal(manifest.counts.bundledWidgets, 1);
    assert.ok(manifest.dashboardHashes["1"]);
    const read = (n) => JSON.parse(files[n].toString("utf8"));
    // Widget settings travel.
    assert.deepEqual(read("dashboards.json")[0].layout[0].userPrefs, {
      room: 1,
    });
    assert.equal(read("bots.json")[0].session, undefined);
    assert.deepEqual(read("settings.json"), {
      theme: "refresh",
      checkForUpdatesOnLaunch: true,
    });
    assert.deepEqual(read("profile.json").items.dashboards, ["1"]);
    const all = Object.values(files)
      .map((b) => b.toString("utf8"))
      .join("");
    assert.ok(!all.includes("SECRET"));
  });
});

describe("gatherProfile + saveProfileToFile", () => {
  const appId = "@test/pfile";
  const widgetDir = path.join(stubDir, "widgets", "@ai-built", "pipeline");
  fs.mkdirSync(path.join(widgetDir, "dist"), { recursive: true });
  fs.mkdirSync(path.join(widgetDir, "node_modules", "big"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(widgetDir, "dash.json"), "{}");
  fs.writeFileSync(
    path.join(widgetDir, "dist", "index.cjs.js"),
    "module.exports={}",
  );
  fs.writeFileSync(path.join(widgetDir, "node_modules", "big", "x.js"), "x");

  const installed = {
    "@ai-built/pipeline": {
      version: "0.1.0",
      path: widgetDir,
      scope: "ai-built",
      componentNames: ["Pipeline"],
    },
    "@trops/chat": {
      version: "0.0.882",
      installSource: "registry",
      scope: "trops",
      componentNames: ["ChatClaudeCodeWidget"],
    },
    // An old unscoped install of the same package: must never be used.
    chat: { version: "0.0.1", path: "/nope/old-chat", componentNames: [] },
  };
  const registry = {
    getWidget: (p) => installed[p] || null,
    getWidgets: () =>
      Object.entries(installed).map(([k, v]) => ({
        name: k,
        packageId: k,
        ...v,
      })),
  };
  const workspaces = [
    {
      id: 1,
      name: "Kitchen",
      menuId: 7,
      themeKey: "refresh",
      selectedProviders: {},
      layout: [
        {
          id: 1,
          component: "Pipeline",
          packageId: "@ai-built/pipeline",
          selectedProviders: { ha: "home" },
        },
        { id: 2, component: "ChatClaudeCodeWidget", packageId: "@trops/chat" },
      ],
    },
    { id: 2, name: "Sales", layout: [] },
  ];
  const lookups = [];
  const deps = {
    workspaceFile: () => workspaces,
    folderFile: () => [
      { id: 7, name: "Home" },
      { id: 8, name: "Work" },
    ],
    themeFile: () => ({ refresh: { name: "Refresh" }, other: {} }),
    allBots: () => [
      { id: "b1", name: "memo", session: "s", mcpServers: ["github"] },
      { id: "b2", name: "work bot" },
      { id: "lead1", name: "Kitchen Lead", role: "lead", workspaceId: 1 },
      { id: "lead2", name: "Sales Lead", role: "lead", workspaceId: 2 },
      { id: "d1", name: "Planner", system: "dash-team" },
    ],
    providers: () => [
      {
        name: "home",
        type: "home-assistant",
        credentials: { token: "SECRET" },
      },
      { name: "github", type: "github", oauth: "SECRET2" },
      { name: "slack", type: "slack", credentials: "SECRET3" },
    ],
    settings: () => ({ theme: "refresh", mcpDashServer: { token: "SECRET4" } }),
    widgetRegistry: () => registry,
    lookupPackage: async (p) => {
      lookups.push(p);
      return p === "@trops/chat"
        ? { versions: ["0.0.882"], latestVersion: "0.0.882" }
        : null;
    },
  };

  it("takes only what the profile holds, plus the folder and theme its dashboards use", async () => {
    store.create(appId, "Mac Mini", {
      defaultItems: { dashboards: [1, 2], bots: ["b1", "b2"] },
    });
    const mini = store.list(appId).find((p) => p.name === "Mac Mini");
    store.add(appId, "dashboards", 1, mini.id);
    store.add(appId, "bots", "b1", mini.id);

    const g = await gatherProfile(appId, mini.id, {}, deps);
    assert.deepEqual(
      g.dashboards.map((d) => d.name),
      ["Kitchen"],
    );
    assert.deepEqual(
      g.folders.map((f) => f.name),
      ["Home"],
    );
    assert.deepEqual(Object.keys(g.themes), ["refresh"]);
    // A dashboard's lead comes with it, even when not ticked.
    assert.deepEqual(
      g.bots.map((b) => b.name),
      ["memo", "Kitchen Lead"],
    );
    // Providers it uses (by name), never their keys.
    assert.deepEqual(g.providers.map((p) => p.name).sort(), ["github", "home"]);
    // @ai-built is never looked up.
    assert.deepEqual(lookups, ["@trops/chat"]);
    const byPkg = Object.fromEntries(g.widgets.map((w) => [w.package, w]));
    // Full "@scope/name" ids, and the exact installed versions.
    assert.deepEqual(Object.keys(byPkg).sort(), [
      "@ai-built/pipeline",
      "@trops/chat",
    ]);
    assert.equal(byPkg["@trops/chat"].version, "0.0.882");
    assert.equal(g.installedOf["@trops/chat"].version, "0.0.882");
    assert.equal(byPkg["@ai-built/pipeline"].source, "bundled");
    assert.equal(byPkg["@trops/chat"].source, "registry");
  });

  it("writes a zip with the bundled widget (without node_modules) and no secrets, and counts up", async () => {
    const mini = store.list(appId).find((p) => p.name === "Mac Mini");
    const out = path.join(stubDir, "Mac Mini.dashprofile");
    const res = await saveProfileToFile(
      null,
      appId,
      mini.id,
      { filePath: out },
      deps,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(res.revision, 1);

    const zip = new AdmZip(out);
    const names = zip.getEntries().map((e) => e.entryName);
    assert.ok(names.includes("manifest.json"));
    assert.ok(names.includes("widgets/@ai-built/pipeline/dash.json"));
    assert.ok(names.includes("widgets/@ai-built/pipeline/dist/index.cjs.js"));
    assert.ok(!names.some((n) => n.includes("node_modules")));
    const text = zip
      .getEntries()
      .filter((e) => e.entryName.endsWith(".json"))
      .map((e) => e.getData().toString("utf8"))
      .join("");
    for (const secret of ["SECRET", "SECRET2", "SECRET3", "SECRET4"]) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
    const manifest = JSON.parse(zip.readAsText("manifest.json"));
    assert.equal(manifest.name, "Mac Mini");
    assert.equal(manifest.appVersion, "9.9.9");

    // The save is recorded; the next one counts up.
    store._resetCache();
    const link = store.list(appId).find((p) => p.id === mini.id).link;
    assert.equal(link.revision, 1);
    assert.deepEqual(Object.keys(link.dashboardHashes), ["1"]);
    const again = await saveProfileToFile(
      null,
      appId,
      mini.id,
      { filePath: out },
      deps,
    );
    assert.equal(again.revision, 2);
  });

  it("refuses a file whose widget code is too big", async () => {
    const mini = store.list(appId).find((p) => p.name === "Mac Mini");
    const { MAX_BUNDLED_BYTES } = require("./profileFile");
    const big = path.join(stubDir, "big-widget");
    fs.mkdirSync(big, { recursive: true });
    const fd = fs.openSync(path.join(big, "huge.bin"), "w");
    fs.ftruncateSync(fd, MAX_BUNDLED_BYTES + 1);
    fs.closeSync(fd);
    const saved = installed["@ai-built/pipeline"].path;
    installed["@ai-built/pipeline"].path = big;
    try {
      const res = await saveProfileToFile(
        null,
        appId,
        mini.id,
        { filePath: path.join(stubDir, "too-big.dashprofile") },
        deps,
      );
      assert.equal(res.success, false);
      assert.match(res.error, /too much for one file/);
      assert.equal(
        fs.existsSync(path.join(stubDir, "too-big.dashprofile")),
        false,
      );
    } finally {
      installed["@ai-built/pipeline"].path = saved;
      fs.rmSync(big, { recursive: true, force: true });
    }
  });

  it("only safe package ids become folders in the zip", () => {
    const { SAFE_PACKAGE_ID } = require("./profileFile");
    assert.ok(SAFE_PACKAGE_ID.test("@ai-built/pipeline"));
    assert.ok(SAFE_PACKAGE_ID.test("@trops/dash-samples"));
    assert.ok(!SAFE_PACKAGE_ID.test("@x/../../etc"));
    assert.ok(!SAFE_PACKAGE_ID.test("../evil"));
  });

  it("options leave out bots, providers and settings", async () => {
    const mini = store.list(appId).find((p) => p.name === "Mac Mini");
    const g = await gatherProfile(
      appId,
      mini.id,
      { bots: false, providers: false, settings: false },
      deps,
    );
    assert.equal(g.bots.length, 0);
    assert.equal(g.providers.length, 0);
    assert.equal(g.settings, null);
  });

  it("with only Default, Default holds everything and nothing is written to profiles.json", async () => {
    const appId2 = "@test/pfile-default";
    const g = await gatherProfile(appId2, "default", {}, deps);
    assert.equal(g.dashboards.length, 2);
    const out = path.join(stubDir, "Default.dashprofile");
    await saveProfileToFile(null, appId2, "default", { filePath: out }, deps);
    assert.equal(
      fs.existsSync(path.join(stubDir, "Dashboard", appId2, "profiles.json")),
      false,
    );
  });
});
