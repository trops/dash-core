/**
 * expandToComponentRows
 *
 * Expand a registry's package-level installed-widget entries to one
 * row per component, mirroring the dotted form (`<scope>.<pkg>.<comp>`)
 * that the runtime grant store keys grants by. Without this fan-out,
 * the Privacy & Security panel only ever sees package-level rows
 * (`@trops/gmail`), and component-level rows had to be smuggled in
 * via the orphan-grant loop — disappearing the moment a user
 * fully-revoked their last tool grant for that component.
 *
 * Each fanned-out row preserves `packageId` so groupRowsByPackage
 * still buckets sibling components under the same package header.
 * Entries without a `componentNames` array (or with an empty one)
 * pass through unchanged — the package itself stays as the row.
 *
 * Pure function. No side effects. Mirrors the construction in
 * `src/Components/Dashboard/WidgetsTab.js:31`.
 */
"use strict";

function expandToComponentRows(installedWidgets) {
  if (!Array.isArray(installedWidgets)) return [];
  const out = [];
  for (const w of installedWidgets) {
    if (!w || typeof w !== "object") continue;
    if (typeof w.name !== "string" || !w.name) continue;
    const components = Array.isArray(w.componentNames) ? w.componentNames : [];
    if (components.length === 0) {
      out.push(w);
      continue;
    }
    const scope = w.scope ? String(w.scope).replace(/^@/, "") : null;
    const pkgName = w.packageId
      ? String(w.packageId).replace(/^@[^/]+\//, "")
      : null;
    for (const comp of components) {
      if (typeof comp !== "string" || !comp) continue;
      let id;
      if (scope && pkgName) id = `${scope}.${pkgName}.${comp}`;
      else if (pkgName) id = `${pkgName}.${comp}`;
      else id = comp;
      out.push({ ...w, name: id });
    }
  }
  return out;
}

module.exports = { expandToComponentRows };
