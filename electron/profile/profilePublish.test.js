/**
 * profilePublish.test.js — publishing from "Save to file" (PR 4b): what can
 * be published and how (never over an existing version, private on first
 * publish, visibility kept after), and switching this computer's
 * dashboards — including event wiring — to the published package.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  planPublish,
  publishWidget,
  publishMany,
  beginPublishing,
  stopPublishing,
  freeVersion,
} = require("./profilePublish");
const { repointLayoutPackage } = require("../schema/dashboardConfigUtils");

describe("freeVersion", () => {
  it("keeps a version the registry doesn't have", () => {
    assert.equal(freeVersion("1.4.0", ["1.3.2"]), "1.4.0");
  });
  it("bumps past a taken version and never goes below the newest", () => {
    assert.equal(freeVersion("0.0.882", ["0.0.882"]), "0.0.883");
    assert.equal(freeVersion("0.0.882", ["0.0.882", "0.0.883"]), "0.0.884");
    assert.equal(freeVersion("1.0.0", ["2.1.0"]), "2.1.1");
  });
  it("gives a starting version to widgets without one", () => {
    assert.equal(freeVersion(null, []), "1.0.0");
  });
});

describe("planPublish", () => {
  const widgets = [
    { package: "@ai-built/pipeline", version: "1.0.0", source: "bundled" },
    { package: "@trops/kitchen", version: "1.4.0", source: "bundled" },
    { package: "@trops/chat", version: "0.0.882", source: "registry" },
    { package: "@someone/else", version: "1.0.0", source: "bundled" },
  ];
  const registry = {
    "@trops/pipeline": null,
    "@trops/kitchen": { versions: ["1.4.0", "1.3.2"], visibility: "public" },
  };
  const lookup = async (pkg) => registry[pkg] ?? null;

  it("offers only what the registry can't supply and the user can own", async () => {
    const rows = await planPublish(widgets, "trops", lookup);
    const byPkg = Object.fromEntries(rows.map((r) => [r.package, r]));
    assert.equal(byPkg["@trops/chat"], undefined);
    assert.equal(byPkg["@someone/else"].publishable, false);
    assert.match(byPkg["@someone/else"].reason, /someone else/);
  });

  it("@ai-built publishes under the user's name, private, at its own version", async () => {
    const rows = await planPublish(widgets, "trops", lookup);
    const p = rows.find((r) => r.package === "@ai-built/pipeline");
    assert.equal(p.publishAs, "@trops/pipeline");
    assert.equal(p.version, "1.0.0");
    assert.equal(p.visibility, "private");
    assert.equal(p.exists, false);
  });

  it("an existing package keeps its visibility and never reuses a version", async () => {
    const rows = await planPublish(widgets, "trops", lookup);
    const k = rows.find((r) => r.package === "@trops/kitchen");
    assert.equal(k.publishAs, "@trops/kitchen");
    assert.equal(k.visibility, "public");
    assert.equal(k.version, "1.4.1");
    assert.equal(k.bumped, true);
  });

  it("a name already used by another kind of package isn't offered", async () => {
    const rows = await planPublish(
      [{ package: "@ai-built/kitchen", version: "1.0.0", source: "bundled" }],
      "trops",
      async () => ({ type: "dashboard", versions: ["1.0.0"] }),
    );
    assert.equal(rows[0].publishable, false);
    assert.match(rows[0].reason, /already the name of a dashboard/);
  });

  it("can't reach the account → not offered", async () => {
    const rows = await planPublish(widgets, "trops", async () => "unreachable");
    assert.ok(rows.every((r) => !r.publishable));
  });
});

describe("repointLayoutPackage", () => {
  const ws = {
    id: 1,
    layout: [
      {
        id: 3,
        type: "widget",
        workspace: "ai-built",
        component: "ai-built.pipeline.ProspectList",
        componentName: "ai-built.pipeline.ProspectList",
        uuid: "1-ai-built.pipeline.ProspectList-3",
        packageId: "@ai-built/pipeline",
        _sourcePackage: "@ai-built/pipeline",
        userPrefs: { a: 1 },
      },
      {
        id: 4,
        component: "trops.chat.Chat",
        packageId: "@trops/chat",
        listeners: {
          onSelect: [
            "ai-built.pipeline.ProspectList[3].selected",
            "trops.chat.Chat[9].sent",
          ],
        },
      },
      {
        id: 5,
        component: "ai-built.other.Thing",
        packageId: "@ai-built/other",
      },
    ],
    pages: [
      {
        id: "p2",
        layout: [
          {
            id: 6,
            component: "Container",
            items: [
              {
                id: 7,
                component: "ai-built.pipeline.Board",
                packageId: "@ai-built/pipeline",
              },
            ],
          },
        ],
      },
    ],
    sidebarLayout: [
      {
        id: 8,
        component: "ai-built.pipeline.Mini",
        packageId: "@ai-built/pipeline",
      },
    ],
  };

  it("points widgets, nested items, pages, sidebar and event wiring at the new package", () => {
    const { workspace, changed } = repointLayoutPackage(
      ws,
      "@ai-built/pipeline",
      "@trops/pipeline",
    );
    const [a, b, c] = workspace.layout;
    assert.equal(a.component, "trops.pipeline.ProspectList");
    // componentName is what a layout loads first.
    assert.equal(a.componentName, "trops.pipeline.ProspectList");
    assert.equal(a.workspace, "trops");
    // Widget data is stored under the uuid, so it's kept.
    assert.equal(a.uuid, "1-ai-built.pipeline.ProspectList-3");
    assert.equal(a.packageId, "@trops/pipeline");
    assert.equal(a._sourcePackage, "@trops/pipeline");
    assert.deepEqual(a.userPrefs, { a: 1 });
    assert.deepEqual(b.listeners.onSelect, [
      "trops.pipeline.ProspectList[3].selected",
      "trops.chat.Chat[9].sent",
    ]);
    // Another @ai-built package is left alone.
    assert.equal(c.component, "ai-built.other.Thing");
    assert.equal(c.packageId, "@ai-built/other");
    assert.equal(
      workspace.pages[0].layout[0].items[0].component,
      "trops.pipeline.Board",
    );
    assert.equal(workspace.sidebarLayout[0].packageId, "@trops/pipeline");
    assert.equal(changed, 4);
    // The input isn't modified.
    assert.equal(ws.layout[0].component, "ai-built.pipeline.ProspectList");
  });

  it("a dashboard without the package is unchanged", () => {
    const { changed } = repointLayoutPackage(
      { layout: [{ component: "trops.chat.Chat", packageId: "@trops/chat" }] },
      "@ai-built/pipeline",
      "@trops/pipeline",
    );
    assert.equal(changed, 0);
  });
});

describe("publishWidget", () => {
  const row = {
    package: "@ai-built/pipeline",
    publishAs: "@trops/pipeline",
    publishable: true,
    version: "1.0.0",
    visibility: "private",
  };
  const fakes = (publishResult, { downloadFails = false } = {}) => {
    const calls = { publish: [], downloads: [], saved: [], marked: [] };
    return {
      calls,
      deps: {
        publish: async (appId, pkg, options) => {
          calls.publish.push({ pkg, options });
          return publishResult;
        },
        registry: () => ({
          downloadWidget: async (name, url) => {
            if (downloadFails) throw new Error("network");
            calls.downloads.push({ name, url });
          },
          markInstallSource: (...a) => calls.marked.push(a),
        }),
        listWorkspaces: () => [
          {
            id: 1,
            layout: [
              {
                component: "ai-built.pipeline.X",
                packageId: "@ai-built/pipeline",
              },
            ],
          },
          {
            id: 2,
            layout: [
              { component: "trops.chat.Chat", packageId: "@trops/chat" },
            ],
          },
        ],
        saveWorkspace: (win, appId, ws) => calls.saved.push(ws),
      },
    };
  };
  const ok = {
    success: true,
    registryResult: {
      downloadUrl:
        "https://r/api/packages/trops/pipeline/download?version=1.0.0",
    },
  };

  it("publishes privately at the planned version under the user's scope", async () => {
    const f = fakes(ok);
    await publishWidget(null, "@a", row, {}, f.deps);
    assert.deepEqual(f.calls.publish[0], {
      pkg: "@ai-built/pipeline",
      options: {
        version: "1.0.0",
        visibility: "private",
        scope: "trops",
        confirmPersonalPaths: false,
      },
    });
  });

  it("installs the published package and switches every dashboard using it", async () => {
    const f = fakes(ok);
    const res = await publishWidget(null, "@a", row, {}, f.deps);
    assert.equal(res.status, "published");
    assert.equal(res.dashboardsSwitched, 1);
    assert.equal(f.calls.downloads[0].name, "@trops/pipeline");
    assert.equal(f.calls.saved.length, 1);
    assert.equal(f.calls.saved[0].layout[0].component, "trops.pipeline.X");
  });

  it("a failed publish changes nothing", async () => {
    const f = fakes({ success: false, error: "Build failed" });
    const res = await publishWidget(null, "@a", row, {}, f.deps);
    assert.equal(res.status, "failed");
    assert.equal(res.error, "Build failed");
    assert.equal(f.calls.downloads.length, 0);
    assert.equal(f.calls.saved.length, 0);
  });

  it("the registry's reasons are part of the error", async () => {
    const f = fakes({
      success: false,
      error: "Manifest validation failed",
      details: ['"name" must be kebab-case (got "x_y")'],
    });
    const res = await publishWidget(null, "@a", row, {}, f.deps);
    assert.equal(
      res.error,
      'Manifest validation failed — "name" must be kebab-case (got "x_y")',
    );
  });

  it("if installing fails after publishing, dashboards keep the local copy", async () => {
    const f = fakes(ok, { downloadFails: true });
    const res = await publishWidget(null, "@a", row, {}, f.deps);
    assert.equal(res.status, "failed");
    assert.equal(res.published, true);
    assert.equal(f.calls.saved.length, 0);
  });

  it("personal paths found → asks first, then publishes when confirmed", async () => {
    const f = fakes({
      needsConfirmation: true,
      reason: "personal-paths",
      personalPathFindings: [{ file: "a.js", match: "/Users/x" }],
    });
    const res = await publishWidget(null, "@a", row, {}, f.deps);
    assert.equal(res.status, "needs-confirmation");
    assert.equal(res.findings.length, 1);
    const g = fakes(ok);
    await publishWidget(
      null,
      "@a",
      row,
      { confirmPersonalPaths: true },
      g.deps,
    );
    assert.equal(g.calls.publish[0].options.confirmPersonalPaths, true);
  });

  it("same package name: no install or switch, marked as the registry's code", async () => {
    const f = fakes(ok);
    const res = await publishWidget(
      null,
      "@a",
      {
        ...row,
        package: "@trops/kitchen",
        publishAs: "@trops/kitchen",
        version: "1.4.1",
        visibility: "public",
      },
      {},
      f.deps,
    );
    assert.equal(res.status, "published");
    assert.equal(f.calls.publish[0].options.visibility, "public");
    assert.equal(f.calls.downloads.length, 0);
    assert.deepEqual(f.calls.marked[0], [
      "@trops/kitchen",
      "registry",
      "1.4.1",
    ]);
  });
});

describe("publishWidget — the user's visibility (bulk publish)", () => {
  const calls = [];
  const deps = {
    publish: async (appId, pkg, options) => {
      calls.push(options);
      return { success: true };
    },
    registry: () => ({ markInstallSource: () => {} }),
  };
  const row = {
    package: "@trops/kitchen",
    publishAs: "@trops/kitchen",
    publishable: true,
    version: "1.0.1",
    visibility: "private",
  };

  it("a chosen visibility wins over the package's, either way", async () => {
    const pub = await publishWidget(
      null,
      "@a",
      row,
      { visibility: "public" },
      deps,
    );
    assert.equal(calls[0].visibility, "public");
    assert.equal(pub.visibility, "public");
    const priv = await publishWidget(
      null,
      "@a",
      { ...row, visibility: "public" },
      { visibility: "private" },
      deps,
    );
    assert.equal(calls[1].visibility, "private");
    assert.equal(priv.visibility, "private");
  });

  it("no choice: as the package is (a first publish private)", async () => {
    const res = await publishWidget(
      null,
      "@a",
      row,
      { visibility: "bogus" },
      deps,
    );
    assert.equal(calls[2].visibility, "private");
    assert.equal(res.visibility, "private");
  });
});

describe("publishMany (bulk publish)", () => {
  const plan = [
    { package: "@ai-built/a", publishable: true, publishAs: "@me/a" },
    { package: "@ai-built/b", publishable: true, publishAs: "@me/b" },
    { package: "@ai-built/c", publishable: true, publishAs: "@me/c" },
    { package: "@other/x", publishable: false },
  ];
  const fakeWin = () => {
    const sent = [];
    return {
      sent,
      win: {
        isDestroyed: () => false,
        webContents: { send: (channel, data) => sent.push({ channel, data }) },
      },
    };
  };

  it("publishes each one with its own visibility and confirmation, in order, telling the window", async () => {
    const seen = [];
    const { win, sent } = fakeWin();
    const res = await publishMany(
      win,
      "@a",
      "p1",
      plan,
      ["@ai-built/a", "@ai-built/b", "@ai-built/a"],
      {
        options: {
          visibility: { "@ai-built/b": "public" },
          confirmPersonalPaths: ["@ai-built/a"],
        },
        publishOne: async (w, appId, row, options) => {
          seen.push({ pkg: row.package, options });
          return {
            status: "published",
            version: "1.0.0",
            visibility: options.visibility || "private",
          };
        },
      },
    );
    assert.equal(res.success, true);
    assert.equal(res.stopped, false);
    assert.deepEqual(seen, [
      {
        pkg: "@ai-built/a",
        options: { confirmPersonalPaths: true, visibility: undefined },
      },
      {
        pkg: "@ai-built/b",
        options: { confirmPersonalPaths: false, visibility: "public" },
      },
    ]);
    assert.deepEqual(
      res.results.map((r) => [r.package, r.status, r.visibility]),
      [
        ["@ai-built/a", "published", "private"],
        ["@ai-built/b", "published", "public"],
      ],
    );
    assert.deepEqual(
      sent.map((s) => [
        s.channel,
        s.data.package,
        s.data.index,
        s.data.total,
        s.data.status,
      ]),
      [
        ["profile:publish-progress", "@ai-built/a", 0, 2, "publishing"],
        ["profile:publish-progress", "@ai-built/a", 0, 2, "published"],
        ["profile:publish-progress", "@ai-built/b", 1, 2, "publishing"],
        ["profile:publish-progress", "@ai-built/b", 1, 2, "published"],
      ],
    );
  });

  it("one failing, or not publishable, doesn't stop the rest", async () => {
    const res = await publishMany(
      null,
      "@a",
      "p1",
      plan,
      ["@other/x", "@ai-built/a", "@ai-built/b"],
      {
        publishOne: async (w, appId, row) => {
          if (row.package === "@ai-built/a") throw new Error("boom");
          return { status: "published" };
        },
      },
    );
    assert.deepEqual(
      res.results.map((r) => [r.package, r.status, r.error || null]),
      [
        ["@other/x", "failed", "@other/x can't be published."],
        ["@ai-built/a", "failed", "boom"],
        ["@ai-built/b", "published", null],
      ],
    );
  });

  it("Stop finishes the widget being published, then stops; the next run starts fresh", async () => {
    const seen = [];
    const res = await publishMany(
      null,
      "@a",
      "p1",
      plan,
      ["@ai-built/a", "@ai-built/b", "@ai-built/c"],
      {
        publishOne: async (w, appId, row) => {
          seen.push(row.package);
          if (row.package === "@ai-built/a") stopPublishing("@a", "p1");
          return { status: "published" };
        },
      },
    );
    assert.deepEqual(seen, ["@ai-built/a"]);
    assert.equal(res.stopped, true);
    assert.equal(res.results.length, 1);
    const again = await publishMany(null, "@a", "p1", plan, ["@ai-built/b"], {
      publishOne: async () => ({ status: "published" }),
    });
    assert.equal(again.stopped, false);
    assert.equal(again.results.length, 1);
  });

  it("a Stop sent while the run is still planned counts; an old one doesn't", async () => {
    stopPublishing("@a", "p3");
    beginPublishing("@a", "p3");
    // Planning…, then Stop.
    stopPublishing("@a", "p3");
    const seen = [];
    const res = await publishMany(null, "@a", "p3", plan, ["@ai-built/a"], {
      publishOne: async (w, appId, row) => {
        seen.push(row.package);
        return { status: "published" };
      },
    });
    assert.deepEqual(seen, []);
    assert.equal(res.stopped, true);
    // A stop left over from before is forgotten when the next run is asked.
    stopPublishing("@a", "p3");
    beginPublishing("@a", "p3");
    const next = await publishMany(null, "@a", "p3", plan, ["@ai-built/a"], {
      publishOne: async () => ({ status: "published" }),
    });
    assert.equal(next.stopped, false);
    assert.equal(next.results.length, 1);
  });

  it("a stop for another profile doesn't touch this run", async () => {
    const res = await publishMany(
      null,
      "@a",
      "p1",
      plan,
      ["@ai-built/a", "@ai-built/b"],
      {
        publishOne: async (w, appId, row) => {
          if (row.package === "@ai-built/a") stopPublishing("@a", "p2");
          return { status: "published" };
        },
      },
    );
    assert.equal(res.stopped, false);
    assert.equal(res.results.length, 2);
  });
});
