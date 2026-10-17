/**
 * widgetLibraries.js — download a widget package's own libraries from npm
 * so the app can build its checked source with them (consolidation Phase
 * 1a-3). A package lists them in package.json `dependencies` (publishing
 * records them, utils/libraryImports.js).
 *
 * installLibraries(dependencies) lays the libraries out as a node_modules
 * folder in a temp directory — the versions asked for, what they depend on
 * and the libraries they expect beside them (peers), shared where they
 * agree and kept beside what needs them where they don't — and the
 * compiler reads them from there (esbuild nodePaths). Nothing is written
 * into the package.
 *
 * Safety: files come over HTTPS from npm's own server only; every file
 * must match the fingerprint npm publishes for it (dist.integrity, else
 * dist.shasum) and the verified bytes are what's unpacked; archives are
 * unpacked as plain files and folders (no links, nothing outside the
 * target); library names are checked; nothing a library ships is ever run;
 * libraries the app provides (React, dash-react…) are never downloaded;
 * downloads, unpacked size and package count are capped, and every request
 * — body included — times out.
 *
 * Cache (userData/widget-libraries): downloaded files by fingerprint, and
 * npm's answers about each library (fresh for a day, used past that when
 * npm can't be reached) — so a package builds offline once its libraries
 * were downloaded.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { isHostProvided } = require("./utils/libraryImports");

const REGISTRY = "https://registry.npmjs.org";
const REGISTRY_HOST = "registry.npmjs.org";
const DEFAULT_LIMITS = {
  maxPackages: 500,
  maxBytes: 250 * 1024 * 1024, // downloaded
  maxUnpackedBytes: 750 * 1024 * 1024,
  timeoutMs: 60 * 1000,
  packumentTtlMs: 24 * 60 * 60 * 1000,
  maxCacheBytes: 1024 * 1024 * 1024,
};
let limits = { ...DEFAULT_LIMITS };

let fetchImpl = null; // tests: a fake registry
let cacheDirOverride = null;
function setLibraryFetch(fn) {
  fetchImpl = typeof fn === "function" ? fn : null;
}
function setLibraryCacheDir(dir) {
  cacheDirOverride = dir || null;
}
/** Tests: smaller limits; null puts the defaults back. */
function setLibraryLimits(over) {
  limits = { ...DEFAULT_LIMITS, ...(over || {}) };
}

function cacheDir() {
  if (cacheDirOverride) return cacheDirOverride;
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "widget-libraries");
  } catch (_e) {
    return path.join(os.tmpdir(), "dash-widget-libraries");
  }
}

function semver() {
  return require("semver");
}

// npm's package-name rules (older packages may use capitals), with no
// "." or ".." part — a name becomes a folder.
const VALID_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
function checkName(name) {
  if (typeof name !== "string" || name.length > 214 || !VALID_NAME.test(name)) {
    throw new Error(`"${name}" isn't a valid library name.`);
  }
}

/** A promise that gives up after the time limit, saying what took long. */
function inTime(promise, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`${what} took too long — npm stopped answering.`)),
        limits.timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** GET from npm's server → { ok, status, res }; body read separately. */
async function request(url, what) {
  let host = "";
  try {
    const u = new URL(url);
    host = u.protocol === "https:" ? u.hostname : "";
  } catch (_e) {
    host = "";
  }
  if (host !== REGISTRY_HOST) {
    throw new Error(
      `${what} isn't on npm's own server (${url}), so it wasn't downloaded.`,
    );
  }
  const controller = fetchImpl ? null : new AbortController();
  const res = await inTime(
    fetchImpl
      ? fetchImpl(url)
      : fetch(url, {
          signal: controller.signal,
          redirect: "error",
          headers: {
            accept:
              "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8",
          },
        }),
    what,
  ).catch((e) => {
    if (controller) controller.abort();
    throw e;
  });
  return { res, controller };
}

/** The body, read within the time limit (aborting the request if not). */
async function body(res, controller, kind, what) {
  try {
    return await inTime(kind === "json" ? res.json() : res.arrayBuffer(), what);
  } catch (e) {
    if (controller) controller.abort();
    throw e;
  }
}

// ---------- npm's answers about a library (packuments), cached ----------
function packumentFile(name) {
  return path.join(cacheDir(), "packuments", `${name.replace("/", "__")}.json`);
}
function readCachedPackument(name) {
  try {
    return JSON.parse(fs.readFileSync(packumentFile(name), "utf8"));
  } catch (_e) {
    return null;
  }
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function fetchPackument(name) {
  const encoded = name.startsWith("@")
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name);
  const what = `The library "${name}"`;
  const { res, controller } = await request(`${REGISTRY}/${encoded}`, what);
  if (!res.ok) {
    throw Object.assign(
      new Error(`${what} isn't on npm (${res.status || "no answer"}).`),
      { notFound: true },
    );
  }
  const doc = await body(res, controller, "json", what);
  try {
    writeAtomic(
      packumentFile(name),
      JSON.stringify({ fetchedAt: Date.now(), doc }),
    );
  } catch (_e) {
    // cache is best-effort
  }
  return doc;
}

