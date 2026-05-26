/**
 * widgetManifest.js
 *
 * Manifest loader + validator for locally-installed widgets (Phase 5B,
 * P1 #11). Reads identity + declared-providers from either `dash.json`
 * (preferred) or a `dash` block inside `package.json`. Both files are
 * already part of every existing widget; this module just promotes
 * their fields to a structured-required contract.
 *
 * Required fields (hard-fail when missing):
 *   - name         — `^@?[a-z0-9-]+(/[a-z0-9-]+)?$`
 *   - version      — semver-ish (`X.Y.Z` plus optional pre-release tag)
 *   - entry        — relative path under the widget root, no `..`,
 *                    must resolve under root after realpath. Defaults
 *                    to `widgets/` when absent (back-compat with the
 *                    existing widget corpus).
 *
 * Required for Phase 5C consumption (treated as deprecation warning
 * when missing — flips to hard-fail in a follow-up release):
 *   - declaredProviders — array of strings; empty array OK.
 *
 * Optional pass-through fields:
 *   - displayName, description, author, icon, permissions
 *
 * Also exports `walkSourceContainment(rootPath)` — recursively walks
 * a candidate widget source folder and rejects any entry whose
 * realpath escapes the folder. Reuses `safePath.js` for per-entry
 * containment.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { safePath } = require("./safePath");

const NAME_RE = /^@?[a-z0-9][a-z0-9.-]*(\/[a-z0-9][a-z0-9.-]*)?$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/**
 * Read and validate a widget manifest from a folder.
 *
 * @param {string} folderPath
 * @returns {{ ok: true, manifest: object, source: "dash.json"|"package.json", warnings: string[] }
 *           | { ok: false, error: string }}
 */
function loadWidgetManifest(folderPath) {
  if (typeof folderPath !== "string" || !folderPath) {
    return { ok: false, error: "folderPath must be a non-empty string" };
  }
  if (!fs.existsSync(folderPath)) {
    return { ok: false, error: `folder does not exist: ${folderPath}` };
  }

  const dashJsonPath = path.join(folderPath, "dash.json");
  const packageJsonPath = path.join(folderPath, "package.json");

  let raw;
  let source;

  if (fs.existsSync(dashJsonPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(dashJsonPath, "utf8"));
      source = "dash.json";
    } catch (err) {
      return {
        ok: false,
        error: `dash.json present but unreadable: ${err.message}`,
      };
    }
  } else if (fs.existsSync(packageJsonPath)) {
    // Fall back to package.json — accept either a top-level shape
    // OR a nested `dash` block. Top-level wins for `name`/`version`
    // since that's where npm puts them.
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const dashBlock = pkg.dash || {};
      raw = {
        name: pkg.name || dashBlock.name,
        version: pkg.version || dashBlock.version,
        entry: dashBlock.entry,
        declaredProviders: dashBlock.declaredProviders,
        displayName: pkg.displayName || dashBlock.displayName,
        description: pkg.description || dashBlock.description,
        author:
          typeof pkg.author === "string"
            ? pkg.author
            : pkg.author?.name || dashBlock.author,
        icon: dashBlock.icon,
        permissions: dashBlock.permissions,
      };
      source = "package.json";
    } catch (err) {
      return {
        ok: false,
        error: `package.json present but unreadable: ${err.message}`,
      };
    }
  } else {
    return {
      ok: false,
      error: "widget folder requires dash.json or package.json",
    };
  }

  const warnings = [];

  // Required: name
  if (typeof raw.name !== "string" || !NAME_RE.test(raw.name)) {
    return {
      ok: false,
      error: `manifest.name is required and must match ${NAME_RE.source}`,
    };
  }

  // Required: version
  if (typeof raw.version !== "string" || !SEMVER_RE.test(raw.version)) {
    return {
      ok: false,
      error:
        "manifest.version is required and must be valid semver (X.Y.Z[-tag])",
    };
  }

  // entry: optional with sensible default. Validate when present.
  let entry = typeof raw.entry === "string" ? raw.entry : "widgets";
  if (path.isAbsolute(entry) || entry.split(/[/\\]/).includes("..")) {
    return {
      ok: false,
      error: "manifest.entry must be relative and must not contain `..`",
    };
  }
  try {
    // Re-use safePath to assert the resolved entry stays under the
    // folder root after realpath. If the entry doesn't yet exist on
    // disk (common during validate-only flows), fall back to a plain
    // resolve-and-prefix check.
    const candidate = path.join(folderPath, entry);
    if (fs.existsSync(candidate)) {
      safePath(candidate, [folderPath]);
    } else {
      const resolved = path.resolve(candidate);
      const rootResolved = path.resolve(folderPath);
      if (
        resolved !== rootResolved &&
        !resolved.startsWith(rootResolved + path.sep)
      ) {
        return {
          ok: false,
          error: "manifest.entry resolves outside the widget folder",
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `manifest.entry rejected by containment check: ${err.message}`,
    };
  }

  // declaredProviders: required for Phase 5C credential scoping.
  // Locked policy: missing → deprecation warning for one release, then
  // hard-fail.
  let declaredProviders = raw.declaredProviders;
  if (declaredProviders === undefined) {
    warnings.push(
      `[widgetManifest] ${raw.name}: declaredProviders is missing; defaulting to null ("all currently-granted"). Will become required in a future release.`,
    );
    declaredProviders = null;
  } else if (
    !Array.isArray(declaredProviders) ||
    declaredProviders.some((p) => typeof p !== "string")
  ) {
    return {
      ok: false,
      error: "manifest.declaredProviders must be an array of strings",
    };
  }

  return {
    ok: true,
    source,
    warnings,
    manifest: {
      name: raw.name,
      version: raw.version,
      entry,
      declaredProviders,
      displayName: raw.displayName,
      description: raw.description,
      author: raw.author,
      icon: raw.icon,
      permissions: raw.permissions,
    },
  };
}

/**
 * Recursively walk a candidate widget source folder. Throws if any
 * file/dir/symlink under `rootPath` resolves (via fs.realpathSync) to
 * a location outside `rootPath`.
 *
 * Used by `installFromLocalPath` BEFORE the cpSync copy so a symlink-
 * escape source ("/Users/x/widget-folder/secrets -> /etc") doesn't end
 * up siphoned into the userData widgets cache.
 *
 * @param {string} rootPath
 */
function walkSourceContainment(rootPath) {
  if (typeof rootPath !== "string" || !rootPath) {
    throw new Error("walkSourceContainment: rootPath required");
  }
  if (!fs.existsSync(rootPath)) {
    throw new Error(`walkSourceContainment: rootPath missing: ${rootPath}`);
  }

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    safePath(current, [rootPath]);

    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    }
    // Symlinks: lstat gives us the symlink-itself; safePath above
    // realpath-resolves it. If the realpath escapes rootPath,
    // safePath throws. If it stays inside, we continue walking
    // through it once.
  }
}

module.exports = {
  loadWidgetManifest,
  walkSourceContainment,
  NAME_RE,
  SEMVER_RE,
};
