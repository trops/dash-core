/**
 * modelList.test.js — the fresh model list: what's accepted, when it
 * checks, and what a failed check keeps.
 */
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const mp = require("./modelProviders");
const {
  createModelList,
  parseModelList,
  DAY_MS,
  HOUR_MS,
  FORCED_GAP_MS,
} = require("./modelList");

const LIST = {
  version: 1,
  updated: "2026-11-15",
  providers: {
    anthropic: {
      models: [
        {
          value: "claude-opus-6",
          label: "Claude Opus 6",
          family: "opus",
          status: "current",
          tier: "deep",
          reasoning: "effort",
          pricing: { input: 4, output: 20 },
        },
        {
          value: "claude-opus-5-5",
          label: "Claude Opus 5.5",
          family: "opus",
          status: "retiring",
          retiresOn: "2027-03-01",
          tier: "deep",
        },
        { value: "claude-haiku-5-5", family: "haiku", status: "current" },
      ],
      retired: { "claude-sonnet-4-20250514": "claude-sonnet-5-5" },
    },
  },
};

function harness(over = {}) {
  let t = 1_000_000;
  const calls = { fetch: 0, saved: null, changes: 0 };
  const list = createModelList({
    url: "https://example.test/api/models",
    fetchJson: async () => {
      calls.fetch++;
      if (over.fail) throw new Error("offline");
      return over.json || LIST;
    },
    readSaved: () => over.saved || null,
    save: (s) => {
      calls.saved = s;
    },
    getApiKey: async () => over.apiKey || null,
    listLive: over.listLive,
    builtInIds: () => mp.PROVIDERS.anthropic.curatedModels.map((m) => m.value),
    now: () => t,
    setInterval: () => null,
    clearInterval: () => {},
    onChange: () => {
      calls.changes++;
    },
  });
  return {
    list,
    calls,
    advance: (ms) => {
      t += ms;
    },
    over,
  };
}

describe("modelList", () => {
  beforeEach(() => mp.setFreshList("anthropic", null));

  describe("parseModelList", () => {
    it("keeps well-formed models and drops the rest", () => {
      const parsed = parseModelList({
        version: 1,
        providers: {
          anthropic: {
            models: [
              ...LIST.providers.anthropic.models,
              { value: "Bad Id!", family: "opus" },
              { value: "claude-x", family: "NOT A FAMILY" },
              { value: "claude-opus-6", family: "opus" }, // a repeat
              null,
            ],
            retired: { "claude-a": "claude-b", "claude-c": 5 },
          },
        },
      });
      assert.deepEqual(
        parsed.models.map((m) => m.value),
        ["claude-opus-6", "claude-opus-5-5", "claude-haiku-5-5"],
      );
      assert.deepEqual(parsed.models[0].reasoning.control, "effort");
      assert.equal(parsed.models[1].retiresOn, "2027-03-01");
      assert.equal(parsed.models[2].label, "claude-haiku-5-5");
      assert.deepEqual(parsed.retiredMap, { "claude-a": "claude-b" });
    });

    it("refuses anything that isn't a usable list", () => {
      assert.equal(parseModelList(null), null);
      assert.equal(parseModelList({ version: 2, providers: {} }), null);
      assert.equal(parseModelList({ version: 1, providers: {} }), null);
      assert.equal(
        parseModelList({
          version: 1,
          providers: {
            anthropic: {
              models: [{ value: "claude-a", family: "a", status: "retired" }],
            },
          },
        }),
        null,
      );
    });
  });

  it("start checks, uses the list everywhere and saves it", async () => {
    const h = harness();
    const s = await h.list.start();
    assert.equal(s.source, "dash");
    assert.equal(s.error, null);
    assert.equal(s.updated, "2026-11-15");
    assert.equal(
      mp.migrateModelId("claude-code", "latest:opus"),
      "claude-opus-6",
    );
    assert.equal(h.calls.saved.list.models.length, 3);
    // Opus 6 wasn't in the built-in list: it's new.
    assert.deepEqual(s.added, ["claude-opus-6"]);
  });

  it("a failed check keeps the saved list and says why", async () => {
    const h = harness({ fail: true });
    h.over.saved = {
      list: {
        updated: "2026-11-01",
        models: LIST.providers.anthropic.models,
        retiredMap: {},
      },
      checkedAt: 5,
    };
    const s = await h.list.start();
    assert.equal(s.source, "dash");
    assert.equal(s.error, "offline");
    assert.equal(s.checkedAt, 5);
    assert.equal(
      mp.migrateModelId("anthropic", "latest:opus"),
      "claude-opus-6",
    );
  });

  it("with no saved list and no connection, the built-in list stays", async () => {
    const h = harness({ fail: true });
    const s = await h.list.start();
    assert.equal(s.source, "built-in");
    assert.equal(
      mp.migrateModelId("anthropic", "latest:opus"),
      "claude-opus-5-5",
    );
  });

  it("checks again a day later, and an hour after a failed check", async () => {
    const h = harness();
    await h.list.start();
    assert.equal(h.calls.fetch, 1);
    h.advance(DAY_MS - 1000);
    await h.list.tick();
    assert.equal(h.calls.fetch, 1);
    h.advance(2000);
    h.over.fail = true;
    await h.list.tick();
    assert.equal(h.calls.fetch, 2);
    h.advance(HOUR_MS / 2);
    await h.list.tick();
    assert.equal(h.calls.fetch, 2);
    h.advance(HOUR_MS / 2);
    h.over.fail = false;
    const s = await h.list.tick();
    assert.equal(h.calls.fetch, 3);
    assert.equal(s.error, null);
  });

  it("a run that finds its model gone checks, but not over and over", async () => {
    const h = harness();
    await h.list.start();
    await h.list.checkNow();
    assert.equal(h.calls.fetch, 1);
    h.advance(FORCED_GAP_MS);
    await h.list.checkNow();
    assert.equal(h.calls.fetch, 2);
  });

  it("checks at the same time share one fetch", async () => {
    const h = harness();
    await Promise.all([h.list.check(), h.list.check(), h.list.check()]);
    assert.equal(h.calls.fetch, 1);
  });

  it("an API key narrows the list to what Anthropic offers", async () => {
    const h = harness({
      apiKey: "sk-test",
      listLive: async () => [
        { value: "claude-opus-6", label: "Claude Opus 6" },
        { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      ],
    });
    await h.list.start();
    assert.deepEqual(
      mp.getCuratedModels("anthropic").map((m) => m.value),
      ["claude-opus-6", "claude-haiku-5-5"],
    );
  });

  it("clearAdded forgets the new-model note once seen", async () => {
    const h = harness();
    await h.list.start();
    assert.deepEqual(h.list.clearAdded().added, []);
    assert.deepEqual(h.calls.saved.added, []);
  });

  it("models only Anthropic's list has are never announced as new", async () => {
    const h = harness({
      apiKey: "sk-test",
      listLive: async () => [
        { value: "claude-opus-6", label: "Claude Opus 6" },
        { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
        { value: "claude-3-haiku-20240307", label: "Claude Haiku 3" },
      ],
    });
    const s = await h.list.start();
    assert.deepEqual(s.added, ["claude-opus-6"]);
    const old = mp
      .getCuratedModels("anthropic")
      .find((m) => m.value === "claude-3-haiku-20240307");
    assert.equal(old.status, "older");
  });
});
