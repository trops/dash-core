/**
 * profileStore.test.js — profiles are lists of ids. With no profiles.json
 * there is only Default and it holds everything (no filtering); creating
 * the first extra profile writes Default's lists from what exists then.
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
const storeFile = () => path.join(stubDir, "Dashboard", appId, "profiles.json");
const everything = {
  dashboards: [1, 2, 3],
  folders: [1],
  themes: ["refresh"],
  bots: ["b-1", "b-2"],
};

beforeEach(() => {
  n += 1;
  appId = `@test/app-${n}`;
  store._resetCache();
});

describe("profileStore", () => {
  it("starts with only Default, no filtering, nothing written", () => {
    assert.deepEqual(
      store.list(appId).map((p) => p.name),
      ["Default"],
    );
    assert.equal(store.hasProfiles(appId), false);
    assert.equal(store.members(appId, "dashboards"), null);
    store.add(appId, "dashboards", 9);
    assert.equal(fs.existsSync(storeFile()), false);
  });

  it("the first extra profile writes Default's lists; the new one starts empty", () => {
    const mini = store.create(appId, "  Mac Mini ", {
      defaultItems: everything,
    });
    assert.equal(mini.name, "Mac Mini");
    assert.match(mini.id, /^p-[a-z0-9]+$/);
    assert.equal(store.hasProfiles(appId), true);
    assert.deepEqual(store.members(appId, "dashboards"), ["1", "2", "3"]);
    assert.deepEqual(store.members(appId, "bots"), ["b-1", "b-2"]);
    assert.deepEqual(store.members(appId, "dashboards", mini.id), []);
    // Creating doesn't switch.
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
  });

  it("a later profile doesn't touch Default's lists", () => {
    store.create(appId, "A", { defaultItems: everything });
    store.create(appId, "B", { defaultItems: { dashboards: [99] } });
    assert.deepEqual(store.members(appId, "dashboards"), ["1", "2", "3"]);
  });

  it("adds to the active profile, by default", () => {
    const mini = store.create(appId, "Mac Mini", { defaultItems: everything });
    store.setActive(appId, mini.id);
    store.add(appId, "dashboards", 2);
    store.add(appId, "dashboards", "2");
    assert.deepEqual(store.members(appId, "dashboards"), ["2"]);
    assert.deepEqual(store.members(appId, "dashboards", DEFAULT_PROFILE_ID), [
      "1",
      "2",
      "3",
    ]);
  });

  it("one item can be in several profiles; removing from one keeps the rest", () => {
    const mini = store.create(appId, "Mac Mini", { defaultItems: everything });
    store.add(appId, "bots", "b-1", mini.id);
    assert.deepEqual(
      store.profilesHolding(appId, "bots", "b-1").map((p) => p.name),
      ["Default", "Mac Mini"],
    );
    store.removeFromProfile(appId, "bots", "b-1", mini.id);
    assert.deepEqual(store.members(appId, "bots", mini.id), []);
    assert.deepEqual(store.members(appId, "bots"), ["b-1", "b-2"]);
  });

  it("removeEverywhere takes an id out of every profile", () => {
    const mini = store.create(appId, "Mac Mini", { defaultItems: everything });
    store.add(appId, "dashboards", 1, mini.id);
    store.removeEverywhere(appId, "dashboards", 1);
    assert.deepEqual(store.members(appId, "dashboards"), ["2", "3"]);
    assert.deepEqual(store.members(appId, "dashboards", mini.id), []);
  });

  it("refuses duplicate names (ignoring case) and empty names", () => {
    store.create(appId, "Mac Mini", { defaultItems: everything });
    assert.throws(() => store.create(appId, "mac mini"), /already exists/);
    assert.throws(() => store.create(appId, "default"), /already exists/);
    assert.throws(() => store.create(appId, "   "), /needs a name/);
  });

  it("switches and remembers the active profile on disk", () => {
    const p = store.create(appId, "Work Laptop", { defaultItems: everything });
    store.setActive(appId, p.id);
    store._resetCache();
    assert.equal(store.getActive(appId).name, "Work Laptop");
    assert.throws(() => store.setActive(appId, "p-nope"), /No profile/);
  });

  it("renames, but not onto another profile's name", () => {
    const a = store.create(appId, "A", { defaultItems: everything });
    store.create(appId, "B");
    assert.equal(store.rename(appId, a.id, "Mac Mini").name, "Mac Mini");
    assert.throws(() => store.rename(appId, a.id, "b"), /already exists/);
  });

  it("deletes a profile but never Default or the active one", () => {
    const keep = store.create(appId, "Keep", { defaultItems: everything });
    const gone = store.create(appId, "Gone");
    assert.throws(
      () => store.remove(appId, DEFAULT_PROFILE_ID),
      /can't be deleted/,
    );
    store.setActive(appId, keep.id);
    assert.throws(() => store.remove(appId, keep.id), /Switch to another/);
    store.remove(appId, gone.id);
    assert.deepEqual(
      store.list(appId).map((p) => p.name),
      ["Default", "Keep"],
    );
  });

  it("treats a damaged profiles.json as Default only, holding everything", () => {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), "{not json");
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
    assert.equal(store.members(appId, "dashboards"), null);
  });

  it("falls back to Default when the active id is unknown", () => {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({
        activeProfileId: "p-missing",
        profiles: [{ id: "default", name: "Default", items: {} }],
      }),
    );
    assert.equal(store.getActiveProfileId(appId), DEFAULT_PROFILE_ID);
  });

  it("ignores profiles with unsafe ids and unknown kinds", () => {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({
        activeProfileId: "default",
        profiles: [{ id: "../../escape", name: "Bad" }],
      }),
    );
    assert.deepEqual(
      store.list(appId).map((p) => p.id),
      [DEFAULT_PROFILE_ID],
    );
    assert.throws(
      () => store.members(appId, "widgets"),
      /Unknown profile item/,
    );
  });

  it("put creates or replaces a profile by id, never Default", () => {
    const loaded = store.put(
      appId,
      { id: "p-macmini", name: "Mac Mini", items: { dashboards: [101] } },
      { defaultItems: everything },
    );
    assert.equal(loaded.id, "p-macmini");
    // Starting profiles here: Default keeps what was here.
    assert.deepEqual(store.members(appId, "dashboards", "default"), [
      "1",
      "2",
      "3",
    ]);
    const replaced = store.put(appId, {
      id: "p-macmini",
      name: "Mac Mini",
      items: { dashboards: [102] },
      link: { revision: 4 },
    });
    assert.deepEqual(replaced.items.dashboards, ["102"]);
    assert.equal(replaced.link.revision, 4);
    assert.equal(store.list(appId).length, 2);
    assert.throws(
      () => store.put(appId, { id: "default", name: "X", items: {} }),
      /can't be replaced/,
    );
    assert.throws(
      () => store.put(appId, { id: "p-other", name: "mac mini", items: {} }),
      /already exists/,
    );
    // Default's own account copy replaces it in place; it stays "Default".
    const def = store.put(
      appId,
      { id: "default", name: "Whatever", items: { dashboards: [7] } },
      { replaceDefault: true },
    );
    assert.equal(def.id, "default");
    assert.equal(def.name, "Default");
    assert.deepEqual(store.members(appId, "dashboards", "default"), ["7"]);
    assert.equal(store.list(appId).length, 2);
  });
});
