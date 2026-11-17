/**
 * toolCall.test.js — a tool call check (frame 20): only a tool that can't
 * change anything is called, with inputs from the record; rules on the
 * answer decide — including that CI ran on the Builder's commit, not an
 * older one.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runToolCall, READ_NAME } = require("./toolCall");

const input = {
  input: { pr: 1043, commit: "7c41e09" },
  from: { ticketReader: { owner: "acme", repo: "app" } },
};

const check = {
  server: "GitHub",
  tool: "get_pull_request_status",
  args: {
    owner: { field: "from.ticketReader.owner" },
    repo: { field: "from.ticketReader.repo" },
    pullNumber: { field: "input.pr" },
  },
  answerRules: [
    { path: "state", op: "equals", value: "success" },
    { path: "sha", op: "equals", ref: "input.commit" },
  ],
};

describe("runToolCall", () => {
  it("calls the tool with inputs from the record and passes when every rule holds", async () => {
    let called = null;
    const r = await runToolCall(check, input, {
      isReadOnly: () => true,
      callTool: async (server, tool, args) => {
        called = { server, tool, args };
        return { text: JSON.stringify({ state: "success", sha: "7c41e09" }) };
      },
    });
    assert.deepEqual(called.args, {
      owner: "acme",
      repo: "app",
      pullNumber: 1043,
    });
    assert.equal(r.pass, true);
  });

  it("fails when CI ran on an older commit", async () => {
    const r = await runToolCall(check, input, {
      isReadOnly: () => true,
      callTool: async () => ({
        text: JSON.stringify({ state: "success", sha: "0ld5ha" }),
      }),
    });
    assert.equal(r.pass, false);
    assert.match(r.reason, /sha equals 7c41e09, but it's 0ld5ha/);
  });

  it("never calls a tool that could change something", async () => {
    let called = false;
    const r = await runToolCall(
      { ...check, tool: "merge_pull_request" },
      input,
      {
        isReadOnly: () => false,
        callTool: async () => {
          called = true;
          return {};
        },
      },
    );
    assert.equal(called, false);
    assert.equal(r.pass, false);
    assert.match(r.reason, /could change something/);
  });

  it("an error answer fails", async () => {
    const r = await runToolCall(check, input, {
      isReadOnly: () => true,
      callTool: async () => ({ isError: true, text: "Not Found" }),
    });
    assert.equal(r.pass, false);
    assert.match(r.reason, /Not Found/);
  });
});

describe("READ_NAME", () => {
  it("knows reading names from changing ones", () => {
    for (const n of [
      "get_pull_request",
      "list_issues",
      "search_code",
      "getEvents",
      "read_file",
    ]) {
      assert.ok(READ_NAME.test(n), n);
    }
    for (const n of [
      "merge_pull_request",
      "create_issue",
      "send_email",
      "delete_file",
    ]) {
      assert.ok(!READ_NAME.test(n), n);
    }
  });
});
