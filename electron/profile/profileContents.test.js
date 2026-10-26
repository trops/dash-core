/**
 * profileContents.test.js — what Settings › Profiles shows and changes:
 * every item on this computer with whether a profile holds it and which
 * other profiles do; ticking/unticking changes one profile only and never
 * deletes the item; Duplicate copies a profile's lists.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-contents-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_contents__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_contents__"] = {
  id: "__stub_electron_contents__",
  filename: "__stub_electron_contents__",
  loaded: true,
  exports: {
    app: { getPath: () => stubDir },
    dialog: {},
    BrowserWindow: function () {},
    shell: {},
  },
};

const store = require("./profileStore");
const profileController = require("../controller/profileController");
const workspaceController = require("../controller/workspaceController");

const appId = "@test/contents-app";
const appDir = path.join(stubDir, "Dashboard", appId);

const byName = (list) => Object.fromEntries(list.map((i) => [i.name, i]));

describe("profile contents", () => {
  before(() => {
    fs.mkdirSync(appDir, { recursive: true });
    const write = (name, data) =>
      fs.writeFileSync(path.join(appDir, name), JSON.stringify(data));
    write("workspaces.json", [
      { id: 1, name: "Home Assistant" },
      { id: 2, name: "Sales" },
    ]);
    write("menuItems.json", [{ id: 1, name: "Home" }]);
    write("themes.json", { refresh: { name: "Refresh" } });
  });

  it("with only Default, Default holds everything and nothing can be unticked", () => {
    const res = profileController.listContents(appId, "default");
    assert.equal(res.success, true, res.error);
    assert.equal(res.hasProfiles, false);
    assert.ok(res.contents.dashboards.every((d) => d.inProfile));
    assert.equal(res.contents.themes[0].name, "Refresh");
    const change = profileController.setMembership(
      appId,
      "default",
      "dashboards",
      1,
      false,
    );
    assert.equal(change.success, false);
    assert.match(change.error, /Create a profile first/);
  });

  it("marks what a profile holds and where else each item is", () => {
    const mini = profileController.createProfile(appId, "Mac Mini").profile;
    profileController.setMembership(appId, mini.id, "dashboards", 1, true);

    const forMini = profileController.listContents(appId, mini.id).contents;
    const dash = byName(forMini.dashboards);
    assert.equal(dash["Home Assistant"].inProfile, true);
    assert.deepEqual(dash["Home Assistant"].alsoIn, ["Default"]);
    assert.equal(dash["Sales"].inProfile, false);
    assert.deepEqual(dash["Sales"].alsoIn, ["Default"]);

    const forDefault = profileController.listContents(
      appId,
      "default",
    ).contents;
    assert.deepEqual(byName(forDefault.dashboards)["Home Assistant"].alsoIn, [
      "Mac Mini",
    ]);
  });

  it("unticking takes an item out of one profile and never deletes it", () => {
    const res = profileController.setMembership(
      appId,
      "default",
      "dashboards",
      1,
      false,
    );
    assert.equal(res.success, true, res.error);
    assert.deepEqual(res.alsoIn, ["Mac Mini"]);
    const all = JSON.parse(
      fs.readFileSync(path.join(appDir, "workspaces.json"), "utf8"),
    );
    assert.equal(all.length, 2);
    assert.deepEqual(
      workspaceController
        .listWorkspacesForApplication(null, appId)
        .workspaces.map((w) => w.name),
      ["Sales"],
    );
  });

  it("an item in no profile still shows, unticked everywhere", () => {
    const mini = store.list(appId).find((p) => p.name === "Mac Mini");
    const res = profileController.setMembership(
      appId,
      mini.id,
      "dashboards",
      1,
      false,
    );
    assert.deepEqual(res.alsoIn, []);
    const ha = byName(
      profileController.listContents(appId, "default").contents.dashboards,
    )["Home Assistant"];
    assert.equal(ha.inProfile, false);
    assert.deepEqual(ha.alsoIn, []);
  });

  it("duplicate copies a profile's lists under a new name", () => {
    const res = profileController.duplicateProfile(
      appId,
      "default",
      "Default copy",
    );
    assert.equal(res.success, true, res.error);
    assert.deepEqual(res.profile.items.dashboards, ["2"]);
    assert.deepEqual(res.profile.items.themes, ["refresh"]);
    const again = profileController.duplicateProfile(
      appId,
      "default",
      "default copy",
    );
    assert.equal(again.success, false);
  });
});

describe("duplicate as the very first profile", () => {
  it("keeps everything in Default and copies it all", () => {
    const appId2 = "@test/contents-first";
    const dir = path.join(stubDir, "Dashboard", appId2);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "workspaces.json"),
      JSON.stringify([{ id: 5, name: "Only" }]),
    );
    const res = profileController.duplicateProfile(appId2, "default", "Copy");
    assert.equal(res.success, true, res.error);
    assert.deepEqual(res.profile.items.dashboards, ["5"]);
    assert.deepEqual(store.members(appId2, "dashboards", "default"), ["5"]);
  });
});
