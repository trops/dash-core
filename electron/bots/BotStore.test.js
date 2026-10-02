/**
 * BotStore.test.js
 *
 * CRUD, session round-trip, run-log capping, working-directory creation, and
 * durability across a simulated restart — all with an injected in-memory
 * persistence and a temp bots root (no Electron, no electron-store).
 */
"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BotStore = require("./BotStore");

// In-memory persistence that deep-clones on write, mimicking a disk round-trip
// (so a "restart" — a fresh BotStore over the same persistence — sees a clean
// copy, not shared references).
function memPersistence(initial) {
  let blob = initial
    ? JSON.parse(JSON.stringify(initial))
    : { bots: {}, runs: {} };
  return {
    read: () => blob,
    write: (o) => {
      blob = JSON.parse(JSON.stringify(o));
    },
    _blob: () => blob,
  };
}

const tmpRoots = [];
function freshStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
  tmpRoots.push(root);
  const persistence = memPersistence();
  const clock = { now: () => "2026-09-28T00:00:00.000Z" };
  const store = new BotStore({ persistence, paths: { botsRoot: root }, clock });
  return { store, persistence, root };
}

const validDef = { name: "PR Digest", instructions: "Summarize open PRs." };

after(() => {
  for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true });
});

describe("BotStore construction", () => {
  it("requires persistence and a bots root", () => {
    assert.throws(() => new BotStore({}), /persistence/);
    assert.throws(
      () => new BotStore({ persistence: memPersistence() }),
      /botsRoot/,
    );
  });
});

describe("BotStore CRUD", () => {
  it("create stamps id + timestamps, persists, and makes the working dir", () => {
    const { store, root } = freshStore();
    const bot = store.create(validDef);
    assert.ok(bot.id.startsWith("bot_"));
    assert.equal(bot.createdAt, "2026-09-28T00:00:00.000Z");
    assert.equal(bot.updatedAt, bot.createdAt);
    assert.equal(store.get(bot.id).name, "PR Digest");
    assert.ok(fs.existsSync(path.join(root, bot.id, "files")));
  });

  it("create rejects an invalid definition and persists nothing", () => {
    const { store } = freshStore();
    assert.throws(() => store.create({ name: "" }), /invalid bot/);
    assert.equal(store.list().length, 0);
  });

  it("list returns all bots; duplicate names are allowed (id-keyed)", () => {
    const { store } = freshStore();
    const a = store.create(validDef);
    const b = store.create(validDef); // same name, different bot
    assert.notEqual(a.id, b.id);
    assert.equal(store.list().length, 2);
  });

  it("update merges a patch and bumps updatedAt without touching createdAt", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    const clock = { now: () => "2026-10-01T12:00:00.000Z" };
    store._now = clock.now; // advance the clock
    const updated = store.update(bot.id, { name: "Renamed" });
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.createdAt, "2026-09-28T00:00:00.000Z");
    assert.equal(updated.updatedAt, "2026-10-01T12:00:00.000Z");
  });

  it("update cannot clobber id/createdAt/session via the patch", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    store.saveSession(bot.id, "tool-loop", { messages: [1] });
    const updated = store.update(bot.id, {
      id: "bot_hacked",
      createdAt: "1999-01-01",
      session: null,
    });
    assert.equal(updated.id, bot.id);
    assert.equal(updated.createdAt, bot.createdAt);
    assert.deepEqual(updated.session, {
      engine: "tool-loop",
      state: { messages: [1] },
    });
  });

  it("delete removes the bot, its runs, and its working directory", () => {
    const { store, root } = freshStore();
    const bot = store.create(validDef);
    store.appendRun(bot.id, { status: "completed" });
    assert.equal(store.delete(bot.id), true);
    assert.equal(store.get(bot.id), null);
    assert.equal(store.getRuns(bot.id).length, 0);
    assert.equal(fs.existsSync(path.join(root, bot.id)), false);
    assert.equal(store.delete(bot.id), false); // idempotent
  });
});

describe("BotStore session state (US-005)", () => {
  it("saves and resets engine session state", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    store.saveSession(bot.id, "tool-loop", { messages: [{ role: "user" }] });
    assert.deepEqual(store.get(bot.id).session, {
      engine: "tool-loop",
      state: { messages: [{ role: "user" }] },
    });
    store.resetSession(bot.id);
    assert.equal(store.get(bot.id).session, null);
  });
});

describe("BotStore run log", () => {
  it("appends runs and caps at MAX_RUNS_PER_BOT (newest kept)", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    for (let i = 0; i < BotStore.MAX_RUNS_PER_BOT + 5; i++) {
      store.appendRun(bot.id, { seq: i });
    }
    const runs = store.getRuns(bot.id);
    assert.equal(runs.length, BotStore.MAX_RUNS_PER_BOT);
    assert.equal(runs[runs.length - 1].seq, BotStore.MAX_RUNS_PER_BOT + 4);
    assert.equal(runs[0].seq, 5); // oldest 5 dropped
  });
});

