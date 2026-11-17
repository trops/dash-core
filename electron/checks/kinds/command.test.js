/**
 * command.test.js — a command check (frame 18): the step's input arrives
 * as the same JSON on standard input and in $DASH_INPUT; exit code 0
 * passes; a {"reason","details"} last line is the proof; always-blocked
 * commands never run; a hang is stopped.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runCommand, proofLine } = require("./command");

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-cmd-test-"));
  // Echoes back what it got both ways, then passes or fails on input.ok.
  fs.writeFileSync(
    path.join(dir, "check.js"),
    [
      'const fs = require("fs");',
      'let stdin = "";',
      'process.stdin.on("data", (d) => (stdin += d));',
      'process.stdin.on("end", () => {',
      '  const file = fs.readFileSync(process.env.DASH_INPUT, "utf8");',
      "  const input = JSON.parse(file);",
      '  console.log(JSON.stringify({ reason: input.input.ok ? "fine" : "not fine", details: { same: stdin === file } }));',
      "  process.exit(input.input.ok ? 0 : 1);",
      "});",
    ].join("\n"),
  );
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("runCommand", () => {
  it("gets the same JSON on stdin and in $DASH_INPUT; exit 0 passes", async () => {
    const r = await runCommand(
      { command: "node check.js" },
      { input: { ok: true } },
      { cwd: dir },
    );
    assert.equal(r.pass, true);
    assert.equal(r.reason, "fine");
    assert.deepEqual(r.details, { same: true });
    assert.equal(r.exitCode, 0);
  });

  it("a non-zero exit fails, with its proof line", async () => {
    const r = await runCommand(
      { command: "node check.js" },
      { input: { ok: false } },
      { cwd: dir },
    );
    assert.equal(r.pass, false);
    assert.equal(r.reason, "not fine");
    assert.equal(r.exitCode, 1);
  });

  it("passes on what its output contains, when set", async () => {
    const r = await runCommand(
      {
        command: "echo all good",
        passWhen: { type: "contains", text: "good" },
      },
      {},
      { cwd: dir },
    );
    assert.equal(r.pass, true);
  });

  it("never runs an always-blocked command", async () => {
    const r = await runCommand(
      { command: "git push --force" },
      {},
      { cwd: dir },
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /always blocked/);
  });

  it("is stopped at its time limit", async () => {
    const r = await runCommand(
      { command: 'node -e "setTimeout(() => {}, 60000)"', timeoutSec: 1 },
      {},
      { cwd: dir },
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /Stopped after 1 seconds/);
  });

  it("a folder that isn't there fails before anything runs", async () => {
    const r = await runCommand(
      { command: "ls" },
      {},
      { cwd: path.join(dir, "nope") },
    );
    assert.equal(r.pass, false);
  });

  it("proofLine reads the last JSON line only", () => {
    assert.deepEqual(proofLine('hello\n{"reason":"x"}\n'), { reason: "x" });
    assert.equal(proofLine("no json here"), null);
  });
});
