/**
 * registryInstallScan.test.js
 *
 * Pins that a registry install (WidgetRegistry.downloadWidget) runs the
 * MCP permission scan right after extracting the package, like a local
 * install does. Without it the installed package has no declared
 * permissions until the next app start, so the consent prompt and the
 * permission dialog's wildcard offer have nothing to go on.
 *
 * Static source check — downloadWidget needs Electron and the network.
 *
 * Run with `node --test electron/utils/registryInstallScan.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "widgetRegistry.js"),
  "utf8",
);

function methodBody(name) {
  const start = source.indexOf(`  async ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\n  async ", start + 1);
  return source.slice(start, next > 0 ? next : undefined);
}

for (const method of ["downloadWidget", "installFromLocalPath"]) {
  test(`${method}: scans permissions after extracting, before loading config`, () => {
    const body = methodBody(method);
    const extract = body.lastIndexOf("extractAllTo(widgetPath");
    const scan = body.indexOf("applyScanToPackageJson(widgetPath)");
    const load = body.indexOf("this.loadWidgetConfig(");
    assert.ok(extract >= 0, "extract missing");
    assert.ok(scan > extract, "scan must run after extraction");
    assert.ok(load > scan, "scan must run before the config is loaded");
  });
}
