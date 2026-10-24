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
// A package loaded from a folder while signed out (widgetRegistry
// scopedLocalId).
const LOCAL_SCOPE = "@local";
const scopeOf = (id) => {
  const m = /^(@[^/]+)\//.exec(id || "");
  return m ? m[1] : null;
};

function orgOf(w) {
  if (w.source === "builtin") return BUILT_IN;
  if (w.kind === "draft") return AI_BUILT;
  const scope = scopeOf(w.packageId);
  if (scope === AI_SCOPE) return AI_BUILT;
  if (scope === LOCAL_SCOPE) return LOCAL;
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

// ComponentConfigModel's default `name` — not a real title.
const DEFAULT_CONFIG_NAME = "My Workspace";

/**
 * A widget's title in lists: its display name, else its component name
 * made readable ("trops.slack.ChannelMessages" → "Channel Messages").
 * The config model's default "My Workspace" never counts as a name, nor
 * does a display name that's just its component id.
 */
export function widgetTitle(w) {
  const real = (v) =>
    typeof v === "string" && v.trim() && v.trim() !== DEFAULT_CONFIG_NAME
      ? v.trim()
      : null;
  const display = real(w && w.displayName);
  const ids = [w && w.name, ...((w && w.componentNames) || [])].filter(Boolean);
  const shown = display && ids.includes(display) ? null : display;
  if (shown) return shown;
  const component =
    ((w && w.componentNames) || []).find(
      (n) => n && !String(n).startsWith("@"),
    ) ||
    (w && w.name);
  const last = real(
    String(component || "")
      .split(".")
      .pop(),
  );
  if (!last) return "Widget";
  return last
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
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
 *   usedOn, widgetUsage, build, checks }> }>}
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
        // publish under), plus their local @ai-built packages and drafts,
        // and @local ones (loaded from their folder while signed out).
        // @local is theirs here only: changing one in place would rewrite
        // their folder, so edits copy it (widgetOwnership, editTarget).
        mine:
          !(w.source === "builtin") &&
          (scopeOf(id) === LOCAL_SCOPE ||
            deriveWidgetOwnership({
              originalPackage: id,
              registryUsername: username,
            }).isOwner),
        update: null,
        description: null,
        providers: [],
        widgets: [],
        // "dash" (built here from its checked source) or "developer"
        // (its own build), and its checks (consolidation Phase 1a-2).
        build: w.build || null,
        checks: w.checks || null,
        // Loaded from the user's own folder: Uninstall forgets it, the
        // folder stays.
        loadedInPlace: !!w.loadedInPlace,
        // Copied from the user's folder: Uninstall removes Dash's copy.
        copiedFromFolder: !!w.copiedFromFolder,
      };
      packages.set(id, pkg);
    }
    pkg.widgets.push(w);
    if (!pkg.version && w.version) pkg.version = w.version;
    if (!pkg.description && w.description) pkg.description = w.description;
    if (!pkg.build && w.build) pkg.build = w.build;
    if (!pkg.checks && w.checks) pkg.checks = w.checks;
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A package's widgets under the In use / Not used chips (consolidation
 * Phase 4b: the list inside an open package). Mine is the package's, so it
 * keeps them all.
 */
export function packageWidgets(pkg, chip) {
  const used = (w) => ((pkg && pkg.widgetUsage[w.name]) || []).length > 0;
  const all = (pkg && pkg.widgets) || [];
  if (chip === "inUse") return all.filter(used);
  if (chip === "notUsed") return all.filter((w) => !used(w));
  return all;
}

/**
 * Search as one flat list (Phase 4b): packages whose name matches, then
 * widgets that match wherever they live, each with its package — so a
 * search never lands inside a closed package. Same Org filter and chips.
 * @returns {{ packages: object[], widgets: Array<{ pkg, widget }> }}
 */
export function searchResults(
  orgs,
  { query = "", orgs: only = [], chip } = {},
) {
  const q = query.trim().toLowerCase();
  const out = { packages: [], widgets: [] };
  if (!q) return out;
  const keep = CHIPS[chip] || (() => true);
  for (const o of orgs || []) {
    if (only.length && !only.includes(o.name)) continue;
    for (const pkg of o.packages.filter(keep)) {
      if (`${pkg.id} ${packageLabel(pkg)}`.toLowerCase().includes(q)) {
        out.packages.push(pkg);
      }
      for (const widget of packageWidgets(pkg, chip)) {
        const text = [
          widgetTitle(widget),
          widget.displayName,
          widget.name,
          widget.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (text.includes(q)) out.widgets.push({ pkg, widget });
      }
    }
  }
  return out;
}

/** The Widgets page's summary, before a package is opened (Phase 4b). */
export function widgetTotals(orgs) {
  const pkgs = (orgs || []).flatMap((o) => o.packages);
  const widgets = pkgs.flatMap((p) =>
    p.widgets.map((w) => ({ pkg: p, widget: w })),
  );
  const inUse = widgets.filter(
    ({ pkg, widget }) => (pkg.widgetUsage[widget.name] || []).length > 0,
  ).length;
  const dashboards = new Set(
    pkgs.flatMap((p) => p.usedOn.map((u) => u.workspaceId)),
  ).size;
  return {
    packages: pkgs.length,
    widgets: widgets.length,
    inUse,
    dashboards,
    updates: pkgs.filter((p) => p.update).length,
  };
}

/**
 * What Uninstall says before it happens (Phase 4b). Uninstall is
 * package-level, so from a widget it names the others that go with it,
 * where each is used, and what those dashboards will show; a package that
 * isn't in the registry (AI-built, local) can't be put back.
 * @param {object} pkg
 * @param {object} [widget]  the widget page it was asked from
 * @returns {{ title, intro, items: string[], note }}
 */
export function uninstallCopy(pkg, widget = null) {
  const label = packageLabel(pkg);
  const n = pkg.widgets.length;
  const usedOnText = (w) => {
    const u = pkg.widgetUsage[w.name] || [];
    return u.length ? ` · on ${u.map((x) => x.workspaceName).join(", ")}` : "";
  };
  const intro =
    n === 1
      ? pkg.usedOn.length
        ? `It's used on ${pkg.usedOn.map((u) => u.workspaceName).join(", ")}.`
        : "It isn't on any dashboard."
      : widget
        ? `${widgetTitle(widget)} comes with ${plural(n - 1, "other widget")} in the ${label} package. Uninstalling removes all ${n}:`
        : `This removes its ${n} widgets:`;
  const items =
    n === 1 ? [] : pkg.widgets.map((w) => `${widgetTitle(w)}${usedOnText(w)}`);
  const notInRegistry = pkg.org === AI_BUILT || pkg.org === LOCAL;
  // Loaded from the user's folder: nothing is deleted. Otherwise, not in
  // the registry: it can't be put back, which is what matters.
  const note = pkg.loadedInPlace
    ? "Dash will forget it. Your folder stays where it is."
    : pkg.copiedFromFolder
      ? `Dash removes its copy. Your folder stays where it is.${
          pkg.usedOn.length
            ? ` ${n === 1 ? "Its cells" : "Their cells"} will show "Widget Not Found" until you load it again.`
            : ""
        }`
      : notInRegistry
        ? "This can't be undone: it isn't in the registry."
        : pkg.usedOn.length
          ? `On ${pkg.usedOn.length === 1 ? "that dashboard" : `those ${pkg.usedOn.length} dashboards`}, ${n === 1 ? "its cell will show" : "the cells will show"} "Widget Not Found" until you reinstall it from the registry.`
          : "";
  return { title: `Uninstall ${label}?`, intro, items, note };
}

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
