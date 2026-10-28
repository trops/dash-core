/**
 * profileLoadV3.test.js — loading a v3 profile: what it would do (new,
 * already here, changed — which copy wins and why — and what leaves),
 * keeping a profile in step with its account copy, and the load itself:
 * the setup written with its ids, this Mac's keys and approvals kept,
 * providers mapped, bots paused, Default replaced only by its own copy.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildManifestV3, parseProfileV3 } = require("./profileSetup");
const { planLoadV3, applyLoadV3 } = require("./profileLoadV3");

const appId = "@test/app";
const clone = (v) => JSON.parse(JSON.stringify(v));

// The profile saved on the laptop: Home (folder 2, Ocean), its lead, a
// Brief bot using Work Slack, the Home widget at 1.2.0.
function laptopSetup() {
  return {
    dashboards: [
      {
        id: 1,
        name: "Home",
        menuId: 2,
        themeKey: "Ocean",
        updatedAt: "2026-10-28T10:00:00.000Z",
        selectedProviders: { slack: "Work Slack" },
        layout: [
          {
            id: 1,
            component: "Lights",
            packageId: "@trops/home",
            selectedProviders: { ha: "Home" },
            userPrefs: { room: "Kitchen", apiKey: "" },
          },
        ],
      },
    ],
    themes: { Ocean: { name: "Ocean", primary: "blue" } },
    folders: [{ id: 2, name: "House" }],
    bots: [
      {
        id: "lead1",
        role: "lead",
        workspaceId: 1,
        name: "Home lead",
        instructions: "lead",
      },
      {
        id: "brief",
        name: "Brief",
        instructions: "summarize the house",
        mcpServers: ["Work Slack"],
        toolSelections: { "Work Slack": ["post"] },
      },
    ],
  };
}

function manifest({ setup = laptopSetup(), ...extra } = {}) {
  const m = buildManifestV3({
    profile: { id: "mac-mini", name: "Mac Mini" },
    owner: "trops",
    widgets: { "@trops/home": "1.2.0" },
    ...setup,
    providers: [
      { name: "Work Slack", type: "slack" },
      { name: "Home", type: "home-assistant" },
    ],
    appSettings: { theme: "Ocean" },
    secretsToEnter: [
      {
        dashboardId: 1,
        dashboard: "Home",
        item: "layout/1",
        title: "Lights",
        field: "apiKey",
      },
    ],
    revision: 5,
    createdOn: "laptop",
    ...extra,
  });
  return parseProfileV3(m).manifest;
}

// A computer: its records, profiles and what it records doing.
function computer(state0 = {}) {
  const state = {
    profiles: [{ id: "default", name: "Default", items: {} }],
    explicit: false,
    active: "default",
    workspaces: [],
    folders: [{ id: 1, name: "General" }],
    themes: {},
    bots: [],
    installed: {},
    info: { "@trops/home": { versions: ["1.2.0"], latestVersion: "1.2.0" } },
    providers: [{ name: "Slack", type: "slack" }],
    settings: { theme: "Dark" },
    ...state0,
  };
  const calls = [];
  const d = {
    store: {
      list: () => state.profiles,
      hasProfiles: () => state.explicit,
      getActiveProfileId: () => state.active,
      put: (appId_, p, opts) => {
        calls.push(["put", p, opts]);
        const id = p.id || "p-new";
        const next = { ...p, id };
        state.profiles = [...state.profiles.filter((x) => x.id !== id), next];
        return next;
      },
      removeFromProfile: (...a) => calls.push(["removeFromProfile", ...a]),
    },
    workspaceFile: () => clone(state.workspaces),
    folderFile: () => clone(state.folders),
    themeFile: () => clone(state.themes),
    writeAppFile: (appId_, name, data) => {
      calls.push(["write", name, data]);
      if (name === "workspaces.json") state.workspaces = data;
      if (name === "menuItems.json") state.folders = data;
      if (name === "themes.json") state.themes = data;
    },
    allBots: () => clone(state.bots),
    saveBot: (def, opts) => {
      calls.push(["saveBot", def, opts]);
      const i = state.bots.findIndex((b) => String(b.id) === String(def.id));
      if (i >= 0) state.bots[i] = { ...state.bots[i], ...def };
      else state.bots.push(def);
      return def;
    },
    applyActiveProfile: () => calls.push(["applyActiveProfile"]),
    widgetRegistry: () => ({
      getWidget: (p) => state.installed[p] || null,
      getWidgets: () =>
        Object.entries(state.installed).map(([k, v]) => ({
          name: k,
          packageId: k,
          ...v,
        })),
      downloadWidget: async (pkg, url) => {
        calls.push(["download", pkg, url]);
        state.installed[pkg] = { version: "1.2.0", installSource: "registry" };
        return { name: pkg };
      },
    }),
    announceInstalled: () => {},
    lookup: async (pkg) =>
      state.unreachable ? "unreachable" : state.info[pkg] || null,
    downloadUrl: (pkg, v) => `https://registry/${pkg}@${v}`,
    providers: () => state.providers,
    settings: () => state.settings,
    saveSettings: (s) => calls.push(["saveSettings", s]),
    now: () => new Date("2026-10-28T12:00:00.000Z"),
  };
  const written = (name) =>
    calls.filter((c) => c[0] === "write" && c[1] === name).pop();
  return { d, state, calls, written };
}

const rowOf = (plan, kind, pkg) =>
  plan.rows.find((r) => r.kind === kind && r.package === String(pkg));

describe("planning", () => {
  it("into an empty computer: everything new, a new profile", async () => {
    const { d } = computer();
    const plan = await planLoadV3(appId, manifest(), d);
    assert.equal(plan.schemaVersion, 3);
    assert.deepEqual(plan.target, {
      mode: "create",
      profileId: null,
      name: "Mac Mini",
    });
    for (const [kind, id] of [
      ["widget", "@trops/home"],
      ["dashboard", 1],
      ["folder", 2],
      ["theme", "Ocean"],
      ["bot", "brief"],
      ["bot", "lead1"],
    ]) {
      assert.equal(rowOf(plan, kind, id).action, "install", `${kind} ${id}`);
    }
    assert.deepEqual(
      plan.providers.map((p) => [p.name, p.status]),
      [
        ["Work Slack", "map"],
        ["Home", "setup"],
      ],
    );
    assert.equal(plan.secretsToEnter.length, 1);
    assert.deepEqual(plan.leaving, []);
  });

  it("already here and the same: nothing to do", async () => {
    const s = laptopSetup();
    const { d } = computer({
      workspaces: s.dashboards,
      folders: s.folders,
      themes: s.themes,
      bots: s.bots,
      providers: [
        { name: "Work Slack", type: "slack" },
        { name: "Home", type: "home-assistant" },
      ],
      installed: {
        "@trops/home": { version: "1.2.0", installSource: "registry" },
      },
    });
    const plan = await planLoadV3(appId, manifest(), d);
    assert.deepEqual([...new Set(plan.rows.map((r) => r.action))], ["here"]);
  });

  it("a key typed here doesn't make a dashboard different", async () => {
    const s = laptopSetup();
    s.dashboards[0].layout[0].userPrefs.apiKey = "SECRET-HERE";
    const { d } = computer({
      workspaces: s.dashboards,
      providers: [
        { name: "Work Slack", type: "slack" },
        { name: "Home", type: "home-assistant" },
      ],
    });
    const plan = await planLoadV3(appId, manifest(), d);
    assert.equal(rowOf(plan, "dashboard", 1).action, "here");
    // Missing or null here: still the same.
    delete s.dashboards[0].layout[0].userPrefs.apiKey;
    const { d: d2 } = computer({
      workspaces: s.dashboards,
      providers: [
        { name: "Work Slack", type: "slack" },
        { name: "Home", type: "home-assistant" },
      ],
    });
    const plan2 = await planLoadV3(appId, manifest(), d2);
    assert.equal(rowOf(plan2, "dashboard", 1).action, "here");
  });

  it("this Mac's copy with its providers mapped (Work Slack → Slack) is the same", async () => {
    const s = laptopSetup();
    s.dashboards[0].selectedProviders = { slack: "Slack" };
    s.dashboards[0].layout[0].selectedProviders = { ha: "Home" };
    const { d } = computer({
      workspaces: s.dashboards,
      providers: [
        { name: "Slack", type: "slack" },
        { name: "Home", type: "home-assistant" },
      ],
    });
    const plan = await planLoadV3(appId, manifest(), d);
    assert.equal(rowOf(plan, "dashboard", 1).action, "here");
  });

  it("a profile's bot never lands on this Mac's Dash team", async () => {
    const s = laptopSetup();
    s.bots[1].id = "dashteam";
    const { d, state, calls } = computer({
      bots: [{ id: "dashteam", system: "dash-team", name: "Dash team" }],
    });
    const m = manifest({ setup: s });
    const row = rowOf(await planLoadV3(appId, m, d), "bot", "dashteam");
    assert.equal(row.action, "install");
    assert.equal(row.newId, true);
    const res = await applyLoadV3(null, appId, m, {}, d);
    assert.equal(res.success, true, res.error);
    const save = calls.find((c) => c[0] === "saveBot" && c[1].name === "Brief");
    assert.equal(save[1].id, undefined);
    assert.equal(save[2].keepId, false);
    assert.equal(
      state.bots.find((b) => b.system === "dash-team").name,
      "Dash team",
    );
  });

  it("changed: the newer copy wins by default, and says why", async () => {
    const older = laptopSetup().dashboards[0];
    older.name = "Old name";
    older.updatedAt = "2026-10-20T10:00:00.000Z";
    const { d } = computer({ workspaces: [older] });
    const row = rowOf(await planLoadV3(appId, manifest(), d), "dashboard", 1);
    assert.equal(row.action, "update");
    assert.match(row.reason, /profile/);

    const newer = { ...older, updatedAt: "2026-10-29T10:00:00.000Z" };
    const { d: d2 } = computer({ workspaces: [newer] });
    const kept = rowOf(await planLoadV3(appId, manifest(), d2), "dashboard", 1);
    assert.equal(kept.action, "keep");
    assert.match(kept.reason, /this Mac/);
  });

  it("keeping in step: the account's copy wins, even over a newer one here", async () => {
    const mine = {
      ...laptopSetup().dashboards[0],
      name: "Renamed here",
      updatedAt: "2026-10-29T10:00:00.000Z",
    };
    const { d } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: {} },
        { id: "mm", name: "Mac Mini here", items: { dashboards: ["1"] } },
      ],
      workspaces: [mine],
    });
    const plan = await planLoadV3(appId, manifest(), d, {
      linkedProfileId: "mm",
      sync: true,
    });
    assert.equal(plan.keepingInStep, true);
    assert.equal(plan.target.profileId, "mm");
    const row = rowOf(plan, "dashboard", 1);
    assert.equal(row.action, "update");
    assert.equal(row.reason, "Changed in your account's copy");
    // A file (not linked) doesn't keep in step.
    const file = await planLoadV3(appId, manifest(), d);
    assert.equal(file.keepingInStep, false);
  });

  it("Default only by its own account copy; otherwise its own profile", async () => {
    const { d } = computer();
    const m = manifest({ profile: { id: "default", name: "Default" } });
    const asOwn = await planLoadV3(appId, m, d);
    assert.equal(asOwn.target.mode, "create");
    assert.equal(asOwn.target.name, "Default (from laptop)");
    const inPlace = await planLoadV3(appId, m, d, {
      linkedProfileId: "default",
      sync: true,
    });
    assert.equal(inPlace.target.profileId, "default");
    assert.equal(inPlace.target.mode, "replace");
  });

  it("replacing: what leaves the profile, and whether it's hidden", async () => {
    const { d } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: { dashboards: ["8"] } },
        {
          id: "mm",
          name: "Mac Mini",
          items: { dashboards: ["1", "8", "9"], bots: ["solo"] },
        },
      ],
      workspaces: [
        laptopSetup().dashboards[0],
        { id: 8, name: "Shared" },
        { id: 9, name: "Only here" },
      ],
      bots: [{ id: "solo", name: "Solo" }],
    });
    const plan = await planLoadV3(appId, manifest(), d);
    assert.deepEqual(plan.leaving, [
      { kind: "dashboard", name: "Shared", hidden: false },
      { kind: "dashboard", name: "Only here", hidden: true },
      { kind: "bot", name: "Solo", hidden: true },
    ]);
  });

  it("a dashboard's lead: this Mac's is kept", async () => {
    const { d } = computer({
      workspaces: [laptopSetup().dashboards[0]],
      bots: [{ id: "myLead", role: "lead", workspaceId: 1, name: "Lead here" }],
    });
    const row = rowOf(await planLoadV3(appId, manifest(), d), "bot", "lead1");
    assert.equal(row.action, "here");
    assert.equal(row.localId, "myLead");
  });

  it("a copy made before v3 (another id, same package) is matched", async () => {
    const ref = {
      registryRef: {
        package: "@trops/home-lab",
        kind: "dashboard",
        version: "1.0.0",
        origin: "installed",
      },
    };
    const s = laptopSetup();
    Object.assign(s.dashboards[0], {
      registryRef: { ...ref.registryRef, origin: "published" },
    });
    const { d } = computer({
      workspaces: [{ ...s.dashboards[0], id: 77, name: "Older", ...ref }],
    });
    const row = rowOf(
      await planLoadV3(appId, manifest({ setup: s }), d),
      "dashboard",
      1,
    );
    assert.equal(row.localId, "77");
    assert.notEqual(row.action, "install");
  });

  it("a widget built here is kept unless picked; unreachable stops", async () => {
    const { d, state } = computer({
      installed: {
        "@trops/home": { version: "1.3.0", installSource: "local" },
      },
    });
    const row = rowOf(
      await planLoadV3(appId, manifest(), d),
      "widget",
      "@trops/home",
    );
    assert.equal(row.action, "keep");
    state.unreachable = true;
    assert.equal((await planLoadV3(appId, manifest(), d)).unreachable, true);
  });
});

describe("loading", () => {
  it("into an empty computer: the setup with its ids, bots paused in the new profile", async () => {
    const { d, state, calls, written } = computer({ explicit: true });
    // A provider the profile doesn't list is never connected.
    const s = laptopSetup();
    s.dashboards[0].layout[0].selectedProviders.other = "Unlisted";
    const ok = await applyLoadV3(null, appId, manifest({ setup: s }), {}, d);
    assert.equal(ok.success, true, ok.error);
    assert.deepEqual(ok.widgetsInstalled, ["@trops/home"]);
    assert.equal(written("workspaces.json")[2][0].id, 1);
    assert.deepEqual(
      written("menuItems.json")[2].map((f) => f.name),
      ["General", "House"],
    );
    assert.equal(written("themes.json")[2].Ocean.primary, "blue");
    const put = calls.find((c) => c[0] === "put");
    assert.deepEqual(put[1].items, {
      dashboards: ["1"],
      folders: ["2"],
      themes: ["Ocean"],
      bots: ["lead1", "brief"],
    });
    const saves = calls.filter((c) => c[0] === "saveBot");
    assert.deepEqual(
      saves.map((c) => [
        c[1].id,
        c[2] && c[2].addToProfile,
        c[2] && c[2].keepId,
      ]),
      [
        ["lead1", "mac-mini", true],
        ["brief", "mac-mini", true],
      ],
    );
    assert.deepEqual(ok.botsPaused, ["Home lead", "Brief"]);
    // Providers mapped to this computer's; ones the profile doesn't list dropped.
    const ws = state.workspaces[0];
    assert.deepEqual(ws.selectedProviders, { slack: "Slack" });
    assert.deepEqual(ws.layout[0].selectedProviders, { ha: "Home" });
    const brief = state.bots.find((b) => b.id === "brief");
    assert.deepEqual(brief.mcpServers, ["Slack"]);
    assert.deepEqual(brief.toolSelections, { Slack: ["post"] });
    assert.deepEqual(ok.providersToSetUp, ["Home"]);
  });

  it("over this Mac's copy: its keys and approvals stay", async () => {
    const mine = laptopSetup();
    mine.dashboards[0].layout[0].userPrefs = {
      room: "Garage",
      apiKey: "SECRET-HERE",
    };
    mine.dashboards[0].updatedAt = "2026-10-01T00:00:00.000Z";
    mine.bots[1] = {
      ...mine.bots[1],
      instructions: "old",
      allowedTools: ["slack.post"],
      approvalPolicy: "never",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const fresh = laptopSetup();
    fresh.bots[1].updatedAt = "2026-10-28T00:00:00.000Z";
    const { d, state, calls } = computer({
      workspaces: mine.dashboards,
      bots: mine.bots,
    });
    const res = await applyLoadV3(
      null,
      appId,
      manifest({ setup: fresh }),
      {},
      d,
    );
    assert.equal(res.success, true, res.error);
    const prefs = state.workspaces[0].layout[0].userPrefs;
    assert.equal(prefs.room, "Kitchen");
    assert.equal(prefs.apiKey, "SECRET-HERE");
    const save = calls.find((c) => c[0] === "saveBot" && c[1].id === "brief");
    assert.equal(save[2], undefined); // an update, not a new bot
    assert.equal("allowedTools" in save[1], false);
    assert.equal("approvalPolicy" in save[1], false);
    const brief = state.bots.find((b) => b.id === "brief");
    assert.deepEqual(brief.allowedTools, ["slack.post"]);
    assert.equal(brief.instructions, "summarize the house");
  });

  it("a bot whose provider isn't here yet still loads, and says what to add", async () => {
    const { d, state, calls } = computer({ providers: [] });
    // As the real bot save does: a connection this Mac doesn't have fails.
    const realSave = d.saveBot;
    d.saveBot = (def, opts) => {
      for (const n of def.mcpServers || []) {
        if (!state.providers.some((p) => p.name === n)) {
          throw new Error(
            `It uses the connection "${n}", which you don't have`,
          );
        }
      }
      return realSave(def, opts);
    };
    const res = await applyLoadV3(null, appId, manifest(), {}, d);
    assert.equal(res.success, true, res.error);
    assert.deepEqual(res.problems, []);
    assert.deepEqual(res.botsWaiting, [
      { bot: "Brief", providers: ["Work Slack"] },
    ]);
    const brief = calls.find((c) => c[0] === "saveBot" && c[1].id === "brief");
    assert.deepEqual(brief[1].mcpServers, []);
    assert.deepEqual(brief[1].toolSelections, {});
  });

  it("a bot that can't be saved isn't left in the profile", async () => {
    const { d, calls } = computer();
    d.saveBot = (def) => {
      if (def.id === "brief") throw new Error("invalid bot");
      return def;
    };
    const res = await applyLoadV3(null, appId, manifest(), {}, d);
    assert.equal(res.success, true);
    assert.match(res.problems[0], /Brief wasn't loaded: invalid bot/);
    assert.ok(
      calls.some(
        (c) =>
          c[0] === "removeFromProfile" && c[2] === "bots" && c[3] === "brief",
      ),
    );
  });

  it("this Mac's bots on the profile's dashboards stay in it (a profile saved without bots)", async () => {
    const s = laptopSetup();
    s.bots = [];
    const { d, calls } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: {} },
        {
          id: "mm",
          name: "Mac Mini",
          items: { dashboards: ["1"], bots: ["myLead", "myTeam"] },
        },
      ],
      workspaces: laptopSetup().dashboards,
      bots: [
        { id: "myLead", role: "lead", workspaceId: 1, name: "Lead here" },
        { id: "myTeam", workspaceId: 1, name: "Team bot here" },
        { id: "other", workspaceId: 99, name: "Elsewhere" },
      ],
    });
    const res = await applyLoadV3(
      null,
      appId,
      manifest({ setup: s }),
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    const put = calls.find((c) => c[0] === "put");
    assert.deepEqual(put[1].items.bots.sort(), ["myLead", "myTeam"]);
  });

  it("a results widget keeps pointing at this Mac's bot", async () => {
    const s = laptopSetup();
    s.dashboards[0].layout[0].userPrefs.botId = "lead1";
    s.dashboards[0].name = "Home (renamed)";
    const mine = laptopSetup();
    mine.dashboards[0].layout[0].userPrefs.botId = "myLead";
    const { d, state } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: {} },
        { id: "mm", name: "Mac Mini", items: { dashboards: ["1"] } },
      ],
      workspaces: mine.dashboards,
      bots: [{ id: "myLead", role: "lead", workspaceId: 1, name: "Lead here" }],
    });
    const res = await applyLoadV3(
      null,
      appId,
      manifest({ setup: s }),
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(state.workspaces[0].name, "Home (renamed)");
    assert.equal(state.workspaces[0].layout[0].userPrefs.botId, "myLead");
  });

  it("a bot's widget trigger follows its dashboard to this Mac's id", async () => {
    const ref = {
      package: "@trops/home-lab",
      kind: "dashboard",
      version: "1.0.0",
    };
    const s = laptopSetup();
    s.dashboards[0].registryRef = { ...ref, origin: "published" };
    s.bots[1].workspaceId = 1;
    s.bots[1].subscriptions = [
      { source: { workspaceId: 1, widget: "Lights" } },
    ];
    const { d, calls } = computer({
      workspaces: [
        { id: 77, name: "Older", registryRef: { ...ref, origin: "installed" } },
      ],
    });
    const res = await applyLoadV3(null, appId, manifest({ setup: s }), {}, d);
    assert.equal(res.success, true, res.error);
    const brief = calls.find(
      (c) => c[0] === "saveBot" && c[1].id === "brief",
    )[1];
    assert.equal(brief.workspaceId, "77");
    assert.equal(brief.subscriptions[0].source.workspaceId, "77");
  });

  it("loading as new loads what the preview showed ticked", async () => {
    const mine = {
      ...laptopSetup().dashboards[0],
      name: "Renamed here",
      updatedAt: "2026-10-29T10:00:00.000Z",
    };
    const { d, state } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: {} },
        { id: "mm", name: "Mac Mini", items: { dashboards: ["1"] } },
      ],
      workspaces: [mine],
    });
    const preview = await planLoadV3(appId, manifest(), d, {
      linkedProfileId: "mm",
      sync: true,
    });
    assert.equal(rowOf(preview, "dashboard", 1).action, "update");
    const res = await applyLoadV3(
      null,
      appId,
      manifest(),
      { asNew: true, name: "Copy", linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(state.workspaces[0].name, "Home");
  });

  it("keeping in step: a folder another profile uses is shown as not renamed", async () => {
    const s = laptopSetup();
    s.folders = [{ id: 1, name: "Renamed elsewhere" }];
    const { d } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: { folders: ["1"] } },
        { id: "mm", name: "Mac Mini", items: { folders: ["1"] } },
      ],
      folders: [{ id: 1, name: "General" }],
    });
    const plan = await planLoadV3(appId, manifest({ setup: s }), d, {
      linkedProfileId: "mm",
      sync: true,
    });
    const row = rowOf(plan, "folder", 1);
    assert.equal(row.action, "here");
    assert.match(row.reason, /Another profile here uses it/);
  });

  it("the user's choices: kept rows are left alone", async () => {
    const older = {
      ...laptopSetup().dashboards[0],
      name: "Old",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const { d, calls } = computer({ workspaces: [older] });
    const res = await applyLoadV3(
      null,
      appId,
      manifest(),
      { keep: ["dashboard:1"] },
      d,
    );
    assert.equal(res.success, true);
    assert.equal(
      calls.some((c) => c[0] === "write" && c[1] === "workspaces.json"),
      false,
    );
  });

  it("keeping in step: account wins; a shared folder isn't renamed; a bot keeps some providers", async () => {
    const s = laptopSetup();
    s.folders = [{ id: 1, name: "Renamed elsewhere" }, ...s.folders];
    s.bots[1].mcpServers = ["Gone"];
    const mine = laptopSetup();
    mine.dashboards[0].name = "Mine, newer";
    mine.dashboards[0].updatedAt = "2026-10-30T00:00:00.000Z";
    mine.bots[1] = {
      ...mine.bots[1],
      mcpServers: ["Slack"],
      instructions: "mine",
    };
    const { d, state } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: { folders: ["1"] } },
        {
          id: "mm",
          name: "Mac Mini",
          items: { dashboards: ["1"], folders: ["1", "2"], bots: ["brief"] },
        },
      ],
      workspaces: mine.dashboards,
      folders: [
        { id: 1, name: "General" },
        { id: 2, name: "House" },
      ],
      bots: mine.bots,
    });
    const res = await applyLoadV3(
      null,
      appId,
      manifest({ setup: s }),
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(state.workspaces[0].name, "Home");
    assert.equal(state.folders.find((f) => f.id === 1).name, "General");
    const brief = state.bots.find((b) => b.id === "brief");
    assert.equal(brief.instructions, "summarize the house");
    assert.deepEqual(brief.mcpServers, ["Slack"]);
  });

  it("Default's own account copy replaces Default in place", async () => {
    const { d, calls } = computer();
    const m = manifest({ profile: { id: "default", name: "Default" } });
    const res = await applyLoadV3(
      null,
      appId,
      m,
      { linkedProfileId: "default", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    const put = calls.find((c) => c[0] === "put");
    assert.equal(put[1].id, "default");
    assert.equal(put[1].name, "Default");
    assert.equal(put[2].replaceDefault, true);
  });

  it("refuses before writing: a name in use, or no registry", async () => {
    const { d, calls, state } = computer({
      explicit: true,
      profiles: [
        { id: "default", name: "Default", items: {} },
        { id: "x", name: "Taken", items: {} },
      ],
    });
    const named = await applyLoadV3(
      null,
      appId,
      manifest({ profile: { id: "other", name: "Other" } }),
      { name: "Taken" },
      d,
    );
    assert.match(named.error, /already exists/);
    state.unreachable = true;
    const offline = await applyLoadV3(null, appId, manifest(), {}, d);
    assert.match(offline.error, /registry/);
    assert.equal(calls.length, 0);
  });

  it("app settings only when asked", async () => {
    const { d, calls } = computer();
    await applyLoadV3(null, appId, manifest(), {}, d);
    assert.equal(
      calls.some((c) => c[0] === "saveSettings"),
      false,
    );
    const { d: d2, calls: calls2 } = computer();
    await applyLoadV3(null, appId, manifest(), { applySettings: true }, d2);
    assert.deepEqual(
      calls2.find((c) => c[0] === "saveSettings")[1].theme,
      "Ocean",
    );
  });
});
