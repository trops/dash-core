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
 * Locate the package's `widgets/` directory and enumerate every
 * `<Name>.js` paired with a `<Name>.dash.js` config. That pair is the
 * canonical widget shape across the repo (see
 * `widgetCompiler.findWidgetsDir`). Returns
 *   [{componentName, componentFilePath}].
 *
 * Files without a sibling `.dash.js` (utils, helpers, contexts) are
 * skipped — they're not widgets, so attributing their MCP usage to a
 * specific component is ambiguous.
 */
function _findComponentFiles(packageDir) {
  const candidates = [
    path.join(packageDir, "widgets"),
    path.join(packageDir, "src", "widgets"),
  ];
  const out = [];
  for (const widgetsDir of candidates) {
    if (!fs.existsSync(widgetsDir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(widgetsDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const m = entry.name.match(/^(.+)\.dash\.(?:js|jsx|ts|tsx)$/);
      if (!m) continue;
      const componentName = m[1];
      // Prefer .js, then .jsx, .ts, .tsx — first-match wins.
      for (const ext of [".js", ".jsx", ".ts", ".tsx"]) {
        const componentFilePath = path.join(
          widgetsDir,
          `${componentName}${ext}`,
        );
        if (fs.existsSync(componentFilePath)) {
          out.push({ componentName, componentFilePath });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Walk packageDir, scan every source file, return the canonical
 * `dash.permissions.mcp` block. Returns `{}` when no MCP usage found.
 *
 * Per-file pairing — providers and tools are paired at the source-file
 * level, not unioned across the whole package. The vast majority of
 * widget source files use a single `useMcpProvider("type")` hook and
 * call its tools in the same file; pairing per file produces the
 * correct provider→tools mapping for that case.
 *
 * Multi-widget packages (one package shipping N widgets, each with a
 * different provider) used to be miscompiled by the old whole-package
 * union: every provider in the package got credit for every tool any
 * sibling widget called. The result was a manifest where, e.g., the
 * `slack` server claimed `list_pull_requests` and `list_directory`
 * tools simply because the same package also shipped a GitHub widget
 * and a Filesystem widget. Per-file pairing eliminates that
 * cross-pollination because each file's tools attach only to that
 * file's providers.
 *
 * Files containing multiple providers (a widget that orchestrates two
 * MCP servers in the same component) attribute their tools to each
 * provider in that file — an acceptable over-grant within the single
 * widget's own scope, and a rare-enough case that we don't try to
 * parse expression scoping. Tools called in files with NO provider
 * hook (e.g. a helper module called from a parent widget) are ignored
 * — a runtime hint without static evidence of which provider it
 * targets falls through to the gate's JIT consent.
 */
function scanWidgetPackagePermissions(packageDir) {
  if (typeof packageDir !== "string" || !fs.existsSync(packageDir)) return {};

  const providerToTools = new Map();
  for (const filePath of _walkSourceFiles(packageDir)) {
    let code;
    try {
      code = fs.readFileSync(filePath, "utf8");
    } catch (_) {
      continue;
    }
    const { providers, tools } = scanFileForMcpUsage(code);
    // No provider in this file → tools have no statically-known
    // server to attach to. Skip rather than cross-pollinate.
    if (providers.length === 0) continue;
    // No tools in this file → still register the provider with an
    // empty set so the manifest knows the widget declares this
    // server. (Edge case: helper file that mounts useMcpProvider but
    // calls callTool via an indirection we can't statically read.)
    for (const p of providers) {
      if (!providerToTools.has(p)) providerToTools.set(p, new Set());
      const bucket = providerToTools.get(p);
      for (const t of tools) bucket.add(t);
    }
  }

  // Drop providers that ended up with no tools across the whole
  // package — declaring a server with an empty tool list is
  // misleading downstream (the Permissions panel renders an empty
  // section, the gate treats it as "all tools require JIT"). The
  // runtime gate is the safety net for tools we couldn't statically
  // pair.
  const out = {};
  for (const [provider, toolSet] of providerToTools.entries()) {
    if (toolSet.size === 0) continue;
    out[provider] = { tools: Array.from(toolSet).sort() };
  }
  return out;
}

/**
 * Per-component scanner. Walks each `widgets/<Name>.js` paired with
 * `widgets/<Name>.dash.js` and produces a map
 *   { [componentName]: { [server]: { tools: [...] } } }
 *
 * Each component's entry contains ONLY the providers + tools its own
 * file uses. Sibling widgets in the same package don't bleed into
 * each other — the bug the package-level `mcp` block carries by
 * design (one shared block for the whole package) is closed here at
 * the widget granularity.
 *
 * Used by `widgetPermissions.getWidgetMcpPermissions(scopedWidgetId)`
 * to answer "what does THIS specific widget declare" instead of
 * "what does the WHOLE package declare", which is what fixes:
 *   - Permissions panel showing every sibling's declarations under
 *     every widget
 *   - JIT consent's sibling-fanout writing grants to widgets that
 *     don't actually use the granted tool
 *
 * Returns `{}` when no component file declares any MCP usage.
 */
function scanWidgetPackagePermissionsByComponent(packageDir) {
  if (typeof packageDir !== "string" || !fs.existsSync(packageDir)) return {};
  const out = {};
  for (const { componentName, componentFilePath } of _findComponentFiles(
    packageDir,
  )) {
    let code;
    try {
      code = fs.readFileSync(componentFilePath, "utf8");
    } catch (_) {
      continue;
    }
    const { providers, tools } = scanFileForMcpUsage(code);
    if (providers.length === 0) continue;
    // Pair this file's providers with this file's tools — same
    // per-file logic as `scanWidgetPackagePermissions`, scoped to
    // a single widget's component file.
    const servers = {};
    for (const provider of providers) {
      const sorted = Array.from(new Set(tools)).sort();
      if (sorted.length === 0) continue;
      servers[provider] = { tools: sorted };
    }
    if (Object.keys(servers).length > 0) {
      out[componentName] = { servers };
    }
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
 * read, merge with any existing manifest, write back. Returns the
 * resulting package-level `mcp` block (or null if no package.json AND
 * no usage to write).
 *
 * Writes BOTH blocks:
 *   - `dash.permissions.mcp` — package-level union (back-compat with
 *     the gate's pre-per-component lookup path)
 *   - `dash.permissions.mcpByComponent` — per-widget breakdown so the
 *     Permissions panel and JIT-consent sibling fanout can answer
 *     "which specific widgets declare this tool" without cross-
 *     contaminating siblings
 *
 * The per-component block is fully scanner-derived (no hand-merge) —
 * editing it by hand is unsupported. Package-level `mcp` continues
 * to honor hand-authored entries.
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
  const byComponent = scanWidgetPackagePermissionsByComponent(packageDir);
  // Existing stale `mcpByComponent` from a prior scan must be dropped
  // when this run finds no qualifying components — otherwise leftover
  // entries for deleted widgets keep applying permissions the user
  // didn't actually re-approve. Treat "has existing block but new
  // scan empty" as a write trigger (with the side effect of removing
  // the block via the delete below).
  const hadByComponent =
    !!existing.dash?.permissions?.mcpByComponent &&
    typeof existing.dash.permissions.mcpByComponent === "object" &&
    Object.keys(existing.dash.permissions.mcpByComponent).length > 0;
  if (
    Object.keys(merged).length === 0 &&
    Object.keys(byComponent).length === 0 &&
    !hadByComponent
  ) {
    // Nothing to write. Don't churn the file.
    return null;
  }
  const nextPermissions = {
    ...((existing.dash || {}).permissions || {}),
  };
  if (Object.keys(merged).length > 0) nextPermissions.mcp = merged;
  if (Object.keys(byComponent).length > 0) {
    nextPermissions.mcpByComponent = byComponent;
  } else {
    // Drop a stale `mcpByComponent` block when re-scanning finds no
    // qualifying component files. Prevents leftover entries from a
    // prior install lingering after the user deletes a widget.
    delete nextPermissions.mcpByComponent;
  }
  const next = {
    ...existing,
    dash: {
      ...(existing.dash || {}),
      permissions: nextPermissions,
    },
  };
  fs.writeFileSync(pkgPath, JSON.stringify(next, null, 2), "utf8");
  return merged;
}

/**
 * Run `applyScanToPackageJson` over a list of widget package paths.
 * Used at registry boot to backfill `dash.permissions.mcp` for widgets
 * installed before the publish/install scanner hooks existed (or that
 * have since updated their tool set without re-publishing). Idempotent
 * — additive merge means repeated boots produce no further writes.
 *
 * @param {string[]} packagePaths
 * @returns {{scanned: number, modified: number, errors: Array<{path: string, error: string}>}}
 */
function backfillPackagePermissions(packagePaths) {
  const summary = { scanned: 0, modified: 0, errors: [] };
  if (!Array.isArray(packagePaths)) return summary;
  for (const pkgPath of packagePaths) {
    if (typeof pkgPath !== "string" || !pkgPath) continue;
    if (!fs.existsSync(pkgPath)) continue;
    summary.scanned += 1;
    try {
      const merged = applyScanToPackageJson(pkgPath);
      if (merged) summary.modified += 1;
    } catch (e) {
      summary.errors.push({ path: pkgPath, error: e.message });
    }
  }
  return summary;
}

module.exports = {
  scanFileForMcpUsage,
  scanWidgetPackagePermissions,
  scanWidgetPackagePermissionsByComponent,
  mergePermissions,
  applyScanToPackageJson,
  backfillPackagePermissions,
};