/** npm's answer about `name`: cached if fresh, else asked; stale offline. */
async function packument(name, { fresh = false } = {}) {
  const cached = readCachedPackument(name);
  if (
    !fresh &&
    cached &&
    Date.now() - (cached.fetchedAt || 0) < limits.packumentTtlMs
  ) {
    return { doc: cached.doc, fromCache: true };
  }
  try {
    return { doc: await fetchPackument(name), fromCache: false };
  } catch (e) {
    if (cached && !e.notFound) return { doc: cached.doc, fromCache: true };
    if (e.notFound) throw e;
    throw new Error(
      `Couldn't reach npm for the library "${name}": ${(e && e.message) || e}`,
    );
  }
}

function chooseVersion(doc, range) {
  const versions = Object.keys(doc.versions || {});
  const tags = doc["dist-tags"] || {};
  if (tags[range]) return tags[range];
  if (semver().valid(range)) return versions.includes(range) ? range : null;
  return semver().maxSatisfying(versions, range);
}

/** The version a spec asks for → its manifest. */
async function pick(name, spec) {
  checkName(name);
  const range = String(spec || "latest").trim() || "latest";
  if (
    /^(?:git\+|git:|github:|file:|link:|https?:|npm:|workspace:)|\//.test(range)
  ) {
    throw new Error(
      `The library "${name}" is listed as "${range}", which can't be downloaded — only npm versions and ranges can.`,
    );
  }
  let { doc, fromCache } = await packument(name);
  let version = chooseVersion(doc, range);
  if (!version && fromCache) {
    // Published since npm was last asked?
    try {
      ({ doc } = await packument(name, { fresh: true }));
      version = chooseVersion(doc, range);
    } catch (_e) {
      // offline: fall through to "isn't on npm"
    }
  }
  if (!version || !doc.versions[version]) {
    throw new Error(`The library ${name}@${range} isn't on npm.`);
  }
  return doc.versions[version];
}

/**
 * Where each library goes: { name, version, dist, dir } in install order.
 * A library is shared when what resolves from the requiring package already
 * satisfies it; otherwise it's kept beside the package that needs it. A
 * peer (a library one expects beside it) is placed as the requirer's
 * sibling — unless the app provides it, or it's optional.
 */
async function plan(dependencies) {
  const root = { children: new Map(), dir: "", parent: null };
  const out = [];
  const queue = Object.entries(dependencies || {}).map(([name, spec]) => ({
    parent: root,
    name,
    spec,
  }));
  while (queue.length) {
    const { parent, name, spec } = queue.shift();
    if (isHostProvided(name)) continue;
    checkName(name);
    let found = null;
    for (let n = parent; n; n = n.parent) {
      if (n.children.has(name)) {
        found = n.children.get(name);
        break;
      }
    }
    const range = String(spec || "").trim() || "*";
    if (
      found &&
      semver().validRange(range) &&
      semver().satisfies(found.version, range)
    ) {
      continue;
    }
    const manifest = await pick(name, spec);
    if (found && found.version === manifest.version) continue;
    const at = found ? parent : root;
    const node = {
      name,
      version: manifest.version,
      dist: manifest.dist || {},
      parent: at,
      children: new Map(),
      dir: path.join(at.dir, "node_modules", ...name.split("/")),
    };
    at.children.set(name, node);
    out.push(node);
    if (out.length > limits.maxPackages) {
      throw new Error(
        `This widget's libraries need more than ${limits.maxPackages} packages — too many to download.`,
      );
    }
    // What a library needs to run (not optional dependencies).
    for (const [dn, ds] of Object.entries(manifest.dependencies || {})) {
      queue.push({ parent: node, name: dn, spec: ds });
    }
    // Libraries it expects beside it.
    const peerMeta = manifest.peerDependenciesMeta || {};
    for (const [pn, ps] of Object.entries(manifest.peerDependencies || {})) {
      if (peerMeta[pn] && peerMeta[pn].optional) continue;
      queue.push({ parent: at, name: pn, spec: ps });
    }
  }
  return out;
}

/** Does the file match npm's fingerprint for it? */
function matches(buf, dist) {
  const integrity = String(dist.integrity || "");
  for (const part of integrity.split(/\s+/)) {
    const m = /^(sha512|sha384|sha256)-(.+)$/.exec(part);
    if (m) {
      return (
        crypto.createHash(m[1]).update(buf).digest("base64") ===
        m[2].replace(/\?.*$/, "")
      );
    }
  }
  if (dist.shasum) {
    return crypto.createHash("sha1").update(buf).digest("hex") === dist.shasum;
  }
  return false;
}

