/**
 * runEnv.test.js — bots' commands get the user's PATH; a missing tool is
 * named plainly (DASH-53).
 */
"use strict";

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  runPath,
  runEnv,
  mergePaths,
  missingTool,
  needsMessage,
  __setLoginLookupForTest,
} = require("./runEnv");

describe("runPath", () => {
  beforeEach(() => __setLoginLookupForTest(null));
  after(() => __setLoginLookupForTest(null));

  it("puts the login shell's PATH first, then the app's, then Homebrew's", () => {
    __setLoginLookupForTest(
      () => "/Users/me/.nvm/versions/node/v20/bin:/opt/homebrew/bin:/usr/bin",
    );
    const p = runPath({ env: { PATH: "/usr/bin:/bin" }, platform: "darwin" });
    assert.equal(
      p,
      "/Users/me/.nvm/versions/node/v20/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin",
    );
  });

  it("still finds Homebrew when the login shell can't be read", () => {
    __setLoginLookupForTest(() => "");
    const p = runPath({ env: { PATH: "/usr/bin:/bin" }, platform: "darwin" });
    assert.equal(p, "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin");
  });

  it("is looked up once per app session", () => {
    let n = 0;
    __setLoginLookupForTest(() => {
      n++;
      return "/a";
    });
    runPath({ env: { PATH: "" }, platform: "darwin" });
    runPath({ env: { PATH: "" }, platform: "darwin" });
    assert.equal(n, 1);
  });

  it("runEnv keeps the rest of the environment", () => {
    __setLoginLookupForTest(() => "/x");
    const env = runEnv({ PATH: "/usr/bin", HOME: "/Users/me" });
    assert.equal(env.HOME, "/Users/me");
    assert.match(env.PATH, /^\/x:\/usr\/bin/);
  });
});

describe("mergePaths", () => {
  it("keeps each folder once, in order, and skips blanks", () => {
    assert.equal(mergePaths(["/a::/b", "/b:/c", ""]), "/a:/b:/c");
  });
});

describe("missingTool", () => {
  it("reads every shell's 'not found'", () => {
    assert.equal(missingTool("zsh: command not found: gh"), "gh");
    assert.equal(missingTool("bash: node: command not found"), "node");
    assert.equal(missingTool("/bin/sh: git: not found"), "git");
    assert.equal(missingTool("sh: 1: npm: not found"), "npm");
    assert.equal(missingTool("env: node: No such file or directory"), "node");
    assert.equal(
      missingTool("Exit code 127\n/bin/bash: line 1: pnpm: command not found"),
      "pnpm",
    );
  });

  it("leaves other failures alone", () => {
    assert.equal(missingTool("fatal: not a git repository"), null);
    assert.equal(missingTool("Error: file not found"), null);
    assert.equal(missingTool(""), null);
  });

  it("says what to do", () => {
    assert.match(
      needsMessage("git"),
      /^Needs `git`: .*Install it and run again\.$/,
    );
  });
});
