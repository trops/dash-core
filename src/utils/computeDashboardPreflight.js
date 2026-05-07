/**
 * computeDashboardPreflight
 *
 * Pure scanner. Walks a workspace's layout, finds every widget present
 * on the dashboard, looks up each widget's declared-vs-granted state
 * via a `widgetMcp.listAll()` snapshot, and returns the diff so the
 * pre-flight modal can prompt for the missing permissions in one shot.
 *
 * Why this exists: pre-this-slice, every gated call from a widget
 * dripped a separate JIT prompt. With manifests pre-declared (slice 7
 * for AI-built; existing for @trops/*), we can compute the union up
 * front and ask once.
 *
 * Inputs (all snapshots — caller is responsible for liveness):
 *   - layout: workspace.layout array (grid containers + widgets)
 *   - allRows: result of `widgetMcp.listAll()` IPC
 *   - registry: Map<packageId, {componentNames, ...}> from
 *     getWidgetRegistry().widgets
 *
 * Output: { widgets: [{ widgetId, packageId, displayName, missing }] }
 *   - missing has the same shape as a `granted` blob: `{servers, domains}`.
 *   - Only includes widgets where missing is non-empty.
 *   - Widgets without a manifest are skipped (no declared = nothing to
 *     pre-ask; runtime JIT is the fallback).
 */

function _isObject(x) {
  return x && typeof x === "object";
}

function _bareNameFromWidgetId(widgetId) {
  if (typeof widgetId !== "string") return null;
  const idx = widgetId.lastIndexOf(".");
  return idx >= 0 ? widgetId.slice(idx + 1) : widgetId;
}

/**
 * Parse a grant-keyed widgetId (`trops.google-drive.GDriveFileList`)
 * into its scoped package id (`@trops/google-drive`). When a registry
 * snapshot is supplied, prefer its truth — handles edge cases the
 * naive parser can't (e.g. unconventional packageId formats). Falls
 * back to dotted-form parsing otherwise.
 */
function _packageIdFromWidgetId(widgetId, registry) {
  const bareName = _bareNameFromWidgetId(widgetId);
  if (!bareName) return null;

  if (registry) {
    const entries =
      typeof registry.entries === "function"
        ? Array.from(registry.entries())
        : Object.entries(registry);
    for (const [, entry] of entries) {
      if (!entry || !Array.isArray(entry.componentNames)) continue;
      if (entry.componentNames.includes(bareName)) {
        return entry.packageId || null;
      }
    }
  }

  // Fallback: parse the dotted form. Shape is
  //   <scope>.<package-name-may-contain-hyphens>.<componentName>
  if (typeof widgetId !== "string") return null;
  if (widgetId.startsWith("@")) return null; // bare scoped id, not dotted
  const parts = widgetId.split(".");
  if (parts.length < 3) return null;
  const scope = parts[0];
  const pkg = parts.slice(1, -1).join(".");
  if (!scope || !pkg) return null;
  return "@" + scope + "/" + pkg;
}

function _diffArray(declared, granted) {
  const grantedSet = new Set(granted || []);
  return (declared || []).filter((x) => !grantedSet.has(x));
}

function _diffServers(declaredServers, grantedServers) {
  const out = {};
  if (!_isObject(declaredServers)) return out;
  for (const [name, decl] of Object.entries(declaredServers)) {
    const grant = grantedServers && grantedServers[name];
    const missingTools = _diffArray(decl.tools, grant?.tools);
    const missingReadPaths = _diffArray(decl.readPaths, grant?.readPaths);
    const missingWritePaths = _diffArray(decl.writePaths, grant?.writePaths);
    if (
      missingTools.length === 0 &&
      missingReadPaths.length === 0 &&
      missingWritePaths.length === 0
    ) {
      continue;
    }
    out[name] = {
      tools: missingTools,
      readPaths: missingReadPaths,
      writePaths: missingWritePaths,
    };
  }
  return out;
}

function _diffFs(declaredFs, grantedFs) {
  if (!_isObject(declaredFs)) return null;
  const missingActions = _diffArray(declaredFs.actions, grantedFs?.actions);
  const missingReadPaths = _diffArray(
    declaredFs.readPaths,
    grantedFs?.readPaths,
  );
  const missingWritePaths = _diffArray(
    declaredFs.writePaths,
    grantedFs?.writePaths,
  );
  if (
    missingActions.length === 0 &&
    missingReadPaths.length === 0 &&
    missingWritePaths.length === 0
  ) {
    return null;
  }
  const out = {};
  if (missingActions.length > 0) out.actions = missingActions;
  if (missingReadPaths.length > 0) out.readPaths = missingReadPaths;
  if (missingWritePaths.length > 0) out.writePaths = missingWritePaths;
  return out;
}

function _diffNetwork(declaredNet, grantedNet) {
  if (!_isObject(declaredNet)) return null;
  const missingActions = _diffArray(declaredNet.actions, grantedNet?.actions);
  const missingHosts = _diffArray(declaredNet.hosts, grantedNet?.hosts);
  if (missingActions.length === 0 && missingHosts.length === 0) return null;
  const out = {};
  if (missingActions.length > 0) out.actions = missingActions;
  if (missingHosts.length > 0) out.hosts = missingHosts;
  return out;
}

function _hasAnyMissing(missing) {
  if (Object.keys(missing.servers || {}).length > 0) return true;
  if (missing.domains?.fs) return true;
  if (missing.domains?.network) return true;
  return false;
}

function _collectWidgetComponentNames(layout) {
  const names = [];
  if (!Array.isArray(layout)) return names;
  for (const item of layout) {
    if (item && item.type === "widget" && typeof item.component === "string") {
      names.push(item.component);
    }
  }
  return names;
}

export function computeDashboardPreflight({ layout, allRows, registry }) {
  const widgetComponentNames = _collectWidgetComponentNames(layout);
  if (widgetComponentNames.length === 0) return { widgets: [] };
  if (!Array.isArray(allRows)) return { widgets: [] };

  // Build a quick lookup from componentName → row. We match by the
  // last dotted segment of widgetId.
  const rowByBareName = new Map();
  for (const r of allRows) {
    const bareName = _bareNameFromWidgetId(r.widgetId);
    if (bareName) rowByBareName.set(bareName, r);
  }

  const widgets = [];
  const seenWidgetIds = new Set();

  for (const componentName of widgetComponentNames) {
    const row = rowByBareName.get(componentName);
    if (!row) continue;
    if (seenWidgetIds.has(row.widgetId)) continue;
    if (!row.declared) continue; // No manifest → falls through to runtime JIT

    const missing = {
      servers: _diffServers(row.declared.servers, row.granted?.servers),
      domains: {},
    };
    const fsDiff = _diffFs(row.declared.domains?.fs, row.granted?.domains?.fs);
    if (fsDiff) missing.domains.fs = fsDiff;
    const netDiff = _diffNetwork(
      row.declared.domains?.network,
      row.granted?.domains?.network,
    );
    if (netDiff) missing.domains.network = netDiff;

    if (!_hasAnyMissing(missing)) continue;

    const packageId = _packageIdFromWidgetId(row.widgetId, registry);
    if (!packageId) continue; // Can't render meaningfully without package context

    widgets.push({
      widgetId: row.widgetId,
      packageId,
      displayName: componentName,
      missing,
    });
    seenWidgetIds.add(row.widgetId);
  }

  return { widgets };
}
