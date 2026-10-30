/**
 * profileSaveV3.test.js — saving a v3 profile: what it lists for each
 * widget (and what the review says), never publishing, writing the file,
 * and keeping it in the account without overwriting a newer copy.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  planSave,
  executeSave,
  widgetRow,
  LISTED,
  UNPUBLISHED,
  NOT_IN_REGISTRY,
} = require("./profileSaveV3");
const { parseProfileV3 } = require("./profileSetup");

const appId = "@test/app";

// What gatherProfile hands back (keys already blanked).
function gathered() {
  return {
    profile: { id: "mm", name: "Mac Mini", link: { revision: 2 } },
    explicit: true,
    dashboards: [
      {
        id: 1,
        name: "Home",
        layout: [
          { id: 1, component: "Lights", packageId: "@trops/home" },
          { id: 2, component: "Pipe", packageId: "@ai-built/pipe" },
        ],
      },
    ],
    folders: [{ id: 2, name: "House" }],
    themes: { Ocean: { name: "Ocean" } },
    bots: [
      {
        id: "b1",
        name: "Brief",
        instructions: "x",
        session: { s: 1 },
        allowedTools: ["a"],
      },
    ],
    providers: [{ name: "Slack", type: "slack" }],
    settings: { theme: "Ocean", checkForUpdatesOnLaunch: true },
    widgets: [
      {
        package: "@trops/home",
        version: "1.2.0",
        source: "registry",
        status: "in-registry",
      },
      {
        package: "@trops/calendar",
        version: "2.1.0",
        source: "bundled",
        status: "newer-here",
        registryVersion: "2.0.0",
      },
      {
        package: "@ai-built/pipe",
        version: "0.1.0",
        source: "bundled",
        status: "not-in-registry",
      },
    ],
    secretsLeftOut: [
      { dashboardId: 1, dashboard: "Home", item: "layout/1", field: "apiKey" },
    ],
  };
}

function deps(over = {}) {
  const calls = [];
  const registry = {
    getWidget: () => null,
    getWidgets: () => [
      {
        name: "@trops/home",
        packageId: "@trops/home",
        componentNames: ["Lights"],
      },
      {
        name: "@ai-built/pipe",
        packageId: "@ai-built/pipe",
        componentNames: ["Pipe"],
      },
    ],
  };
  const d = {
    username: async () => "trops",
    gather: async () => gathered(),
    planWidgets: async (widgets) =>
      widgets.map((w) => ({
        package: w.package,
        publishable: w.package === "@ai-built/pipe",
      })),
    widgetRegistry: () => registry,
    digest: () => ({
      dashboards: {},
      bots: {},
      themes: {},
      folders: {},
      widgets: {},
    }),
    store: { setLink: (...a) => calls.push(["setLink", ...a]) },
    appVersion: () => "1.0.0",
    account: () => ({
      getLink: () => ({ accountId: "acc1", revision: 3 }),
      revisionOf: (v) => (Number.isInteger(v) ? v : null),
      newAccountId: () => "acc-new",
      listRemote: async () => ({
        success: true,
        profiles: [{ id: "acc1", revision: over.remoteRevision ?? 3 }],
      }),
      putRemote: async (id, manifest, base) => {
        calls.push(["putRemote", id, manifest, base]);
        return { success: true, saved: { revision: (base || 0) + 1 } };
      },
      setLink: (...a) => {
        calls.push(["accountLink", ...a]);
        return a[3];
      },
    }),
    ...over.deps,
  };
  return { d, calls };
}

describe("each widget", () => {
  it("is listed as the registry has it — or says why not", () => {
    assert.equal(
      widgetRow({ package: "a/b", version: "1.0.0", status: "in-registry" })
        .action,
      LISTED,
    );
    const built = widgetRow({
      package: "@me/w",
      version: "1.0.0",
      status: "local-build",
    });
    assert.equal(built.action, UNPUBLISHED);
    assert.equal(built.version, "1.0.0");
    const newer = widgetRow({
      package: "@me/w",
      version: "1.1.0",
      status: "newer-here",
      registryVersion: "1.0.0",
    });
    assert.equal(newer.action, UNPUBLISHED);
    assert.equal(newer.version, "1.0.0");
    assert.match(newer.note, /1\.1\.0 here, not published/);
    assert.equal(
      widgetRow({ package: "@ai-built/x", status: "not-in-registry" }).action,
      NOT_IN_REGISTRY,
    );
    assert.equal(
      widgetRow({ package: "@me/w", status: "unchecked" }).action,
      "blocked",
    );
  });
});

describe("planning a save", () => {
  it("a widget published already: its visibility now, for the switch", async () => {
    const { d } = deps();
    d.planWidgets = async (widgets) =>
      widgets.map((w) => ({
        package: w.package,
        publishable: w.package === "@ai-built/pipe",
        exists: true,
        visibility: "public",
      }));
    const plan = await planSave(appId, "mm", {}, d);
    const pipe = plan.widgets.find((w) => w.package === "@ai-built/pipe");
    assert.equal(pipe.published, true);
    assert.equal(pipe.visibility, "public");
  });

  it("lists, notes and offers to publish — never publishes", async () => {
    const { d } = deps();
    const plan = await planSave(appId, "mm", {}, d);
    assert.equal(plan.success, true);
    const by = (p) => plan.widgets.find((w) => w.package === p);
    assert.equal(by("@trops/home").action, LISTED);
    assert.equal(by("@trops/calendar").action, UNPUBLISHED);
    assert.equal(by("@trops/calendar").publishable, undefined);
    assert.equal(by("@ai-built/pipe").action, NOT_IN_REGISTRY);
    assert.equal(by("@ai-built/pipe").publishable, true);
    // Never published: its switch starts private (bulk publish).
    assert.equal(by("@ai-built/pipe").published, false);
    assert.equal(by("@ai-built/pipe").visibility, "private");
    assert.match(by("@ai-built/pipe").note, /Home will show it as missing/);
    assert.deepEqual(plan.counts, {
      dashboards: 1,
      bots: 1,
      themes: 1,
      folders: 1,
      widgets: 2,
      unpublished: 1,
      notInRegistry: 1,
    });
    assert.equal(plan.secretsLeftOut, 1);
  });

  it("a widget the registry couldn't check blocks the save", async () => {
    const { d } = deps({
      deps: {
        gather: async () => ({
          ...gathered(),
          widgets: [
            { package: "@trops/home", version: "1.0.0", status: "unchecked" },
          ],
        }),
      },
    });
    const plan = await planSave(appId, "mm", {}, d);
    assert.equal(plan.blockers.length, 1);
    const res = await executeSave(
      null,
      appId,
      "mm",
      {},
      { filePath: "/nope" },
      d,
    );
    assert.equal(res.success, false);
    assert.equal(res.blockers.length, 1);
  });
});

describe("saving", () => {
  it("a file: the setup as it is, widgets by version, no approvals", async () => {
    const { d, calls } = deps();
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "dash-save-v3-")),
      "p.dashprofile",
    );
    const res = await executeSave(null, appId, "mm", {}, { filePath: file }, d);
    assert.equal(res.success, true, res.error);
    assert.equal(res.revision, 3);
    const { manifest } = parseProfileV3(fs.readFileSync(file));
    assert.deepEqual(
      { ...manifest.widgets },
      { "@trops/home": "1.2.0", "@trops/calendar": "2.0.0" },
    );
    assert.equal(manifest.setup.dashboards[0].name, "Home");
    assert.equal(manifest.setup.bots[0].allowedTools, undefined);
    assert.equal(manifest.setup.bots[0].session, undefined);
    assert.deepEqual(
      manifest.leftOut.map((l) => l.name),
      ["@ai-built/pipe"],
    );
    assert.deepEqual(manifest.settings.app, {
      theme: "Ocean",
      checkForUpdatesOnLaunch: true,
    });
    assert.deepEqual(res.unpublished, [
      { package: "@trops/calendar", version: "2.0.0", here: "2.1.0" },
    ]);
    assert.deepEqual(calls.find((c) => c[0] === "setLink")[3].revision, 3);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("the account: saved over the revision it last saw, linked with its digest", async () => {
    const { d, calls } = deps();
    const res = await executeSave(
      null,
      appId,
      "mm",
      {},
      { target: "account" },
      d,
    );
    assert.equal(res.success, true, res.error);
    const put = calls.find((c) => c[0] === "putRemote");
    assert.equal(put[1], "acc1");
    assert.equal(put[3], 3);
    assert.equal(put[2].schemaVersion, 3);
    const link = calls.find((c) => c[0] === "accountLink")[4];
    assert.equal(link.revision, 4);
    assert.ok(link.digest);
  });

  it("the account: never over a newer copy, unless that's the one to replace", async () => {
    const { d, calls } = deps({ remoteRevision: 5 });
    const res = await executeSave(
      null,
      appId,
      "mm",
      {},
      { target: "account" },
      d,
    );
    assert.equal(res.success, false);
    assert.equal(res.conflict.revision, 5);
    assert.equal(
      calls.some((c) => c[0] === "putRemote"),
      false,
    );
    const keep = await executeSave(
      null,
      appId,
      "mm",
      {},
      { target: "account", replaceRevision: 5 },
      d,
    );
    assert.equal(keep.success, true, keep.error);
    assert.equal(calls.find((c) => c[0] === "putRemote")[3], 5);
  });

  it("the account: signed out, or too big, says so", async () => {
    const { d } = deps({ deps: { username: async () => null } });
    const out = await executeSave(
      null,
      appId,
      "mm",
      {},
      { target: "account" },
      d,
    );
    assert.equal(out.signInRequired, true);
    // Random text doesn't compress: well over the account's limit.
    const crypto = require("crypto");
    const big = gathered();
    big.dashboards[0].notes = crypto.randomBytes(400000).toString("hex");
    const { d: d2, calls } = deps({ deps: { gather: async () => big } });
    const res = await executeSave(
      null,
      appId,
      "mm",
      {},
      { target: "account" },
      d2,
    );
    assert.match(res.error, /too big to keep in your account/);
    assert.equal(
      calls.some((c) => c[0] === "putRemote"),
      false,
    );
  });
});
