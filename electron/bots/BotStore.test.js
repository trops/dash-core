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

  it("create keeps a loaded bot's id when asked and it's free", () => {
    const { store } = freshStore();
    const kept = store.create(
      {
        ...validDef,
        id: "bot_lqf3k9_7f3a1b_0",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-02-03T00:00:00.000Z",
      },
      { keepId: true },
    );
    assert.equal(kept.id, "bot_lqf3k9_7f3a1b_0");
    // Its times come along too, so loading the file again finds it unchanged.
    assert.equal(kept.createdAt, "2026-01-02T00:00:00.000Z");
    assert.equal(kept.updatedAt, "2026-02-03T00:00:00.000Z");
    // Taken, malformed, or not asked: a new id.
    const again = store.create(
      { ...validDef, id: "bot_lqf3k9_7f3a1b_0" },
      { keepId: true },
    );
    assert.notEqual(again.id, kept.id);
    assert.notEqual(
      store.create({ ...validDef, id: "../x" }, { keepId: true }).id,
      "../x",
    );
    assert.notEqual(
      store.create({ ...validDef, id: "bot_other_1" }).id,
      "bot_other_1",
    );
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

  it("the chat's session is kept apart from the job's; Reset clears both", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    store.saveSession(bot.id, "tool-loop", { messages: ["job"] });
    store.saveSession(bot.id, "tool-loop", { messages: ["chat"] }, "chat");
    assert.deepEqual(store.get(bot.id).session.state, { messages: ["job"] });
    assert.deepEqual(store.get(bot.id).chatSession.state, {
      messages: ["chat"],
    });
    // A definition update can't clobber it.
    store.update(bot.id, { chatSession: null });
    assert.ok(store.get(bot.id).chatSession);
    store.resetSession(bot.id);
    assert.equal(store.get(bot.id).session, null);
    assert.equal(store.get(bot.id).chatSession, null);
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

  it("seals the run's prompt too; tool summaries stay readable", () => {
    const { store, persistence } = boxedStore();
    const bot = store.create(validDef);
    store.appendRun(bot.id, {
      status: "completed",
      prompt: "Find emails from Acme",
      output: "2 found",
      toolCalls: [{ tool: "search_emails", provider: "Gmail New", ok: true }],
    });
    const raw = persistence._blob().runs[bot.id][0];
    assert.ok(raw.prompt.startsWith("enc:v1:"));
    assert.ok(!raw.prompt.includes("Acme"));
    assert.equal(raw.toolCalls[0].tool, "search_emails");
    const [run] = store.getRuns(bot.id);
    assert.equal(run.prompt, "Find emails from Acme");
    assert.equal(run.output, "2 found");
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

  it("background mode defaults: stay in the tray, start at login, don't keep awake (US-018)", () => {
    const { store } = freshStore();
    const s = store.getSettings();
    assert.equal(s.background, true);
    assert.equal(s.startAtLogin, true);
    assert.equal(s.keepAwake, false);
    store.setSettings({ keepAwake: true, background: false });
    assert.equal(store.getSettings().keepAwake, true);
    assert.equal(store.getSettings().background, false);
    assert.equal(store.getSettings().startAtLogin, true);
  });

  it("stores the global auto-lead switch", () => {
    const { store } = freshStore();
    store.setSettings({ autoLeads: false });
    assert.equal(store.getSettings().autoLeads, false);
  });
});

describe("BotStore.onChange — bot definitions changed (TEAM-011 refresh)", () => {
  it("fires on create, update and delete with what changed", () => {
    const { store } = freshStore();
    const seen = [];
    store.onChange((change) => seen.push(change));
    const bot = store.create(validDef);
    store.update(bot.id, { name: "Renamed" });
    store.delete(bot.id);
    assert.deepEqual(seen, [
      { type: "created", id: bot.id },
      { type: "updated", id: bot.id },
      { type: "deleted", id: bot.id },
    ]);
  });

  it("does not fire for runs, sessions or settings", () => {
    const { store } = freshStore();
    const bot = store.create(validDef);
    const seen = [];
    store.onChange((change) => seen.push(change));
    store.appendRun(bot.id, { status: "completed", output: "x" });
    store.saveSession(bot.id, "tool-loop", { id: "s" });
    store.setSettings({ autoLeads: false });
    store.setTeamSettings("7", { leadEnabled: false });
    assert.deepEqual(seen, []);
  });

  it("deleting a missing bot doesn't fire", () => {
    const { store } = freshStore();
    const seen = [];
    store.onChange((c) => seen.push(c));
    store.delete("bot_missing");
    assert.deepEqual(seen, []);
  });

  it("unsubscribes, and a throwing listener can't break a save", () => {
    const { store } = freshStore();
    const seen = [];
    store.onChange(() => {
      throw new Error("listener bug");
    });
    const off = store.onChange((c) => seen.push(c.type));
    const bot = store.create(validDef);
    off();
    store.update(bot.id, { name: "x" });
    assert.deepEqual(seen, ["created"]);
    assert.equal(store.get(bot.id).name, "x");
  });
});

// Latest results a bot sent (team-dashboards TD-002).
describe("BotStore — latest results", () => {
  const { createSecretBox } = require("./secretBox");
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("X" + s, "utf8"),
    decryptString: (b) => b.toString("utf8").slice(1),
  };
  const payload = (n) => ({ name: "emails", items: [{ title: `mail ${n}` }] });

  it("keeps only the latest result per name and survives a restart", () => {
    const { store, persistence, root } = freshStore();
    const bot = store.create(validDef);
    assert.equal(store.getResult(bot.id, "emails"), null);
    store.setResult(bot.id, "emails", payload(1));
    store.setResult(bot.id, "emails", payload(2));
    store.setResult(bot.id, "digest", { name: "digest", items: [] });
    const again = new BotStore({ persistence, paths: { botsRoot: root } });
    assert.deepEqual(again.getResult(bot.id, "emails"), payload(2));
    assert.deepEqual(again.getResult(bot.id, "digest").items, []);
  });

  it("refuses a result for an unknown bot", () => {
    const { store } = freshStore();
    assert.throws(() => store.setResult("bot_nope", "x", {}), /no bot/);
  });

  it("deletes a bot's results with the bot", () => {
    const { store, persistence } = freshStore();
    const bot = store.create(validDef);
    store.setResult(bot.id, "emails", payload(1));
    store.delete(bot.id);
    assert.equal(persistence._blob().results[bot.id], undefined);
    assert.equal(store.getResult(bot.id, "emails"), null);
  });

  it("seals results at rest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
    tmpRoots.push(root);
    const persistence = memPersistence();
    const store = new BotStore({
      persistence,
      paths: { botsRoot: root },
      secretBox: createSecretBox(crypto),
    });
    const bot = store.create(validDef);
    store.setResult(bot.id, "emails", payload(1));
    const raw = persistence._blob().results[bot.id].emails;
    assert.ok(raw.startsWith("enc:v1:"));
    assert.ok(!raw.includes("mail 1"));
    assert.deepEqual(store.getResult(bot.id, "emails"), payload(1));
  });
});

// Events waiting for paused bots (bot-factory US-011 AC8).
describe("BotStore — paused-bot event queue", () => {
  const { createSecretBox } = require("./secretBox");
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from("X" + s, "utf8"),
    decryptString: (b) => b.toString("utf8").slice(1),
  };
  const queue = { b1: { A: { key: "A", event: { content: "secret mail" } } } };

  it("saves and reads it back, sealed at rest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "botstore-test-"));
    tmpRoots.push(root);
    const persistence = memPersistence();
    const store = new BotStore({
      persistence,
      paths: { botsRoot: root },
      secretBox: createSecretBox(crypto),
    });
    assert.equal(store.getPausedQueue(), null);
    store.setPausedQueue(queue);
    const raw = persistence._blob().pausedQueue;
    assert.ok(raw.startsWith("enc:v1:"));
    assert.ok(!raw.includes("secret mail"));
    assert.deepEqual(store.getPausedQueue(), queue);
  });

  it("survives a restart", () => {
    const { store, persistence, root } = freshStore();
    store.setPausedQueue(queue);
    const again = new BotStore({ persistence, paths: { botsRoot: root } });
    assert.deepEqual(again.getPausedQueue(), queue);
  });
});
