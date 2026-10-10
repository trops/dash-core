/**
 * scannerExport.test.js
 *
 * Pins the standalone scanner export (`@trops/dash-core/scanner`). Widget
 * publish scripts run in plain Node and can't load the Electron bundle,
 * so they require this entry to put the package's declared MCP tools
 * into the registry manifest.
 *
 * Run with `node --test electron/utils/scannerExport.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

test("package.json exports ./scanner from dist/scanner/index.js", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  assert.deepStrictEqual(pkg.exports["./scanner"], {
    require: "./dist/scanner/index.js",
  });
});

test("the electron rollup config builds the scanner entry", () => {
  const cfg = fs.readFileSync(
    path.join(root, "rollup.config.electron.mjs"),
    "utf8",
  );
  assert.match(
    cfg,
    /input: "electron\/utils\/scanWidgetPackagePermissions\.js"/,
  );
  assert.match(cfg, /file: "dist\/scanner\/index\.js"/);
});

test("the scanner has no Electron dependency", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "scanWidgetPackagePermissions.js"),
    "utf8",
  );
  assert.doesNotMatch(src, /require\(["']electron["']\)/);
});
