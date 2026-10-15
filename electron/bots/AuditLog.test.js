/**
 * AuditLog.test.js — the bots' saved audit log: append, rotate, read with
 * filters and paging, and which gate decisions are logged.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAuditLog, fromGateEntry, kindOf } = require("./AuditLog");

let dir;
let file;
let t;
const now = () => new Date(Date.UTC(2026, 9, 15, 12, 0, t++)).toISOString();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  file = path.join(dir, "bots", "audit.log");
  t = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("AuditLog", () => {
  it("appends one JSON line per entry, with id, time and kind", () => {
    const log = createAuditLog({ file, now });
    const saved = log.append({ type: "pause-bot", botId: "b1", botName: "W" });
    assert.equal(saved.kind, "pause");
    assert.equal(saved.at, "2026-10-15T12:00:00.000Z");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), saved);
  });

  it("ignores unknown types and empty entries", () => {
    const log = createAuditLog({ file, now });
    assert.equal(log.append({ type: "usage", cost: 1 }), null);
    assert.equal(log.append(null), null);
    assert.equal(fs.existsSync(file), false);
  });

  it("reads newest first", () => {
    const log = createAuditLog({ file, now });
    log.append({ type: "pause-bot", botId: "b1" });
    log.append({ type: "resume-bot", botId: "b1" });
    const { entries, more } = log.read();
    assert.deepEqual(
      entries.map((e) => e.type),
      ["resume-bot", "pause-bot"],
    );
    assert.equal(more, false);
  });

  it("filters by bot and kind", () => {
    const log = createAuditLog({ file, now });
    log.append({ type: "pause-bot", botId: "b1" });
    log.append({ type: "budget-override", botId: "b1" });
    log.append({ type: "pause-bot", botId: "b2" });
    log.append({ type: "pause-all" });
    assert.deepEqual(
      log.read({ botIds: ["b1"] }).entries.map((e) => e.type),
      ["budget-override", "pause-bot"],
    );
    assert.deepEqual(
      log.read({ kinds: ["pause"] }).entries.map((e) => e.type),
      ["pause-all", "pause-bot", "pause-bot"],
    );
    assert.deepEqual(
      log.read({ botIds: ["b1"], kinds: ["budgets"] }).entries.length,
      1,
    );
  });

  it("pages back with `before`", () => {
    const log = createAuditLog({ file, now });
    for (let i = 0; i < 5; i++)
      log.append({ type: "pause-bot", botId: `b${i}` });
    const first = log.read({ limit: 2 });
    assert.deepEqual(
      first.entries.map((e) => e.botId),
      ["b4", "b3"],
    );
    assert.equal(first.more, true);
    const next = log.read({ limit: 2, before: first.entries[1].id });
    assert.deepEqual(
      next.entries.map((e) => e.botId),
      ["b2", "b1"],
    );
    const last = log.read({ limit: 2, before: next.entries[1].id });
    assert.deepEqual(
      last.entries.map((e) => e.botId),
      ["b0"],
    );
    assert.equal(last.more, false);
  });

  it("rotates past maxBytes, keeping one older file", () => {
    const log = createAuditLog({ file, now, maxBytes: 300 });
    for (let i = 0; i < 12; i++)
      log.append({ type: "pause-bot", botId: `b${i}` });
    assert.ok(fs.existsSync(`${file}.1`));
    assert.ok(fs.statSync(file).size <= 300);
    const ids = log.read({ limit: 500 }).entries.map((e) => e.botId);
    // Newest kept, oldest dropped, still in order.
    assert.equal(ids[0], "b11");
    assert.ok(ids.length < 12);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))),
    );
  });

  it("survives a restart and skips a torn last line", () => {
    createAuditLog({ file, now }).append({ type: "pause-all" });
    fs.appendFileSync(file, '{"id":"x","type":"pa');
    const again = createAuditLog({ file, now });
    again.append({ type: "resume-all" });
    assert.deepEqual(
      again.read().entries.map((e) => e.type),
      ["resume-all", "pause-all"],
    );
  });

  it("reports a write failure instead of throwing", () => {
    const errors = [];
    const log = createAuditLog({
      file,
      now,
      fs: {
        ...fs,
        appendFileSync: () => {
          throw new Error("disk full");
        },
      },
      onError: (e) => errors.push(e.message),
    });
    assert.equal(log.append({ type: "pause-all" }), null);
    assert.deepEqual(errors, ["disk full"]);
  });
});

describe("fromGateEntry", () => {
  const base = { botId: "b1", toolName: "search", serverName: "Gmail" };

  it("logs tools that ran or were refused without asking", () => {
    assert.deepEqual(fromGateEntry({ ...base, outcome: "read-only" }), {
      type: "ran-read-only",
      botId: "b1",
      tool: "search",
      provider: "Gmail",
    });
    assert.equal(
      fromGateEntry({ ...base, outcome: "granted" }).type,
      "ran-granted",
    );
    assert.equal(
      fromGateEntry({ ...base, outcome: "policy-allow" }).type,
      "ran-policy",
    );
    assert.equal(
      fromGateEntry({ ...base, outcome: "auto-allowed" }).type,
      "ran-preapproved",
    );
    assert.equal(
      fromGateEntry({ ...base, outcome: "denied-unconfigured" }).type,
      "refused-unconfigured",
    );
    assert.equal(
      fromGateEntry({ ...base, outcome: "paused" }).type,
      "refused-paused",
    );
  });

  it("skips internal tools and approvals (logged where they're created)", () => {
    for (const outcome of ["internal", "pending", "approved", "denied"]) {
      assert.equal(fromGateEntry({ ...base, outcome }), null, outcome);
    }
  });

  it("never copies the tool's input", () => {
    const e = fromGateEntry({
      ...base,
      outcome: "granted",
      input: { to: "x" },
    });
    assert.equal("input" in e, false);
  });

  it("keeps the run's start time", () => {
    const e = fromGateEntry({
      ...base,
      outcome: "granted",
      runStartedAt: "2026-10-15T10:00:00.000Z",
    });
    assert.equal(e.runStartedAt, "2026-10-15T10:00:00.000Z");
  });

  it("every logged type has a kind", () => {
    assert.equal(kindOf("ran-granted"), "auto");
    assert.equal(kindOf("usage"), null);
  });
});
