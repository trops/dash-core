/**
 * scanWidgetManifestCli.test.js
 *
 * Pins `dash-scan-manifest`. It must load the scanner that ships in the
 * npm package (dist/scanner, built from scanWidgetPackagePermissions) and
 * read widget calls the way widgets make them: `useMcpProvider("type")`
 * plus `callTool("tool", args)`, with template tool names as wildcards.
 *
 * Run with `node --test scripts/scanWidgetManifestCli.test.js`.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "scanWidgetManifestCli.js");

const WIDGET_SRC = [
  'const { callTool } = useMcpProvider("algolia");',
  "callTool(`algolia_search_${index}`, params);",
  'callTool("algolia_recommendations", {});',
].join("\n");

function makePackage(permissions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-cli-"));
  fs.mkdirSync(path.join(dir, "widgets"));
  fs.writeFileSync(path.join(dir, "widgets", "Search.js"), WIDGET_SRC);
  const pkg = { name: "@test/search", version: "1.0.0" };
  if (permissions) pkg.dash = { permissions: { mcp: permissions } };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("the published package ships the scanner the CLI loads", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const src = fs.readFileSync(CLI, "utf8");
  assert.ok(pkg.files.includes("dist"));
  assert.match(src, /"dist", "scanner", "index\.js"/);
  assert.doesNotMatch(src, /manifestScanner/);
});

test("--json reports the widget's tools, templates as wildcards", () => {
  const r = run([makePackage(null), "--json"]);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.detected, {
    algolia: { tools: ["algolia_recommendations", "algolia_search_*"] },
  });
  assert.deepStrictEqual(out.missing, {
    algolia: { tools: ["algolia_recommendations", "algolia_search_*"] },
  });
  assert.strictEqual(r.status, 1);
});

test("a declared wildcard covers the scanned tools → exit 0", () => {
  const dir = makePackage({
    algolia: { tools: ["algolia_*"] },
  });
  const r = run([dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Manifest looks complete/);
});

test("--check lists only the undeclared tools", () => {
  const dir = makePackage({ algolia: { tools: ["algolia_search_*"] } });
  const r = run([dir, "--json"]);
  assert.deepStrictEqual(JSON.parse(r.stdout).missing, {
    algolia: { tools: ["algolia_recommendations"] },
  });
  assert.strictEqual(r.status, 1);
});

test("--init adds the scanned tools and keeps hand-written entries", () => {
  const dir = makePackage({
    algolia: { tools: ["algolia_search_*"], readPaths: ["/data"] },
  });
  const r = run([dir, "--init"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  assert.deepStrictEqual(pkg.dash.permissions.mcp.algolia, {
    tools: ["algolia_recommendations", "algolia_search_*"],
    readPaths: ["/data"],
  });
  assert.strictEqual(run([dir]).status, 0);
});

test("a missing directory exits 2", () => {
  const r = run([path.join(os.tmpdir(), "no-such-dir-scan-cli")]);
  assert.strictEqual(r.status, 2);
});
