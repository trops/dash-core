const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  validateDashboardConfig,
  applyDefaults,
  CURRENT_SCHEMA_VERSION,
} = require("./dashboardConfigValidator");

// Load example configs
const analyticsExample = require("./examples/analytics-dashboard.json");
const eventDemoExample = require("./examples/event-demo-dashboard.json");

/** Minimal valid config */
function minimalConfig() {
  return {
    schemaVersion: "1.0.0",
    name: "Test Dashboard",
    workspace: {
      layout: [
        {
          id: 1,
          type: "grid",
          component: "LayoutGridContainer",
          grid: { rows: 1, cols: 1 },
        },
      ],
    },
    widgets: [{ id: "test.widget.Foo", package: "@test/foo" }],
  };
}

describe("validateDashboardConfig", () => {
  // --- Valid configs ---

  it("accepts a minimal valid config", () => {
    const result = validateDashboardConfig(minimalConfig());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts the analytics example config", () => {
    const result = validateDashboardConfig(analyticsExample);
    assert.equal(result.valid, true, result.errors.join(", "));
  });

  it("accepts the event demo example config", () => {
    const result = validateDashboardConfig(eventDemoExample);
    assert.equal(result.valid, true, result.errors.join(", "));
  });

  it("accepts a config with all optional fields", () => {
    const config = {
      ...minimalConfig(),
      description: "Full config",
      author: { name: "Tester", id: "tester-1" },
      shareable: false,
      tags: ["test", "demo"],
      icon: "cog",
      screenshots: ["https://example.com/shot.png"],
      providers: [
        {
          type: "slack",
          providerClass: "mcp",
          required: true,
          usedBy: ["SlackWidget"],
        },
      ],
      eventWiring: [
        {
          source: { widget: "Sender", event: "clicked" },
          target: { widget: "Receiver", handler: "onClicked" },
        },
      ],
    };
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, true, result.errors.join(", "));
  });

  // --- Missing required fields ---

  it("rejects null", () => {
    const result = validateDashboardConfig(null);
    assert.equal(result.valid, false);
  });

  it("rejects undefined", () => {
    const result = validateDashboardConfig(undefined);
    assert.equal(result.valid, false);
  });

  it("rejects config missing schemaVersion", () => {
    const config = minimalConfig();
    delete config.schemaVersion;
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("schemaVersion")));
  });

  it("rejects config missing name", () => {
    const config = minimalConfig();
    delete config.name;
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects config missing workspace", () => {
    const config = minimalConfig();
    delete config.workspace;
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("workspace")));
  });

  it("rejects config missing widgets", () => {
    const config = minimalConfig();
    delete config.widgets;
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("widgets")));
  });

  // --- Field validation ---

  it("rejects invalid schemaVersion format", () => {
    const config = minimalConfig();
    config.schemaVersion = "v1";
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("semver")));
  });

  it("rejects empty name", () => {
    const config = minimalConfig();
    config.name = "";
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
  });

  it("rejects name over 100 characters", () => {
    const config = minimalConfig();
    config.name = "x".repeat(101);
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
  });

  it("rejects author without name", () => {
    const config = minimalConfig();
    config.author = { id: "test" };
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("author.name")));
  });

  it("rejects non-boolean shareable", () => {
    const config = minimalConfig();
    config.shareable = "yes";
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
  });

  it("rejects workspace with empty layout array", () => {
    const config = minimalConfig();
    config.workspace.layout = [];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
  });

  it("rejects widget missing id", () => {
    const config = minimalConfig();
    config.widgets = [{ package: "@test/foo" }];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("widgets[0].id")));
  });

  it("rejects widget missing package", () => {
    const config = minimalConfig();
    config.widgets = [{ id: "test.Foo" }];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("widgets[0].package")));
  });

  it("rejects provider with invalid providerClass", () => {
    const config = minimalConfig();
    config.providers = [{ type: "test", providerClass: "invalid" }];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("providerClass")));
  });

  it("rejects eventWiring with missing source fields", () => {
    const config = minimalConfig();
    config.eventWiring = [
      { source: { widget: "A" }, target: { widget: "B", handler: "onX" } },
    ];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("source")));
  });

  it("rejects eventWiring with missing target fields", () => {
    const config = minimalConfig();
    config.eventWiring = [
      { source: { widget: "A", event: "x" }, target: { widget: "B" } },
    ];
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("target")));
  });

  it("rejects unknown top-level fields", () => {
    const config = { ...minimalConfig(), foo: "bar" };
    const result = validateDashboardConfig(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Unknown field: "foo"')));
  });
});

describe("applyDefaults", () => {
  it("fills in all optional fields", () => {
    const config = minimalConfig();
    const result = applyDefaults(config);

    assert.equal(result.schemaVersion, "1.0.0");
    assert.equal(result.description, "");
    assert.equal(result.shareable, true);
    assert.deepEqual(result.tags, []);
    assert.equal(result.icon, "grip");
    assert.deepEqual(result.screenshots, []);
    assert.deepEqual(result.providers, []);
    assert.deepEqual(result.eventWiring, []);
    assert.equal(result.workspace.type, "workspace");
    assert.equal(result.workspace.version, 1);
    assert.equal(result.workspace.menuId, 1);
  });

  it("preserves explicitly set values", () => {
    const config = {
      ...minimalConfig(),
      shareable: false,
      tags: ["custom"],
      icon: "star",
    };
    const result = applyDefaults(config);

    assert.equal(result.shareable, false);
    assert.deepEqual(result.tags, ["custom"]);
    assert.equal(result.icon, "star");
  });

  it("does not mutate the original config", () => {
    const config = minimalConfig();
    const original = JSON.parse(JSON.stringify(config));
    applyDefaults(config);
    assert.deepEqual(config, original);
  });
});

describe("CURRENT_SCHEMA_VERSION", () => {
  it("is a valid semver string", () => {
    assert.match(CURRENT_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
