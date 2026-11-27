/**
 * packageStore.js — the check packages installed on this computer
 * (DASH-106): one folder each under <root>/<scope>/<name>/, with its
 * check.json, its file and where it came from (source.json).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  readCheckFiles,
  parsePackageRef,
  packageSummary,
} = require("./checkPackage");
const { starterPackage, STARTERS, BUILT_INS } = require("./starterPackages");

/**
 * @param {{ root: string }} opts  the folder installed packages live in
 */
function createPackageStore({ root }) {
  const dirOf = (ref) => {
    const r = parsePackageRef(ref);
    if (!r || !r.scope) return null;
    return path.join(root, r.scope, r.name);
  };

  function readDir(dir) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (_e) {
      return null;
    }
    const files = {};
    for (const n of names) {
      if (n === "source.json") continue;
      try {
        files[n] = fs.readFileSync(path.join(dir, n), "utf8");
      } catch (_e) {
        // Unreadable: left out, and the package reads as broken.
      }
    }
    const read = readCheckFiles(files);
    if (read.error) return null;
    let source = {};
    try {
      source = JSON.parse(
        fs.readFileSync(path.join(dir, "source.json"), "utf8"),
      );
    } catch (_e) {
      source = {};
    }
    return { manifest: read.manifest, files: read.files, source };
  }

  return {
    /** A package by ref: installed (@scope/name), or one Dash ships (name). */
    get(ref) {
      const r = parsePackageRef(ref);
      if (!r) return null;
      if (!r.scope) return starterPackage(r.name);
      const dir = dirOf(ref);
      const pkg = dir ? readDir(dir) : null;
      return pkg
        ? { ...pkg, id: r.id, source: pkg.source.from || "registry" }
        : null;
    },

    /** Every package: Dash's, then installed ones, and the built-in kinds. */
    list() {
      const out = STARTERS.map((s) =>
        packageSummary(s.manifest, { id: s.manifest.name, source: "dash" }),
      );
      let scopes = [];
      try {
        scopes = fs.readdirSync(root);
      } catch (_e) {
        scopes = [];
      }
      for (const scope of scopes.sort()) {
        let names = [];
        try {
          names = fs.readdirSync(path.join(root, scope));
        } catch (_e) {
          continue;
        }
        for (const name of names.sort()) {
          const pkg = readDir(path.join(root, scope, name));
          if (!pkg) continue;
          out.push(
            packageSummary(pkg.manifest, {
              id: `@${scope}/${name}`,
              source: pkg.source.from || "registry",
              installedAt: pkg.source.installedAt || null,
            }),
          );
        }
      }
      return {
        packages: out,
        builtIns: BUILT_INS.map((b) => ({ ...b, source: "built-in" })),
      };
    },

    /**
     * Install (or update) a package's files as @scope/name.
     * @returns {{ ok: true, id, manifest } | { error }}
     */
    install({ scope, name, files, from = "registry", version = null }) {
      const ref = `@${scope}/${name}`;
      const r = parsePackageRef(ref);
      if (!r || !r.scope) return { error: `"${ref}" isn't a package's name` };
      const read = readCheckFiles(files);
      if (read.error) return { error: read.error };
      const dir = dirOf(ref);
      const tmp = `${dir}.installing`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      for (const [f, body] of Object.entries(read.files)) {
        fs.writeFileSync(path.join(tmp, f), body, {
          mode: f === read.manifest.run ? 0o755 : 0o644,
        });
      }
      fs.writeFileSync(
        path.join(tmp, "source.json"),
        JSON.stringify({
          from,
          version: version || read.manifest.version,
          installedAt: new Date().toISOString(),
        }),
      );
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      return { ok: true, id: r.id, manifest: read.manifest };
    },

    /** Remove an installed package. */
    remove(ref) {
      const dir = dirOf(ref);
      if (!dir || !fs.existsSync(dir))
        return { error: `"${ref}" isn't installed` };
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    },

    has(ref) {
      return !!this.get(ref);
    },
  };
}

module.exports = { createPackageStore };
