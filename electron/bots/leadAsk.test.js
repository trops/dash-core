/**
 * leadAsk.test.js — team_ask_bot's run (lead-workspace release 1): the
 * asked bot runs as asked by the lead, always asking before it changes
 * anything; the hand-off cap, a long wait, and an outside caller.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { askTeamBot, LEAD_ASK_WAIT_MS } = require("./leadAsk");

const lead = { id: "lead_7", name: "Kitchen Sink Lead" };
const member = { id: "b1", name: "Inbox Watch" };

function setup(over = {}) {
  const calls = [];
  const tracked = [];
  return {
    calls,
    tracked,
    args: {
      lead,
      member,
      request: "Anything urgent since 9:00?",
      takeHandoff: () => true,
      run: async (opts) => {
        calls.push(opts);
        return { status: "completed", output: "2 need attention" };
      },
      track: (p) => tracked.push(p),
      ...over,
    },
  };
}

describe("askTeamBot", () => {
  it("runs the bot as asked by the lead, and always asks before changing anything", async () => {
    const { args, calls, tracked } = setup();
    const res = await askTeamBot(args);
    assert.deepEqual(res, { status: "completed", output: "2 need attention" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].trigger, "ask");
    assert.equal(calls[0].via, "lead:lead_7");
    // Whatever the bot's own setting: the request came through the lead.
    assert.equal(calls[0].approvalPolicy, "ask");
    assert.match(calls[0].prompt, /^Anything urgent since 9:00\?/);
    assert.match(calls[0].prompt, /Asked by Kitchen Sink Lead, the team lead/);
    // The controller is told, so stopping the lead stops this run.
    assert.equal(tracked.length, 1);
  });

  it("over the lead's hand-offs for this answer: nothing runs", async () => {
    const { args, calls } = setup({ takeHandoff: () => false });
    const res = await askTeamBot(args);
    assert.equal(res.skipped, true);
    assert.match(res.reason, /as many times as one answer allows/);
    assert.equal(calls.length, 0);
  });

  it("a lead asked from outside Dash (MCP) can't run its bots", async () => {
    let counted = false;
    const { args, calls } = setup({
      leadVia: "mcp",
      takeHandoff: () => {
        counted = true;
        return true;
      },
    });
    const res = await askTeamBot(args);
    assert.equal(res.skipped, true);
    assert.match(res.reason, /from outside Dash/);
    assert.equal(calls.length, 0);
    assert.equal(counted, false);
  });

  it("asked from Dash (no via, or Create) it runs", async () => {
    for (const leadVia of [null, "create"]) {
      const { args, calls } = setup({ leadVia });
      await askTeamBot(args);
      assert.equal(calls.length, 1, String(leadVia));
    }
  });

  it("still going after the wait (an approval, usually): pending, and the run carries on", async () => {
    let finish;
    const { args } = setup({
      run: () => new Promise((r) => (finish = r)),
      waitMs: 20,
    });
    const res = await askTeamBot(args);
    assert.deepEqual(res, { pending: true });
    finish({ status: "completed" }); // finishes on its own afterwards
  });

  it("skipped and failed runs come back as they are", async () => {
    for (const record of [
      { skipped: true, reason: "over budget" },
      { status: "failed", error: "Gmail token expired" },
    ]) {
      const { args } = setup({ run: async () => record });
      assert.deepEqual(await askTeamBot(args), record);
    }
  });

  it("waits three minutes by default", () => {
    assert.equal(LEAD_ASK_WAIT_MS, 180000);
  });
});
