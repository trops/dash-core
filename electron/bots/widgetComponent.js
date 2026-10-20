/**
 * widgetComponent.js — the component id a layout uses for a widget the
 * Builder names (create-entry PRD CRE-011, slice 3c).
 *
 * Layouts name widgets by their scoped id, `scope.package.Component`
 * (src/utils/scopedComponentId.js). The Builder knows a package
 * (`@ai-built/gmailunreadcount`, from build_widget or search_library), so
 * this finds the package among the installed widgets and picks its
 * component. A full dotted id (e.g. a built-in `dash.bots.BotResults`) is
 * taken as it is.
 *
 * Pure (NFR-006): the installed-widget list is passed in.
 */
"use strict";

/** "@ai-built/pipeline" + "Column" → "ai-built.pipeline.Column" (as in src). */
function scopedId(packageName, componentName) {
  const cleaned = String(packageName).replace(/^@/, "").replace(/\//g, ".");
  return `${cleaned}.${componentName}`;
}

/**
 * @param {string} widget     a package ("@scope/pkg") or a dotted component id
 * @param {string|null} component  which component, when the package has several
 * @param {() => object[]} listInstalled  widget registry entries
 * @param {{ name?: string }} [hint]  the plan's name for the widget: with no
 *   component, a package with several widgets uses the one it names
 *   ("Algolia Rules List" → AlgoliaRulesList, ignoring spaces and case)
 * @returns {{ component: string } | { error: string }}
 */
function resolveWidgetComponent(widget, component, listInstalled, hint = {}) {
  const name = String(widget || "").trim();
  if (!name) return { error: "Which widget?" };
  if (!name.includes("/")) {
    // Already a component id (scope.package.Component, or a built-in).
    return name.split(".").length >= 3
      ? { component: name }
      : {
          error: `"${name}" isn't a widget package or a full component id (scope.package.Component).`,
        };
  }
  const pkgName = name.startsWith("@") ? name : `@${name}`;
  const pkg = (listInstalled() || []).find(
    (p) => p && String(p.name).toLowerCase() === pkgName.toLowerCase(),
  );
  if (!pkg) return { error: `${pkgName} isn't installed.` };
  const comps = (Array.isArray(pkg.widgets) ? pkg.widgets : [])
    .map((w) => w && w.name)
    .filter(Boolean);
  if (!comps.length) return { error: `${pkgName} has no widgets to place.` };
  let pick = comps[0];
  if (component) {
    const want = String(component).split(".").pop();
    const hit = comps.find((c) => c.toLowerCase() === want.toLowerCase());
    if (!hit) {
      return {
        error: `${pkgName} has no component "${component}" (it has ${comps.join(", ")}).`,
      };
    }
    pick = hit;
  } else if (comps.length > 1) {
    const squash = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    const named = hint && hint.name ? squash(hint.name) : "";
    // "Digital Clock" names DigitalClockWidget too (the common suffix),
    // and a widget's display name counts (found live, Phase 2b).
    const bare = (v) => squash(v).replace(/widget$/, "");
    const entries = (Array.isArray(pkg.widgets) ? pkg.widgets : []).filter(
      (w) => w && w.name,
    );
    const byName = named
      ? comps.find((c) => squash(c) === named) ||
        comps.find((c) => bare(c) === bare(named)) ||
        (
          entries.find(
            (w) => w.displayName && bare(w.displayName) === bare(named),
          ) || {}
        ).name
      : null;
    const hit = byName || null;
    if (hit) return { component: scopedId(pkg.name, hit) };
    return {
      error: `${pkgName} has several widgets (${comps.join(", ")}) — say which with component.`,
    };
  }
  return { component: scopedId(pkg.name, pick) };
}

module.exports = { resolveWidgetComponent, scopedId };
