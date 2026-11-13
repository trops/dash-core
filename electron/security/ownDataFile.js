/**
 * ownDataFile.js
 *
 * A widget copy's own data file: "<widget>--<copy>.json" in Dash's data
 * folder (the renderer names it — src/Api/WidgetApi.js ownDataFilename;
 * keep the two in step). Reading and writing it is the widget keeping its
 * own state, so the fs gate never asks the user about it.
 */
"use strict";

const safePart = (s) =>
  String(s == null ? "" : s).replace(/[^A-Za-z0-9._-]/g, "_");

/** Is `filename` this widget's own data file (any of its copies)? */
function isOwnDataFile(widgetId, filename) {
  if (!widgetId || typeof filename !== "string") return false;
  const prefix = `${safePart(widgetId)}--`;
  if (!filename.startsWith(prefix) || !filename.endsWith(".json")) {
    return false;
  }
  // A plain file name only — no folders, no "..".
  const copy = filename.slice(prefix.length, -".json".length);
  return !!copy && /^[A-Za-z0-9._-]+$/.test(copy) && !copy.includes("..");
}

module.exports = { isOwnDataFile };
