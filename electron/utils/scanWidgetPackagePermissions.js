/**
 * scanWidgetPackagePermissions
 *
 * Walks a widget package directory, statically extracts MCP usage
 * (`useMcpProvider("type")` + `callTool("name", ...)`) from every
 * source file, and returns the canonical `dash.permissions.mcp` block
 * for embedding in the package's `package.json`.
 *
 * Used at three boundaries to keep declared permissions in sync with
 * the actual code:
 *   - Widget publish flow (registry:publish-widget) — declarations
 *     ship with the package.
 *   - Widget install flow (installFromLocalPath) — declarations are
 *     re-derived for already-published packages whose authors didn't
 *     run the scanner, AND for new versions that updated their tool
 *     set without updating the manifest.
 *   - AI builder (widget:ai-build) — same scanner, single source of
 *     truth.
 *
 * MERGE policy: scanner output is additive. Hand-authored entries in
 * `package.json.dash.permissions.mcp` are preserved; scanner-found
 * entries the human missed are appended. Idempotent — repeated runs
 * produce the same package.json (assuming source code unchanged).
 *
 * Limitations (acceptable, documented):
 *   - Single-string regex scan. Variable-indirected calls like
 *     `callTool(toolName, ...)` are skipped — runtime gate is the
 *     safety net.
 *   - Comments are stripped (line `//` only) so commented-out
 *     examples don't pollute the declaration.
 *   - Walks `widgets/`, `src/`, and the package root for `.js`,
 *     `.jsx`, `.ts`, `.tsx` files. Skips `node_modules/` and `dist/`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SOURCE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "__tests__",
  "__mocks__",
]);

function _stripLineComments(code) {
  return code.replace(/\/\/[^\n]*/g, "");
}

function _captureAll(code, pattern) {
  const out = [];
  for (const match of code.matchAll(pattern)) {
    out.push(match[1]);
  }
  return out;
}

/**
 * Scan a single file's contents and return any detected MCP usage.
 * @param {string} code
 * @returns {{providers: string[], tools: string[]}}
 */
function scanFileForMcpUsage(code) {
  if (typeof code !== "string" || !code) return { providers: [], tools: [] };
  const stripped = _stripLineComments(code);
  const providerPattern = /useMcpProvider\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const callPattern = /callTool\s*\(\s*["'`]([^"'`]+)["'`]/g;
  return {
    providers: Array.from(new Set(_captureAll(stripped, providerPattern))),
    tools: Array.from(new Set(_captureAll(stripped, callPattern))),
  };
}

function _walkSourceFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(..._walkSourceFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SOURCE_EXTS.has(ext)) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Walk packageDir, scan every source file, return the canonical
 * `dash.permissions.mcp` block. Returns `{}` when no MCP usage found.
 */
function scanWidgetPackagePermissions(packageDir) {
  if (typeof packageDir !== "string" || !fs.existsSync(packageDir)) return {};

  const allProviders = new Set();
  const allTools = new Set();
  for (const filePath of _walkSourceFiles(packageDir)) {
    let code;
    try {
      code = fs.readFileSync(filePath, "utf8");
    } catch (_) {
      continue;
    }
    const { providers, tools } = scanFileForMcpUsage(code);
    for (const p of providers) allProviders.add(p);
    for (const t of tools) allTools.add(t);
  }

  if (allProviders.size === 0 || allTools.size === 0) return {};

  const out = {};
  for (const provider of allProviders) {
    out[provider] = { tools: Array.from(allTools).sort() };
  }
  return out;
}

/**
 * Merge scanner output with any hand-authored block. Additive:
 *   - Servers in `human` are kept as-is.
 *   - Servers in `scanned` not in `human` are added.
 *   - When the same server is in both, the union of `tools` arrays is
 *     written, preserving any read/write paths the human declared.
 */
function mergePermissions(human, scanned) {
  const out = {};
  // Start with human entries (preserves their shape including paths).
  if (human && typeof human === "object") {
    for (const [name, perms] of Object.entries(human)) {
      out[name] = { ...perms };
      if (Array.isArray(perms.tools)) out[name].tools = [...perms.tools];
    }
  }
  if (scanned && typeof scanned === "object") {
    for (const [name, perms] of Object.entries(scanned)) {
      if (!out[name]) {
        out[name] = { tools: [...(perms.tools || [])] };
      } else {
        const existing = new Set(out[name].tools || []);
        for (const t of perms.tools || []) existing.add(t);
        out[name].tools = Array.from(existing).sort();
      }
    }
  }
  return out;
}

/**
 * Apply the scanner's findings to `package.json` in `packageDir` —
 * read, merge with any existing `dash.permissions.mcp` block, write
 * back. Returns the resulting block (or null if no package.json).
 */
function applyScanToPackageJson(packageDir) {
  const pkgPath = path.join(packageDir, "package.json");
  let existing = {};
  if (fs.existsSync(pkgPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch (_) {
      existing = {};
    }
  }
  const scanned = scanWidgetPackagePermissions(packageDir);
  const human = existing.dash?.permissions?.mcp || null;
  const merged = mergePermissions(human, scanned);
  if (Object.keys(merged).length === 0) {
    // Nothing to write. Don't churn the file.
    return null;
  }
  const next = {
    ...existing,
    dash: {
      ...(existing.dash || {}),
      permissions: {
        ...((existing.dash || {}).permissions || {}),
        mcp: merged,
      },
    },
  };
  fs.writeFileSync(pkgPath, JSON.stringify(next, null, 2), "utf8");
  return merged;
}

module.exports = {
  scanFileForMcpUsage,
  scanWidgetPackagePermissions,
  mergePermissions,
  applyScanToPackageJson,
};
