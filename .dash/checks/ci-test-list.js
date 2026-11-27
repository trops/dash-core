#!/usr/bin/env node
/**
 * ci-test-list: every node:test file is in scripts/ci.sh's test lists
 * (DASH-111). jest skips electron/ and scripts/ (jest.config.js), so a
 * node:test file that isn't named in ci.sh never runs anywhere — the
 * mistake that has bitten us before.
 *
 * Files that were already missing when this check was added are listed in
 * ci-test-list.known.txt (one per line, # comments): they're a known gap, not
 * a new one. Take a file off that list once it's in ci.sh.
 *
 * Exit 0 passes; the last line is {"reason", "details"}.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.env.DASH_WORKSPACE || process.cwd();
const ci = fs.readFileSync(path.join(root, "scripts/ci.sh"), "utf8");
const knownFile = path.join(__dirname, "ci-test-list.known.txt");
const fromRepo = path.join(root, ".dash/checks/ci-test-list.known.txt");
let known = [];
for (const f of [knownFile, fromRepo]) {
  try {
    known = fs
      .readFileSync(f, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
    break;
  } catch (_e) {
    // Next place.
  }
}

const files = execFileSync("git", ["ls-files", "*.test.js"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.startsWith("node_modules/"));
const nodeTests = files.filter((f) => {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  return /require\(["']node:test["']\)|from ["']node:test["']/.test(src);
});
const missing = nodeTests.filter((f) => !ci.includes(f) && !known.includes(f));
const fixed = known.filter((f) => ci.includes(f));

if (missing.length) {
  console.log(missing.map((f) => `  ${f}`).join("\n"));
  console.log(
    JSON.stringify({
      reason: `${missing.length} node:test file${missing.length === 1 ? " isn't" : "s aren't"} in scripts/ci.sh, so ${missing.length === 1 ? "it never runs" : "they never run"}: add ${missing.join(", ")} to a node --test line in scripts/ci.sh`,
      details: { missing },
    }),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    reason: `All ${nodeTests.length - known.length + fixed.length} node:test files are in scripts/ci.sh${known.length - fixed.length ? ` (${known.length - fixed.length} known gaps in ci-test-list.known.txt)` : ""}`,
    details: { known: known.length, fixedButStillListed: fixed },
  }),
);
