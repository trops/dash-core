/**
 * modelProviders.test.js
 *
 * Tests the provider-pluggable model registry: curated fallback, default
 * model, retired-id migration, and the live-fetch dispatch (with a mocked
 * Anthropic SDK). Loaded via source-eval so the SDK can be injected, matching
 * the existing dash-core test pattern.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function loadModule(mockAnthropic) {
  const source = fs.readFileSync(
    path.join(__dirname, "modelProviders.js"),
    "utf8",
  );
  const customRequire = (mod) => {
    if (mod === "@anthropic-ai/sdk") return mockAnthropic;
    return require(mod);
  };
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "console", source);
  fn(customRequire, m, m.exports, console);
  return m.exports;
}

// Build a mock Anthropic SDK constructor whose models.list runs `behavior`.
function mockSdk(behavior) {
  return class MockAnthropic {
    constructor(opts) {
      this.opts = opts;
    }
    get models() {
      return { list: behavior };
    }
  };
}

const NOOP_SDK = mockSdk(async () => ({ data: [] }));

describe("modelProviders", () => {
  describe("defaults and curated list", () => {
    it("default model for anthropic is claude-opus-4-8", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.getDefaultModel("anthropic"), "claude-opus-4-8");
    });

    it("unknown provider falls back to the default provider", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.getDefaultModel("does-not-exist"), "claude-opus-4-8");
    });

    it("curated list contains current, non-deprecated ids", () => {
      const mp = loadModule(NOOP_SDK);
      const ids = mp.getCuratedModels("anthropic").map((m) => m.value);
      assert.ok(ids.includes("claude-opus-4-8"));
      assert.ok(ids.includes("claude-sonnet-4-6"));
      assert.ok(ids.includes("claude-haiku-4-5"));
      // No retired ids leak into the curated list
      assert.ok(!ids.includes("claude-sonnet-4-20250514"));
    });
  });

  describe("migrateModelId", () => {
    it("maps retired ids to current replacements", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.migrateModelId("anthropic", "claude-sonnet-4-20250514"),
        "claude-sonnet-4-6",
      );
      assert.equal(
        mp.migrateModelId("anthropic", "claude-opus-4-20250514"),
        "claude-opus-4-8",
      );
    });

    it("passes through a current id unchanged", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.migrateModelId("anthropic", "claude-sonnet-4-6"),
        "claude-sonnet-4-6",
      );
    });

    it("returns the default model for a falsy id", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.migrateModelId("anthropic", undefined),
        "claude-opus-4-8",
      );
      assert.equal(mp.migrateModelId("anthropic", ""), "claude-opus-4-8");
    });

    it("isKnownRetired flags retired ids only", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.isKnownRetired("anthropic", "claude-opus-4-20250514"),
        true,
      );
      assert.equal(mp.isKnownRetired("anthropic", "claude-opus-4-8"), false);
    });
  });

  describe("listModels", () => {
    it("live fetch maps id/display_name and reports source=live", async () => {
      const mp = loadModule(
        mockSdk(async () => ({
          data: [
            { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
            { id: "claude-xyz", display_name: "Claude XYZ" },
          ],
        })),
      );
      const res = await mp.listModels("anthropic", { apiKey: "sk-test" });
      assert.equal(res.source, "live");
      assert.deepEqual(res.models, [
        { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
        { value: "claude-xyz", label: "Claude XYZ" },
      ]);
    });

    it("falls back to curated when no apiKey (no live fetch)", async () => {
      const mp = loadModule(
        mockSdk(async () => {
          throw new Error("should not be called without a key");
        }),
      );
      const res = await mp.listModels("anthropic", {});
      assert.equal(res.source, "curated");
      assert.ok(res.models.some((m) => m.value === "claude-opus-4-8"));
    });

    it("falls back to curated when the live fetch throws", async () => {
      const mp = loadModule(
        mockSdk(async () => {
          throw new Error("network down");
        }),
      );
      const res = await mp.listModels("anthropic", { apiKey: "sk-test" });
      assert.equal(res.source, "curated");
      assert.ok(res.models.length > 0);
    });

    it("falls back to curated when the live fetch returns empty", async () => {
      const mp = loadModule(mockSdk(async () => ({ data: [] })));
      const res = await mp.listModels("anthropic", { apiKey: "sk-test" });
      assert.equal(res.source, "curated");
    });

    it("unknown provider returns the default provider's curated list", async () => {
      const mp = loadModule(NOOP_SDK);
      const res = await mp.listModels("does-not-exist", {});
      assert.equal(res.source, "curated");
      assert.ok(res.models.some((m) => m.value === "claude-opus-4-8"));
    });
  });
});
