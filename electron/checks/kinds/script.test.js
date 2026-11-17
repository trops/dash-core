/**
 * script.test.js — a script check runs sealed off (frame 19; G17): it gets
 * its input and returns { pass, reason, details }; a script that tries to
 * reach the internet or write a file is stopped and the check fails with
 * the reason; a hang is stopped at the time limit.
 *
 * The network is taken away in two layers — code generation is off, so
 * the usual way out of the sandbox fails, and the runner blocks the network
 * modules for anything that still gets out. The second layer is tested by
 * running the runner with code generation left on.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { runScript, runnerPath, permissionFlag } = require("./script");

const input = {
  input: { text: "Spring sale hours and the garden" },
  from: {
    notes: [
      { title: "Spring sale hours" },
      { title: "garden" },
      { title: "Opening times" },
    ],
  },
};

const EVERY_NOTE = `function check({ input, from }) {
  const missing = from.notes.filter((n) => !input.text.includes(n.title));
  return {
    pass: missing.length === 0,
    reason: missing.length ? "Notes not used: " + missing.length : "Every note is used",
    details: missing.map((n) => n.title),
  };
}`;

describe("runScript", () => {
  it("runs the function on its input", async () => {
    const r = await runScript({ script: EVERY_NOTE }, input);
    assert.equal(r.pass, false);
    assert.equal(r.reason, "Notes not used: 1");
    assert.deepEqual(r.details, ["Opening times"]);
  });

  it("a script that reaches for the internet fails, saying why", async () => {
    const r = await runScript(
      {
        script: `function check() {
          const p = this.constructor.constructor("return process")();
          p.mainModule.require("https").get("https://example.com");
          return { pass: true };
        }`,
      },
      input,
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /sealed box|internet/);
  });

  it("a script that tries to write a file fails, and nothing is written", async () => {
    const target = path.join(os.tmpdir(), `dash-escape-${process.pid}.txt`);
    const r = await runScript(
      {
        script: `function check() {
          const p = this.constructor.constructor("return process")();
          p.mainModule.require("fs").writeFileSync(${JSON.stringify(target)}, "x");
          return { pass: true };
        }`,
      },
      input,
    );
    assert.equal(r.pass, false);
    assert.equal(fs.existsSync(target), false);
  });

  it("no require, process or fetch inside the script", async () => {
    const r = await runScript(
      {
        script:
          "function check() { return { pass: typeof require === 'undefined' && typeof process === 'undefined' && typeof fetch === 'undefined', reason: 'sealed' }; }",
      },
      input,
    );
    assert.equal(r.pass, true);
  });

  it("a hang is stopped at its time limit", async () => {
    const r = await runScript(
      { script: "function check() { while (true) {} }", timeoutSec: 2 },
      input,
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /Stopped after|failed/);
  });

  it("a script that returns the wrong shape fails", async () => {
    const r = await runScript(
      { script: "function check() { return 42; }" },
      input,
    );
    assert.equal(r.pass, false);
    assert.match(r.reason, /must return/);
  });
});

describe("the runner's own network block (second layer)", () => {
  it("can't load the network modules even when code gets out", () => {
    const file = runnerPath(os.tmpdir());
    const job = JSON.stringify({
      source: `function check() {
        const p = this.constructor.constructor("return process")();
        try { p.mainModule.require("https"); return { pass: true, reason: "loaded" }; }
        catch (e) { return { pass: false, reason: e.message }; }
      }`,
      input: {},
    });
    // Code generation left ON: the escape works, the module block must hold.
    const out = spawnSync(
      process.execPath,
      [permissionFlag(), `--allow-fs-read=${file}`, file],
      { input: job, encoding: "utf8" },
    );
    const line = out.stdout
      .split("\n")
      .find((l) => l.startsWith("DASH_RESULT "));
    const res = JSON.parse(line.slice("DASH_RESULT ".length));
    assert.equal(res.pass, false);
    assert.match(res.reason, /No internet in a script check/);
  });

  it("fetch is gone from the process too", () => {
    const file = runnerPath(os.tmpdir());
    const job = JSON.stringify({
      source: `function check() {
        const g = this.constructor.constructor("return globalThis")();
        try { g.fetch("https://example.com"); return { pass: true, reason: "fetched" }; }
        catch (e) { return { pass: false, reason: e.message }; }
      }`,
      input: {},
    });
    const out = spawnSync(
      process.execPath,
      [permissionFlag(), `--allow-fs-read=${file}`, file],
      {
        input: job,
        encoding: "utf8",
      },
    );
    const line = out.stdout
      .split("\n")
      .find((l) => l.startsWith("DASH_RESULT "));
    const res = JSON.parse(line.slice("DASH_RESULT ".length));
    assert.equal(res.pass, false);
    assert.match(res.reason, /No internet/);
  });
});