describe("BotStore durability across a restart", () => {
  it("a fresh store over the same persistence sees prior bots + sessions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
    tmpRoots.push(root);
    const persistence = memPersistence();

    const store1 = new BotStore({ persistence, paths: { botsRoot: root } });
    const bot = store1.create(validDef);
    store1.saveSession(bot.id, "tool-loop", { messages: ["hi"] });

    // "Restart": brand-new store instance, same durable persistence.
    const store2 = new BotStore({ persistence, paths: { botsRoot: root } });
    const restored = store2.get(bot.id);
    assert.equal(restored.name, "PR Digest");
    assert.deepEqual(restored.session.state, { messages: ["hi"] });
  });
});

// Stable identity for event naming (bot:<ref>[<botId>].<event>) — survives
// renames; set once.
describe("BotStore — ref (stable bot identity)", () => {
  it("create sets ref = local/<slug of name>", () => {
    const { store } = freshStore();
    const bot = store.create({ ...validDef, name: "Gmail Email Check" });
    assert.equal(bot.ref, "local/gmail-email-check");
  });

  it("create keeps a ref supplied by a template install", () => {
    const { store } = freshStore();
    const bot = store.create({
      ...validDef,
      ref: "@trops/inbox-tools/InboxTriage",
    });
    assert.equal(bot.ref, "@trops/inbox-tools/InboxTriage");
  });

  it("renaming doesn't change ref, and a patch can't overwrite it", () => {
    const { store } = freshStore();
    const bot = store.create({ ...validDef, name: "Gmail Email Check" });
    const renamed = store.update(bot.id, {
      name: "Inbox Watch",
      ref: "local/hijack",
    });
    assert.equal(renamed.name, "Inbox Watch");
    assert.equal(renamed.ref, "local/gmail-email-check");
  });

  it("bots saved before refs existed get one on load, persisted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
    tmpRoots.push(root);
    const persistence = memPersistence({
      bots: {
        bot_old: { id: "bot_old", name: "Daily Brief", instructions: "x" },
      },
      runs: {},
    });
    const store = new BotStore({ persistence, paths: { botsRoot: root } });
    assert.equal(store.get("bot_old").ref, "local/daily-brief");
    assert.equal(persistence._blob().bots.bot_old.ref, "local/daily-brief");
  });
});

// Run answers are sensitive (email snippets…) — sealed at rest (secretBox).
describe("BotStore — encrypted run answers", () => {
  const { createSecretBox } = require("./secretBox");
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("X" + s, "utf8"),
    decryptString: (b) => b.toString("utf8").slice(1),
  };

  function boxedStore(box = createSecretBox(crypto), persistence) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
    tmpRoots.push(root);
    const p = persistence || memPersistence();
    const store = new BotStore({
      persistence: p,
      paths: { botsRoot: root },
      secretBox: box,
    });
    return { store, persistence: p };
  }

  it("stores a run's output encrypted and returns it decrypted", () => {
    const { store, persistence } = boxedStore();
    const bot = store.create(validDef);
    store.appendRun(bot.id, {
      status: "completed",
      output: "3 important emails",
    });
    const raw = persistence._blob().runs[bot.id][0].output;
    assert.ok(raw.startsWith("enc:v1:"));
    assert.ok(!raw.includes("important"));
    assert.equal(store.getRuns(bot.id)[0].output, "3 important emails");
  });

  it("an undecryptable answer reads as null, flagged outputUnavailable", () => {
    const { store, persistence } = boxedStore();
    const bot = store.create(validDef);
    store.appendRun(bot.id, { status: "completed", output: "x" });
    const noKey = createSecretBox({
      ...crypto,
      decryptString: () => {
        throw new Error("no key");
      },
    });
    const { store: store2 } = boxedStore(noKey, persistence);
    const [run] = store2.getRuns(bot.id);
    assert.equal(run.output, null);
    assert.equal(run.outputUnavailable, true);
  });

  it("without a secretBox, outputs stay plain (plain-Node host)", () => {
    const { store, persistence } = freshStore();
    const bot = store.create(validDef);
    store.appendRun(bot.id, { status: "completed", output: "hello" });
    assert.equal(persistence._blob().runs[bot.id][0].output, "hello");
  });
});

// Per-dashboard team settings (lead on/off) + the global auto-lead switch.
describe("BotStore — team settings", () => {
  it("defaults: leads enabled everywhere, auto-create on", () => {
    const { store } = freshStore();
    assert.equal(store.getTeamSettings("7").leadEnabled, true);
    assert.equal(store.getSettings().autoLeads, true);
  });

  it("remembers a turned-off lead per dashboard (ids as strings)", () => {
    const { store } = freshStore();
    store.setTeamSettings(7, { leadEnabled: false });
    assert.equal(store.getTeamSettings("7").leadEnabled, false);
    assert.equal(store.getTeamSettings("9").leadEnabled, true);
  });

  it("stores the global auto-lead switch", () => {
    const { store } = freshStore();
    store.setSettings({ autoLeads: false });
    assert.equal(store.getSettings().autoLeads, false);
  });
});
