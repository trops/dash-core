#!/usr/bin/env node
/**
 * ci-test-list: every node:test file runs in CI (DASH-111, DASH-158).
 * jest skips electron/ and scripts/ (jest.config.js), so a node:test file
 * that scripts/ci.sh doesn't run never runs anywhere.
 *
 * ci.sh runs every node:test file through scripts/listNodeTests.js, except
 * the ones quarantined in ci-test-list.known.txt. This check fails when:
 *   - ci.sh doesn't run scripts/listNodeTests.js and doesn't name a file;
 *   - a quarantined file has no Jira bug (`# DASH-<n>`) on its line.
 *
 * Exit 0 passes; the last line is {"reason", "details"}.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.env.DASH_WORKSPACE || process.cwd();
const ci = fs.readFileSync(path.join(root, "scripts/ci.sh"), "utf8");
const runsAll = /node\s+scripts\/listNodeTests\.js/.test(ci);

// The quarantine, from the workspace (or next to this file).
function readQuarantine() {
  for (const f of [
    path.join(root, ".dash/checks/ci-test-list.known.txt"),
    path.join(__dirname, "ci-test-list.known.txt"),
  ]) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch (_e) {
      continue;
    }
    return text
      .split(/\r?\n/)
      .map((line) => {
        const hash = line.indexOf("#");
        return {
          file: (hash === -1 ? line : line.slice(0, hash)).trim(),
          note: hash === -1 ? "" : line.slice(hash + 1).trim(),
        };
      })
      .filter((q) => q.file);
  }
  return [];
}
const quarantined = readQuarantine();
const quarantinedFiles = quarantined.map((q) => q.file);

const files = execFileSync(
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
)
  .split("\n")
  .filter((f) => f && !f.startsWith("node_modules/"));
const nodeTests = [...new Set(files)].filter((f) => {
  try {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    return /require\(["']node:test["']\)|from ["']node:test["']/.test(src);
  } catch (_e) {
    return false;
  }
});

const fail = (reason, details) => {
  console.log(JSON.stringify({ reason, details }));
  process.exit(1);
};

const noTicket = quarantined.filter((q) => !/\bDASH-\d+\b/.test(q.note));
if (noTicket.length) {
  console.log(noTicket.map((q) => `  ${q.file}`).join("\n"));
  fail(
    `${noTicket.length} quarantined test file(s) in ci-test-list.known.txt name no Jira bug: add "# DASH-<n>: why" to the line, or fix the test and take it off`,
    { noTicket: noTicket.map((q) => q.file) },
  );
}

const missing = runsAll
  ? []
  : nodeTests.filter((f) => !ci.includes(f) && !quarantinedFiles.includes(f));
if (missing.length) {
  console.log(missing.map((f) => `  ${f}`).join("\n"));
  fail(
    `${missing.length} node:test file(s) never run: scripts/ci.sh should run every node:test file with scripts/listNodeTests.js`,
    { missing },
  );
}

const out = quarantinedFiles.filter((f) => nodeTests.includes(f)).length;
console.log(
  JSON.stringify({
    reason: `All ${nodeTests.length - out} node:test files run in scripts/ci.sh${
      out ? ` (${out} quarantined, each with a ticket)` : ""
    }`,
    details: { quarantined: quarantinedFiles },
  }),
);
