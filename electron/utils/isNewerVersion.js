/**
 * isNewerVersion — true when `latest` is a higher version than `installed`.
 *
 * The widget update check used to flag any difference, so a package
 * installed locally at a newer version than the registry's was offered a
 * "downgrade" as an update. Compares dotted numeric parts
 * (`0.0.911` vs `0.0.875`); a pre-release tag (`1.0.0-beta`) sorts before
 * its release. Unparseable versions fall back to "different = newer" so a
 * strange version string never hides a real update.
 */
"use strict";

function _parse(v) {
  if (typeof v !== "string") return null;
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+(?:\.\d+)*)(?:-(.+))?$/);
  if (!m) return null;
  return { parts: m[1].split(".").map(Number), pre: m[2] || null };
}

function isNewerVersion(latest, installed) {
  if (!latest || latest === installed) return false;
  const a = _parse(latest);
  const b = _parse(installed);
  if (!a || !b) return latest !== installed;
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const x = a.parts[i] || 0;
    const y = b.parts[i] || 0;
    if (x !== y) return x > y;
  }
  // Same numbers: a release beats a pre-release.
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  return false;
}

module.exports = { isNewerVersion };
