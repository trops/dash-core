/**
 * Static pins: stdio MCP servers' stderr is captured (and still logged), and
 * a failed start reports the server's own reason via describeStartFailure.
 * mcpController needs the MCP SDK (provided by dash-electron), so these
 * check the source.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ctrl = fs.readFileSync(path.join(__dirname, "mcpController.js"), "utf8");

describe("mcpController — start failure messages", () => {
  it("pipes stdio stderr into a bounded tail and still logs it", () => {
    assert.match(ctrl, /require\("\.\.\/utils\/mcpStartError"\)/);
    assert.match(
      ctrl,
      /new StdioClientTransport\(\{\s*command: resolved\.command,\s*args,\s*env: resolved\.env,\s*stderr: "pipe",\s*\}\)/,
    );
    assert.match(ctrl, /stderrTail = new StderrTail\(\)/);
    assert.match(
      ctrl,
      /transport\.stderr\.on\("data", \(chunk\) => \{\s*stderrTail\.push\(chunk\);\s*process\.stderr\.write\(chunk\);/,
    );
  });

  it("describes the failure from the captured stderr", () => {
    assert.match(
      ctrl,
      /describeStartFailure\(\{\s*serverName,\s*message: error\.message,\s*stderr: stderrTail \? stderrTail\.text\(\) : "",\s*\}\)/,
    );
  });

  it("keeps the Node version message first", () => {
    const esm = ctrl.indexOf("isNodeEsmError(error.message)");
    const desc = ctrl.indexOf("describeStartFailure({", esm);
    assert.ok(esm > 0 && desc > esm);
  });
});