/** The library's archive, verified → its bytes (from the cache or npm). */
async function tarball(node, budget) {
  const label = `${node.name}@${node.version}`;
  const key = crypto
    .createHash("sha256")
    .update(String(node.dist.integrity || node.dist.shasum || label))
    .digest("hex");
  const cached = path.join(cacheDir(), "tarballs", `${key}.tgz`);
  if (fs.existsSync(cached)) {
    const buf = fs.readFileSync(cached);
    if (matches(buf, node.dist)) return buf;
    fs.rmSync(cached, { force: true });
  }
  const what = `The library ${label}`;
  let res;
  let controller;
  try {
    ({ res, controller } = await request(
      String(node.dist.tarball || ""),
      what,
    ));
  } catch (e) {
    if (/npm's own server|took too long/.test((e && e.message) || "")) throw e;
    throw new Error(
      `Couldn't download the library ${label}: ${(e && e.message) || e}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Couldn't download the library ${label} (${res.status || "no answer"}).`,
    );
  }
  const announced = Number(
    (res.headers && res.headers.get && res.headers.get("content-length")) || 0,
  );
  if (announced && budget.bytes + announced > limits.maxBytes) {
    if (controller) controller.abort();
    throw new Error(
      "This widget's libraries are too large to download (over 250 MB).",
    );
  }
  const buf = Buffer.from(await body(res, controller, "buffer", what));
  budget.bytes += buf.length;
  if (budget.bytes > limits.maxBytes) {
    throw new Error(
      "This widget's libraries are too large to download (over 250 MB).",
    );
  }
  if (!matches(buf, node.dist)) {
    throw new Error(
      `The download of ${label} doesn't match npm's fingerprint for it, so it wasn't used.`,
    );
  }
  try {
    writeAtomic(cached, buf);
  } catch (_e) {
    // cache is best-effort
  }
  return buf;
}

const PLAIN = new Set(["File", "OldFile", "ContiguousFile", "Directory"]);

/** Unpack verified archive bytes into dest: plain files and folders only. */
function unpack(buf, dest, budget, label) {
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    let tooBig = false;
    const extract = require("tar").x({
      cwd: dest,
      strip: 1,
      filter: (_p, entry) => {
        if (!entry || !PLAIN.has(entry.type)) return false;
        budget.unpacked += entry.size || 0;
        if (budget.unpacked > limits.maxUnpackedBytes) tooBig = true;
        return !tooBig;
      },
    });
    extract.on("error", reject);
    extract.on("finish", () =>
      tooBig
        ? reject(
            new Error(
              `This widget's libraries are too large once unpacked (at ${label}).`,
            ),
          )
        : resolve(),
    );
    extract.end(buf);
  });
}

/** Keep the download cache under its size: oldest files go first. */
function pruneCache() {
  const dir = path.join(cacheDir(), "tarballs");
  let files;
  try {
    files = fs.readdirSync(dir).map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtimeMs };
    });
  } catch (_e) {
    return;
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= limits.maxCacheBytes) return;
  for (const f of files.sort((a, b) => a.at - b.at)) {
    if (total <= limits.maxCacheBytes * 0.8) break;
    fs.rmSync(path.join(dir, f.name), { force: true });
    total -= f.size;
  }
}

/**
 * Download `dependencies` ({ name: version or range }) and what they need
 * into a temp node_modules. → { nodeModules, cleanup() }; cleanup removes
 * it. Throws a plain-language error naming the library when one can't be
 * found, downloaded or trusted.
 */
async function installLibraries(dependencies) {
  const nodes = await plan(dependencies);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dash-widget-libs-"));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    const budget = { bytes: 0, unpacked: 0 };
    for (const node of nodes) {
      const dest = path.resolve(root, node.dir);
      if (!dest.startsWith(path.resolve(root) + path.sep)) {
        throw new Error(`"${node.name}" isn't a valid library name.`);
      }
      const buf = await tarball(node, budget);
      await unpack(buf, dest, budget, `${node.name}@${node.version}`);
    }
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    pruneCache();
    return { nodeModules: path.join(root, "node_modules"), cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** A package's listed libraries (package.json dependencies), or null. */
function listedLibraries(packageDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
    );
    const deps = pkg && pkg.dependencies;
    if (!deps || typeof deps !== "object") return null;
    const own = Object.entries(deps).filter(([n]) => !isHostProvided(n));
    return own.length ? Object.fromEntries(own) : null;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  installLibraries,
  listedLibraries,
  setLibraryFetch,
  setLibraryCacheDir,
  setLibraryLimits,
};
