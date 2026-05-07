/**
 * widgetPublishManifest.js
 *
 * Pure helpers for widget-publish flow — version bumping, package-name
 * parsing, and manifest generation. No electron / fs / adm-zip deps so
 * these can be unit-tested directly.
 */

const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function bumpVersion(current, type) {
  if (!current || typeof current !== "string") return "1.0.0";
  const match = current.match(SEMVER_RE);
  if (!match) return current;
  let [, major, minor, patch] = match;
  major = Number(major);
  minor = Number(minor);
  patch = Number(patch);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function resolveNextVersion(currentVersion, options = {}) {
  if (options.version) return options.version;
  if (options.bump) return bumpVersion(currentVersion, options.bump);
  return currentVersion;
}

function parsePackageName(pkgName) {
  if (!pkgName) return { scope: null, name: "" };
  const m = pkgName.match(/^@([^/]+)\/(.+)$/);
  if (m) return { scope: m[1], name: m[2] };
  return { scope: null, name: pkgName };
}

function generateWidgetRegistryManifest(
  packageJson,
  widgetConfigs,
  options = {},
) {
  const parsed = parsePackageName(packageJson.name || "");
  const scope = options.scope || parsed.scope || "";
  const name = options.name || parsed.name || packageJson.name || "";
  const version = options.version || packageJson.version || "1.0.0";
  const visibility = options.visibility === "private" ? "private" : "public";

  // Drop falsy / non-object entries from a providers array before we
  // iterate or reshape it. `.dash.js` configs occasionally ship sparse
  // arrays (trailing commas, stripped comments, conditional includes
  // that returned undefined) and those used to crash every consumer
  // that iterated the array with `p.providerClass`. Publish-side
  // sanitization means installed packages never carry the bad entry.
  const sanitizeProviderList = (list) =>
    Array.isArray(list) ? list.filter((p) => p && typeof p === "object") : [];

  const providerKeys = new Set();
  const providers = [];
  for (const cfg of widgetConfigs || []) {
    for (const p of sanitizeProviderList(cfg.providers)) {
      const key = `${p.type}:${p.providerClass || "mcp"}`;
      if (providerKeys.has(key)) continue;
      providerKeys.add(key);
      providers.push({
        type: p.type,
        required: p.required !== false,
        providerClass: p.providerClass || "mcp",
      });
    }
  }

  const widgets = (widgetConfigs || []).map((cfg) => ({
    name: cfg.component || cfg.name,
    displayName: cfg.name || cfg.component,
    description: cfg.description || "",
    icon: cfg.icon || "square",
    providers: sanitizeProviderList(cfg.providers).map((p) => ({
      type: p.type,
      required: p.required !== false,
      providerClass: p.providerClass || "mcp",
    })),
  }));

  const manifest = {
    scope,
    name,
    displayName: options.displayName || packageJson.displayName || name,
    version,
    type: "widget",
    visibility,
    description: options.description || packageJson.description || "",
    author:
      options.authorName ||
      (typeof packageJson.author === "string"
        ? packageJson.author
        : packageJson.author?.name || ""),
    category: options.category || "general",
    tags: Array.isArray(options.tags) ? options.tags : [],
    icon: options.icon || "puzzle-piece",
    providers,
    widgets,
    appOrigin: options.appOrigin || "",
    publishedAt: new Date().toISOString(),
  };

  // Slice 13c: forward `dash.permissions.mcp` from package.json into
  // the registry manifest so installers can show "what tools does
  // this widget need" before downloading. The block is computed by
  // the install/publish/boot scanner pipeline (slice 13a/13b) and
  // sanitized here on the way out.
  const sanitizedPermissions = sanitizePermissionsBlock(
    packageJson?.dash?.permissions?.mcp,
  );
  if (sanitizedPermissions) manifest.permissions = sanitizedPermissions;

  return manifest;
}

/**
 * Defensive sanitizer — keeps the published manifest safe even if a
 * widget's package.json has a malformed permissions block. Drops
 * non-object server values and filters tools/readPaths/writePaths
 * down to non-empty strings. Returns null if the block has no
 * surviving content (caller omits the field entirely).
 */
function sanitizePermissionsBlock(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [serverName, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const block = {};
    if (Array.isArray(value.tools)) {
      const tools = value.tools.filter((t) => typeof t === "string" && t);
      if (tools.length > 0) block.tools = tools;
    }
    if (Array.isArray(value.readPaths)) {
      const r = value.readPaths.filter((p) => typeof p === "string" && p);
      if (r.length > 0) block.readPaths = r;
    }
    if (Array.isArray(value.writePaths)) {
      const w = value.writePaths.filter((p) => typeof p === "string" && p);
      if (w.length > 0) block.writePaths = w;
    }
    if (Object.keys(block).length > 0) out[serverName] = block;
  }
  return Object.keys(out).length > 0 ? out : null;
}

module.exports = {
  bumpVersion,
  resolveNextVersion,
  parsePackageName,
  generateWidgetRegistryManifest,
};
