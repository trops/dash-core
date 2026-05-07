/**
 * normalizeGrantsByProviderType
 *
 * The grant store keys `granted.servers` by the user's provider
 * INSTANCE LABEL (e.g. "Gmail New", "Filesystem", "Filesystem_pipeline"),
 * because the runtime gate authorizes specific provider instances and
 * needs to disambiguate when a user has multiple of the same type.
 *
 * The widget-package manifest scanner, however, extracts the literal
 * type string from `useMcpProvider("gmail")` / `useMcpProvider("filesystem")`
 * — there's no instance-level info available at static-scan time.
 *
 * That mismatch means declared (manifest, type-keyed) blocks never join
 * with granted (label-keyed) blocks for direct comparison, and
 * Settings → Privacy paints every grant amber-stale even when the
 * widget's source code DOES request the granted tool.
 *
 * This helper bridges the two by rewriting each row's granted.servers
 * keys from instance labels to provider types, using the renderer's
 * already-loaded `AppContext.providers` map (label → { type, ... }).
 *
 * Multiple instances of the same type collapse into a single
 * type-keyed entry whose tools/readPaths/writePaths are the union.
 * That matches the manifest semantics: "this widget needs ANY provider
 * of type X for these tools."
 *
 * Pure function. No mutation of inputs.
 *
 * @param {Array} rows - rows from window.mainApi.widgetMcp.listAll()
 * @param {object|null} providersByLabel - AppContext.providers (label → provider)
 * @returns {Array} rows with each granted.servers re-keyed by type
 */
export function normalizeGrantsByProviderType(rows, providersByLabel) {
  if (!Array.isArray(rows)) return [];
  const labelToType = new Map();
  if (providersByLabel && typeof providersByLabel === "object") {
    for (const [label, provider] of Object.entries(providersByLabel)) {
      const type =
        provider && typeof provider === "object" ? provider.type : null;
      if (typeof type === "string" && type) {
        labelToType.set(label, type);
      }
    }
  }
  return rows.map((row) => normalizeRow(row, labelToType));
}

function normalizeRow(row, labelToType) {
  if (!row || !row.granted || !row.granted.servers) return row;
  const labels = Object.keys(row.granted.servers);
  const anyTranslated = labels.some((l) => labelToType.has(l));
  if (!anyTranslated) return row;

  const newServers = {};
  for (const [label, perms] of Object.entries(row.granted.servers)) {
    const type = labelToType.get(label);
    const targetKey = type || label;
    // Track the original instance labels so the renderer can show
    // "filesystem (Filesystem, Filesystem_pipeline)" — otherwise the
    // user just sees the bare type and loses the connection to the
    // provider names they configured. Only populated when the label
    // was actually translated (i.e. label !== targetKey).
    if (!newServers[targetKey]) {
      newServers[targetKey] = {
        tools: [...(perms.tools || [])],
        readPaths: [...(perms.readPaths || [])],
        writePaths: [...(perms.writePaths || [])],
        _labels: type ? [label] : [],
      };
    } else {
      const existing = newServers[targetKey];
      existing.tools = unionDedupe(existing.tools, perms.tools);
      existing.readPaths = unionDedupe(existing.readPaths, perms.readPaths);
      existing.writePaths = unionDedupe(existing.writePaths, perms.writePaths);
      if (type && !existing._labels.includes(label))
        existing._labels.push(label);
    }
  }
  return {
    ...row,
    granted: { ...row.granted, servers: newServers },
  };
}

function unionDedupe(a, b) {
  const out = new Set(Array.isArray(a) ? a : []);
  if (Array.isArray(b)) for (const x of b) out.add(x);
  return Array.from(out);
}
