/**
 * profileManifest.test.js — the v2 profile: packages at exact versions and
 * what publishing leaves out (widget settings, bot provider choices).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  dashboardOverlay,
  botOverlay,
  buildManifestV2,
} = require("./profileManifest");

describe("dashboardOverlay", () => {
  it("each widget's settings and providers here, by section and widget id", () => {
    const ws = {
      selectedProviders: { ha: "Home" },
      pages: [
        {
          id: "p1",
          layout: [
            {
              id: 1,
              uuid: "u1",
              userPrefs: { room: "Kitchen", apiKey: "" },
              selectedProviders: { ha: "Home" },
            },
            { id: 2, uuid: "u2" },
          ],
        },
      ],
    };
    assert.deepEqual(dashboardOverlay(ws), {
      items: {
        "page:p1/u1": {
          userPrefs: { room: "Kitchen", apiKey: "" },
          selectedProviders: { ha: "Home" },
        },
      },
      selectedProviders: { ha: "Home" },
    });
    assert.deepEqual(dashboardOverlay(null), { items: {} });
  });
});

describe("botOverlay", () => {
  it("providers, tools picked and AI — never approvals", () => {
    const o = botOverlay({
      mcpServers: ["Home"],
      toolSelections: { Home: ["lights"] },
      allowedTools: ["lights"],
      provider: "anthropic",
      model: "m",
    });
    assert.deepEqual(o, {
      mcpServers: ["Home"],
      toolSelections: { Home: ["lights"] },
      provider: "anthropic",
      model: "m",
    });
    assert.equal("allowedTools" in o, false);
  });
});

describe("buildManifestV2", () => {
  it("lists packages at exact versions, with where they go and the overlays", () => {
    const m = buildManifestV2({
      profile: { id: "mac-mini", name: "Mac Mini" },
      owner: "trops",
      dashboards: [
        {
          package: "@trops/home-lab",
          version: "1.0.3",
          id: 1712,
          name: "Home Lab",
          folder: 2,
          theme: "@trops/ocean",
          overlay: { items: {} },
        },
      ],
      bots: [
        {
          package: "@trops/brief",
          version: "1.0.1",
          kind: "bot",
          dashboard: null,
          overlay: { mcpServers: [] },
        },
      ],
      themes: [{ package: "@trops/ocean", version: "1.1.0", key: "Ocean" }],
      widgets: { "@trops/chat": "0.0.9" },
      folders: [{ id: 2, name: "Home", icon: "house", extra: "x" }],
      providers: [{ name: "Home", type: "home-assistant" }],
      appSettings: { theme: "Ocean" },
      secretsToEnter: [{ dashboard: "Home Lab", field: "apiKey" }],
      leftOut: [{ kind: "dashboard", name: "Work", reason: "x" }],
      revision: 7,
      createdOn: "laptop",
      appVersion: "0.0.1038",
      now: new Date("2026-10-27T12:00:00Z"),
    });
    assert.equal(m.kind, "dash-profile");
    assert.equal(m.schemaVersion, 2);
    assert.equal(m.owner, "trops");
    assert.deepEqual(m.dashboards["@trops/home-lab"], {
      version: "1.0.3",
      id: "1712",
      name: "Home Lab",
      folder: "2",
      theme: "@trops/ocean",
    });
    assert.deepEqual(m.bots["@trops/brief"], {
      version: "1.0.1",
      kind: "bot",
      dashboard: null,
    });
    assert.deepEqual(m.themes, {
      "@trops/ocean": { version: "1.1.0", key: "Ocean" },
    });
    assert.deepEqual(m.widgets, { "@trops/chat": "0.0.9" });
    assert.deepEqual(m.folders, [{ id: "2", name: "Home", icon: "house" }]);
    assert.deepEqual(m.settings.dashboards["@trops/home-lab"], { items: {} });
    assert.deepEqual(m.settings.app, { theme: "Ocean" });
    assert.equal(m.createdAt, "2026-10-27T12:00:00.000Z");
    assert.equal(m.leftOut.length, 1);
    // Nothing that could be a record or code.
    assert.equal(JSON.stringify(m).includes("layout"), false);
  });
});
