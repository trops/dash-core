/**
 * profileStore.test.js — the profile list and which profile is active.
 * With no profiles.json the app has one profile, Default, and nothing is
 * written until a second profile is created.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The store requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-profiles-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_profiles__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_profiles__"] = {
  id: "__stub_electron_profiles__",
  filename: "__stub_electron_profiles__",
  loaded: true,
  exports: { app: { getPath: () => stubDir } },
};

const store = require("./profileStore");
const { DEFAULT_PROFILE_ID } = store;

let n = 0;
let appId;
const appDir = () => path.join(stubDir, "Dashboard", appId);
const storeFile = () => path.join(appDir(), "profiles.json");

beforeEach(() => {
  n += 1;
  appId = `@test/app-${n}`;
  store._resetCache();
});

describe("profileStore", () => {
  it("starts with only Default and writes nothing", () => {
    assert.deepEqual(store.list(appId), [
      { id: DEFAULT_PROFILE_ID, name: "Default" },
    ]);
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
    assert.equal(fs.existsSync(storeFile()), false);
  });

  it("Default's folder is the app folder itself", () => {
    assert.equal(store.getProfileDir(appId, DEFAULT_PROFILE_ID), appDir());
  });

  it("creates a profile with its own folder under profiles/", () => {
    const profile = store.create(appId, "  Mac Mini ");
    assert.equal(profile.name, "Mac Mini");
    assert.match(profile.id, /^p-[a-z0-9]+$/);
    const dir = path.join(appDir(), "profiles", profile.id);
    assert.equal(store.getProfileDir(appId, profile.id), dir);
    assert.equal(fs.existsSync(dir), true);
    assert.deepEqual(
      store.list(appId).map((p) => p.name),
      ["Default", "Mac Mini"],
    );
    // Creating doesn't switch.
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
  });

  it("refuses duplicate names, ignoring case", () => {
    store.create(appId, "Mac Mini");
    assert.throws(() => store.create(appId, "mac mini"), /already exists/);
    assert.throws(() => store.create(appId, "default"), /already exists/);
    assert.throws(() => store.create(appId, "   "), /needs a name/);
  });

  it("switches the active profile and remembers it on disk", () => {
    const profile = store.create(appId, "Work Laptop");
    store.setActive(appId, profile.id);
    store._resetCache();
    assert.equal(store.getActiveProfileId(appId), profile.id);
    assert.equal(store.getActive(appId).name, "Work Laptop");
    assert.throws(() => store.setActive(appId, "p-nope"), /No profile/);
  });

  it("renames, but not onto another profile's name", () => {
    const a = store.create(appId, "A");
    store.create(appId, "B");
    assert.equal(store.rename(appId, a.id, "Mac Mini").name, "Mac Mini");
    assert.throws(() => store.rename(appId, a.id, "b"), /already exists/);
  });

  it("deletes a profile and its folder, never Default or the active one", () => {
    const keep = store.create(appId, "Keep");
    const gone = store.create(appId, "Gone");
    const goneDir = store.getProfileDir(appId, gone.id);
    fs.writeFileSync(path.join(goneDir, "workspaces.json"), "[]");

    assert.throws(
      () => store.remove(appId, DEFAULT_PROFILE_ID),
      /can't be deleted/,
    );
    store.setActive(appId, keep.id);
    assert.throws(() => store.remove(appId, keep.id), /Switch to another/);

    store.remove(appId, gone.id);
    assert.equal(fs.existsSync(goneDir), false);
    assert.deepEqual(
      store.list(appId).map((p) => p.name),
      ["Default", "Keep"],
    );
  });

  it("treats a damaged profiles.json as Default only", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(storeFile(), "{not json");
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
  });

  it("falls back to Default when the active id is unknown", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({
        activeProfileId: "p-missing",
        profiles: [{ id: "default", name: "Default" }],
      }),
    );
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
  });

  it("never builds a folder path from an unsafe id", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({
        activeProfileId: "../../escape",
        profiles: [{ id: "../../escape", name: "Bad" }],
      }),
    );
    assert.deepEqual(
      store.list(appId).map((p) => p.id),
      [DEFAULT_PROFILE_ID],
    );
    assert.throws(
      () => store.getProfileDir(appId, "../../escape"),
      /Invalid profile id/,
    );
  });
});
