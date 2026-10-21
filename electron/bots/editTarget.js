/**
 * editTarget.js — the widget a change goes to (consolidation Phase 3, Create
 * › Change <widget>). The renderer names the component; which package that
 * is, and whether the user may change it in place, is worked out here from
 * what's installed and who's signed in — never taken from the renderer or
 * the Builder.
 *
 * The ownership rule is src/utils/widgetOwnership.js's (the Widget Builder
 * and the Widgets page use that one): AI-built widgets are always the
 * user's; otherwise the package's scope must be the signed-in registry
 * username. editTarget.test.js checks the two agree.
 *
 * Pure (NFR-006).
 */
"use strict";

const AI_BUILT = "ai-built";

/** "jg" from "@jg/inbox", "jg/inbox" or "jg.inbox.Inbox"; null if neither. */
function scopeOf(pkg, component) {
  const p = typeof pkg === "string" ? pkg : "";
  const m = /^@([^/]+)\//.exec(p) || /^([^/@]+)\//.exec(p);
  if (m) return m[1];
  const c = typeof component === "string" ? component : "";
  const d = /^([^.]+)\./.exec(c);
  return d ? d[1] : null;
}

/** May the user change this widget in place? */
function ownsWidget({ pkg, component, username }) {
  const scope = scopeOf(pkg, component);
  const s = typeof scope === "string" ? scope.toLowerCase() : null;
  const u =
    typeof username === "string"
      ? username.toLowerCase().replace(/^@/, "")
      : null;
  return s === AI_BUILT || (!!u && s === u);
}

/**
 * Does this installed package hold the component ("jg.inbox.Inbox")? The
 * registry lists components by their bare names ("Inbox"), so the package
 * must also be that id's scope/package ("@jg/inbox", or "inbox" as a
 * registry package is kept). Keep src/Components/Create/editCreate.js's
 * copy the same (editTarget.parity.test.js checks).
 */
function holdsComponent(w, component) {
  if (!w || typeof component !== "string") return false;
  const names = [
    ...(Array.isArray(w.componentNames) ? w.componentNames : []),
    ...(Array.isArray(w.widgets) ? w.widgets : []).map((x) => x && x.name),
  ];
  if (names.includes(component)) return true;
  const parts = component.split(".");
  if (parts.length < 3 || !names.includes(parts[parts.length - 1])) {
    return false;
  }
  const pkg = String(w.packageId || w.name || "")
    .toLowerCase()
    .replace(/^@/, "");
  return (
    pkg === `${parts[0]}/${parts[1]}`.toLowerCase() ||
    pkg === parts[1].toLowerCase()
  );
}

const isAiBuilt = (pkg, component) =>
  String(scopeOf(pkg, component) || "").toLowerCase() === AI_BUILT;

/**
 * Why a change can't go in place ("<name> <reason>"), or null: the package has no registry
 * name (an unscoped "inbox" — whose it is can't be told), or it's an
 * AI-built package holding more than this widget (@ai-built/<name> is
 * replaced whole). Ownership is checked separately (ownsWidget).
 * Keep src/Components/Create/editCreate.js's copy the same
 * (editTarget.parity.test.js checks).
 */
function inPlaceProblem({ package: pkg, componentName }) {
  const name = String(componentName || "");
  const p = String(pkg || "");
  if (!scopeOf(p, null)) {
    return "has no registry name";
  }
  if (
    isAiBuilt(p, null) &&
    p.toLowerCase() !== `@${AI_BUILT}/${name.toLowerCase()}`
  ) {
    return "shares its package with other widgets";
  }
  return null;
}

/**
 * The installed widget a change goes to: { package, component,
 * componentName, aiBuilt } — the package as the registry keeps it — or
 * { error }.
 * @param {object} edit  from the renderer: { component, mode, … }
 * @param {Array<{ name, componentNames? }>} installed  the registry's widgets
 */
function resolveEditTarget(edit, installed) {
  const component = String((edit && edit.component) || "").trim();
  if (component.split(".").length < 3) {
    return { error: "Which widget should change?" };
  }
  const mode = edit && edit.mode === "new" ? "new" : "update";
  const found = (Array.isArray(installed) ? installed : []).find((w) =>
    holdsComponent(w, component),
  );
  if (!found || !found.name) {
    return { error: `${component} isn't installed here any more.` };
  }
  const target = {
    package: String(found.name),
    component,
    componentName: component.split(".").pop(),
    mode,
    // From the installed package only — never the id the renderer sent.
    aiBuilt: isAiBuilt(found.name, null),
  };
  const problem = mode === "update" ? inPlaceProblem(target) : null;
  return problem
    ? {
        error: `${target.componentName} ${problem}, so it can't be changed in place — save the change as a new widget.`,
      }
    : target;
}

module.exports = {
  scopeOf,
  ownsWidget,
  isAiBuilt,
  holdsComponent,
  inPlaceProblem,
  resolveEditTarget,
};
