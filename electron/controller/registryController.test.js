const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");

// The controller loads electron (app paths): a stub, as other main-process
// tests do — this file failed to load without one.
const Module = require("node:module");
const electronStubDir = require("fs").mkdtempSync(
  require("path").join(os.tmpdir(), "zz-electron-registryctl-"),
);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_registryctl__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_registryctl__"] = {
  id: "__stub_electron_registryctl__",
  filename: "__stub_electron_registryctl__",
  loaded: true,
  exports: {
    app: {
      getPath: () => electronStubDir,
      getAppPath: () => electronStubDir,
      isPackaged: false,
      getVersion: () => "0.0.0",
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    shell: {},
    dialog: {},
  },
};

const fs = require("fs");

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

// The registry comes through registryAuthController.authedFetch: a stub that
// answers with the test data, so the controller takes its normal (non-dev)
// path and the tracked test-registry-index.json is never touched — this test
// used to overwrite it and, on master, failed to load without an electron
// stub.
const authPath = require.resolve("./registryAuthController");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    getStoredToken: () => null,
    authedFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(testRegistryData)),
    }),
  },
};
const previousNodeEnv = process.env.NODE_ENV;

before(() => {
  // Not dev mode: no local test file, the stubbed fetch instead.
  delete process.env.NODE_ENV;
});

after(() => {
  if (previousNodeEnv !== undefined) process.env.NODE_ENV = previousNodeEnv;
  Module._resolveFilename = originalResolve;
  fs.rmSync(electronStubDir, { recursive: true, force: true });
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

describe("fetchPackageSource — validation", () => {
  it("throws when packageName is missing", async () => {
    const { fetchPackageSource } = require("./registryController");
    await assert.rejects(
      () => fetchPackageSource(""),
      /packageName is required/,
    );
  });

  it("throws when package is not found in the registry", async () => {
    const { fetchPackageSource } = require("./registryController");
    await assert.rejects(
      () => fetchPackageSource("non-existent-package"),
      /not found in the registry/,
    );
  });
});
