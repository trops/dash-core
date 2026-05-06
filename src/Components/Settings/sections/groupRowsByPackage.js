/**
 * groupRowsByPackage
 *
 * Renderer-side grouping of `widgetMcp.listAll` rows into packages.
 * Each row is per-widget (e.g. `trops.google-drive.GDriveFileList`);
 * this helper reconstructs the owning packageId (`@trops/google-drive`)
 * by parsing the dotted form back to scoped npm-id form.
 *
 * Mirrors the parsing semantics in
 * `electron/security/resolveSiblings.js` so the two layers agree on
 * what counts as "the same package".
 *
 * Output is sorted alphabetically by packageId so the sidebar list is
 * stable across reloads. Rows that don't parse to a recognized
 * scope+name shape are bucketed under `packageId: null` (rendered as
 * "Ungrouped" in the UI) — covers the test probe (`@test/jit-probe`)
 * and any future ids that don't follow the dotted convention.
 */

function _parsePackageId(widgetId) {
  if (typeof widgetId !== "string" || !widgetId) return null;
  // Expected shape: "<scope>.<name>.<componentName>" — at least two dots.
  // Bail on anything else (e.g. "@test/jit-probe" goes to ungrouped).
  const parts = widgetId.split(".");
  if (parts.length < 3) return null;
  if (widgetId.startsWith("@")) return null;
  const scope = parts[0];
  const name = parts.slice(1, -1).join(".");
  if (!scope || !name) return null;
  return "@" + scope + "/" + name;
}

function _hasGrant(granted) {
  if (!granted || typeof granted !== "object") return false;
  const servers = granted.servers || {};
  if (Object.keys(servers).some((k) => servers[k])) return true;
  const domains = granted.domains || {};
  if (domains.fs) {
    if (
      (domains.fs.readPaths || []).length > 0 ||
      (domains.fs.writePaths || []).length > 0
    ) {
      return true;
    }
  }
  if (domains.network) {
    if ((domains.network.hosts || []).length > 0) return true;
  }
  return false;
}

export function groupRowsByPackage(rows) {
  if (!Array.isArray(rows)) return [];
  const byPackage = new Map();
  for (const row of rows) {
    const packageId = _parsePackageId(row.widgetId);
    const key = packageId || "__ungrouped__";
    if (!byPackage.has(key)) {
      byPackage.set(key, {
        packageId,
        displayName: packageId || "Ungrouped",
        widgets: [],
        grantCount: 0,
        hasAnyGrant: false,
      });
    }
    const group = byPackage.get(key);
    group.widgets.push(row);
    if (_hasGrant(row.granted)) {
      group.grantCount += 1;
      group.hasAnyGrant = true;
    }
  }
  return Array.from(byPackage.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}
