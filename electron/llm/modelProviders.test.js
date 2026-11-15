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
    it("default model for anthropic is claude-opus-5-5", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.getDefaultModel("anthropic"), "claude-opus-5-5");
    });

    it("unknown provider falls back to the default provider", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.getDefaultModel("does-not-exist"), "claude-opus-5-5");
    });

    it("curated list leads with the Claude 5 family, older models after", () => {
      const mp = loadModule(NOOP_SDK);
      const ids = mp.getCuratedModels("anthropic").map((m) => m.value);
      assert.deepEqual(ids.slice(0, 4), [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5-2",
      ]);
      assert.ok(!ids.includes("claude-fable-5"));
      // The CLI provider offers the same models and default.
      assert.deepEqual(
        mp.getCuratedModels("claude-code").map((m) => m.value),
        ids,
      );
      assert.equal(mp.getDefaultModel("claude-code"), "claude-opus-5-5");
    });

    it("Fable 5 self-heals to the newest Fable", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.migrateModelId("anthropic", "claude-fable-5"),
        "claude-fable-5-2",
      );
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
    it("maps retired ids to the newest of their family", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(
        mp.migrateModelId("anthropic", "claude-sonnet-4-20250514"),
        "claude-sonnet-5-5",
      );
      assert.equal(
        mp.migrateModelId("anthropic", "claude-opus-4-20250514"),
        "claude-opus-5-5",
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
        "claude-opus-5-5",
      );
      assert.equal(mp.migrateModelId("anthropic", ""), "claude-opus-5-5");
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
    it("live fetch narrows the list to what the key offers, adding unknown ones", async () => {
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
      assert.deepEqual(
        res.models.map((m) => [m.value, m.family]),
        [
          ["claude-opus-4-8", "opus"],
          ["claude-xyz", "xyz"],
        ],
      );
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

  describe("families and the fresh list", () => {
    it("every built-in model has a family and a status", () => {
      const mp = loadModule(NOOP_SDK);
      const statuses = new Set(["current", "older", "retiring", "retired"]);
      for (const m of mp.getCuratedModels("anthropic")) {
        assert.ok(m.family, `no family for ${m.value}`);
        assert.ok(statuses.has(m.status), `bad status for ${m.value}`);
      }
    });

    it("Latest <family> runs on the newest of that family", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.latestAlias("opus"), "latest:opus");
      assert.equal(
        mp.migrateModelId("claude-code", "latest:haiku"),
        "claude-haiku-5-5",
      );
      assert.equal(
        mp.migrateModelId("anthropic", "latest:fable"),
        "claude-fable-5-2",
      );
      // A family the provider doesn't have: the default.
      assert.equal(
        mp.migrateModelId("anthropic", "latest:nope"),
        "claude-opus-5-5",
      );
    });

    it("a fresh list replaces the built-in one for both Claude providers", () => {
      const mp = loadModule(NOOP_SDK);
      mp.setFreshList("anthropic", {
        models: [
          { value: "claude-opus-6", family: "opus", status: "current" },
          { value: "claude-opus-5-5", family: "opus", status: "older" },
        ],
        retiredMap: { "claude-sonnet-5-5": "claude-opus-6" },
      });
      assert.equal(
        mp.migrateModelId("claude-code", "latest:opus"),
        "claude-opus-6",
      );
      assert.equal(
        mp.migrateModelId("anthropic", "claude-sonnet-5-5"),
        "claude-opus-6",
      );
      assert.deepEqual(
        mp.getCuratedModels("claude-code").map((m) => m.value),
        ["claude-opus-6", "claude-opus-5-5"],
      );
      mp.setFreshList("anthropic", null);
      assert.equal(
        mp.migrateModelId("anthropic", "latest:opus"),
        "claude-opus-5-5",
      );
    });

    it("a retired model follows its replacement until one runs, without looping", () => {
      const mp = loadModule(NOOP_SDK);
      mp.setFreshList("anthropic", {
        models: [
          { value: "a", family: "x", status: "retired", replacedBy: "b" },
          { value: "b", family: "x", status: "retired", replacedBy: "c" },
          { value: "c", family: "x", status: "current" },
          { value: "p", family: "y", status: "retired", replacedBy: "q" },
          { value: "q", family: "y", status: "retired", replacedBy: "p" },
        ],
        retiredMap: {},
      });
      assert.equal(mp.migrateModelId("anthropic", "a"), "c");
      assert.ok(["p", "q"].includes(mp.migrateModelId("anthropic", "p")));
      assert.equal(mp.isKnownRetired("anthropic", "a"), true);
      assert.equal(mp.newestOfFamily("anthropic", "x"), "c");
    });

    it("isKnownModel accepts families, listed and retired ids only", () => {
      const mp = loadModule(NOOP_SDK);
      assert.equal(mp.isKnownModel("claude-code", "latest:sonnet"), true);
      assert.equal(mp.isKnownModel("claude-code", "claude-haiku-4-5"), true);
      assert.equal(
        mp.isKnownModel("claude-code", "claude-sonnet-4-20250514"),
        true,
      );
      assert.equal(mp.isKnownModel("claude-code", "gpt-4o"), false);
      assert.equal(mp.isKnownModel("claude-code", "latest:nope"), false);
    });
  });

  describe("Bot Factory engine + advisor metadata", () => {
    it("anthropic routes through the tool-loop engine + anthropic adapter", () => {
      const mp = loadModule(NOOP_SDK);
      const p = mp.getProvider("anthropic");
      assert.equal(p.engine, "tool-loop");
      assert.equal(p.adapter, "anthropic");
    });

    it("every anthropic curated model carries a valid tier and pricing", () => {
      const mp = loadModule(NOOP_SDK);
      const tiers = new Set(["fast", "balanced", "deep"]);
      for (const m of mp.getCuratedModels("anthropic")) {
        assert.ok(tiers.has(m.tier), `bad tier for ${m.value}: ${m.tier}`);
        assert.equal(typeof m.pricing.input, "number");
        assert.equal(typeof m.pricing.output, "number");
      }
    });

    it("tier assignments match the model hierarchy", () => {
      const mp = loadModule(NOOP_SDK);
      const byId = Object.fromEntries(
        mp.getCuratedModels("anthropic").map((m) => [m.value, m]),
      );
      assert.equal(byId["claude-opus-5-5"].tier, "deep");
      assert.equal(byId["claude-sonnet-5-5"].tier, "balanced");
      assert.equal(byId["claude-haiku-5-5"].tier, "fast");
      assert.equal(byId["claude-opus-4-8"].tier, "deep");
      assert.equal(byId["claude-sonnet-4-6"].tier, "balanced");
      assert.equal(byId["claude-haiku-4-5"].tier, "fast");
    });

    it("openai provider uses the openai-compatible adapter", () => {
      const mp = loadModule(NOOP_SDK);
      const p = mp.getProvider("openai");
      assert.equal(p.id, "openai");
      assert.equal(p.engine, "tool-loop");
      assert.equal(p.adapter, "openai-compatible");
    });

    it("xai provider is openai-compatible with the x.ai base URL", () => {
      const mp = loadModule(NOOP_SDK);
      const p = mp.getProvider("xai");
      assert.equal(p.adapter, "openai-compatible");
      assert.equal(p.baseURL, "https://api.x.ai/v1");
    });
  });

  describe("an API key's own list", () => {
    it("narrows only: a model the list doesn't know is older, never retired", () => {
      const mp2 = loadModule(NOOP_SDK);
      const out = mp2.mergeLive(
        mp2.getCuratedModels("anthropic"),
        [
          { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
          { value: "claude-haiku-9-dated", label: "Claude Haiku 9" },
          { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
        ],
        { "claude-sonnet-4-20250514": "latest:sonnet" },
      );
      assert.deepEqual(
        out.map((m) => [m.value, m.status]),
        [
          ["claude-opus-5-5", "current"],
          ["claude-haiku-9-dated", "older"],
        ],
      );
    });
  });
});
