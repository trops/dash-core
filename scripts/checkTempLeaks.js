#!/usr/bin/env node
/**
 * checkTempLeaks.js — run a command and fail if it leaves test folders or
 * files behind in the OS temp dir (os.tmpdir()).
 *
 * Usage:
 *   node scripts/checkTempLeaks.js -- node --test electron/foo.test.js ...
 *
 * How it decides something is a leak: the entry is in os.tmpdir() after
 * the run but wasn't before, it was created/changed after the run started,
 * AND its name matches one of the test prefixes below. The prefix filter
 * keeps unrelated programs that write to the temp dir at the same time
 * from failing CI.
 *
 * Exit code: the command's own exit code if it failed; otherwise 1 when
 * anything leaked, 0 when the temp dir is clean.
 *
 * Tests should make temp folders with electron/testUtils/tempDir.js,
 * which removes them on exit.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Names test files use for their temp folders/files: an explicit list
// (grep the tests for tempDir("...") / mkdtemp prefixes when adding one),
// never a catch-all that would match other programs' folders.
// x1-/x2- are tempFile("x1", ".zip") folders.
const TEST_PREFIXES =
  /^(zz-|widget-zz|x[12]\.zip$|botscan|botstore-test|scan-cli|scan-pkg-test|mcp-test|dash-test|dash-save|dash-keys|dash-autosave|dash-widget-ver|dash-widget-integration|audit-|profile-account-|dedupe-folders-test|widget-manifest-test|widget-perms-test-|safe-path-test-|perm-gate-test-|granted-perms-test-|fs-gate-test-|x[12]-)/;

function listTemp(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
}

function findLeaks(dir, before, startMs) {
  const leaks = [];
  for (const name of listTemp(dir)) {
    if (before.has(name) || !TEST_PREFIXES.test(name)) continue;
    let st;
    try {
      st = fs.lstatSync(path.join(dir, name));
    } catch (_) {
      continue; // gone already
    }
    // 1s slack for coarse filesystem timestamps.
    const changed = Math.max(st.mtimeMs, st.birthtimeMs || 0, st.ctimeMs);
    if (changed + 1000 < startMs) continue;
    leaks.push(`${name}${st.isDirectory() ? "/" : ""}`);
  }
  return leaks.sort();
}

function main(argv) {
  const sep = argv.indexOf("--");
  const cmd = sep === -1 ? argv : argv.slice(sep + 1);
  if (cmd.length === 0) {
    console.error(
      "usage: node scripts/checkTempLeaks.js -- <command> [args...]",
    );
    return 2;
  }

  const dir = os.tmpdir();
  const before = new Set(listTemp(dir));
  const startMs = Date.now();

  const run = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  if (run.error) {
    console.error(`checkTempLeaks: could not run ${cmd[0]}: ${run.error}`);
    return 1;
  }
  const code = run.status === null ? 1 : run.status;

  const leaks = findLeaks(dir, before, startMs);
  if (leaks.length > 0) {
    console.error("");
    console.error(
      `✖ Temp-dir leak: these tests left ${leaks.length} item(s) in ${dir}:`,
    );
    const shown = leaks.slice(0, 50);
    for (const name of shown) console.error(`    ${name}`);
    if (leaks.length > shown.length) {
      console.error(`    … and ${leaks.length - shown.length} more`);
    }
    console.error(
      "  Make temp folders with tempDir() from electron/testUtils/tempDir.js " +
        "(removed on exit) instead of fs.mkdtempSync(os.tmpdir()), and never " +
        "write fixed-name files straight into os.tmpdir().",
    );
    return code !== 0 ? code : 1;
  }
  return code;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { TEST_PREFIXES, findLeaks, main };
