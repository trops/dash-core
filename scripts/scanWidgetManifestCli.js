#!/usr/bin/env node
/**
 * scanWidgetManifestCli.js
 *
 * CLI shim around the widget permission scanner
 * (electron/utils/scanWidgetPackagePermissions.js, shipped as
 * dist/scanner). Run from a widget package root to compare the MCP tools
 * its widgets call against the package's `dash.permissions.mcp` block.
 * It's the same scanner the publish and install flows use, so templated
 * tool names (`algolia_search_${index}`) show up as wildcards
 * (`algolia_search_*`).
 *
 * Usage:
 *   npx dash-scan-manifest                  # scan ./, print diff (default --check)
 *   npx dash-scan-manifest <dir>            # scan <dir>
 *   npx dash-scan-manifest --init           # add the scanned tools to package.json
 *   npx dash-scan-manifest --json           # machine-readable output
 *
 * Exit codes:
 *   0  no missing entries (manifest is complete or scan found nothing)
 *   1  scan found tool usage not declared in the manifest
 *   2  invalid arguments / unreadable directory
 */
"use strict";

const fs = require("fs");
const path = require("path");

// The published package ships the built scanner (dist/scanner); a repo
// checkout without a build falls back to the source.
const scannerPath = (() => {
  const distPath = path.join(__dirname, "..", "dist", "scanner", "index.js");
  if (fs.existsSync(distPath)) return distPath;
  return path.join(
    __dirname,
    "..",
    "electron",
    "utils",
    "scanWidgetPackagePermissions.js",
  );
})();
const {
  scanWidgetPackagePermissions,
  applyScanToPackageJson,
  toolListAllows,
} = require(scannerPath);

function parseArgs(argv) {
  const args = { dir: null, mode: "check", json: false };
  for (const a of argv) {
    if (a === "--init") args.mode = "init";
    else if (a === "--check") args.mode = "check";
    else if (a === "--json") args.json = true;
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      args.dir = a;
    }
  }
  if (!args.dir) args.dir = process.cwd();
  return args;
}

function readPackageJson(dir) {
  const p = path.join(dir, "package.json");
  if (!fs.existsSync(p)) return { path: p, pkg: null };
  try {
    return { path: p, pkg: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    console.error(`Could not read ${p}: ${e.message}`);
    process.exit(2);
  }
}

function getDeclaredManifest(pkg) {
  return pkg?.dash?.permissions?.mcp || null;
}

function diff(detected, declared) {
  // detected: { [server]: { tools[] } }
  // declared: { [server]: { tools[], readPaths[], writePaths[] } } | null
  // A declared wildcard covers the tools (and narrower wildcards) it matches.
  const missing = {};
  for (const [name, entry] of Object.entries(detected)) {
    const declTools = declared?.[name]?.tools || [];
    const missingTools = entry.tools.filter(
      (t) => !toolListAllows(declTools, t),
    );
    if (missingTools.length > 0) missing[name] = { tools: missingTools };
  }
  return { missing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Directory not found: ${dir}`);
    process.exit(2);
  }

  const detected = scanWidgetPackagePermissions(dir);
  const { pkg } = readPackageJson(dir);
  const declared = getDeclaredManifest(pkg);
  const d = diff(detected, declared);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          dir,
          detected,
          declared: declared || null,
          missing: d.missing,
        },
        null,
        2,
      ),
    );
    process.exit(Object.keys(d.missing).length > 0 ? 1 : 0);
  }

  if (args.mode === "init") {
    if (!pkg) {
      console.error(
        `No package.json found in ${dir}. --init requires an existing package.json.`,
      );
      process.exit(2);
    }
    // Additive: hand-written entries (and their paths) are kept.
    const merged = applyScanToPackageJson(dir);
    if (!merged) {
      console.log("No MCP usage detected — package.json left unchanged.");
    } else {
      console.log(
        `Updated dash.permissions in ${path.join(dir, "package.json")}.`,
      );
      console.log(
        "Review the readPaths and writePaths arrays — the scanner cannot infer paths.",
      );
    }
    process.exit(0);
  }

  // --check (default)
  console.log(`Scanned: ${dir}`);
  if (Object.keys(detected).length === 0) {
    console.log("No MCP usage detected.");
  } else {
    console.log("\nDetected MCP usage:");
    for (const [name, entry] of Object.entries(detected)) {
      console.log(`  ${name}: ${entry.tools.join(", ")}`);
    }
  }

  if (declared) {
    console.log("\nDeclared manifest:");
    for (const [name, entry] of Object.entries(declared)) {
      console.log(`  ${name}: ${(entry.tools || []).join(", ") || "(empty)"}`);
    }
  } else {
    console.log("\nNo dash.permissions.mcp block in package.json.");
  }

  if (Object.keys(d.missing).length > 0) {
    console.log("\nMissing in manifest:");
    for (const [name, entry] of Object.entries(d.missing)) {
      console.log(`  ${name}: ${entry.tools.join(", ")}`);
    }
    console.log("\nRun `dash-scan-manifest --init` to add them.");
    process.exit(1);
  }
  console.log("\nManifest looks complete.");
  process.exit(0);
}

main();
