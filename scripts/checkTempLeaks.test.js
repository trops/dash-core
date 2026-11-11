const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TEST_PREFIXES } = require("./checkTempLeaks");

const GUARD = path.join(__dirname, "checkTempLeaks.js");

// Runs the guard around `node -e <script>` with a private temp dir (TMPDIR,
// which os.tmpdir() follows). `node --test` runs test files at the same
// time, and their zz-*/dash-* folders in the shared temp dir would
// otherwise look like leaks to the inner guard.
function guard(script) {
  const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), "zz-guard-tmp-"));
  try {
    const r = spawnSync(
      process.execPath,
      [GUARD, "--", process.execPath, "-e", script],
      { encoding: "utf8", env: { ...process.env, TMPDIR: privateTmp } },
    );
    return { ...r, tmp: privateTmp };
  } finally {
    fs.rmSync(privateTmp, { recursive: true, force: true });
  }
}

test("a command that cleans up passes", () => {
  const r = guard(`
    const fs = require("fs"), os = require("os"), path = require("path");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "zz-guard-clean-"));
    fs.rmSync(d, { recursive: true, force: true });
  `);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("a command that leaves a test folder behind fails and names it", () => {
  const r = guard(`
    const fs = require("fs"), os = require("os"), path = require("path");
    process.stdout.write(fs.mkdtempSync(path.join(os.tmpdir(), "zz-guard-leak-")));
  `);
  const leaked = r.stdout.trim();
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /Temp-dir leak/);
  assert.ok(leaked.startsWith(r.tmp), leaked);
  assert.ok(r.stderr.includes(path.basename(leaked)), r.stderr);
});

test("new temp entries with non-test names are ignored", () => {
  const r = guard(`
    const fs = require("fs"), os = require("os"), path = require("path");
    fs.mkdtempSync(path.join(os.tmpdir(), "someapp-cache-"));
    fs.mkdtempSync(path.join(os.tmpdir(), "otherapp-test-"));
  `);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("the prefixes are explicit, not a catch-all", () => {
  for (const name of [
    "zz-electron-abc",
    "widget-perms-test-abc",
    "safe-path-test-abc",
    "perm-gate-test-abc",
    "granted-perms-test-abc",
    "fs-gate-test-abc",
    "x1-abc",
    "x1.zip",
  ]) {
    assert.ok(TEST_PREFIXES.test(name), name);
  }
  for (const name of ["otherapp-test-abc", "com.apple.launchd.xyz"]) {
    assert.ok(!TEST_PREFIXES.test(name), name);
  }
});

test("the command's own failure exit code is kept", () => {
  const r = guard("process.exit(3)");
  assert.strictEqual(r.status, 3);
});
