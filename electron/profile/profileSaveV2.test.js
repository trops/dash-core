/**
 * profileSaveV2.test.js — saving a profile as a v2 file: what each item
 * becomes (referenced, published, remixed, left out, blocking), and the
 * save itself (publish order, public items held back, failures, the file).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { planSave, executeSave } = require("./profileSaveV2");
const { publishFingerprint } = require("../registry/fingerprint");
const { remixOrigin } = require("../registry/remix");

const USER = "trops";
const appId = "@test/app";

const homeLab = {
  id: 1,
  name: "Home Lab",
  menuId: 2,
  layout: [
    {
      id: 3,
      uuid: "u3",
      component: "trops.chat.Chat",
      packageId: "@trops/chat",
      userPrefs: { room: "Kitchen" },
    },
  ],
};
// Published before, unchanged since.
homeLab.registryRef = {
  package: "@trops/home-lab",
  kind: "dashboard",
  version: "1.0.3",
  origin: "published",
  contentHash: publishFingerprint("dashboard", homeLab),
};
const changedPublic = {
  id: 2,
  name: "Kitchen Sink",
  layout: [
    {
      id: 1,
      uuid: "a",
      component: "trops.chat.Chat",
      packageId: "@trops/chat",
    },
  ],
  registryRef: {
    package: "@trops/kitchen-sink",
    kind: "dashboard",
    version: "1.0.0",
    origin: "published",
    contentHash: "old",
  },
};
const brandNew = { id: 3, name: "New One", layout: [] };
const fromFile = {
  id: 4,
  name: "From A File",
  layout: [],
  _dashboardConfig: { shareable: false, source: "zip" },
};
const alicesUnchanged = {
  id: 5,
  name: "Alice Board",
  layout: [
    {
      id: 1,
      uuid: "b",
      component: "trops.chat.Chat",
      packageId: "@trops/chat",
    },
  ],
};
alicesUnchanged.registryRef = {
  package: "@alice/board",
  kind: "dashboard",
  version: "2.0.0",
  origin: "installed",
  contentHash: publishFingerprint("dashboard", alicesUnchanged),
};
const alicesEdited = {
  ...alicesUnchanged,
  id: 6,
  name: "Alice Edited",
  layout: [],
  registryRef: { ...alicesUnchanged.registryRef, package: "@alice/edited" },
};
const carolsEdited = {
  ...alicesEdited,
  id: 7,
  name: "Carol Edited",
  registryRef: { ...alicesUnchanged.registryRef, package: "@carol/locked" },
};
const usesLeftOutWidget = {
  id: 8,
  name: "Uses Bob's",
  layout: [
    {
      id: 1,
      uuid: "c",
      component: "bob.secret.Thing",
      packageId: "@bob/secret",
    },
  ],
};

function gathered(overrides = {}) {
  return {
    profile: { id: "mini", name: "Mac Mini", link: { revision: 2 } },
    explicit: true,
    dashboards: [
      homeLab,
      changedPublic,
      brandNew,
      fromFile,
      alicesUnchanged,
      alicesEdited,
      carolsEdited,
      usesLeftOutWidget,
    ],
    themes: { Ocean: { name: "Ocean", primary: "blue" } },
    bots: [
      { id: "bot_lead", name: "Lead", role: "lead", workspaceId: 1 },
      { id: "bot_a", name: "Brief", instructions: "x", workspaceId: null },
      { id: "bot_t", name: "Helper", instructions: "y", workspaceId: 1 },
    ],
    folders: [{ id: 2, name: "Home" }],
    providers: [{ name: "Home", type: "home-assistant" }],
    settings: { theme: "Ocean", checkForUpdatesOnLaunch: true },
    widgets: [
      {
        package: "@trops/chat",
        version: "0.0.9",
        source: "registry",
        status: "in-registry",
      },
      {
        package: "@ai-built/pipeline",
        version: "1.0.0",
        source: "bundled",
        status: "not-in-registry",
      },
      {
        package: "@bob/secret",
        version: "1.0.0",
        source: "bundled",
        status: "not-in-registry",
      },
    ],
    secretsLeftOut: [{ dashboard: "Home Lab", field: "apiKey" }],
    ...overrides,
  };
}

function deps(overrides = {}) {
  const calls = [];
  const registry = {
    "@trops/kitchen-sink": {
      type: "dashboard",
      visibility: "public",
      versions: ["1.0.0"],
    },
    "@trops/pipeline": null,
  };
  const d = {
    calls,
    username: async () => USER,
    gather: async () => gathered(),
    isOwnScope: (scope, user) =>
      String(scope).toLowerCase() === String(user).toLowerCase(),
    lookup: async (pkg) => (pkg in registry ? registry[pkg] : null),
    remixOrigin: (kind, record, user) => remixOrigin(kind, record, user),
    checkRemixAll: async (origins) => {
      const locked = (origins || []).find((o) => o && o.scope === "carol");
      return locked
        ? { error: "The author of @carol/locked doesn't allow remixes." }
        : { remixedFrom: null };
    },
    widgetRegistry: () => null,
    teamSettings: () => ({}),
    teamBots: (wsId) =>
      gathered().bots.filter(
        (b) => String(b.workspaceId) === String(wsId) && b.role !== "lead",
      ),
    publishWidget: async (win, a, row) => {
      calls.push(["widget", row.package]);
      return {
        status: "published",
        publishedAs: row.publishAs,
        version: row.version,
      };
    },
    publishTheme: async (a, key) => {
      calls.push(["theme", key]);
      return { success: true, package: "@trops/ocean", version: "1.0.0" };
    },
    publishDashboard: async (a, id) => {
      calls.push(["dashboard", String(id)]);
      return { success: true, package: `@trops/d${id}`, version: "1.0.0" };
    },
    publishBot: async (opts) => {
      calls.push([opts.kind, opts.botId || opts.workspaceId]);
      return { success: true, package: "@trops/b", version: "1.0.0" };
    },
    reload: async () => gathered(),
    store: { setLink: (...args) => calls.push(["setLink", args[2]]) },
    appVersion: () => "0.0.1038",
    ...overrides,
  };
  return d;
}

const byKey = (plan) =>
  Object.fromEntries(plan.items.map((i) => [`${i.kind}:${i.key}`, i]));

describe("planSave", () => {
  it("signed out: sign in first", async () => {
    const plan = await planSave(
      appId,
      "mini",
      {},
      deps({ username: async () => null }),
    );
    assert.equal(plan.signInRequired, true);
    assert.equal(plan.success, false);
  });

  it("decides each item", async () => {
    const plan = await planSave(appId, "mini", {}, deps());
    assert.equal(plan.success, true);
    const k = byKey(plan);
    // Widgets
    assert.equal(k["widget:@trops/chat"].action, "reference");
    assert.equal(k["widget:@ai-built/pipeline"].action, "publish");
    assert.equal(k["widget:@ai-built/pipeline"].package, "@trops/pipeline");
    assert.equal(k["widget:@bob/secret"].action, "leave-out");
    // Dashboards
    assert.equal(k["dashboard:1"].action, "reference");
    assert.equal(k["dashboard:1"].version, "1.0.3");
    assert.equal(k["dashboard:2"].action, "publish");
    assert.equal(
      k["dashboard:2"].public,
      true,
      "a public package of the user's",
    );
    assert.equal(k["dashboard:3"].action, "publish");
    assert.equal(k["dashboard:3"].package, null, "new");
    assert.equal(k["dashboard:4"].action, "leave-out");
    assert.match(k["dashboard:4"].reason, /Imported from a file/);
    assert.equal(k["dashboard:5"].action, "reference");
    assert.equal(k["dashboard:5"].package, "@alice/board");
    assert.equal(k["dashboard:6"].action, "remix");
    assert.equal(k["dashboard:7"].action, "leave-out");
    assert.match(k["dashboard:7"].reason, /doesn't allow remixes/);
    assert.equal(k["dashboard:8"].action, "leave-out");
    assert.match(k["dashboard:8"].reason, /@bob\/secret/);
    // Themes and bots: the lead goes with its dashboard; a dashboard's
    // other bots go as its team; others one by one.
    assert.equal(k["theme:Ocean"].action, "publish");
    assert.equal(k["bot:bot_lead"], undefined);
    assert.equal(k["bot:bot_a"].action, "publish");
    assert.equal(k["team:1"].action, "publish");
    assert.equal(plan.blockers.length, 0);
    assert.equal(plan.secretsLeftOut, 1);
  });

  it("a widget the registry couldn't be asked about blocks the save", async () => {
    const plan = await planSave(
      appId,
      "mini",
      {},
      deps({
        gather: async () =>
          gathered({
            widgets: [
              {
                package: "@trops/chat",
                version: "1",
                source: "registry",
                status: "unchecked",
              },
            ],
          }),
      }),
    );
    assert.equal(plan.blockers.length, 1);
    assert.match(plan.blockers[0].reason, /Couldn't check @trops\/chat/);
  });
});

describe("executeSave", () => {
  const tmpFile = () =>
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "v2save-")),
      "p.dashprofile",
    );

  it("publishes widgets, themes, dashboards, then bots — and writes the v2 file", async () => {
    const d = deps();
    const filePath = tmpFile();
    const res = await executeSave(null, appId, "mini", {}, { filePath }, d);
    assert.equal(res.success, true, res.error);
    const kinds = d.calls.filter((c) => c[0] !== "setLink").map((c) => c[0]);
    const firstOf = (k) => kinds.indexOf(k);
    assert.ok(firstOf("widget") < firstOf("theme"));
    assert.ok(firstOf("theme") < firstOf("dashboard"));
    assert.ok(firstOf("dashboard") < firstOf("bot"));
    // Left out and referenced items aren't published.
    const dashboards = d.calls
      .filter((c) => c[0] === "dashboard")
      .map((c) => c[1]);
    assert.deepEqual(dashboards.sort(), ["2", "3", "6"]);

    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(file.schemaVersion, 2);
    assert.equal(file.owner, USER);
    assert.equal(file.revision, 3);
    assert.equal(file.dashboards["@trops/home-lab"].version, "1.0.3");
    assert.equal(file.widgets["@trops/chat"], "0.0.9");
    assert.equal(file.widgets["@trops/pipeline"], "1.0.0");
    assert.deepEqual(
      file.settings.dashboards["@trops/home-lab"].items["layout/u3"],
      {
        userPrefs: { room: "Kitchen" },
      },
    );
    assert.ok(file.leftOut.some((l) => l.name === "Carol Edited"));
    assert.ok(d.calls.some((c) => c[0] === "setLink" && c[1].revision === 3));
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("a public item the user unticked isn't released", async () => {
    const d = deps();
    const filePath = tmpFile();
    const res = await executeSave(
      null,
      appId,
      "mini",
      {},
      { filePath, skipPublic: ["dashboard:2"] },
      d,
    );
    assert.equal(res.success, true);
    assert.deepEqual(res.skipped, ["dashboard:2"]);
    assert.equal(
      d.calls.some((c) => c[0] === "dashboard" && c[1] === "2"),
      false,
    );
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("the user's own item that can't be published stops the save; someone else's is left out", async () => {
    const d = deps({
      publishDashboard: async (a, id) =>
        String(id) === "6"
          ? { success: false, error: "The author doesn't allow remixes." }
          : String(id) === "3"
            ? { success: false, error: "Checks failed" }
            : { success: true, package: `@trops/d${id}`, version: "1.0.0" },
    });
    const res = await executeSave(
      null,
      appId,
      "mini",
      {},
      { filePath: tmpFile() },
      d,
    );
    assert.equal(res.success, false);
    assert.match(res.error, /New One couldn't be published: Checks failed/);
  });

  it("a widget whose files mention this computer's folders asks first", async () => {
    const d = deps({
      publishWidget: async () => ({
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      }),
    });
    const res = await executeSave(
      null,
      appId,
      "mini",
      {},
      { filePath: tmpFile() },
      d,
    );
    assert.equal(res.success, false);
    assert.equal(res.needsConfirmation.package, "@ai-built/pipeline");
  });

  it("nothing is published while something blocks", async () => {
    const d = deps({
      gather: async () =>
        gathered({
          widgets: [
            {
              package: "@trops/chat",
              version: "1",
              source: "registry",
              status: "unchecked",
            },
          ],
        }),
    });
    const res = await executeSave(
      null,
      appId,
      "mini",
      {},
      { filePath: tmpFile() },
      d,
    );
    assert.equal(res.success, false);
    assert.equal(res.blockers.length, 1);
    assert.equal(d.calls.length, 0);
  });
});

describe("review fixes", () => {
  it("a public widget held back keeps the version the registry has", async () => {
    const d = deps({
      gather: async () =>
        gathered({
          widgets: [
            {
              package: "@trops/kit",
              version: "1.0.4",
              source: "bundled",
              status: "newer-here",
            },
          ],
        }),
      lookup: async (pkg) =>
        pkg === "@trops/kit"
          ? {
              type: "widget",
              visibility: "public",
              latestVersion: "1.0.3",
              versions: ["1.0.3"],
            }
          : null,
    });
    const plan = await planSave(appId, "mini", {}, d);
    const kit = plan.items.find((i) => i.key === "@trops/kit");
    assert.equal(kit.action, "publish");
    assert.equal(kit.public, true);
    assert.equal(kit.lastVersion, "1.0.3");
    const filePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "v2save-")),
      "p.dashprofile",
    );
    const res = await executeSave(
      null,
      appId,
      "mini",
      {},
      { filePath, skipPublic: ["widget:@trops/kit"] },
      d,
    );
    assert.equal(res.success, true, res.error);
    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(file.widgets["@trops/kit"], "1.0.3");
    assert.equal(
      d.calls.some((c) => c[0] === "widget"),
      false,
    );
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("a dashboard's own team, unchanged, goes with the dashboard", async () => {
    const team = gathered().bots.filter(
      (b) => b.workspaceId === 1 && b.role !== "lead",
    );
    const d = deps({
      teamSettings: () => ({
        embeddedFrom: {
          package: "@trops/home-lab",
          version: "1.0.3",
          contentHash: publishFingerprint("bot-team", team),
        },
      }),
    });
    const plan = await planSave(appId, "mini", {}, d);
    const t = plan.items.find((i) => i.kind === "team");
    assert.equal(t.action, "with-dashboard");
    const filePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "v2save-")),
      "p.dashprofile",
    );
    const res = await executeSave(null, appId, "mini", {}, { filePath }, d);
    assert.equal(res.success, true, res.error);
    assert.equal(
      d.calls.some((c) => c[0] === "team"),
      false,
    );
    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(file.dashboards["@trops/home-lab"].withTeam, true);
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("a bot from a team package isn't saved on its own", async () => {
    const d = deps({
      gather: async () =>
        gathered({
          bots: [
            {
              id: "bot_m",
              name: "Member",
              workspaceId: 99,
              installedFrom: {
                package: "alice/crew",
                version: "1.0.0",
                kind: "bot-team",
                role: "a",
              },
            },
          ],
        }),
    });
    const plan = await planSave(appId, "mini", {}, d);
    const m = plan.items.find((i) => i.key === "bot_m");
    assert.equal(m.action, "leave-out");
    assert.match(m.reason, /Part of a team package/);
  });

  it("a dashboard published before Dash recorded the scope is published again", async () => {
    const old = {
      id: 9,
      name: "Old",
      layout: [],
      _dashboardConfig: { registryPackage: "old", version: "1.0.0" },
    };
    const d = deps({ gather: async () => gathered({ dashboards: [old] }) });
    const plan = await planSave(appId, "mini", {}, d);
    assert.equal(plan.items.find((i) => i.key === "9").action, "publish");
  });
});
