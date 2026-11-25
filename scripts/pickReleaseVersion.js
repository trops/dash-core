#!/usr/bin/env node
/**
 * pickReleaseVersion.js: the version a merge to master publishes as.
 *
 * The publish workflow (.github/workflows/release-package.yml) picks the
 * version when a change is merged, not when its PR is made. Several PRs
 * (yours, or the Code Factory's) can wait at once, each made from the same
 * master, and the order they're merged in decides their versions.
 *
 *   package.json's version, if it's past everything already published
 *   (you bumped it yourself, e.g. with ci.sh --pr), else the next patch
 *   after the highest published version.
 *
 *   node scripts/pickReleaseVersion.js [--taken 1.2.3 ...]
 *
 * prints the version. --taken adds versions npm doesn't list yet (it can
 * lag a few minutes behind a publish); the workflow passes the one it just
 * failed to publish over.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { compareVersions, nextPatch } = require("./release");

const PLAIN = /^\d+\.\d+\.\d+$/;

/**
 * @param {string} pkgVersion package.json's version
 * @param {string[]} taken versions already published (or being published)
 * @returns {string}
 */
function pickVersion(pkgVersion, taken) {
  const plain = (taken || []).filter((v) => PLAIN.test(String(v)));
  const highest = plain.reduce(
    (hi, v) => (!hi || compareVersions(v, hi) > 0 ? v : hi),
    null,
  );
  if (!highest || compareVersions(pkgVersion, highest) > 0) return pkgVersion;
  return nextPatch(highest);
}

/** Every version npm has for the package; [] when it has none yet. */
function publishedVersions(name) {
  let raw;
  try {
    raw = execFileSync("npm", ["view", name, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (_e) {
    return []; // never published (E404)
  }
  const list = JSON.parse(raw || "[]");
  return Array.isArray(list) ? list : [list];
}

function main(argv) {
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--taken") extra.push(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  return pickVersion(pkg.version, [...publishedVersions(pkg.name), ...extra]);
}

if (require.main === module) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + "\n");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { pickVersion, publishedVersions };
