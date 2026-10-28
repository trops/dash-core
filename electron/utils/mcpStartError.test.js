/**
 * mcpStartError.test.js — when an MCP server fails to start, say why (from
 * its own stderr) instead of "MCP error -32000: Connection closed".
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  describeStartFailure,
  describeNetworkFailure,
  isLocalNetworkHost,
  StderrTail,
} = require("./mcpStartError");

const CLOSED = "MCP error -32000: Connection closed";
const NEXT = "Check its settings on the Providers page.";

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

describe("a remote server that couldn't be reached", () => {
  // What Node's fetch throws: "fetch failed", the reason in `cause`.
  const failed = (code, message) => {
    const e = new TypeError("fetch failed");
    e.cause = Object.assign(new Error(message || `connect ${code}`), { code });
    return e;
  };
  const url = "http://10.0.0.107:9583/private_SECRETPATHTOKEN123";

  it("a local-network address out of reach on a Mac: macOS blocking Dash, or the device off — says both, and the fix", () => {
    const r = describeNetworkFailure(failed("EHOSTUNREACH"), url, "darwin");
    assert.equal(r.fix, "local-network");
    assert.match(
      r.message,
      /Dash couldn't reach 10\.0\.0\.107:9583 on your local network/,
    );
    assert.match(r.message, /check that the device is on/);
    assert.equal(
      describeNetworkFailure(failed("EHOSTDOWN"), url, "darwin").fix,
      "local-network",
    );
    assert.match(r.message, /Privacy & Security › Local Network/);
    // Never the path (it can hold the server's key).
    assert.equal(r.message.includes("private_"), false);
  });

  it("elsewhere, or not a local address: just unreachable", () => {
    assert.equal(
      describeNetworkFailure(failed("EHOSTUNREACH"), url, "linux").fix,
      undefined,
    );
    assert.equal(
      describeNetworkFailure(
        failed("EHOSTUNREACH"),
        "http://example.com/mcp",
        "darwin",
      ).fix,
      undefined,
    );
  });

  it("refused, not found, timed out, reset, certificate", () => {
    const text = (code) =>
      describeNetworkFailure(failed(code), url, "darwin").message;
    assert.match(
      text("ECONNREFUSED"),
      /Nothing is answering at 10\.0\.0\.107:9583/,
    );
    assert.match(text("ENOTFOUND"), /Couldn't find/);
    assert.match(text("UND_ERR_CONNECT_TIMEOUT"), /didn't answer in time/);
    assert.match(text("ECONNRESET"), /closed the connection/);
    assert.match(
      text("SELF_SIGNED_CERT_IN_CHAIN"),
      /certificate isn't trusted/,
    );
  });

  it("not a network error: the caller keeps its own message", () => {
    assert.equal(
      describeNetworkFailure(new Error("HTTP 401"), url, "darwin"),
      null,
    );
  });

  it("local network addresses", () => {
    for (const h of [
      "10.0.0.107",
      "192.168.1.20",
      "172.20.0.5",
      "169.254.1.1",
      "homeassistant.local",
    ]) {
      assert.equal(isLocalNetworkHost(h), true, h);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "example.com"]) {
      assert.equal(isLocalNetworkHost(h), false, h);
    }
  });

  it("the reason further down: nested causes, and IPv4 and IPv6 tried at once", () => {
    const deep = new TypeError("fetch failed");
    deep.cause = new Error("wrapper");
    deep.cause.cause = Object.assign(new Error("connect EHOSTUNREACH"), {
      code: "EHOSTUNREACH",
    });
    assert.equal(
      describeNetworkFailure(deep, url, "darwin").fix,
      "local-network",
    );
    const both = new TypeError("fetch failed");
    both.cause = Object.assign(
      new AggregateError(
        [
          Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
          Object.assign(new Error("connect EHOSTUNREACH"), {
            code: "EHOSTUNREACH",
          }),
        ],
        "",
      ),
      { code: "ETIMEDOUT" },
    );
    assert.equal(
      describeNetworkFailure(both, "http://hass.local:8123/mcp", "darwin").fix,
      "local-network",
    );
  });

  it("the server answered: its own words, never read as a network failure", () => {
    const http = Object.assign(
      new Error("Error POSTing to endpoint: upstream connect ECONNREFUSED"),
      { code: 502 },
    );
    assert.equal(describeNetworkFailure(http, url, "darwin"), null);
    assert.equal(
      describeNetworkFailure(
        new Error("socket hang up in the reply"),
        url,
        "darwin",
      ),
      null,
    );
  });

  it("a public address out of reach isn't a local-network problem", () => {
    const r = describeNetworkFailure(
      failed("EHOSTUNREACH"),
      "http://93.184.216.34/mcp",
      "darwin",
    );
    assert.equal(r.fix, undefined);
    assert.match(r.message, /Couldn't reach 93\.184\.216\.34/);
  });

  it("IPv6 and names: only real local addresses", () => {
    for (const h of [
      "fd00::1",
      "[fe80::1]",
      "::ffff:a00:1",
      "::ffff:192.168.1.5",
    ]) {
      assert.equal(isLocalNetworkHost(h), true, h);
    }
    for (const h of [
      "fdic.gov",
      "fc.example.com",
      "fe80.example.com",
      "2001:db8::1",
      "::ffff:808:808",
    ]) {
      assert.equal(isLocalNetworkHost(h), false, h);
    }
  });
});
