const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

// We can't easily mock fetchRegistryIndex, but we can test searchRegistry
// by pre-populating the cache. The cache variables are module-scoped,
// so we call fetchRegistryIndex once and then the cache is used.
// Instead, we test the filter logic by calling searchRegistry with
// the existing search + type + compatibleWidgets filters.
//
// Since the controller fetches from network/filesystem, we test the
// pure filtering by importing and calling searchRegistry after seeding
// the module cache via a test registry file.

// For these tests, set NODE_ENV to development and ensure a test registry exists.
const path = require("path");
const fs = require("fs");

const TEST_REGISTRY_PATH = path.join(
  __dirname,
  "..",
  "registry",
  "test-registry-index.json",
);

const testRegistryData = {
  version: "1.0.0",
  lastUpdated: new Date().toISOString(),
  packages: [
    {
      name: "clock",
      displayName: "Clock Widgets",
      author: "Test Author",
      description: "Clock widget package",
      version: "1.0.0",
      type: "widget",
      category: "general",
      tags: ["time", "utility"],
      downloadUrl: "https://example.com/clock.zip",
      widgets: [
        { name: "AnalogClockWidget", displayName: "Analog Clock" },
        { name: "DigitalClockWidget", displayName: "Digital Clock" },
      ],
    },
    {
      name: "weather",
      displayName: "Weather Widgets",
      author: "Another Author",
      description: "Weather forecast widgets",
      version: "2.0.0",
      type: "widget",
      category: "data",
      tags: ["weather", "forecast"],
      downloadUrl: "https://example.com/weather.zip",
      widgets: [{ name: "WeatherWidget", displayName: "Weather" }],
    },
    {
      name: "analytics-dashboard",
      displayName: "Analytics Dashboard",
      author: "Test Author",
      description: "Pre-built analytics dashboard with clock and weather",
      version: "1.0.0",
      type: "dashboard",
      category: "analytics",
      tags: ["analytics", "monitoring"],
      downloadUrl: "https://example.com/analytics-dashboard.zip",
      widgets: [
        { name: "AnalogClockWidget", package: "clock", required: true },
        { name: "WeatherWidget", package: "weather", required: true },
      ],
    },
    {
      name: "simple-dashboard",
      displayName: "Simple Dashboard",
      author: "Another Author",
      description: "Just clocks",
      version: "1.0.0",
      type: "dashboard",
      category: "general",
      tags: ["simple"],
      downloadUrl: "https://example.com/simple-dashboard.zip",
      widgets: [
        { name: "DigitalClockWidget", package: "clock", required: true },
      ],
    },
    {
      name: "legacy-widget",
      displayName: "Legacy Widget",
      author: "Legacy Author",
      description: "Widget without explicit type field",
      version: "1.0.0",
      category: "general",
      tags: [],
      downloadUrl: "https://example.com/legacy.zip",
      widgets: [{ name: "LegacyWidget", displayName: "Legacy" }],
    },
  ],
};

// Write test registry and set env before importing controller
before(() => {
  const registryDir = path.dirname(TEST_REGISTRY_PATH);
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  fs.writeFileSync(
    TEST_REGISTRY_PATH,
    JSON.stringify(testRegistryData, null, 2),
  );
  process.env.NODE_ENV = "development";
});

describe("searchRegistry — type filter", () => {
  it("returns only widget packages when type is 'widget'", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", { type: "widget" });
    assert.ok(result.packages.length >= 2);
    assert.ok(result.packages.every((p) => (p.type || "widget") === "widget"));
    assert.ok(result.packages.some((p) => p.name === "clock"));
    assert.ok(result.packages.some((p) => p.name === "legacy-widget"));
  });

  it("returns only dashboard packages when type is 'dashboard'", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", { type: "dashboard" });
    assert.ok(result.packages.length === 2);
    assert.ok(result.packages.every((p) => p.type === "dashboard"));
    assert.ok(result.packages.some((p) => p.name === "analytics-dashboard"));
    assert.ok(result.packages.some((p) => p.name === "simple-dashboard"));
  });

  it("treats packages without type as 'widget'", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", { type: "widget" });
    assert.ok(result.packages.some((p) => p.name === "legacy-widget"));
  });

  it("returns all packages when no type filter", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("");
    assert.ok(result.packages.length === 5);
  });
});

describe("searchRegistry — compatibleWidgets filter", () => {
  it("filters dashboards by installed widget compatibility", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", {
      type: "dashboard",
      compatibleWidgets: ["clock", "weather"],
    });
    assert.ok(result.packages.some((p) => p.name === "analytics-dashboard"));
    assert.ok(result.packages.some((p) => p.name === "simple-dashboard"));
  });

  it("excludes dashboards needing uninstalled widgets", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", {
      type: "dashboard",
      compatibleWidgets: ["clock"],
    });
    assert.ok(!result.packages.some((p) => p.name === "analytics-dashboard"));
    assert.ok(result.packages.some((p) => p.name === "simple-dashboard"));
  });

  it("skips compatibility filter when compatibleWidgets is empty", async () => {
    const { searchRegistry } = require("./registryController");
    const result = await searchRegistry("", {
      type: "dashboard",
      compatibleWidgets: [],
    });
    // Empty array means no filter — returns all dashboards
    assert.equal(result.packages.length, 2);
  });
});

describe("searchDashboards", () => {
  it("is a shortcut for searchRegistry with type: dashboard", async () => {
    const { searchDashboards } = require("./registryController");
    const result = await searchDashboards("");
    assert.ok(result.packages.length === 2);
    assert.ok(result.packages.every((p) => p.type === "dashboard"));
  });

  it("passes through query and filters", async () => {
    const { searchDashboards } = require("./registryController");
    const result = await searchDashboards("analytics");
    assert.ok(result.packages.length === 1);
    assert.equal(result.packages[0].name, "analytics-dashboard");
  });

  it("supports compatibility filter", async () => {
    const { searchDashboards } = require("./registryController");
    const result = await searchDashboards("", {
      compatibleWidgets: ["clock"],
    });
    assert.equal(result.packages.length, 1);
    assert.equal(result.packages[0].name, "simple-dashboard");
  });
});
