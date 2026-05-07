/**
 * dedupeWidgetFolders
 *
 * Boot-time pass over the widgets cache directory. Looks for
 * top-level folders that don't follow the canonical `@scope/name`
 * shape but whose `package.json` declares a scoped name (e.g.
 * `widgets/pipeline/` containing `{ "name": "@ai-built/pipeline" }`).
 * These are stale artifacts from older install paths — they coexist
 * with the canonical `widgets/@scope/name/` folder and crash
 * ComponentManager with "missing origin metadata" because the
 * bare-name registry entry has no scope to derive a 3-segment
 * `<scope>.<package>.<component>` id from.
 *
 * Two outcomes per malformed folder:
 *   - Scoped twin already exists → remove the bare copy (redundant)
 *   - Scoped twin missing       → move the folder to the canonical
 *     scoped path
 *
 * Pure boundary effects (fs read/write/move/remove). The only
 * registry-side fixup is left to the caller — once this returns,
 * `widgetRegistry.reconcileWithDisk` re-walks the directory and
 * picks up the (now canonical) layout cleanly.
 *
 * @param {string} widgetsDir
 * @returns {{removed: string[], migrated: Array<{from: string, to: string}>, errors: Array<{path: string, error: string}>}}
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RESERVED_TOP_LEVEL = new Set(["registry.json"]);

function dedupeWidgetFolders(widgetsDir) {
  const summary = { removed: [], migrated: [], errors: [] };
  if (typeof widgetsDir !== "string" || !fs.existsSync(widgetsDir)) {
    return summary;
  }

  let entries;
  try {
    entries = fs.readdirSync(widgetsDir, { withFileTypes: true });
  } catch (e) {
    summary.errors.push({ path: widgetsDir, error: e.message });
    return summary;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (RESERVED_TOP_LEVEL.has(entry.name)) continue;
    // Canonical scoped folders are handled by reconcileWithDisk;
    // skip them here.
    if (entry.name.startsWith("@")) continue;

    const bareDir = path.join(widgetsDir, entry.name);
    const pkgJsonPath = path.join(bareDir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    let pkgName;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      pkgName = typeof pkg?.name === "string" ? pkg.name : null;
    } catch (e) {
      summary.errors.push({ path: bareDir, error: e.message });
      continue;
    }

    // Truly unscoped package — leave alone.
    if (!pkgName || !pkgName.startsWith("@")) continue;

    const parts = pkgName.split("/");
    if (parts.length !== 2) continue; // malformed scoped name; ignore
    const scope = parts[0]; // e.g. "@ai-built"
    const name = parts[1];
    const scopedDir = path.join(widgetsDir, scope, name);

    try {
      if (fs.existsSync(scopedDir)) {
        // Redundant bare copy — remove it.
        fs.rmSync(bareDir, { recursive: true, force: true });
        summary.removed.push(bareDir);
      } else {
        // Migrate the bare folder to the canonical scoped path.
        fs.mkdirSync(path.dirname(scopedDir), { recursive: true });
        fs.renameSync(bareDir, scopedDir);
        summary.migrated.push({ from: bareDir, to: scopedDir });
      }
    } catch (e) {
      summary.errors.push({ path: bareDir, error: e.message });
    }
  }
  return summary;
}

module.exports = { dedupeWidgetFolders };
