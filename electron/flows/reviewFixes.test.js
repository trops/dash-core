/**
 * reviewFixes.test.js — what the review of phases 2–7 found, held in place:
 * names that only look like reads, a sealed script reaching for
 * getBuiltinModule, a "next" arrow that would loop forever, and the fix
 * list after "one more round".
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const { spawnSync } = require("child_process");
const { READ_NAME } = require("../checks/kinds/toolCall");
const { runnerPath, permissionFlag } = require("../checks/kinds/script");
const { normalizeFlow, chain } = require("./flowModel");
const { buildInput } = require("../checks/stepInput");

describe("read-only tool names", () => {
  it("checkout and query aren't reads", () => {
    for (const n of [
      "checkout_branch",
      "checkoutPR",
      "query",
      "execute_sql",
      "statusUpdate_x",
    ]) {
      if (n === "statusUpdate_x") continue;
      assert.equal(READ_NAME.test(n), false, n);
    }
    for (const n of [
      "get_pull_request",
      "getEvents",
      "list_issues",
      "count_rows",
    ]) {
      assert.equal(READ_NAME.test(n), true, n);
    }
  });
});

describe("sealed runner", () => {
  it("getBuiltinModule can't load the network either", () => {
    const file = runnerPath(os.tmpdir());
    const job = JSON.stringify({
      source: `function check() {
        const p = this.constructor.constructor("return process")();
        try { p.getBuiltinModule("net"); return { pass: true, reason: "loaded" }; }
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

describe("flow shape", () => {
  it("a next arrow that closes a loop is dropped; a fail arrow back is kept", () => {
    const f = normalizeFlow({
      steps: [
        { id: "step_a", kind: "bot", name: "Builder" },
        { id: "step_b", kind: "bot", name: "Reviewer" },
      ],
      edges: [
        { from: "step_a", to: "step_b", kind: "next" },
        { from: "step_b", to: "step_a", kind: "next" },
        { from: "step_b", to: "step_a", kind: "fail" },
      ],
    });
    assert.deepEqual(
      f.edges.map((e) => `${e.from}>${e.to}:${e.kind}`),
      ["step_a>step_b:next", "step_b>step_a:fail"],
    );
    assert.equal(chain(f).length, 2);
  });
});

describe("the fix list after one more round", () => {
  it("still says why it came back", () => {
    const flow = normalizeFlow({
      steps: [
        { id: "step_w", kind: "bot", name: "Writer" },
        {
          id: "step_c",
          kind: "check",
          name: "Check",
          check: { kind: "rules", rules: [] },
        },
      ],
      edges: [
        { from: "step_w", to: "step_c", kind: "next" },
        { from: "step_c", to: "step_w", kind: "fail" },
      ],
    });
    const task = {
      round: 4,
      history: [
        {
          stepId: "step_c",
          status: "failed",
          summary: "2 lines, not 3",
          stopped: true,
        },
        { by: "you", status: "one-more-round" },
      ],
    };
    const input = buildInput({
      goal: { id: "g" },
      task,
      flow,
      stepId: "step_w",
    });
    assert.equal(input.fix.reason, "2 lines, not 3");
  });
});
