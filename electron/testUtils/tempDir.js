/**
 * Test-only temp folders that clean themselves up.
 *
 * Every folder made here is remembered and removed when the process
 * exits (or earlier, via cleanupTempDirs()). Tests use this instead of
 * fs.mkdtempSync(path.join(os.tmpdir(), ...)) so a test run leaves
 * nothing behind in the OS temp dir.
 *
 * Not shipped: package.json "files" only publishes dist/, and no
 * rollup input imports this file.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const made = new Set();

/** Make a fresh folder under os.tmpdir() named `<prefix>XXXXXX`. */
function tempDir(prefix = "dash-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/**
 * A path for a fixed-name file `<name><ext>` (e.g. tempFile("x1", ".zip"))
 * inside its own remembered temp folder, so the fixed name never lands
 * in os.tmpdir() itself. The file is not created.
 */
function tempFile(name = "dash-test", ext = "") {
  const dir = tempDir(`${name}-`);
  return path.join(dir, `${name}${ext}`);
}

/** Remove every folder made so far. Safe to call more than once. */
function cleanupTempDirs() {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      // best effort
    }
    made.delete(dir);
  }
}

/** Folders made and not yet removed (for the helper's own test). */
function trackedTempDirs() {
  return [...made];
}

process.on("exit", cleanupTempDirs);

module.exports = { tempDir, tempFile, cleanupTempDirs, trackedTempDirs };
