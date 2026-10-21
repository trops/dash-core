/**
 * widgetRegistryFiles.test.js — a package's own source files, for the Dash
 * team to read when it changes a widget (consolidation Phase 3): code,
 * styles and data, never node_modules or a build, and only those files.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// widgetRegistry requires "electron"; stub it so the test runs in node.
const Module = require("node:module");
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-electron-files-"));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "electron") return "__stub_electron_files__";
  return originalResolve.call(this, request, parent, ...rest);
};
require.cache["__stub_electron_files__"] = {
  id: "__stub_electron_files__",
  filename: "__stub_electron_files__",
  loaded: true,
  exports: {
    app: {
      getPath: () => stubDir,
      getAppPath: () => stubDir,
      isPackaged: false,
    },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
  },
};

const { packageFiles } = require("./widgetRegistry");

function makePackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-files-"));
  const write = (rel, text = "x") => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write("dash.json", "{}");
  write("widgets/Inbox.js");
  write("widgets/Inbox.dash.js");
  write("widgets/lib/format.js");
  write("widgets/styles.css");
  write("README.md");
  write(".env", "SECRET=1");
  write("logo.png");
  write("dist/index.cjs.js");
  write("node_modules/left-pad/index.js");
  return dir;
}

describe("packageFiles", () => {
  it("lists its source files — not its build, libraries or other files", () => {
    assert.deepEqual(packageFiles(makePackage()), [
      "dash.json",
      "README.md",
      "widgets/Inbox.dash.js",
      "widgets/Inbox.js",
      "widgets/lib/format.js",
      "widgets/styles.css",
    ]);
  });
  it("a folder that isn't there: nothing", () => {
    assert.deepEqual(packageFiles(path.join(os.tmpdir(), "zz-nope-xyz")), []);
  });
});
