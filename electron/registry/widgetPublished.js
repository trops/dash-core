/**
 * widgetPublished.js — what a widget package was when it was last published
 * from (or installed into) this computer, so Publish knows whether the copy
 * here has changes nobody has published yet (DASH-22 follow-up).
 *
 * Kept beside the package as .dash-published.json — a dot file, so it's
 * never zipped into a publish. It holds the version and a hash of the
 * package's own files: every path with its contents, leaving out what Dash
 * writes itself (package.json, dash.json), builds (dist) and node_modules.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RECORD = ".dash-published.json";
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);
const SKIP_TOP = new Set(["package.json", "dash.json", "package-lock.json"]);

/** A hash of the package's own files (contents, not dates). */
function contentHash(dir) {
  const hash = crypto.createHash("sha256");
  const walk = (abs, rel) => {
    let names;
    try {
      names = fs.readdirSync(abs, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(abs, e.name), childRel);
      } else if (!(rel === "" && SKIP_TOP.has(e.name))) {
        try {
          hash.update(`${childRel}\n`);
          hash.update(fs.readFileSync(path.join(abs, e.name)));
          hash.update("\n");
        } catch (_e) {
          // unreadable: left out
        }
      }
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

/** The record, or null. */
function readRecord(dir) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, RECORD), "utf8"));
    return r && typeof r.hash === "string" ? r : null;
  } catch (_e) {
    return null;
  }
}

/** Notes that the package as it is now is `version` (published or installed). */
function writeRecord(dir, version) {
  if (!dir || !version) return;
  try {
    fs.writeFileSync(
      path.join(dir, RECORD),
      JSON.stringify(
        { version, hash: contentHash(dir), at: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  } catch (_e) {
    // a read-only folder: Publish then treats it as changed
  }
}

/**
 * Whether the copy here changed since it was last published or installed.
 * @returns {{ changed: boolean|null, basedOn: string|null }} — changed null:
 *   no record, so it can't be told (treated as changed).
 */
function changedSince(dir) {
  if (!dir) return { changed: null, basedOn: null };
  const r = readRecord(dir);
  if (!r) return { changed: null, basedOn: null };
  return { changed: contentHash(dir) !== r.hash, basedOn: r.version || null };
}

module.exports = { RECORD, contentHash, readRecord, writeRecord, changedSince };
