/**
 * profileDigest.test.js — what a profile holds as fingerprints, what
 * counts as a change (and what doesn't: opening a dashboard, a bot run),
 * and how a profile compares with its account copy.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  profileDigest,
  digestChanges,
  cleanDigest,
  compareWithAccount,
} = require("./profileDigest");

const appId = "@test/app";

function computer(overrides = {}) {
  const state = {
    explicit: true,
    profiles: [
      {
        id: "mini",
        name: "Mac Mini",
        items: { dashboards: ["1"], bots: ["b2"], themes: ["t1"], folders: [] },
      },
    ],
    workspaces: [
      {
        id: 1,
        name: "Home",
        menuId: 7,
        layout: [
          {
            id: 1,
            uuid: "u1",
            component: "Lights",
            packageId: "@trops/home",
            userPrefs: { room: "Kitchen" },
          },
        ],
      },
      { id: 2, name: "Not in the profile", layout: [] },
    ],
    themes: { t1: { name: "Night", primary: "blue" }, t2: { name: "Other" } },
    folders: [{ id: 7, name: "House" }],
    bots: [
      { id: "lead1", role: "lead", workspaceId: 1, name: "Home lead" },
      { id: "b2", name: "Watcher", instructions: "watch" },
      { id: "b3", name: "Elsewhere" },
      { id: "dt", system: "dash-team", name: "Dash team" },
    ],
    widgets: {
      "@trops/home": {
        version: "1.0.0",
        installSource: "registry",
        componentNames: ["Lights"],
      },
    },
    ...overrides,
  };
  const registry = {
    getWidget: (p) => state.widgets[p] || null,
    getWidgets: () =>
      Object.entries(state.widgets).map(([k, v]) => ({
        name: k,
        packageId: k,
        ...v,
      })),
  };
  return {
    state,
    deps: {
      store: {
        list: () => state.profiles,
        hasProfiles: () => state.explicit,
      },
      workspaceFile: () => state.workspaces,
      themeFile: () => state.themes,
      folderFile: () => state.folders,
      allBots: () => state.bots,
      widgetRegistry: () => registry,
    },
  };
}

describe("profileDigest", () => {
  it("holds what the profile holds, not the rest — and never a lead", () => {
    const { deps } = computer();
    const dg = profileDigest(appId, "mini", deps);
    assert.deepEqual(Object.keys(dg.dashboards), ["1"]);
    assert.deepEqual(Object.keys(dg.bots), ["b2"]);
    assert.deepEqual(Object.keys(dg.themes), ["t1"]);
    assert.deepEqual(dg.folders, {});
    assert.equal(profileDigest(appId, "nope", deps), null);
  });

  it("Default without profiles holds everything", () => {
    const { deps, state } = computer();
    state.explicit = false;
    state.profiles = [{ id: "default", name: "Default", items: {} }];
    const dg = profileDigest(appId, "default", deps);
    assert.deepEqual(Object.keys(dg.dashboards).sort(), ["1", "2"]);
    assert.deepEqual(Object.keys(dg.bots).sort(), ["b2", "b3"]);
  });

  it("opening a dashboard or a bot run isn't a change; a widget setting, a rename or a removal is", () => {
    const { deps, state } = computer();
    const before = profileDigest(appId, "mini", deps);
    state.workspaces[0] = { ...state.workspaces[0], lastOpened: Date.now() };
    // A run saves the bot's conversation and edit time; approving a tool
    // here adds to its allowed tools — none is part of the profile.
    state.bots[1] = {
      ...state.bots[1],
      session: { engine: "cli", state: "x" },
      updatedAt: new Date().toISOString(),
      allowedTools: ["slack.post"],
    };
    assert.equal(
      digestChanges(before, profileDigest(appId, "mini", deps)).total,
      0,
    );

    state.workspaces[0] = {
      ...state.workspaces[0],
      layout: [
        { ...state.workspaces[0].layout[0], userPrefs: { room: "Den" } },
      ],
    };
    state.themes.t1 = { ...state.themes.t1, name: "Midnight" };
    state.profiles[0].items.bots = [];
    const changes = digestChanges(before, profileDigest(appId, "mini", deps));
    assert.equal(changes.dashboards, 1);
    assert.equal(changes.themes, 1);
    assert.equal(changes.bots, 1);
    assert.equal(changes.total, 3);
  });

  it("the app making or upgrading a dashboard's lead isn't a change", () => {
    const { deps, state } = computer();
    state.bots = state.bots.filter((b) => b.role !== "lead");
    const before = profileDigest(appId, "mini", deps);
    state.bots.push({
      id: "lead9",
      role: "lead",
      workspaceId: 1,
      instructions: "v2",
    });
    assert.equal(
      digestChanges(before, profileDigest(appId, "mini", deps)).total,
      0,
    );
  });

  it("no recorded digest: nothing is known to have changed", () => {
    const { deps } = computer();
    assert.equal(
      digestChanges(null, profileDigest(appId, "mini", deps)).total,
      0,
    );
  });

  it("a digest from disk is checked", () => {
    assert.equal(cleanDigest(null), null);
    assert.deepEqual(
      cleanDigest({ dashboards: { 1: "0123456789abcdef", 2: "<script>" } }),
      {
        dashboards: { 1: "0123456789abcdef" },
        bots: {},
        themes: {},
        folders: {},
        widgets: {},
      },
    );
  });

  it("a key typed into a widget isn't a change (the profile never has it)", () => {
    const { deps, state } = computer();
    const withKey = (apiKey) => ({
      ...state.workspaces[0],
      layout: [
        {
          ...state.workspaces[0].layout[0],
          userPrefs: { room: "Kitchen", apiKey },
        },
      ],
    });
    // Missing or null before it's typed: still not a change.
    for (const start of [undefined, null, ""]) {
      state.workspaces[0] = withKey(start);
      if (start === undefined) {
        delete state.workspaces[0].layout[0].userPrefs.apiKey;
      }
      const was = profileDigest(appId, "mini", deps);
      state.workspaces[0] = withKey("sk-123");
      assert.equal(
        digestChanges(was, profileDigest(appId, "mini", deps)).total,
        0,
        String(start),
      );
    }
    state.workspaces[0] = withKey("");
    const before = profileDigest(appId, "mini", deps);
    state.workspaces[0] = {
      ...withKey("SECRET"),
      layout: [
        {
          ...withKey("SECRET").layout[0],
          userPrefs: { room: "Kitchen", apiKey: "SECRET" },
        },
      ],
    };
    assert.equal(
      digestChanges(before, profileDigest(appId, "mini", deps)).total,
      0,
    );
  });

  it("widgets: a new registry version is a change; edits built here aren't", () => {
    const { deps, state } = computer();
    const before = profileDigest(appId, "mini", deps);
    assert.deepEqual(Object.keys(before.widgets), ["@trops/home"]);
    // Updated (or published and installed) from the registry: a change.
    state.widgets["@trops/home"] = {
      ...state.widgets["@trops/home"],
      version: "1.1.0",
    };
    const updated = profileDigest(appId, "mini", deps);
    assert.equal(digestChanges(before, updated).widgets, 1);
    // Built here, then built again: not a change.
    state.widgets["@trops/home"] = {
      ...state.widgets["@trops/home"],
      installSource: "local",
      version: "1.1.1",
    };
    const built = profileDigest(appId, "mini", deps);
    state.widgets["@trops/home"] = {
      ...state.widgets["@trops/home"],
      version: "1.1.2",
    };
    assert.equal(
      digestChanges(built, profileDigest(appId, "mini", deps)).total,
      0,
    );
  });
});

describe("compareWithAccount", () => {
  const { deps } = computer();
  const now = profileDigest(appId, "mini", deps);
  const changed = { ...now, dashboards: { 1: "ffffffffffffffff" } };

  it("in step, account newer, changed here, or both", () => {
    assert.equal(
      compareWithAccount({ revision: 3, digest: now }, 3, now).state,
      "in-sync",
    );
    assert.equal(
      compareWithAccount({ revision: 3, digest: now }, 4, now).state,
      "account-newer",
    );
    const local = compareWithAccount({ revision: 3, digest: changed }, 3, now);
    assert.equal(local.state, "local-changed");
    assert.equal(local.changes.dashboards, 1);
    assert.equal(
      compareWithAccount({ revision: 3, digest: changed }, 4, now).state,
      "both",
    );
  });
});
