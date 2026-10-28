/**
 * profileAutoSave.test.js — auto-save to the account: the setting, when a
 * daily save is due, what a pass saves (only changed, only linked, never
 * over a newer copy) and the watcher's wait.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  getSettings,
  setSetting,
  recordManualSave,
  forgetProfile,
  lastOccurrence,
  dailyDue,
  runOnce,
  start,
  stop,
  exclusive,
  DEBOUNCE_MS,
  RETRY_MS,
} = require("./profileAutoSave");

const appId = "@test/app";

function deps(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-autosave-"));
  const calls = [];
  let now = over.now || new Date("2026-10-28T10:00:00");
  const d = {
    appId: () => appId,
    filePath: () => path.join(dir, "profileAutoSave.json"),
    owner: () => ("owner" in over ? over.owner : "Trops"),
    links: () => over.links || { mm: { accountId: "acc1", revision: 3 } },
    profileIds: () => ["default", "mm"],
    changed: () => ("changed" in over ? over.changed : true),
    save: async (win, a, profileId, options) => {
      calls.push(["save", profileId, options]);
      return over.saveResult || { success: true, account: { savedAt: "S" } };
    },
    now: () => now,
    ...over.deps,
  };
  return {
    d,
    calls,
    dir,
    setNow: (t) => (now = t),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("the setting", () => {
  it("Manually by default; set per user and profile; anything odd reads as Manually", () => {
    const { d, cleanup } = deps();
    assert.deepEqual(getSettings(appId, "trops", d), {});
    const s = setSetting(appId, "Trops", "mm", { mode: "changes" }, d);
    assert.equal(s.mode, "changes");
    // Owners match without case; someone else sees none.
    assert.equal(getSettings(appId, "trops", d).mm.mode, "changes");
    assert.deepEqual(getSettings(appId, "alice", d), {});
    assert.throws(
      () => setSetting(appId, "trops", "mm", { mode: "hourly" }, d),
      /Pick how/,
    );
    assert.throws(
      () => setSetting(appId, "trops", "mm", { mode: "daily", time: "9am" }, d),
      /Pick a time/,
    );
    fs.writeFileSync(
      d.filePath(),
      JSON.stringify({ trops: { mm: { mode: "x", time: 5 } } }),
    );
    assert.deepEqual(
      {
        mode: getSettings(appId, "trops", d).mm.mode,
        time: getSettings(appId, "trops", d).mm.time,
      },
      { mode: "manual", time: "09:00" },
    );
    cleanup();
  });

  it("a manual save records its choices and how it went; deleting a profile forgets it", () => {
    const { d, cleanup } = deps();
    recordManualSave(
      appId,
      "trops",
      "mm",
      { bots: false },
      { success: true, account: { savedAt: "T" } },
      d,
    );
    const s = getSettings(appId, "trops", d).mm;
    assert.deepEqual(s.options, { bots: false, settings: true });
    assert.equal(s.last.ok, true);
    assert.equal(s.last.savedAt, "T");
    forgetProfile(appId, "mm", d);
    assert.deepEqual(getSettings(appId, "trops", d), {});
    cleanup();
  });
});

describe("every day at a time", () => {
  const at = (s) => new Date(`2026-10-28T${s}`);
  it("the most recent time: today's once it's passed, else yesterday's", () => {
    assert.equal(lastOccurrence("09:00", at("10:00:00")).getDate(), 28);
    assert.equal(lastOccurrence("11:00", at("10:00:00")).getDate(), 27);
  });

  it("due once its time passes after it was set or last tried — and on the next launch if Dash was closed then", () => {
    const set = (since, last) => ({
      mode: "daily",
      time: "09:00",
      since,
      last,
    });
    // Set at 10:00 for 09:00: not until tomorrow.
    assert.equal(
      dailyDue(set(at("10:00:00").toISOString()), at("10:05:00")),
      false,
    );
    // Set yesterday, never tried: due.
    assert.equal(dailyDue(set("2026-10-27T08:00:00"), at("09:01:00")), true);
    // Tried at 09:01 today: not again today.
    assert.equal(
      dailyDue(
        set("2026-10-27T08:00:00", { at: at("09:01:00").toISOString() }),
        at("15:00:00"),
      ),
      false,
    );
    // Closed yesterday at 09:00 (last tried the day before): due at launch.
    assert.equal(
      dailyDue(
        set("2026-10-20T08:00:00", { at: "2026-10-26T09:01:00" }),
        at("08:00:00"),
      ),
      true,
    );
    assert.equal(dailyDue({ mode: "changes" }, at("10:00:00")), false);
  });
});

describe("a pass", () => {
  it("When I make changes: saves a changed profile, with the manual save's choices", async () => {
    const { d, calls, cleanup } = deps();
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    recordManualSave(
      appId,
      "trops",
      "mm",
      { bots: false },
      { success: true },
      d,
    );
    const res = await runOnce("change", () => null, d);
    assert.deepEqual(res, [{ profileId: "mm", saved: true }]);
    assert.deepEqual(calls[0], ["save", "mm", { bots: false, settings: true }]);
    assert.equal(getSettings(appId, "trops", d).mm.last.ok, true);
    // The daily tick doesn't save a "when I make changes" profile.
    assert.deepEqual(await runOnce("tick", () => null, d), []);
    cleanup();
  });

  it("nothing changed (a bot run, opening a dashboard): no save", async () => {
    const { d, calls, cleanup } = deps({ changed: false });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    assert.deepEqual(await runOnce("change", () => null, d), [
      { profileId: "mm", skipped: "unchanged" },
    ]);
    assert.equal(calls.length, 0);
    cleanup();
  });

  it("never over a newer copy: refused, and says what to do", async () => {
    const { d, cleanup } = deps({
      saveResult: {
        success: false,
        error: "Your account has a newer copy…",
        conflict: { revision: 5 },
      },
    });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    const res = await runOnce("change", () => null, d);
    assert.equal(res[0].error, "Your account has a newer copy…");
    const last = getSettings(appId, "trops", d).mm.last;
    assert.equal(last.ok, false);
    assert.match(last.error, /open Check for updates/);
    cleanup();
  });

  it("only profiles kept in the account, here, with auto-save on, and signed in", async () => {
    const { d, calls, cleanup } = deps({ links: {} });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    assert.deepEqual(await runOnce("change", () => null, d), []);
    const { d: d2, cleanup: c2 } = deps();
    setSetting(appId, "trops", "mm", { mode: "manual" }, d2);
    assert.deepEqual(await runOnce("change", () => null, d2), []);
    const { d: d3, cleanup: c3 } = deps({ owner: null });
    assert.deepEqual(await runOnce("change", () => null, d3), []);
    assert.equal(calls.length, 0);
    cleanup();
    c2();
    c3();
  });

  it("daily: saves when due, and only once that day", async () => {
    const { d, calls, setNow, cleanup } = deps({
      now: new Date("2026-10-27T08:00:00"),
    });
    setSetting(appId, "trops", "mm", { mode: "daily", time: "09:00" }, d);
    setNow(new Date("2026-10-27T09:00:30"));
    assert.deepEqual(await runOnce("tick", () => null, d), [
      { profileId: "mm", saved: true },
    ]);
    setNow(new Date("2026-10-27T09:01:30"));
    assert.deepEqual(await runOnce("tick", () => null, d), []);
    assert.equal(calls.length, 1);
    cleanup();
  });
});

describe("after a save that didn't go through", () => {
  it("the copy taken from the account (in step again): the old warning goes", async () => {
    const { d, cleanup } = deps({
      saveResult: { success: false, error: "x", conflict: { revision: 5 } },
    });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    await runOnce("change", () => null, d);
    assert.equal(getSettings(appId, "trops", d).mm.last.ok, false);
    // Later: nothing changed (the account's copy was loaded).
    d.changed = () => false;
    d.now = () => new Date(Date.now() + RETRY_MS + 1000);
    await runOnce("change", () => null, d);
    const last = getSettings(appId, "trops", d).mm.last;
    assert.equal(last.ok, true);
    assert.equal(last.error, undefined);
    cleanup();
  });

  it("waits before trying again; a daily save retries the same day after a network blip", async () => {
    const { d, calls, setNow, cleanup } = deps({
      now: new Date("2026-10-27T08:00:00"),
      saveResult: { success: false, error: "Couldn't reach the registry." },
    });
    setSetting(appId, "trops", "mm", { mode: "daily", time: "09:00" }, d);
    setNow(new Date("2026-10-27T09:00:30"));
    await runOnce("tick", () => null, d);
    assert.equal(getSettings(appId, "trops", d).mm.last.transient, true);
    setNow(new Date("2026-10-27T09:05:00"));
    await runOnce("tick", () => null, d);
    assert.equal(calls.length, 1);
    setNow(new Date("2026-10-27T09:16:00"));
    await runOnce("tick", () => null, d);
    assert.equal(calls.length, 2);
    cleanup();
  });

  it("a newer copy isn't a blip: a daily save waits for the next day", async () => {
    const { d, calls, setNow, cleanup } = deps({
      now: new Date("2026-10-27T08:00:00"),
      saveResult: { success: false, error: "x", conflict: { revision: 5 } },
    });
    setSetting(appId, "trops", "mm", { mode: "daily", time: "09:00" }, d);
    setNow(new Date("2026-10-27T09:00:30"));
    await runOnce("tick", () => null, d);
    setNow(new Date("2026-10-27T15:00:00"));
    await runOnce("tick", () => null, d);
    assert.equal(calls.length, 1);
    cleanup();
  });

  it("one profile's trouble doesn't stop the others", async () => {
    const { d, calls, cleanup } = deps({
      links: { mm: { accountId: "a" }, default: { accountId: "b" } },
    });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    setSetting(appId, "trops", "default", { mode: "changes" }, d);
    d.changed = (a, id) => {
      if (id === "mm") throw new Error("broken digest");
      return true;
    };
    const res = await runOnce("change", () => null, d);
    assert.deepEqual(
      res.map((r) => [r.profileId, !!r.saved, r.error || null]).sort(),
      [
        ["default", true, null],
        ["mm", false, "broken digest"],
      ],
    );
    assert.equal(calls.length, 1);
    cleanup();
  });

  it("a damaged settings file is kept aside, not silently overwritten", () => {
    const { d, cleanup } = deps();
    fs.writeFileSync(d.filePath(), "{ not json");
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    assert.equal(fs.readFileSync(`${d.filePath()}.bak`, "utf8"), "{ not json");
    assert.equal(getSettings(appId, "trops", d).mm.mode, "changes");
    cleanup();
  });
});

describe("one save at a time", () => {
  it("a manual save waits for an auto-save pass (and the other way round)", async () => {
    const order = [];
    let release;
    const first = exclusive(
      () =>
        new Promise((resolve) => {
          order.push("auto starts");
          release = () => {
            order.push("auto ends");
            resolve();
          };
        }),
    );
    const second = exclusive(async () => order.push("manual"));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, ["auto starts"]);
    release();
    await first;
    await second;
    assert.deepEqual(order, ["auto starts", "auto ends", "manual"]);
  });
});

describe("watching", () => {
  it("a change to a setup file saves after the wait; other files don't count", async () => {
    const timers = [];
    let onChange = null;
    let onError = null;
    const closed = [];
    const { d, cleanup } = deps({
      deps: {
        watchDirs: () => ["/app"],
        watch: (dir, fn) => {
          onChange = fn;
          return {
            close: () => closed.push(dir),
            on: (event, handler) => {
              if (event === "error") onError = handler;
            },
          };
        },
        setTimeout: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length;
        },
        clearTimeout: () => {},
        setInterval: () => 99,
        clearInterval: () => {},
      },
    });
    setSetting(appId, "trops", "mm", { mode: "changes" }, d);
    assert.equal(
      start(() => null, d),
      true,
    );
    const launch = timers.length;
    onChange("change", "dash-registry-auth.json");
    assert.equal(timers.length, launch);
    onChange("change", "workspaces.json");
    assert.equal(timers.length, launch + 1);
    assert.equal(timers[timers.length - 1].ms, DEBOUNCE_MS);
    // A watched folder removed: no crash, the watcher closes.
    assert.equal(typeof onError, "function");
    onError(new Error("ENOENT"));
    assert.deepEqual(closed, ["/app"]);
    // Stopped: a change still in flight schedules nothing.
    stop(d);
    const before = timers.length;
    onChange("change", "workspaces.json");
    assert.equal(timers.length, before);
    cleanup();
  });
});
