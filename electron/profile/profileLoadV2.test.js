/**
 * profileLoadV2.test.js — loading a v2 profile: reading the file (it may be
 * crafted), what loading would do (install / update / here / keep /
 * unavailable, providers to use, map or set up), the overlays, and the load.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseProfileV2,
  isProfileV2,
  planLoadV2,
  applyLoadV2,
  applyDashboardOverlay,
  botPatch,
  providerNamer,
} = require("./profileLoadV2");

const raw = (extra = {}) => ({
  kind: "dash-profile",
  schemaVersion: 2,
  profileId: "mac-mini",
  name: "Mac Mini",
  owner: "trops",
  revision: 3,
  createdOn: "laptop",
  dashboards: {
    "@trops/home-lab": {
      version: "1.0.3",
      id: "1",
      name: "Home Lab",
      folder: "2",
      theme: "@trops/ocean",
    },
    "@trops/kitchen": {
      version: "2.0.0",
      id: "9",
      name: "Kitchen",
      folder: "1",
    },
    "@trops/garage": {
      version: "1.0.0",
      id: "7",
      name: "Garage",
      withTeam: true,
    },
  },
  bots: {
    "@trops/brief": { version: "1.0.1", kind: "bot", dashboard: null },
    "@trops/home-lab-team": {
      version: "1.0.0",
      kind: "team",
      dashboard: "@trops/home-lab",
    },
  },
  themes: { "@trops/ocean": { version: "1.1.0", key: "Ocean" } },
  widgets: { "@trops/chat": "0.0.9", "@trops/pipeline": "1.0.2" },
  folders: [
    { id: "2", name: "Home" },
    { id: "1", name: "General" },
  ],
  providers: [
    { name: "Home", type: "home-assistant" },
    { name: "Work Slack", type: "slack" },
    { name: "Notion", type: "notion" },
  ],
  settings: {
    app: { theme: "Ocean" },
    dashboards: {
      "@trops/home-lab": {
        items: {
          "layout/u1": {
            userPrefs: { room: "Kitchen", apiKey: "" },
            selectedProviders: { slack: "Work Slack" },
          },
        },
      },
    },
    bots: {
      "@trops/brief": {
        mcpServers: ["Work Slack"],
        toolSelections: { "Work Slack": ["post"] },
      },
    },
  },
  secretsToEnter: [{ dashboard: "Home Lab", title: "Lights", field: "apiKey" }],
  leftOut: [],
  ...extra,
});
const bytes = (m) => Buffer.from(JSON.stringify(m));
const manifest = (extra = {}) => parseProfileV2(bytes(raw(extra))).manifest;

describe("reading", () => {
  it("a v2 profile", () => {
    const m = manifest();
    assert.equal(m.name, "Mac Mini");
    assert.equal(m.dashboards["@trops/garage"].withTeam, true);
    assert.equal(isProfileV2(bytes(raw())), true);
    assert.equal(isProfileV2(Buffer.from("PK\x03\x04")), false);
  });

  it("refuses anything else, or anything malformed", () => {
    assert.match(
      parseProfileV2(Buffer.from("nope")).error,
      /isn't a Dash profile/,
    );
    assert.match(
      parseProfileV2(bytes({ ...raw(), schemaVersion: 3 })).error,
      /newer Dash/,
    );
    assert.match(
      parseProfileV2(bytes({ ...raw(), widgets: { "../x": "1.0.0" } })).error,
      /isn't a package name/,
    );
    assert.match(
      parseProfileV2(bytes({ ...raw(), widgets: { "@trops/x": "^1.0.0" } }))
        .error,
      /no exact version/,
    );
    const many = {};
    for (let i = 0; i < 501; i++) many[`@trops/w${i}`] = "1.0.0";
    assert.match(
      parseProfileV2(bytes({ ...raw(), widgets: many })).error,
      /too many/,
    );
  });

  it("names that aren't strings are dropped, never written", () => {
    const m = parseProfileV2(
      bytes(
        raw({
          folders: [{ id: "5", name: { x: 1 }, icon: ["a"] }, { id: { y: 1 } }],
          dashboards: {
            "@trops/home-lab": {
              version: "1.0.3",
              name: { evil: true },
              folder: { a: 1 },
            },
          },
          providers: [
            { name: { x: 1 }, type: "slack" },
            { name: "constructor", type: "x" },
          ],
          secretsToEnter: [{ dashboard: { a: 1 }, field: "k" }, "junk"],
          leftOut: [{ name: 5 }],
        }),
      ),
    ).manifest;
    assert.deepEqual(m.folders, [{ id: "5", name: "Folder" }]);
    assert.equal(m.dashboards["@trops/home-lab"].name, null);
    assert.equal(m.dashboards["@trops/home-lab"].folder, null);
    assert.deepEqual(m.providers, []);
    assert.deepEqual(m.secretsToEnter, [{ field: "k" }]);
    assert.deepEqual(m.leftOut, []);
  });
});

// This computer: the theme and Home Lab already here (Home Lab older), a
// newer Kitchen here, folder 1 (a number, as Dash writes it), Slack and
// Notion providers but no Home Assistant one; "Home" is the active profile.
function computer(overrides = {}) {
  const calls = [];
  const workspaces = [
    {
      id: 11,
      name: "Home Lab",
      registryRef: {
        package: "@trops/home-lab",
        kind: "dashboard",
        version: "1.0.1",
        origin: "installed",
      },
      layout: [{ id: 1, uuid: "u1", userPrefs: { apiKey: "SECRET-HERE" } }],
    },
    {
      id: 12,
      name: "Kitchen",
      registryRef: {
        package: "@trops/kitchen",
        kind: "dashboard",
        version: "2.1.0",
        origin: "published",
      },
      layout: [],
    },
  ];
  const bots = [];
  const themes = {
    Ocean: {
      name: "Ocean",
      registryRef: {
        package: "@trops/ocean",
        kind: "theme",
        version: "1.1.0",
        origin: "installed",
      },
    },
  };
  const lookup = {
    "@trops/chat": { versions: ["0.0.9"] },
    "@trops/pipeline": { versions: ["1.0.2"] },
    "@trops/ocean": { versions: ["1.1.0"] },
    "@trops/home-lab": { versions: ["1.0.3"] },
    "@trops/kitchen": { versions: ["2.0.0", "2.1.0"] },
    "@trops/garage": { versions: ["1.0.0"] },
    "@trops/brief": null, // deleted since
    "@trops/home-lab-team": { versions: ["1.0.0"] },
  };
  let saved = null;
  const d = {
    calls,
    store: {
      list: () => [
        { id: "default", name: "Default" },
        { id: "home", name: "Home" },
      ],
      put: (appId, p, opts) => {
        saved = { ...p, id: p.id || "new-id" };
        calls.push(["put", saved, opts]);
        return saved;
      },
      getActiveProfileId: () => "home",
      hasProfiles: () => true,
      removeFromProfile: (a, kind, ids, profileId) =>
        calls.push(["removeFromProfile", kind, ids, profileId]),
    },
    workspaceFile: () => workspaces,
    folderFile: () => [{ id: 1, name: "General" }],
    themeFile: () => themes,
    writeAppFile: (a, name, data) => calls.push(["write", name, data]),
    saveWorkspace: (a, ws) => calls.push(["saveWorkspace", ws]),
    allBots: () => bots,
    teamSettings: () => ({}),
    updateBot: (id, patch) => calls.push(["updateBot", id, patch]),
    previewBot: async (ws, pkg) => ({
      previewId: `p-${pkg}`,
      plan: { members: [{ role: "r" }] },
    }),
    installBot: async (ws, previewId) => {
      calls.push(["installBot", ws, previewId]);
      const bot = { id: `bot-${previewId}`, name: "Helper", workspaceId: ws };
      bots.push(bot);
      return { installed: [{ role: "r", id: bot.id, name: bot.name }] };
    },
    updateBotsFromRegistry: async (previewId, byRole) => {
      calls.push(["updateBots", previewId, byRole]);
      return { updated: Object.values(byRole) };
    },
    applyActiveProfile: () => {},
    widgetRegistry: () => ({
      getWidget: (pkg) =>
        pkg === "@trops/pipeline"
          ? { version: "1.0.2", installSource: "local" }
          : null,
      downloadWidget: async (pkg, url) => {
        calls.push(["widget", pkg, url]);
        return {};
      },
    }),
    announceInstalled: () => {},
    lookup: async (pkg) => lookup[pkg],
    downloadUrl: (pkg, v) => `url:${pkg}@${v}`,
    installTheme: async () => ({ success: true, themeKey: "Ocean" }),
    installDashboard: async (w, a, pkg, options) => {
      calls.push(["dashboard", pkg, options]);
      const id = options.intoWorkspaceId || (pkg === "@trops/garage" ? 77 : 99);
      if (!workspaces.some((x) => x.id === id)) {
        workspaces.push({ id, name: pkg, layout: [] });
      }
      // A dashboard with its own team brings its bots.
      if (options.withTeam)
        bots.push({ id: "bot-garage", name: "Door", workspaceId: id });
      return { success: true, workspace: { id } };
    },
    providers: () => [
      { name: "Slack", type: "slack" },
      { name: "Notion", type: "notion" },
    ],
    settings: () => ({}),
    saveSettings: (s) => calls.push(["settings", s]),
    now: () => new Date("2026-10-27T12:00:00Z"),
    ...overrides,
  };
  d.saved = () => saved;
  return d;
}

const row = (plan, kind, pkg) =>
  plan.rows.find((r) => r.kind === kind && r.package === pkg);

describe("planLoadV2", () => {
  it("what loading would do, matched by package", async () => {
    const plan = await planLoadV2("app", manifest(), computer());
    assert.equal(plan.target.mode, "create");
    assert.equal(row(plan, "widget", "@trops/chat").action, "install");
    const pipeline = row(plan, "widget", "@trops/pipeline");
    assert.equal(pipeline.action, "keep");
    assert.match(pipeline.reason, /Built on this Mac/);
    assert.equal(row(plan, "theme", "@trops/ocean").action, "here");
    const home = row(plan, "dashboard", "@trops/home-lab");
    assert.equal(home.action, "update");
    assert.equal(home.localId, 11);
    assert.equal(row(plan, "dashboard", "@trops/kitchen").action, "keep");
    assert.equal(row(plan, "dashboard", "@trops/garage").withTeam, true);
    assert.equal(row(plan, "bot", "@trops/brief").action, "unavailable");
    assert.equal(row(plan, "team", "@trops/home-lab-team").action, "install");
    const p = Object.fromEntries(plan.providers.map((x) => [x.name, x]));
    assert.equal(p.Notion.status, "ready");
    assert.equal(p["Work Slack"].status, "map");
    assert.equal(p["Work Slack"].mapTo, "Slack");
    assert.equal(p.Home.status, "setup");
    assert.equal(plan.unreachable, false);
  });

  it("Default is never the target; a profile of that name is replaced", async () => {
    const fromDefault = await planLoadV2(
      "app",
      manifest({ profileId: "default", name: "Default" }),
      computer(),
    );
    assert.equal(fromDefault.fromDefault, true);
    assert.match(fromDefault.target.name, /^Default \(from laptop\)/);
    const d = computer();
    d.store.list = () => [
      { id: "default", name: "Default" },
      { id: "x", name: "mac mini" },
    ];
    const replace = await planLoadV2("app", manifest(), d);
    assert.equal(replace.target.mode, "replace");
    assert.equal(replace.target.profileId, "x");
  });

  it("from the account: the profile linked to it is the one replaced, whatever its name — Default in place", async () => {
    const d = computer();
    d.store.list = () => [
      { id: "default", name: "Default", items: { dashboards: [], bots: [] } },
      { id: "x", name: "Mac Mini", items: { dashboards: [], bots: [] } },
      { id: "y", name: "Renamed here", items: { dashboards: [], bots: [] } },
    ];
    const linked = await planLoadV2("app", manifest(), d, {
      linkedProfileId: "y",
    });
    assert.equal(linked.target.mode, "replace");
    assert.equal(linked.target.profileId, "y");
    // Default's own account copy replaces Default (user, 2026-10-27).
    const toDefault = await planLoadV2(
      "app",
      manifest({ profileId: "default", name: "Default" }),
      d,
      { linkedProfileId: "default" },
    );
    assert.equal(toDefault.target.mode, "replace");
    assert.equal(toDefault.target.profileId, "default");
    assert.equal(toDefault.target.name, "Default");
    // Any other copy of Default still loads as its own profile.
    const fromFile = await planLoadV2(
      "app",
      manifest({ profileId: "default", name: "Default" }),
      d,
    );
    assert.equal(fromFile.target.mode, "create");
    assert.match(fromFile.target.name, /^Default \(from laptop\)/);
  });

  it("loading Default's own account copy replaces Default (only then)", async () => {
    const d = computer();
    d.store.list = () => [
      { id: "default", name: "Default", items: { dashboards: [], bots: [] } },
      { id: "home", name: "Home" },
    ];
    const res = await applyLoadV2(
      null,
      "app",
      manifest({ profileId: "default", name: "Default" }),
      { linkedProfileId: "default" },
      d,
    );
    assert.equal(res.success, true, res.error);
    const put = d.calls.find((c) => c[0] === "put");
    assert.equal(put[1].id, "default");
    assert.equal(put[2].replaceDefault, true);
    const d2 = computer();
    await applyLoadV2(null, "app", manifest(), {}, d2);
    assert.equal(d2.calls.find((c) => c[0] === "put")[2].replaceDefault, false);
  });

  it("replacing: what the profile holds that the loaded one doesn't is listed as leaving", async () => {
    const d = computer();
    d.workspaceFile().push({ id: 13, name: "Office", layout: [] });
    d.allBots().push(
      { id: "m1", name: "Mailer" },
      { id: "l1", name: "Office lead", role: "lead", workspaceId: 13 },
    );
    d.store.list = () => [
      {
        id: "default",
        name: "Default",
        items: { dashboards: ["11", "12", "13"], bots: ["m1", "l1"] },
      },
      { id: "home", name: "Home" },
    ];
    const plan = await planLoadV2(
      "app",
      manifest({ profileId: "default", name: "Default" }),
      d,
      { linkedProfileId: "default" },
    );
    // Default is the only profile holding them: they'd be hidden.
    assert.deepEqual(plan.leaving, [
      { kind: "dashboard", name: "Office", hidden: true },
      { kind: "bot", name: "Mailer", hidden: true },
    ]);
    d.store.list = () => [
      {
        id: "default",
        name: "Default",
        items: { dashboards: ["11", "12", "13"], bots: ["m1"] },
      },
      { id: "home", name: "Home", items: { dashboards: ["13"], bots: [] } },
    ];
    const again = await planLoadV2(
      "app",
      manifest({ profileId: "default", name: "Default" }),
      d,
      { linkedProfileId: "default" },
    );
    assert.equal(again.leaving.find((l) => l.name === "Office").hidden, false);
    assert.equal(again.leaving.find((l) => l.name === "Mailer").hidden, true);
    // Creating a profile takes nothing out of anything.
    const created = await planLoadV2(
      "app",
      manifest({ name: "Brand new" }),
      computer(),
    );
    assert.deepEqual(created.leaving, []);
  });

  it("a team whose dashboard isn't available isn't either; an unreachable registry is said", async () => {
    const d = computer({
      lookup: async (pkg) =>
        pkg === "@trops/home-lab"
          ? null
          : pkg === "@trops/chat"
            ? "unreachable"
            : { versions: [] },
    });
    const plan = await planLoadV2("app", manifest(), d);
    assert.equal(
      row(plan, "team", "@trops/home-lab-team").action,
      "unavailable",
    );
    assert.equal(plan.unreachable, true);
  });
});

describe("overlays", () => {
  const ws = {
    layout: [
      {
        id: 1,
        uuid: "u1",
        userPrefs: { apiKey: "SECRET-HERE", room: "Office", botId: "bot_here" },
      },
    ],
  };
  const overlay = {
    items: {
      "layout/u1": {
        userPrefs: {
          apiKey: "",
          room: "Kitchen",
          mode: "dark",
          botId: "bot_there",
        },
        selectedProviders: { slack: "Work Slack", mail: "Gmail" },
      },
    },
    selectedProviders: { ha: "Home" },
  };
  const names = providerNamer(
    { providers: [{ name: "Work Slack" }, { name: "Home" }] },
    { "Work Slack": "Slack" },
  );

  it("lays the settings on; a blanked key or the other computer's bot never overwrite; only listed providers", () => {
    const next = applyDashboardOverlay(ws, overlay, names);
    assert.deepEqual(next.layout[0].userPrefs, {
      apiKey: "SECRET-HERE",
      room: "Kitchen",
      mode: "dark",
      botId: "bot_here",
    });
    // "Gmail" isn't in the file's provider list: dropped.
    assert.deepEqual(next.layout[0].selectedProviders, { slack: "Slack" });
    assert.deepEqual(next.selectedProviders, { ha: "Home" });
  });

  it("fillOnly keeps this Mac's settings and adds what's missing", () => {
    const next = applyDashboardOverlay(ws, overlay, names, { fillOnly: true });
    assert.equal(next.layout[0].userPrefs.room, "Office");
    assert.equal(next.layout[0].userPrefs.mode, "dark");
  });

  it("provider names like 'constructor' resolve to nothing", () => {
    const n = providerNamer(
      { providers: [{ name: "Slack" }] },
      Object.create(null),
    );
    assert.equal(n("constructor"), null);
    assert.equal(n("toString"), null);
    assert.equal(n("Slack"), "Slack");
  });

  it("botPatch: listed providers, mapped; never approvals", () => {
    assert.deepEqual(
      botPatch(
        {
          mcpServers: ["Work Slack", "Gmail"],
          toolSelections: { "Work Slack": ["post"], Gmail: ["send"] },
          allowedTools: ["post"],
          provider: { x: 1 },
        },
        names,
      ),
      { mcpServers: ["Slack"], toolSelections: { Slack: ["post"] } },
    );
    assert.equal(botPatch(null), null);
  });
});

describe("applyLoadV2", () => {
  it("installs at the profile's versions, lays the settings on, and writes the profile", async () => {
    const d = computer();
    const res = await applyLoadV2(null, "app", manifest(), {}, d);
    assert.equal(res.success, true, res.error);
    const widgets = d.calls.filter((c) => c[0] === "widget");
    assert.deepEqual(
      widgets.map((c) => c[2]),
      ["url:@trops/chat@0.0.9"],
    );
    // Home Lab updated in place; Kitchen (newer here) kept; Garage new,
    // with its own team, into folder 1 by this computer's (number) id.
    const dashboards = d.calls.filter((c) => c[0] === "dashboard");
    assert.deepEqual(
      dashboards.map((c) => c[1]),
      ["@trops/home-lab", "@trops/garage"],
    );
    assert.equal(dashboards[0][2].intoWorkspaceId, 11);
    assert.equal(dashboards[0][2].exactWidgetVersions, true);
    assert.equal(dashboards[1][2].withTeam, true);
    // The folder the profile names that this Mac lacks is added (id 2).
    const written = d.calls.find(
      (c) => c[0] === "write" && c[1] === "menuItems.json",
    );
    assert.deepEqual(
      written[2].map((f) => f.id),
      [1, 2],
    );
    // The overlay: this Mac's key kept, Slack mapped.
    const ws = d.calls.find((c) => c[0] === "saveWorkspace")[1];
    assert.equal(ws.layout[0].userPrefs.apiKey, "SECRET-HERE");
    assert.deepEqual(ws.layout[0].selectedProviders, { slack: "Slack" });
    // The team installs into Home Lab (paused).
    assert.equal(d.calls.find((c) => c[0] === "installBot")[1], 11);
    // The profile: this computer's ids, every bot on its dashboards
    // (including Garage's own team).
    const p = d.saved();
    assert.equal(p.id, "mac-mini");
    assert.deepEqual(p.items.dashboards.sort(), ["11", "12", "77"]);
    assert.deepEqual(p.items.folders.sort(), ["1", "2"]);
    assert.ok(p.items.bots.includes("bot-garage"));
    assert.ok(p.items.bots.includes("bot-p-@trops/home-lab-team"));
    assert.ok(res.botsPaused.includes("Door"));
    // Not added to "Home", the profile in use.
    const removed = d.calls.filter((c) => c[0] === "removeFromProfile");
    const removedBots = removed.find((c) => c[1] === "bots");
    assert.ok(removedBots && removedBots[2].includes("bot-garage"));
    assert.equal(removedBots[3], "home");
    assert.ok(removed.find((c) => c[1] === "dashboards")[2].includes("77"));
    assert.deepEqual(res.providersToSetUp, ["Home"]);
    assert.ok(res.problems.some((x) => /@trops\/brief/.test(x)));
  });

  it("a dashboard goes into an existing folder by that folder's own (number) id", async () => {
    const d = computer();
    await applyLoadV2(
      null,
      "app",
      manifest(),
      { take: ["dashboard:@trops/kitchen"] },
      d,
    );
    // Kitchen is updated in place (its folder there stays); a new one
    // would get folderId — here Garage has no folder.
    const garage = d.calls.find(
      (c) => c[0] === "dashboard" && c[1] === "@trops/garage",
    );
    assert.equal(garage[2].menuId, undefined);
    const m = manifest({
      dashboards: {
        "@trops/new": { version: "1.0.0", name: "New", folder: "1" },
      },
      bots: {},
    });
    const d2 = computer({ lookup: async () => ({ versions: ["1.0.0"] }) });
    await applyLoadV2(null, "app", m, {}, d2);
    const created = d2.calls.find((c) => c[0] === "dashboard");
    assert.equal(created[2].menuId, 1);
    assert.equal(typeof created[2].menuId, "number");
  });

  it("the user's choices: keep this Mac's, take the profile's, no mapping", async () => {
    const d = computer();
    const res = await applyLoadV2(
      null,
      "app",
      manifest(),
      {
        keep: ["dashboard:@trops/home-lab"],
        take: ["dashboard:@trops/kitchen", "widget:@trops/pipeline"],
        providerMap: { "Work Slack": null },
      },
      d,
    );
    assert.equal(res.success, true);
    const dashboards = d.calls
      .filter((c) => c[0] === "dashboard")
      .map((c) => c[1]);
    assert.deepEqual(dashboards, ["@trops/kitchen", "@trops/garage"]);
    assert.ok(
      d.calls.some((c) => c[0] === "widget" && c[1] === "@trops/pipeline"),
    );
    assert.deepEqual(res.providersToSetUp.sort(), ["Home", "Work Slack"]);
  });

  it("updating a bot in place: that copy, and this Mac's choices stay", async () => {
    const d = computer({
      lookup: async () => ({ versions: ["1.0.1"] }),
    });
    d.allBots = () => [
      {
        id: "bot_here",
        name: "Brief",
        registryRef: {
          package: "@trops/brief",
          kind: "bot",
          version: "1.0.0",
          origin: "installed",
        },
      },
    ];
    await applyLoadV2(null, "app", manifest(), {}, d);
    const update = d.calls.find((c) => c[0] === "updateBots");
    assert.deepEqual(update[2], { r: "bot_here" });
    assert.equal(
      d.calls.some((c) => c[0] === "updateBot" && c[1] === "bot_here"),
      false,
    );
  });

  it("refuses when the registry can't be reached, or the name is taken", async () => {
    const down = await applyLoadV2(
      null,
      "app",
      manifest(),
      {},
      computer({ lookup: async () => "unreachable" }),
    );
    assert.match(down.error, /Couldn't reach the registry/);
    const taken = await applyLoadV2(
      null,
      "app",
      manifest(),
      { name: "Home" },
      computer(),
    );
    assert.match(taken.error, /already exists/);
  });
});

describe("keeping a profile in step with its account copy", () => {
  // The account's copy of "Mac Mini", into the profile here linked to it.
  function linked() {
    const d = computer();
    d.store.list = () => [
      { id: "default", name: "Default", items: { dashboards: [], bots: [] } },
      { id: "mm", name: "Mac Mini", items: { dashboards: [], bots: [] } },
    ];
    // This computer's own widget setting, and a key typed here.
    d.workspaceFile()[0].layout[0].userPrefs = {
      apiKey: "SECRET-HERE",
      room: "Garage",
    };
    return d;
  }
  const renamed = () =>
    manifest({
      dashboards: {
        ...manifest().dashboards,
        "@trops/kitchen": {
          ...manifest().dashboards["@trops/kitchen"],
          name: "Kitchen (renamed)",
        },
      },
      folders: [
        { id: "2", name: "Home" },
        { id: "1", name: "Kitchen stuff" },
      ],
    });
  const saved = (d, id) =>
    d.calls
      .filter((c) => c[0] === "saveWorkspace" && String(c[1].id) === String(id))
      .map((c) => c[1])
      .pop();

  it("the account's copy wins: names, folders and widget settings come across — a blank key never overwrites", async () => {
    const d = linked();
    const res = await applyLoadV2(
      null,
      "app",
      renamed(),
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    // A dashboard already here (kept at this computer's version) is renamed.
    assert.equal(saved(d, 12).name, "Kitchen (renamed)");
    // A widget setting changed elsewhere replaces this computer's.
    const prefs = saved(d, 11).layout[0].userPrefs;
    assert.equal(prefs.room, "Kitchen");
    assert.equal(prefs.apiKey, "SECRET-HERE");
    // A renamed folder is renamed here.
    const folders = d.calls
      .filter((c) => c[0] === "write" && c[1] === "menuItems.json")
      .pop();
    assert.equal(
      folders[2].find((x) => String(x.id) === "1").name,
      "Kitchen stuff",
    );
  });

  it("folder and theme follow the account; a folder another profile uses isn't renamed", async () => {
    const d = linked();
    const res = await applyLoadV2(
      null,
      "app",
      renamed(),
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(saved(d, 11).menuId, 2);
    assert.equal(saved(d, 11).themeKey, "Ocean");
    assert.equal(saved(d, 12).menuId, 1);

    const d2 = linked();
    d2.store.list = () => [
      {
        id: "default",
        name: "Default",
        items: { dashboards: [], folders: ["1"] },
      },
      { id: "mm", name: "Mac Mini", items: { dashboards: [], bots: [] } },
    ];
    await applyLoadV2(
      null,
      "app",
      renamed(),
      { linkedProfileId: "mm", syncLinked: true },
      d2,
    );
    assert.equal(
      d2.calls.some(
        (c) =>
          c[0] === "write" &&
          c[1] === "menuItems.json" &&
          c[2].some((x) => x.name === "Kitchen stuff"),
      ),
      false,
    );
  });

  it("a setting cleared elsewhere is cleared here; a blanked key isn't", async () => {
    const d = linked();
    const m = renamed();
    m.settings.dashboards["@trops/home-lab"].items["layout/u1"].userPrefs = {
      room: "",
      apiKey: "",
    };
    await applyLoadV2(
      null,
      "app",
      m,
      { linkedProfileId: "mm", syncLinked: true },
      d,
    );
    const prefs = saved(d, 11).layout[0].userPrefs;
    assert.equal(prefs.room, "");
    assert.equal(prefs.apiKey, "SECRET-HERE");
  });

  it("bots here take the account's choices — not kept ones, and never left without providers", async () => {
    const run = async (localVersion, overlay) => {
      const d = linked();
      // @trops/brief is in the registry here (the shared stub has it deleted).
      const others = d.lookup;
      d.lookup = async (pkg) =>
        pkg === "@trops/brief" ? { versions: ["1.0.1", "1.0.2"] } : others(pkg);
      d.allBots().push({
        id: "bb",
        name: "Brief",
        mcpServers: ["Slack"],
        registryRef: {
          package: "@trops/brief",
          kind: "bot",
          version: localVersion,
          origin: "installed",
        },
      });
      const m = renamed();
      m.settings.bots = { "@trops/brief": overlay };
      await applyLoadV2(
        null,
        "app",
        m,
        { linkedProfileId: "mm", syncLinked: true },
        d,
      );
      return d.calls.filter((c) => c[0] === "updateBot" && c[1] === "bb");
    };
    // Already here at the same version: the account's choices come across.
    const same = await run("1.0.1", {
      mcpServers: ["Work Slack"],
      provider: "claude-cli",
      model: "sonnet",
    });
    assert.equal(same.length, 1);
    assert.equal(same[0][2].provider, "claude-cli");
    assert.deepEqual(same[0][2].mcpServers, ["Slack"]);
    // None of the account's providers is here: it keeps its own.
    const none = await run("1.0.1", {
      mcpServers: ["Gone"],
      toolSelections: { Gone: ["x"] },
      provider: "claude-cli",
    });
    assert.equal(none[0][2].mcpServers, undefined);
    assert.equal(none[0][2].toolSelections, undefined);
    assert.equal(none[0][2].provider, "claude-cli");
    // This computer's is newer and kept: untouched.
    const kept = await run("1.0.3", { provider: "claude-cli" });
    assert.equal(kept.length, 0);
  });

  it("the linked profile is gone here: no keeping in step", async () => {
    const d = linked();
    const res = await applyLoadV2(
      null,
      "app",
      renamed(),
      { linkedProfileId: "gone", syncLinked: true },
      d,
    );
    assert.equal(res.success, true, res.error);
    assert.equal(saved(d, 12), undefined);
  });

  it("anything else — a file, or not into its linked profile — only fills in what's missing", async () => {
    for (const choices of [
      { linkedProfileId: "mm" },
      { linkedProfileId: "mm", syncLinked: true, asNew: true, name: "Copy" },
    ]) {
      const d = linked();
      const res = await applyLoadV2(null, "app", renamed(), choices, d);
      assert.equal(res.success, true, res.error);
      assert.equal(saved(d, 12), undefined);
      const ws = saved(d, 11);
      assert.equal(ws.layout[0].userPrefs.room, "Garage");
      assert.equal(
        d.calls.some(
          (c) =>
            c[0] === "write" &&
            c[1] === "menuItems.json" &&
            c[2].some((x) => x.name === "Kitchen stuff"),
        ),
        false,
      );
    }
  });
});
