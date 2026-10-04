/**
 * widgetSummary — the Widgets page's view of installed widgets (app-navigation
 * PRD NAV-008): org → package → widgets. A package is what gets published and
 * installed; widgets are what get placed on a dashboard. Pure.
 */
import { collectComponentsFromLayout } from "../../hooks/useInstalledWidgets";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { deriveWidgetOwnership } from "../../utils/widgetOwnership";

export const BUILT_IN = "Built-in";
export const AI_BUILT = "AI-built";
export const LOCAL = "Local";

const AI_SCOPE = "@ai-built";
const scopeOf = (id) => {
  const m = /^(@[^/]+)\//.exec(id || "");
  return m ? m[1] : null;
};

function orgOf(w) {
  if (w.source === "builtin") return BUILT_IN;
  if (w.kind === "draft") return AI_BUILT;
  const scope = scopeOf(w.packageId);
  if (scope === AI_SCOPE) return AI_BUILT;
  return scope || LOCAL;
}

function packageIdOf(w) {
  if (w.source === "builtin") return `builtin:${w.package || BUILT_IN}`;
  return w.packageId || w.name;
}

function sourceOf(w, org) {
  if (w.source === "builtin") return "Built-in";
  if (w.kind === "draft") return "Draft";
  if (org === AI_BUILT) return "AI-built";
  return "Installed";
}

/** Which dashboards use these components — every page, not just the first. */
export function usageOf(componentNames, workspaces) {
  const names = new Set(componentNames || []);
  if (!names.size) return [];
  const out = [];
  for (const ws of workspaces || []) {
    const layouts =
      Array.isArray(ws.pages) && ws.pages.length
        ? ws.pages.map((p) => p.layout)
        : [ws.layout];
    let count = 0;
    for (const layout of layouts) {
      count += collectComponentsFromLayout(layout).filter((c) =>
        names.has(c),
      ).length;
    }
    if (count > 0) {
      out.push({
        workspaceId: ws.id,
        workspaceName: ws.name || String(ws.id),
        count,
      });
    }
  }
  return out;
}

/** The package's name in the list (its scope is the org heading). */
export function packageLabel(pkg) {
  if (pkg.isBuiltIn) return pkg.id.replace(/^builtin:/, "");
  if (pkg.isDraft) {
    const w = pkg.widgets[0] || {};
    return `${w.displayName || w.name || "Widget"} (draft)`;
  }
  return pkg.id.replace(/^@[^/]+\//, "");
}

const ORG_RANK = (name) =>
  name === BUILT_IN ? 3 : name === LOCAL ? 2 : name === AI_BUILT ? 1 : 0;

/**
 * Widgets grouped org → package → widgets: registry scopes A-Z, then
 * AI-built, Local, Built-in.
 * @returns {Array<{ name, packages: Array<{ id, org, version, source,
 *   isBuiltIn, isDraft, mine, update, providers, description, widgets,
 *   usedOn, widgetUsage }> }>}
 */
export function widgetOrgs(
  widgets,
  { workspaces = [], updates, username = null } = {},
) {
  const packages = new Map();
  for (const w of widgets || []) {
    if (!w) continue;
    const id = packageIdOf(w);
    let pkg = packages.get(id);
    if (!pkg) {
      const org = orgOf(w);
      pkg = {
        id,
        org,
        version: w.version || null,
        source: sourceOf(w, org),
        isBuiltIn: w.source === "builtin",
        isDraft: w.kind === "draft",
        // The user's own: their username's scope (the only scope they can
        // publish under), plus their local @ai-built packages and drafts.
        mine:
          !(w.source === "builtin") &&
          deriveWidgetOwnership({
            originalPackage: id,
            registryUsername: username,
          }).isOwner,
        update: null,
        description: null,
        providers: [],
        widgets: [],
      };
      packages.set(id, pkg);
    }
    pkg.widgets.push(w);
    if (!pkg.version && w.version) pkg.version = w.version;
    if (!pkg.description && w.description) pkg.description = w.description;
    if (!pkg.update && updates && updates.get) {
      pkg.update = updates.get(w.name) || null;
    }
    for (const p of getUserConfigurableProviders(w.providers)) {
      if (p.type && !pkg.providers.includes(p.type)) pkg.providers.push(p.type);
    }
  }

  const orgs = new Map();
  for (const pkg of packages.values()) {
    pkg.widgetUsage = {};
    for (const w of pkg.widgets) {
      pkg.widgetUsage[w.name] = usageOf(w.componentNames, workspaces);
    }
    pkg.usedOn = usageOf(
      pkg.widgets.flatMap((w) => w.componentNames || []),
      workspaces,
    );
    if (!orgs.has(pkg.org)) orgs.set(pkg.org, { name: pkg.org, packages: [] });
    orgs.get(pkg.org).packages.push(pkg);
  }
  return [...orgs.values()]
    .map((o) => ({
      ...o,
      packages: o.packages.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort(
      (a, b) =>
        ORG_RANK(a.name) - ORG_RANK(b.name) || a.name.localeCompare(b.name),
    );
}

const CHIPS = {
  inUse: (pkg) => pkg.usedOn.length > 0,
  notUsed: (pkg) => pkg.usedOn.length === 0,
  mine: (pkg) => pkg.mine,
};

/**
 * Search, Org filter and chips. Each kept package gets `matched` — the
 * widgets to show — and `queryMatchedWidgets` when only some widgets matched
 * (the list then shows them under the package).
 */
export function filterOrgs(orgs, { query = "", orgs: only = [], chip } = {}) {
  const q = query.trim().toLowerCase();
  const keep = CHIPS[chip] || (() => true);
  return (orgs || [])
    .filter((o) => !only.length || only.includes(o.name))
    .map((o) => ({
      ...o,
      packages: o.packages
        .filter(keep)
        .map((pkg) => {
          if (!q) return { ...pkg, matched: pkg.widgets };
          const pkgText = `${pkg.id} ${packageLabel(pkg)}`.toLowerCase();
          if (pkgText.includes(q)) return { ...pkg, matched: pkg.widgets };
          const matched = pkg.widgets.filter((w) =>
            [w.displayName, w.name, w.description]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q),
          );
          return { ...pkg, matched, queryMatchedWidgets: true };
        })
        .filter((pkg) => pkg.matched.length),
    }))
    .filter((o) => o.packages.length);
}
