/**
 * remixSource.js
 *
 * What a copy is a copy of, so Duplicate keeps the credit: publishing a copy
 * of someone else's dashboard or theme is a remix of the original, and is
 * refused when its author doesn't allow remixes (user decisions,
 * 2026-10-27; the main process — electron/registry/remix.js — and the
 * registry decide, this only remembers).
 *
 * @param {object} record  a stored dashboard or theme
 * @returns {{package: string, version: string|null}|null} null for the
 *   user's own work (made here, or published from here)
 */
export function remixSourceOf(record) {
  if (!record || typeof record !== "object") return null;
  // Already a copy: keep pointing at the same original.
  const r = record.remixedFrom;
  if (r && typeof r === "object") {
    const pkg =
      r.package || (r.scope && r.name ? `${r.scope}/${r.name}` : null);
    if (pkg) return { package: pkg, version: r.version || null };
  }
  // Installed from the registry.
  const ref = record.registryRef;
  if (ref && ref.package) {
    return ref.origin === "installed"
      ? { package: ref.package, version: ref.version || null }
      : null;
  }
  const meta = record._registryMeta;
  if (meta && meta.packageName) {
    return meta.lastPublishedVersion
      ? null
      : { package: meta.packageName, version: record.version || null };
  }
  const config = record._dashboardConfig;
  if (config && config.registryPackage && !config.registryScope) {
    return {
      package: config.registryPackage,
      version: config.installedVersion || null,
    };
  }
  return null;
}

/**
 * The credit line for a registry package that is a remix (the registry's
 * `remixedFrom`): "Remix of Kitchen Sink by trops · originally Sink by alice".
 * Null when it isn't one.
 */
export function remixCreditText(credit) {
  if (!credit || typeof credit !== "object" || !credit.name) return null;
  const what = credit.displayName || credit.name;
  let text = `Remix of ${what}${credit.author ? ` by ${credit.author}` : ""}`;
  const root = credit.root;
  if (root && root.name) {
    text += ` · originally ${root.displayName || root.name}${
      root.author ? ` by ${root.author}` : ""
    }`;
  }
  return text;
}
