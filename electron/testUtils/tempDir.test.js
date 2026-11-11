const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  tempDir,
  tempFile,
  cleanupTempDirs,
  trackedTempDirs,
} = require("./tempDir");

test("tempDir makes a fresh folder under os.tmpdir() and remembers it", () => {
  const dir = tempDir("zz-tempdir-helper-");
  assert.ok(fs.statSync(dir).isDirectory());
  assert.equal(path.dirname(dir), os.tmpdir());
  assert.ok(path.basename(dir).startsWith("zz-tempdir-helper-"));
  assert.ok(trackedTempDirs().includes(dir));
  cleanupTempDirs();
  assert.equal(fs.existsSync(dir), false);
  assert.equal(trackedTempDirs().length, 0);
});

test("tempFile gives a fixed name inside its own temp folder", () => {
  const file = tempFile("x1", ".zip");
  assert.equal(path.basename(file), "x1.zip");
  assert.notEqual(path.dirname(file), os.tmpdir());
  assert.equal(path.dirname(path.dirname(file)), os.tmpdir());
  fs.writeFileSync(file, "zip");
  cleanupTempDirs();
  assert.equal(fs.existsSync(path.dirname(file)), false);
});

test("cleanupTempDirs is safe to call twice and ignores missing folders", () => {
  const dir = tempDir("zz-tempdir-helper-");
  fs.rmSync(dir, { recursive: true, force: true });
  cleanupTempDirs();
  cleanupTempDirs();
  assert.equal(trackedTempDirs().length, 0);
});

test("folders are removed when the process exits", () => {
  const helper = path.join(__dirname, "tempDir.js");
  const script = `const { tempDir } = require(${JSON.stringify(helper)});
const fs = require("fs");
const d = tempDir("zz-tempdir-exit-");
fs.mkdirSync(require("path").join(d, "nested"));
fs.writeFileSync(require("path").join(d, "nested", "f.txt"), "x");
process.stdout.write(d);`;
  const dir = execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  });
  assert.ok(dir.length > 0);
  assert.equal(fs.existsSync(dir), false);
});
