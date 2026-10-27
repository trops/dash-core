/**
 * installInPlace.test.js — dash-profiles v2 groundwork B: finding a package
 * at an exact version, updating a dashboard / theme / bot in place without
 * losing what this computer set, and the update check reading registryRef.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveForInstall,
  packageDownloadUrl,
  isOwnScope,
  themeKeyFor,
} = require("./registryPackages");
const { keepRegistryRef } = require("./packageRef");
const {
  keepPersonalization,
  checkDashboardUpdates,
} = require("../schema/dashboardConfigUtils");
const { botUpdatePatch } = require("../bots/botUpdate");

describe("resolveForInstall", () => {
  const index = {
    "trops/kitchen": {
      scope: "trops",
      name: "kitchen",
      type: "dashboard",
      version: "1.4.0",
    },
  };
  const deps = (entries, onRefresh = () => {}) => ({
    getPackage: async (ref) => entries[String(ref).replace(/^@/, "")] || null,
    refreshIndex: async () => onRefresh(),
  });

  it("the latest, or an exact version when asked", async () => {
    const latest = await resolveForInstall(
      "@trops/kitchen",
      { kinds: ["dashboard"] },
      deps(index),
    );
    assert.equal(latest.pkg.version, "1.4.0");
    const exact = await resolveForInstall(
      "trops/kitchen",
      { kinds: ["dashboard"], version: "1.2.0" },
      deps(index),
    );
    assert.equal(exact.pkg.version, "1.2.0");
    // "*" means the latest; something that isn't a version is refused
    // rather than quietly installing (and recording) the latest.
    const any = await resolveForInstall(
      "trops/kitchen",
      { version: "*" },
      deps(index),
    );
    assert.equal(any.pkg.version, "1.4.0");
    const range = await resolveForInstall(
      "trops/kitchen",
      { version: "^1.0.0" },
      deps(index),
    );
    assert.match(range.error, /"\^1\.0\.0" isn't a version/);
  });

  it("refuses another kind of package with the same name", async () => {
    const res = await resolveForInstall(
      "trops/kitchen",
      { kinds: ["theme"] },
      deps(index),
    );
    assert.match(res.error, /is a dashboard, not a theme/);
  });

  it("asks the registry again when the cached index doesn't have it yet", async () => {
    const entries = {};
    let refreshed = 0;
    const res = await resolveForInstall(
      "@trops/new",
      {},
      deps(entries, () => {
        refreshed++;
        entries["trops/new"] = {
          scope: "trops",
          name: "new",
          version: "1.0.0",
        };
      }),
    );
    assert.equal(refreshed, 1);
    assert.equal(res.pkg.version, "1.0.0");
    assert.equal(res.pkg.type, undefined, "the entry itself is unchanged");
    const missing = await resolveForInstall("@trops/none", {}, deps({}));
    assert.match(missing.error, /was not found/);
  });
});

describe("packageDownloadUrl", () => {
  it("names the version, or none for the latest", () => {
    assert.match(
      packageDownloadUrl("@trops/chat", "0.0.9"),
      /\/api\/packages\/trops\/chat\/download\?version=0\.0\.9$/,
    );
    assert.match(packageDownloadUrl("trops/chat"), /\/chat\/download$/);
    assert.equal(packageDownloadUrl("chat", "1.0.0"), null);
  });
});

describe("isOwnScope", () => {
  it("compares with the signed-in username, ignoring case and @", () => {
    assert.equal(isOwnScope("@Trops", "trops"), true);
    assert.equal(isOwnScope("someone", "trops"), false);
    assert.equal(isOwnScope("trops", null), false);
    assert.equal(isOwnScope("", ""), false);
  });
});

describe("themeKeyFor", () => {
  const ocean = {
    name: "Ocean",
    registryRef: { package: "@trops/ocean", kind: "theme", version: "1.0.0" },
  };

  it("an update goes over the theme installed from that package", () => {
    assert.equal(
      themeKeyFor({ "My Ocean": ocean }, "trops/ocean", "Ocean"),
      "My Ocean",
    );
  });

  it("never over a different theme with the same name", () => {
    const themes = { Ocean: { name: "Ocean" }, "Ocean (2)": { name: "x" } };
    assert.equal(themeKeyFor(themes, "@trops/ocean", "Ocean"), "Ocean (3)");
    assert.equal(themeKeyFor({}, "@trops/ocean", "Ocean"), "Ocean");
    const someoneElses = {
      Ocean: { registryRef: { package: "@alice/ocean", kind: "theme" } },
    };
    assert.equal(
      themeKeyFor(someoneElses, "@trops/ocean", "Ocean"),
      "Ocean (2)",
    );
  });

  it("an older install that kept only the bare name is the same package", () => {
    const older = {
      Ocean: { _registryMeta: { source: "registry", packageName: "ocean" } },
    };
    assert.equal(themeKeyFor(older, "@trops/ocean", "Ocean"), "Ocean");
  });
});

describe("keepPersonalization (a dashboard updated in place)", () => {
  const local = {
    selectedProviders: { ha: "Home" },
    pages: [
      {
        id: "p1",
        layout: [
          {
            id: 1,
            uuid: "u1",
            component: "trops.ha.Lights",
            userPrefs: { room: "Kitchen", apiKey: "secret" },
            selectedProviders: { ha: "Home" },
          },
          { id: 2, uuid: "u2", component: "trops.ha.Old", userPrefs: { a: 1 } },
        ],
      },
    ],
  };
  const published = {
    pages: [
      {
        id: "p1",
        layout: [
          {
            id: 1,
            uuid: "u1",
            component: "trops.ha.Lights",
            userPrefs: { room: "", theme: "dark" },
          },
          { id: 3, uuid: "u3", component: "trops.ha.New" },
        ],
      },
    ],
  };

  it("finds the widget when the page ids differ (the editor renames pages)", () => {
    const renamed = {
      pages: [{ ...published.pages[0], id: "page-999" }],
    };
    const next = keepPersonalization(renamed, local);
    assert.equal(next.pages[0].layout[0].userPrefs.room, "Kitchen");
    assert.equal(next.pages[0].layout[0].userPrefs.apiKey, "secret");
  });

  it("an ambiguous match (same id, different settings) isn't guessed", () => {
    const twoPages = {
      pages: [
        { id: "a", layout: [{ id: 1, component: "C", userPrefs: { x: 1 } }] },
        { id: "b", layout: [{ id: 1, component: "C", userPrefs: { x: 2 } }] },
      ],
    };
    const incoming = {
      pages: [{ id: "c", layout: [{ id: 1, component: "C", userPrefs: {} }] }],
    };
    const next = keepPersonalization(incoming, twoPages);
    assert.deepEqual(next.pages[0].layout[0].userPrefs, {});
  });

  it("keeps this computer's settings and providers for the same widget", () => {
    const next = keepPersonalization(published, local);
    const [lights, added] = next.pages[0].layout;
    assert.deepEqual(lights.userPrefs, {
      room: "Kitchen",
      theme: "dark",
      apiKey: "secret",
    });
    assert.deepEqual(lights.selectedProviders, { ha: "Home" });
    assert.equal(
      added.userPrefs,
      undefined,
      "a new widget starts with defaults",
    );
    assert.equal(next.pages[0].layout.length, 2, "a removed widget is gone");
    assert.deepEqual(next.selectedProviders, { ha: "Home" });
    assert.equal(published.pages[0].layout[0].userPrefs.room, "", "pure");
  });
});

describe("keepRegistryRef (the editor's save)", () => {
  it("keeps where the dashboard came from: registryRef and _dashboardConfig", () => {
    const stored = {
      id: 1,
      registryRef: { package: "@alice/ha", kind: "dashboard" },
      _dashboardConfig: { shareable: false, originalAuthor: "Alice" },
    };
    const saved = keepRegistryRef({ id: 1, name: "HA" }, stored);
    assert.deepEqual(saved._dashboardConfig, stored._dashboardConfig);
    assert.deepEqual(saved.registryRef, stored.registryRef);
    // A save that carries either field keeps its own.
    const own = keepRegistryRef(
      { id: 1, _dashboardConfig: { shareable: true } },
      stored,
    );
    assert.equal(own._dashboardConfig.shareable, true);
    assert.deepEqual(own.registryRef, stored.registryRef);
  });
});

describe("checkDashboardUpdates reads registryRef", () => {
  const registry = [
    { scope: "trops", name: "ha", type: "dashboard", version: "1.2.0" },
  ];
  const ws = (registryRef, extra = {}) => ({
    id: 1,
    name: "HA",
    registryRef,
    ...extra,
  });

  it("an older installed version is an update", () => {
    const updates = checkDashboardUpdates(
      [
        ws({
          package: "@trops/ha",
          kind: "dashboard",
          version: "1.0.0",
          origin: "installed",
        }),
      ],
      registry,
    );
    assert.equal(updates.length, 1);
    assert.equal(updates[0].installedVersion, "1.0.0");
    assert.equal(updates[0].registryScope, "trops");
  });

  it("a dashboard published from here at the latest isn't", () => {
    assert.deepEqual(
      checkDashboardUpdates(
        [
          ws({
            package: "@trops/ha",
            kind: "dashboard",
            version: "1.2.0",
            origin: "published",
          }),
        ],
        registry,
      ),
      [],
    );
    // The older record of a publish (no installedVersion) reads the same.
    assert.deepEqual(
      checkDashboardUpdates(
        [
          {
            id: 2,
            _dashboardConfig: {
              registryPackage: "ha",
              registryScope: "trops",
              version: "1.2.0",
            },
          },
        ],
        registry,
      ),
      [],
    );
  });

  it("a newer version here isn't a downgrade offer", () => {
    assert.deepEqual(
      checkDashboardUpdates(
        [
          ws({
            package: "@trops/ha",
            kind: "dashboard",
            version: "1.3.0",
            origin: "published",
          }),
        ],
        registry,
      ),
      [],
    );
  });
});

describe("botUpdatePatch", () => {
  const existing = {
    id: "bot_1",
    name: "Brief",
    instructions: "old",
    provider: "anthropic",
    model: "m-old",
    engine: null,
    approvalPolicy: "auto",
    mcpServers: ["Home"],
    toolSelections: { Home: ["lights"] },
    subscriptions: [{ source: "x" }],
    schedules: [{ cron: "0 9 * * *", prompt: "go" }],
    publishes: [],
  };
  const member = (definition, needs = []) => ({ definition, needs });

  it("takes what the bot does from the package and keeps how it runs here", () => {
    const { patch, missingProviders } = botUpdatePatch(
      existing,
      member(
        {
          name: "Brief",
          instructions: "new",
          provider: null,
          model: null,
          engine: null,
          approvalPolicy: "ask",
          mcpServers: ["Home"],
          toolSelections: { Home: ["lights", "locks"] },
          schedules: [{ cron: "0 8 * * *", prompt: "go" }],
          publishes: [{ event: "done" }],
          subscriptions: [],
        },
        [{ type: "home-assistant", options: ["Home"], chosen: "Home" }],
      ),
      { registryRef: { package: "@trops/brief" } },
    );
    assert.equal(patch.instructions, "new");
    assert.deepEqual(patch.schedules, [{ cron: "0 8 * * *", prompt: "go" }]);
    assert.deepEqual(patch.publishes, [{ event: "done" }]);
    assert.deepEqual(patch.registryRef, { package: "@trops/brief" });
    // How it runs here stays.
    for (const key of [
      "provider",
      "model",
      "approvalPolicy",
      "mcpServers",
      "toolSelections",
      "subscriptions",
    ]) {
      assert.equal(key in patch, false, key);
    }
    assert.deepEqual(missingProviders, []);
  });

  it("reports a provider the new version needs instead of adding it", () => {
    const { patch, missingProviders } = botUpdatePatch(
      existing,
      member(
        {
          name: "Brief",
          instructions: "x",
          provider: "anthropic",
          model: "m-new",
        },
        [
          { type: "home-assistant", options: ["Home"], chosen: "Home" },
          { type: "slack", options: ["Work Slack"], chosen: "Work Slack" },
        ],
      ),
    );
    assert.deepEqual(missingProviders, ["slack"]);
    assert.equal("mcpServers" in patch, false);
    // This computer has the package's AI: its model comes along.
    assert.equal(patch.model, "m-new");
  });
});
