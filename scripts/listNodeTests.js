#!/usr/bin/env node
/**
 * listNodeTests.js — every node:test file in the repo, one per line
 * (DASH-158). scripts/ci.sh runs them all with one `node --test`, so a new
 * test file runs without anyone adding it to a list. (jest runs src/;
 * jest.config.js skips electron/ and scripts/, which use node:test.)
 *
 * A file is a node:test file when it's named *.test.{js,cjs,mjs}, is tracked
 * or new (not git-ignored), and requires or imports "node:test".
 *
 * Quarantine: a file listed in .dash/checks/ci-test-list.known.txt is left
 * out. Each line there must name the Jira bug that will bring it back
 * (`electron/x.test.js   # DASH-123: why`); the ci-test-list check fails
 * otherwise.
 *
 *   node scripts/listNodeTests.js            the files to run
 *   node scripts/listNodeTests.js --quarantined
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const QUARANTINE = ".dash/checks/ci-test-list.known.txt";
const NODE_TEST = /require\(\s*["']node:test["']\s*\)|from\s+["']node:test["']/;

/** Quarantine entries: [{ file, note }] (note: the text after #). */
function readQuarantine(root) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, QUARANTINE), "utf8");
  } catch (_e) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => {
      const hash = line.indexOf("#");
      const file = (hash === -1 ? line : line.slice(0, hash)).trim();
      const note = hash === -1 ? "" : line.slice(hash + 1).trim();
      return { file, note };
    })
    .filter((q) => q.file);
}

/** Every node:test file (tracked or new), sorted. */
function allNodeTests(root) {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.test.js",
      "*.test.cjs",
      "*.test.mjs",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = [...new Set(out.split("\n").filter(Boolean))]
    .filter((f) => !f.split("/").includes("node_modules"))
    .filter((f) => {
      try {
        return NODE_TEST.test(fs.readFileSync(path.join(root, f), "utf8"));
      } catch (_e) {
        return false; // deleted but still in the index
      }
    });
  return files.sort();
}

/** The node:test files ci.sh runs: all of them but the quarantined. */
function nodeTestsToRun(root) {
  const out = new Set(readQuarantine(root).map((q) => q.file));
  return allNodeTests(root).filter((f) => !out.has(f));
}

if (require.main === module) {
  const root = process.env.DASH_WORKSPACE || process.cwd();
  const list = process.argv.includes("--quarantined")
    ? readQuarantine(root).map((q) => q.file)
    : nodeTestsToRun(root);
  if (list.length) process.stdout.write(list.join("\n") + "\n");
}

module.exports = { allNodeTests, nodeTestsToRun, readQuarantine, QUARANTINE };
