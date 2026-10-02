/**
 * mcpStartError.test.js — when an MCP server fails to start, say why (from
 * its own stderr) instead of "MCP error -32000: Connection closed".
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { describeStartFailure, StderrTail } = require("./mcpStartError");

const CLOSED = "MCP error -32000: Connection closed";
const NEXT = "Check its settings in Settings › Providers.";

// What the Slack MCP server printed in the live repro.
const SLACK_STDERR = [
  '{"level":"fatal","timestamp":"2026-10-02T13:50:54-04:00","message":"Authentication required: Either SLACK_MCP_XOXP_TOKEN, SLACK_MCP_XOXB_TOKEN, or both SLACK_MCP_XOXC_TOKEN and SLACK_MCP_XOXD_TOKEN must be provided","app":"slack-mcp-server"}',
  "node:child_process:955",
  "    throw err;",
  "    ^",
  "",
  "Error: Command failed: /Users/x/.npm/_npx/0eb/node_modules/slack-mcp-server-darwin-amd64/bin/slack-mcp-server-darwin-amd64",
  "    at genericNodeError (node:internal/errors:983:15)",
  "    at checkExecSyncError (node:child_process:916:11)",
  "Node.js v22.22.1",
].join("\n");

describe("describeStartFailure", () => {
  it("uses a JSON log line's message (Slack's missing token)", () => {
    assert.equal(
      describeStartFailure({
        serverName: "Slack",
        message: CLOSED,
        stderr: SLACK_STDERR,
      }),
      "Slack couldn't start: Authentication required: Either SLACK_MCP_XOXP_TOKEN, SLACK_MCP_XOXB_TOKEN, or both SLACK_MCP_XOXC_TOKEN and SLACK_MCP_XOXD_TOKEN must be provided. " +
        NEXT,
    );
  });

  it("picks the last error-looking plain line and skips stack frames", () => {
    const stderr = [
      "Starting server...",
      "Error: GITHUB_PERSONAL_ACCESS_TOKEN environment variable is missing",
      "    at Object.<anonymous> (/x/index.js:12:9)",
      "    at node:internal/main/run_main_module:28:49",
    ].join("\n");
    assert.equal(
      describeStartFailure({ serverName: "GitHub", message: CLOSED, stderr }),
      "GitHub couldn't start: GITHUB_PERSONAL_ACCESS_TOKEN environment variable is missing. " +
        NEXT,
    );
  });

  // Fake tokens are assembled at runtime so the source never contains a
  // token-shaped string (GitHub push protection rejects those, fake or not).
  const fake = (...parts) => parts.join("");

  it("redacts token-looking values", () => {
    const slackToken = fake("xo", "xb-", "1234567890-", "abcdefghijklmnop");
    const stderr = `Error: invalid token ${slackToken} for workspace`;
    const msg = describeStartFailure({
      serverName: "Slack",
      message: CLOSED,
      stderr,
    });
    assert.ok(!msg.includes(slackToken));
    assert.match(msg, /invalid token \[redacted\] for workspace/);
    for (const secret of [
      fake("sk", "-ant-api03-", "AbCdEfGhIjKlMnOpQrStUv"),
      fake("gh", "p_", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"),
      fake("Bearer ", "eyJhbGciOiJIUzI1NiJ9", ".payload.sig"),
      fake("token=", "AbCdEfGhIjKlMnOpQrStUv", "WxYz0123456789abcd"),
    ]) {
      const out = describeStartFailure({
        serverName: "X",
        message: CLOSED,
        stderr: `Error: failed with ${secret}`,
      });
      assert.ok(!out.includes(secret.split(/[ =]/).pop()), secret);
    }
  });

  it("truncates a very long reason", () => {
    const msg = describeStartFailure({
      serverName: "X",
      message: CLOSED,
      stderr: "Error: " + "word ".repeat(200),
    });
    assert.ok(msg.length < 420, String(msg.length));
    assert.match(msg, /…/);
  });

  it("falls back to a plain explanation when stderr says nothing useful", () => {
    for (const stderr of ["", "Starting...\nListening on stdio", null]) {
      assert.equal(
        describeStartFailure({ serverName: "Notion", message: CLOSED, stderr }),
        "Notion couldn't start (it closed the connection). " + NEXT,
      );
    }
  });

  it("leaves specific errors alone", () => {
    const message = "spawn uvx ENOENT";
    assert.equal(
      describeStartFailure({
        serverName: "Fetch",
        message,
        stderr: SLACK_STDERR,
      }),
      message,
    );
  });
});

describe("StderrTail", () => {
  it("keeps only the last bytes", () => {
    const t = new StderrTail(10);
    t.push("abcdef");
    t.push("ghijklmnop");
    assert.equal(t.text(), "ghijklmnop");
    t.push(Buffer.from("XYZ"));
    assert.equal(t.text(), "jklmnopXYZ");
  });
});
