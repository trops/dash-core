#!/usr/bin/env node
/**
 * scanWidgetManifestCli.js
 *
 * CLI shim around electron/utils/manifestScanner.js. Run from a widget
 * package root to compare detected MCP usage against the package's
 * `dash.permissions.mcp` block.
 *
 * Usage:
 *   npx dash-scan-manifest                  # scan ./, print diff (default --check)
 *   npx dash-scan-manifest <dir>            # scan <dir>
 *   npx dash-scan-manifest --init           # write missing manifest into package.json
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

// Find the scanner in either the repo layout (electron/) or the
// published package layout (dist/electron/). Whichever exists wins.
const scannerPath = (() => {
  const distPath = path.join(
    __dirname,
    "..",
    "dist",
    "electron",
    "utils",
    "manifestScanner.js",
  );
  if (fs.existsSync(distPath)) return distPath;
  return path.join(__dirname, "..", "electron", "utils", "manifestScanner.js");
})();
const { scanForMcpUsage } = require(scannerPath);

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
  // detected: { servers: { [name]: { tools[] } } }
  // declared: { [name]: { tools[], readPaths[], writePaths[] } } | null
  const missing = {}; // detected but not declared
  const declaredServers = (declared && declared) || {};
  for (const [name, entry] of Object.entries(detected.servers)) {
    const declTools = declaredServers[name]?.tools || [];
    const missingTools = entry.tools.filter((t) => !declTools.includes(t));
    if (!declaredServers[name] || missingTools.length > 0) {
      missing[name] = {
        tools: missingTools.length > 0 ? missingTools : entry.tools,
      };
    }
  }
  return { missing };
}

function buildSyntheticManifest(detected) {
  const out = {};
  for (const [name, entry] of Object.entries(detected.servers)) {
    out[name] = {
      tools: entry.tools,
      readPaths: [],
      writePaths: [],
    };
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Directory not found: ${dir}`);
    process.exit(2);
  }

  const detected = scanForMcpUsage({ dir });
  const { path: pkgPath, pkg } = readPackageJson(dir);
  const declared = getDeclaredManifest(pkg);
  const d = diff(detected, declared);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          dir,
          detected: detected.servers,
          declared: declared || null,
          missing: d.missing,
          warnings: detected.warnings,
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
    if (declared) {
      console.error(
        `package.json already declares dash.permissions.mcp. --init refuses to overwrite. Use --check to see the diff.`,
      );
      process.exit(2);
    }
    pkg.dash = pkg.dash || {};
    pkg.dash.permissions = pkg.dash.permissions || {};
    pkg.dash.permissions.mcp = buildSyntheticManifest(detected);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    console.log(`Wrote starter manifest to ${pkgPath}.`);
    console.log(
      "Review the readPaths and writePaths arrays — the scanner cannot infer paths.",
    );
    process.exit(0);
  }

  // --check (default)
  console.log(`Scanned: ${dir}`);
  if (Object.keys(detected.servers).length === 0) {
    console.log("No literal MCP usage detected.");
  } else {
    console.log("\nDetected MCP usage:");
    for (const [name, entry] of Object.entries(detected.servers)) {
      console.log(
        `  ${name}: ${entry.tools.join(", ") || "(no literal tools)"}`,
      );
    }
  }

  if (detected.warnings.length > 0) {
    console.log(
      `\n${detected.warnings.length} dynamic call(s) — scanner could not analyze:`,
    );
    for (const w of detected.warnings) {
      console.log(`  ${w.file}:${w.line}  [${w.kind}]  ${w.snippet}`);
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
    console.log(
      "\nRun `dash-scan-manifest --init` to write a starter manifest.",
    );
    process.exit(1);
  }
  console.log("\nManifest looks complete.");
  process.exit(0);
}

main();
