/**
 * secretFields.js
 *
 * Keep secret values out of anything that leaves this computer — profile
 * files and Export Everything. A widget setting the user typed a key or
 * password into is stored in plain text in the dashboard (`userPrefs`);
 * the setting itself travels (so the other computer knows it's needed),
 * its value doesn't.
 *
 * A setting is secret when its widget declares it `type: "secret"` (or
 * "password"), or when its name clearly says so (apiKey, accessToken,
 * password, clientSecret, …). Provider settings that are kept (MCP
 * arguments, URLs) have token-like values redacted.
 */
const fs = require("fs");
const path = require("path");

const SECRET_TYPES = new Set(["secret", "password"]);

// Words that make a setting's name a secret on their own, and the words
// that make "key" one (an "apiKey" is, a "sortKey" isn't).
const SECRET_WORDS = new Set([
  "token",
  "tokens",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "bearer",
]);
const KEY_PREFIXES = new Set([
  "api",
  "access",
  "private",
  "secret",
  "auth",
  "client",
  "license",
  "signing",
]);

function nameWords(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does a setting's name say it holds a secret? */
function looksSecretName(name) {
  const words = nameWords(name);
  for (let i = 0; i < words.length; i++) {
    if (SECRET_WORDS.has(words[i])) return true;
    if (words[i] === "key" && i > 0 && KEY_PREFIXES.has(words[i - 1])) {
      return true;
    }
    if (words[i] === "apikey" || words[i] === "accesskey") return true;
  }
  return false;
}

/** The setting names a widget config declares secret. */
function secretFieldsOfConfig(config) {
  const out = new Set();
  const userConfig = config && config.userConfig;
  if (!userConfig || typeof userConfig !== "object") return out;
  for (const [field, spec] of Object.entries(userConfig)) {
    if (spec && typeof spec === "object" && SECRET_TYPES.has(spec.type)) {
      out.add(field);
    }
  }
  return out;
}

/**
 * Read an installed widget package's `.dash.js` files (the safe AST
 * parser — never evaluated) → Map<componentName, Set<secret field>>.
 */
function secretFieldsOfPackage(packagePath) {
  const map = new Map();
  if (!packagePath) return map;
  const { parseDashConfig } = require("../utils/dashConfigParser");
  let dirs = [];
  for (const rel of ["widgets", "configs/widgets", "configs"]) {
    const dir = path.join(packagePath, rel);
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  for (const dir of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch (_e) {
      files = [];
    }
    for (const file of files) {
      if (!file.endsWith(".dash.js")) continue;
      let parsed;
      try {
        parsed = parseDashConfig(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch (_e) {
        continue;
      }
      if (!parsed || !parsed.ok) continue;
      const name =
        (typeof parsed.config.name === "string" && parsed.config.name) ||
        file.replace(/\.dash\.js$/, "");
      map.set(name, secretFieldsOfConfig(parsed.config));
    }
  }
  return map;
}

function isEmpty(value) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

/** The component name of a layout item ("scope.pkg.Comp" → "Comp"). */
function componentOf(item) {
  const c = String((item && (item.componentName || item.component)) || "");
  return c.split(".").pop();
}

/**
 * A copy of a dashboard with `visit(item, key)` applied to every layout
 * item. Item ids repeat across pages (and the top-level layout mirrors
 * the active page), so an item's key includes where it is:
 * "layout/<id>", "sidebar/<id>" or "page:<pageId>/<id>".
 */
function mapItems(workspace, visit) {
  const walkIn = (section) => {
    const walk = (item) => {
      if (!item || typeof item !== "object") return item;
      const next = visit(item, `${section}/${item.uuid || item.id}`);
      if (Array.isArray(item.items)) next.items = item.items.map(walk);
      if (Array.isArray(item.layout)) next.layout = item.layout.map(walk);
      return next;
    };
    return walk;
  };
  const out = { ...workspace };
  if (Array.isArray(out.layout)) out.layout = out.layout.map(walkIn("layout"));
  if (Array.isArray(out.sidebarLayout)) {
    out.sidebarLayout = out.sidebarLayout.map(walkIn("sidebar"));
  }
  if (Array.isArray(out.pages)) {
    out.pages = out.pages.map((page) =>
      page && Array.isArray(page.layout)
        ? { ...page, layout: page.layout.map(walkIn(`page:${page.id}`)) }
        : page,
    );
  }
  return out;
}

/** Is this setting secret — declared so by its widget, or named so? */
function isSecretSetting(field, declared) {
  return declared.has(field) || looksSecretName(field);
}

/**
 * A copy of a dashboard with every secret widget setting's value blanked,
 * and the list of what was blanked. `secretFieldsFor(item)` returns the
 * Set of setting names its widget declares secret.
 */
function blankDashboardSecrets(workspace, secretFieldsFor = () => new Set()) {
  const blanked = [];
  if (!workspace || typeof workspace !== "object") {
    return { workspace, blanked };
  }
  const out = mapItems(workspace, (item, key) => {
    const next = { ...item };
    if (item.userPrefs && typeof item.userPrefs === "object") {
      const declared = secretFieldsFor(item) || new Set();
      const prefs = { ...item.userPrefs };
      for (const field of Object.keys(prefs)) {
        if (!isSecretSetting(field, declared) || isEmpty(prefs[field])) {
          continue;
        }
        prefs[field] = "";
        blanked.push({
          item: key,
          component: componentOf(item),
          title: item.userPrefs.title || null,
          field,
        });
      }
      next.userPrefs = prefs;
    }
    return next;
  });
  return { workspace: out, blanked };
}

/**
 * item → the Set of settings its widget declares secret, looked up in this
 * computer's installed packages (cached per package).
 */
function secretFieldLookup(registry) {
  const cache = new Map();
  return (item) => {
    const pkg = item && (item.packageId || item._sourcePackage);
    if (!pkg || !registry) return new Set();
    if (!cache.has(pkg)) {
      let installed = null;
      try {
        installed = registry.getWidget(pkg);
      } catch (_e) {
        installed = null;
      }
      cache.set(pkg, secretFieldsOfPackage(installed && installed.path));
    }
    return cache.get(pkg).get(componentOf(item)) || new Set();
  };
}

/**
 * Blank secrets in every dashboard, looking each widget's declared secret
 * settings up in this computer's installed packages.
 * @param {Array} workspaces
 * @param {{getWidget: (pkg: string) => object|null}|null} registry
 */
function blankSecretsInDashboards(workspaces, registry) {
  const fieldsFor = secretFieldLookup(registry);
  const blanked = [];
  const out = (Array.isArray(workspaces) ? workspaces : []).map((w) => {
    const res = blankDashboardSecrets(w, fieldsFor);
    for (const b of res.blanked) {
      blanked.push({
        dashboardId: w && w.id,
        dashboard: (w && (w.name || w.label)) || "Untitled",
        ...b,
      });
    }
    return res.workspace;
  });
  return { workspaces: out, blanked };
}

/** Every layout item of a dashboard, by its key (see mapItems). */
function itemsByKey(workspace) {
  const out = new Map();
  if (workspace && typeof workspace === "object") {
    mapItems(workspace, (item, key) => {
      out.set(key, item);
      return { ...item };
    });
  }
  return out;
}

/**
 * A dashboard loaded over this computer's copy keeps the secret values
 * this computer already has (the file never carries them).
 */
function restoreSecrets(incoming, local, secretFieldsFor = () => new Set()) {
  if (!incoming || !local) return incoming;
  const mine = itemsByKey(local);
  return mapItems(incoming, (item, key) => {
    const next = { ...item };
    const here = mine.get(key);
    if (item.userPrefs && here && here.userPrefs) {
      const declared = secretFieldsFor(item) || new Set();
      const prefs = { ...item.userPrefs };
      for (const field of Object.keys(here.userPrefs)) {
        if (!isSecretSetting(field, declared)) continue;
        if (isEmpty(prefs[field]) && !isEmpty(here.userPrefs[field])) {
          prefs[field] = here.userPrefs[field];
        }
      }
      next.userPrefs = prefs;
    }
    return next;
  });
}

/** Does this computer's copy of a dashboard have a value for a setting? */
function hasSecretValue(local, itemKey, field) {
  const item = itemsByKey(local).get(String(itemKey));
  return !!(item && item.userPrefs && !isEmpty(item.userPrefs[field]));
}

const REDACTED = "";

/** A URL without a password or token-like query values. */
function redactUrl(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  let url;
  try {
    url = new URL(value);
  } catch (_e) {
    return value;
  }
  let changed = false;
  if (url.password) {
    url.password = "";
    changed = true;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (looksSecretName(key) || /^(key|sig|signature|code)$/i.test(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? url.toString() : value;
}

/** MCP arguments without token-like values (`--token=x`, `--api-key x`). */
function redactArgs(args) {
  if (!Array.isArray(args)) return args;
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string") {
      out.push(arg);
      continue;
    }
    const flag = arg.match(/^(--?[A-Za-z0-9_-]+)=(.*)$/);
    if (flag && looksSecretName(flag[1].replace(/^-+/, ""))) {
      out.push(`${flag[1]}=${REDACTED}`);
      continue;
    }
    const prev = i > 0 ? args[i - 1] : null;
    if (
      typeof prev === "string" &&
      /^--?[A-Za-z0-9_-]+$/.test(prev) &&
      looksSecretName(prev.replace(/^-+/, "")) &&
      !arg.startsWith("-")
    ) {
      out.push(REDACTED);
      continue;
    }
    out.push(redactUrl(arg));
  }
  return out;
}

module.exports = {
  looksSecretName,
  secretFieldsOfConfig,
  secretFieldsOfPackage,
  blankDashboardSecrets,
  blankSecretsInDashboards,
  secretFieldLookup,
  restoreSecrets,
  hasSecretValue,
  redactUrl,
  redactArgs,
  mapItems,
  itemsByKey,
};
