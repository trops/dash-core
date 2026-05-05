/**
 * manifestScanner.js
 *
 * Literal-only static scanner for widget MCP usage. Three callers:
 *   1. publish-time CLI (`dash-scan-manifest`) — the dev runs it before
 *      shipping a widget; it diffs detected calls against the package's
 *      `dash.permissions.mcp` block.
 *   2. install-time hook in widgetRegistry — when a widget arrives
 *      without a manifest, the scanner is run on the installed source
 *      and the result is offered as a "discovered" consent prompt.
 *   3. Future: lints during widget builds, IDE plugins, etc.
 *
 * Scope: detects literal-string `callTool("server","tool", ...)` and
 * `useMcpProvider("server")` patterns. Anything dynamic (variable,
 * template literal, function arg) is recorded as a `warnings[]` entry,
 * NOT a silent miss.
 *
 * This is a *linter*, not a security mechanism. The runtime gate
 * (Slices 1-3) is the actual boundary.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);
const SCAN_FILE_LIMIT = 200;

const CALL_TOOL_REGEX =
  /(?:mainApi\.mcp\.|window\.mainApi\.mcp\.|\b)callTool\s*\(\s*([^,)]+?)\s*,\s*([^,)]+?)\s*[,)]/g;

const USE_PROVIDER_REGEX = /useMcpProvider\s*\(\s*([^,)]+?)\s*[,)]/g;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tryLiteralString(arg) {
  if (typeof arg !== "string") return null;
  const trimmed = arg.trim();
  const m =
    /^"([^"\\]*(?:\\.[^"\\]*)*)"$/.exec(trimmed) ||
    /^'([^'\\]*(?:\\.[^'\\]*)*)'$/.exec(trimmed);
  if (!m) return null;
  return m[1];
}

function lineNumberOf(src, charIndex) {
  let n = 1;
  for (let i = 0; i < charIndex && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) n++;
  }
  return n;
}

function readSourceFiles(dir) {
  const result = [];
  const skipDirs = new Set([
    "node_modules",
    "dist",
    "package",
    "build",
    ".git",
  ]);
  function walk(current, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(abs, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        if (result.length >= SCAN_FILE_LIMIT) return;
        try {
          result.push({
            relPath: rel,
            source: fs.readFileSync(abs, "utf8"),
          });
        } catch {
          // unreadable — skip
        }
      }
    }
  }
  walk(dir, "");
  return result;
}

function scanForMcpUsage(input) {
  if (!input || typeof input !== "object") {
    return { servers: {}, warnings: [] };
  }

  let fileList = [];
  if (input.files && typeof input.files === "object") {
    for (const [relPath, source] of Object.entries(input.files)) {
      const ext = path.extname(relPath).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      if (typeof source !== "string") continue;
      fileList.push({ relPath, source });
    }
  } else if (typeof input.dir === "string" && input.dir) {
    fileList = readSourceFiles(input.dir);
  }

  const servers = {};
  const warnings = [];

  function ensureServer(name) {
    if (!servers[name]) servers[name] = { tools: new Set() };
    return servers[name];
  }

  for (const { relPath, source } of fileList) {
    const stripped = stripComments(source);

    USE_PROVIDER_REGEX.lastIndex = 0;
    let m;
    while ((m = USE_PROVIDER_REGEX.exec(stripped)) !== null) {
      const lit = tryLiteralString(m[1]);
      const line = lineNumberOf(stripped, m.index);
      if (lit) {
        ensureServer(lit);
      } else {
        warnings.push({
          file: relPath,
          line,
          kind: "dynamic-server-name",
          snippet: m[0].trim(),
        });
      }
    }

    CALL_TOOL_REGEX.lastIndex = 0;
    while ((m = CALL_TOOL_REGEX.exec(stripped)) !== null) {
      const serverLit = tryLiteralString(m[1]);
      const toolLit = tryLiteralString(m[2]);
      const line = lineNumberOf(stripped, m.index);

      if (serverLit && toolLit) {
        ensureServer(serverLit).tools.add(toolLit);
      } else if (!serverLit && !toolLit) {
        warnings.push({
          file: relPath,
          line,
          kind: "dynamic-server-and-tool",
          snippet: m[0].trim(),
        });
      } else if (!serverLit) {
        warnings.push({
          file: relPath,
          line,
          kind: "dynamic-server-name",
          snippet: m[0].trim(),
        });
      } else {
        warnings.push({
          file: relPath,
          line,
          kind: "dynamic-tool-name",
          snippet: m[0].trim(),
        });
      }
    }
  }

  const out = {};
  for (const [name, entry] of Object.entries(servers)) {
    out[name] = { tools: [...entry.tools].sort() };
  }
  return { servers: out, warnings };
}

module.exports = {
  scanForMcpUsage,
  SCAN_FILE_LIMIT,
};
