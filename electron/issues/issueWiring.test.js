/**
 * Where failures become issues (issues PRD) — static checks on the
 * controllers that can't run outside Electron.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bots = read("controller/botController.js");
const mcp = read("controller/mcpController.js");

describe("bot runs", () => {
  it("a finished run records its issues — a completed one clears its failure", () => {
    assert.match(
      bots,
      /this\._recordRunIssues\(this\._store\.get\(botId\), record\);/,
    );
    assert.match(
      bots,
      /_recordRunIssues\(bot, record\) \{[\s\S]{0,200}record\.skipped \|\| isDashTeam\(bot\)/,
    );
    // A completed run clears an earlier failure; a clean one, warnings too.
    assert.match(
      bots,
      /if \(record\.status === "completed"\) \{\s*issueController\.resolveAsset\(\s*asset,\s*inputs\.length \? \{ severity: "problem" \} : \{\},?\s*\);/,
    );
  });
  it("warnings go through the run, so they're kept on it", () => {
    assert.match(
      bots,
      /_runWarning\(bot, runOpts, event\) \{\s*if \(runOpts && typeof runOpts\.emit === "function"\) \{\s*runOpts\.emit\(event\);/,
    );
    assert.doesNotMatch(
      bots,
      /this\._broadcast\(BOT_STREAM, \{\s*botId: bot\.id,\s*event: \{\s*type: "warning",\s*message: `\$\{f\.serverName\} couldn't start/,
    );
  });
});

describe("providers", () => {
  it("couldn't start, sign-in expired → an issue; started again → resolved", () => {
    assert.match(
      mcp,
      /issues\.record\(\s*providerIssue\(\{ provider: serverName, error: errorMessage \}\),?\s*\)/,
    );
    assert.match(
      mcp,
      /providerIssue\(\{ provider: serverName, error: message, signIn: true \}\)/,
    );
    assert.match(
      mcp,
      /Server connected[\s\S]{0,200}issues\.resolveAsset\(\{ kind: "provider", provider: serverName \}\)/,
    );
  });
});

describe("things that are gone take their issues", () => {
  const workspaces = read("controller/workspaceController.js");
  const providers = read("controller/providerController.js");
  it("a deleted bot, provider or dashboard; a saved dashboard sweeps removed widgets", () => {
    assert.match(
      bots,
      /grantStore\.revokeGrant\(botId\);[\s\S]{0,120}issueController\.forgetAsset\(\{ kind: "bot", botId \}\)/,
    );
    assert.match(
      providers,
      /deleteProvider: \(win, appId, providerName\) => \{[\s\S]{0,200}forgetAsset\(\{\s*kind: "provider",\s*provider: providerName,?\s*\}\)/,
    );
    assert.match(
      workspaces,
      /emitWorkspaceDeleted\(workspaceId\);[\s\S]{0,120}issues\.forgetWorkspace\(workspaceId\)/,
    );
    assert.match(workspaces, /issues\.sweepWorkspace\(workspaceObject\)/);
  });
  it("a test start from the new-provider form isn't an issue", () => {
    assert.match(
      mcp,
      /if \(isSavedProvider\(win, appId, serverName\)\) \{\s*noteProvider\(/,
    );
  });
});
