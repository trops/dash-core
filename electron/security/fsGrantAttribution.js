/**
 * fsGrantAttribution.js
 *
 * Every widget used to share one WidgetApi object, so a widget's file
 * read or write was tagged with whichever widget rendered last. Approving
 * the prompt then granted that other widget the file (on Kitchen Sink,
 * NotificationWidget held NotepadWidget's data file). Widgets now each get
 * their own api; this drops the grants that mix-up left behind.
 *
 * A widget's data file is named `<dashboard>-<scope.package.Component>-<n>.json`.
 * A file path naming a DIFFERENT widget is removed from a grant; every
 * other path (another shape, a wildcard, the widget's own files) stays.
 *
 * Pure (no I/O). Idempotent.
 */
"use strict";

const WIDGET_DATA_FILE = /^\d+-(.+)-\d+\.json$/;

/** The widget a data file belongs to, or null when the name isn't one. */
function dataFileOwner(filename) {
  if (typeof filename !== "string") return null;
  const m = WIDGET_DATA_FILE.exec(filename);
  if (!m) return null;
  return m[1].split(".").length === 3 ? m[1] : null;
}

const belongsElsewhere = (widgetId) => (p) => {
  const owner = dataFileOwner(p);
  return owner !== null && owner !== widgetId;
};

/**
 * @param {object} grants  widgetId → grant, as stored in widgetMcpGrants.json
 * @returns {{ grants: object, removed: number }} a copy without the
 *   mis-attributed paths (the input is not mutated)
 */
function dropMisattributedFsPaths(grants) {
  if (!grants || typeof grants !== "object") return { grants, removed: 0 };
  let removed = 0;
  const out = {};
  for (const [widgetId, grant] of Object.entries(grants)) {
    const fsPerms = grant && grant.domains && grant.domains.fs;
    if (!fsPerms || typeof fsPerms !== "object") {
      out[widgetId] = grant;
      continue;
    }
    const foreign = belongsElsewhere(widgetId);
    const nextFs = { ...fsPerms };
    for (const key of ["readPaths", "writePaths"]) {
      if (!Array.isArray(fsPerms[key])) continue;
      const kept = fsPerms[key].filter((p) => !foreign(p));
      removed += fsPerms[key].length - kept.length;
      nextFs[key] = kept;
    }
    out[widgetId] = { ...grant, domains: { ...grant.domains, fs: nextFs } };
  }
  return { grants: removed ? out : grants, removed };
}

module.exports = { dataFileOwner, dropMisattributedFsPaths };
