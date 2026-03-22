/**
 * Extract a search query from a widget component key.
 *
 * Scoped IDs look like "scope.packageName.WidgetName" — we can do an exact
 * package lookup with the middle segment.  Plain names are just the widget
 * class name, so we fall back to a search.
 */
export function getWidgetSearchQuery(componentKey) {
  const parts = componentKey.split(".");
  if (parts.length >= 3) {
    return {
      packageName: parts[1],
      widgetName: parts[2],
      scope: parts[0],
    };
  }
  return { packageName: null, widgetName: componentKey, scope: null };
}

/**
 * Convert a raw registry package object into the flat widget shape
 * expected by RegistryPackageDetail.
 */
export function packageToFlatWidget(pkg) {
  return {
    key: `${pkg.name}/0`,
    name: pkg.displayName || pkg.name,
    icon: pkg.icon || null,
    isRegistry: true,
    packageName: pkg.name,
    packageScope: pkg.scope || null,
    packageDisplayName: pkg.displayName || pkg.name,
    packageVersion: pkg.version,
    packageAuthor: pkg.author || "",
    packageDescription: pkg.description || "",
    packageTags: pkg.tags || [],
    packageCategory: pkg.category || "",
    downloadUrl: pkg.downloadUrl || "",
    repository: pkg.repository || "",
    publishedAt: pkg.publishedAt || "",
    packageWidgets: pkg.widgets || [],
    appOrigin: pkg.appOrigin || null,
    packageProviders: pkg.providers || [],
    missingApis: [],
  };
}
