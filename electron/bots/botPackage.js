/**
 * botPackage.js
 *
 * Single bots and teams as registry packages (bot-teams TEAM-006 slice 3a,
 * bot-factory US-026). A single bot travels as `bot.json` — one bot embedded
 * exactly like a team member in `team.json` — so both share teamManifest.js's
 * export rules (providers by type; never ids, provider names, grants,
 * sessions or credentials). `registryManifestFor` builds the publish
 * manifest the registry validates and stores (dash-registry ≥ 1.6.0):
 * `type`, `providerTypes`, and a `team` or `bot` display summary.
 *
 * Pure (NFR-006): decisions only; botRegistryController zips and publishes.
 */
"use strict";

const { buildTeamManifest, validateTeamManifest } = require("./teamManifest");

const PACKAGE_TYPE_BOT = "bot";
const PACKAGE_TYPE_TEAM = "bot-team";
// The registry's own rules (dash-registry src/lib/validate.ts).
const PACKAGE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z-]+)?$/;

/**
 * One bot as a `bot.json` package.
 * @returns {{ pkg: object, notIncluded: string[] }}
 */
function buildBotPackage({ bot, providers, description = "" }) {
  const { manifest, notIncluded } = buildTeamManifest({
    name: bot && bot.name,
    description,
    bots: bot ? [bot] : [],
    providers,
  });
  const member = manifest.members[0];
  return {
    pkg: {
      schemaVersion: manifest.schemaVersion,
      type: PACKAGE_TYPE_BOT,
      name: (bot && bot.name) || "",
      description: String(description || ""),
      version: "1.0.0",
      bot: member ? member.embedded : null,
    },
    // One bot has no team: any bot that triggers it is just "another bot".
    notIncluded: notIncluded.map((n) =>
      n.replace("(a bot outside this team)", "(another bot)"),
    ),
  };
}

/** A bot package as a one-bot team, so installs reuse the team path. */
function toTeamManifest(pkg) {
  const role =
    String(pkg.bot.name || "bot")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "bot";
  return {
    schemaVersion: pkg.schemaVersion,
    type: PACKAGE_TYPE_TEAM,
    name: pkg.name,
    description: pkg.description || "",
    version: pkg.version || "1.0.0",
    members: [{ role, embedded: pkg.bot }],
    wiring: [],
  };
}

/**
 * Check a `bot.json` and return a clean copy (unknown fields dropped) —
 * the bot itself is checked by the team rules.
 * @returns {{ valid: boolean, errors: string[], pkg: object|null }}
 */
function validateBotPackage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["not a bot file"], pkg: null };
  }
  if (input.type !== PACKAGE_TYPE_BOT) {
    return { valid: false, errors: ['type must be "bot"'], pkg: null };
  }
  if (!input.bot || typeof input.bot !== "object") {
    return { valid: false, errors: ["bot is required"], pkg: null };
  }
  const asTeam = validateTeamManifest({
    schemaVersion: input.schemaVersion,
    type: PACKAGE_TYPE_TEAM,
    name: input.name,
    description: input.description,
    version: input.version,
    members: [{ role: "bot", embedded: input.bot }],
    wiring: [],
  });
  if (!asTeam.valid) {
    return {
      valid: false,
      errors: asTeam.errors.map((e) => e.replace(/^member 1: /, "")),
      pkg: null,
    };
  }
  const m = asTeam.manifest;
  return {
    valid: true,
    errors: [],
    pkg: {
      schemaVersion: m.schemaVersion,
      type: PACKAGE_TYPE_BOT,
      name: m.name,
      description: m.description,
      version: m.version,
      bot: m.members[0].embedded,
    },
  };
}

function providerTypesOf(members) {
  const out = [];
  for (const e of members) {
    for (const p of (e && e.providers) || []) {
      if (p && p.type && !out.includes(p.type)) out.push(p.type);
    }
  }
  return out;
}

/**
 * The manifest sent with the zip to the registry's /api/publish.
 * @param {object} pkg  a team manifest (team.json) or bot package (bot.json)
 * @param {{ scope, name, displayName, version, description?, visibility?,
 *           appOrigin, author? }} meta
 */
function registryManifestFor(pkg, meta) {
  const isTeam = pkg.type === PACKAGE_TYPE_TEAM;
  const embedded = isTeam ? pkg.members.map((m) => m.embedded) : [pkg.bot];
  const manifest = {
    scope: meta.scope,
    name: meta.name,
    displayName: meta.displayName,
    version: meta.version,
    description: meta.description || "",
    author: meta.author || "",
    appOrigin: meta.appOrigin,
    // Private unless the publisher chose public (decided 2026-10-05):
    // instructions can hold personal details.
    visibility: meta.visibility === "public" ? "public" : "private",
    type: isTeam ? PACKAGE_TYPE_TEAM : PACKAGE_TYPE_BOT,
    providerTypes: providerTypesOf(embedded),
  };
  if (isTeam) {
    manifest.team = {
      members: pkg.members.map((m) => ({
        role: m.role,
        name: m.embedded.name,
      })),
      wiring: pkg.wiring.map((w) => ({
        role: w.role,
        on: { role: w.on.role, event: w.on.event },
      })),
    };
  } else {
    manifest.bot = { name: pkg.bot.name };
  }
  return manifest;
}

/** A registry package name (kebab-case, 2–50 chars) from a display name. */
function toPackageName(displayName) {
  let s = String(displayName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "my-bot";
  if (!/^[a-z]/.test(s)) s = `bot-${s}`;
  if (s.length < 2) s = `${s}-bot`;
  return s.slice(0, 50).replace(/-+$/, "");
}

/** 1.0.0 for a first publish, else the last published version + a patch. */
function nextVersion(lastVersion) {
  const m = typeof lastVersion === "string" && lastVersion.match(SEMVER_RE);
  if (!m) return "1.0.0";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** The publish fields the registry will reject, checked up front. */
function checkPublishMeta({ name, displayName, version, description }) {
  const errors = [];
  if (
    typeof name !== "string" ||
    !PACKAGE_NAME_RE.test(name) ||
    name.length < 2 ||
    name.length > 50
  ) {
    errors.push(
      "Package name must be 2–50 lowercase letters, digits and dashes, starting with a letter.",
    );
  }
  if (
    typeof displayName !== "string" ||
    !displayName.trim() ||
    displayName.length > 100
  ) {
    errors.push("Name is required (at most 100 characters).");
  }
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    errors.push("Version must look like 1.0.0.");
  }
  if (description && String(description).length > 500) {
    errors.push("Description must be at most 500 characters.");
  }
  return errors;
}

/** The files in a published package's zip. */
function publishFiles(pkg, registryManifest) {
  return [
    { name: "manifest.json", text: JSON.stringify(registryManifest, null, 2) },
    {
      name: pkg.type === PACKAGE_TYPE_TEAM ? "team.json" : "bot.json",
      text: JSON.stringify(pkg, null, 2),
    },
  ];
}

module.exports = {
  publishFiles,
  PACKAGE_TYPE_BOT,
  PACKAGE_TYPE_TEAM,
  buildBotPackage,
  validateBotPackage,
  toTeamManifest,
  registryManifestFor,
  toPackageName,
  nextVersion,
  checkPublishMeta,
};
